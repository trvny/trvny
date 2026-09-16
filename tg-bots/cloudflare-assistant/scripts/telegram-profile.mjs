import { basename, resolve } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

import {
  parseProfileCommand,
  profileAudioSummary,
  profilePhotoDescriptor,
  profileTextRequest,
} from "./telegram-profile-lib.mjs";

const STATIC_PROFILE_MAX_BYTES = 10 * 1024 * 1024;
const ANIMATED_PROFILE_MAX_BYTES = 50 * 1024 * 1024;

function loadDevVars() {
  if (!existsSync(".dev.vars")) return;
  for (const raw of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    process.env[key] ??= value;
  }
}

function telegramError(method, response, payload) {
  const description = typeof payload?.description === "string"
    ? payload.description.slice(0, 300)
    : `HTTP ${response.status}`;
  return new Error(`${method} failed: ${description}`);
}

async function telegramJson(api, method, body) {
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw telegramError(method, response, payload);
  return payload.result;
}

async function setProfilePhoto(api, command) {
  const filePath = resolve(command.path);
  if (!existsSync(filePath)) throw new Error(`Profile media file not found: ${command.path}`);
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error(`Profile media path is not a file: ${command.path}`);

  const maxBytes = command.kind === "static" ? STATIC_PROFILE_MAX_BYTES : ANIMATED_PROFILE_MAX_BYTES;
  if (stat.size > maxBytes) {
    throw new Error(`Profile media exceeds the hosted Bot API upload limit (${maxBytes / 1024 / 1024} MB)`);
  }

  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.set("photo", JSON.stringify(profilePhotoDescriptor(command)));
  form.set(
    "profile",
    new Blob([bytes], { type: command.kind === "static" ? "image/jpeg" : "video/mp4" }),
    basename(filePath),
  );

  const response = await fetch(`${api}/setMyProfilePhoto`, { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw telegramError("setMyProfilePhoto", response, payload);
}

async function main() {
  loadDevVars();
  const command = parseProfileCommand(process.argv.slice(2));
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing (.dev.vars is supported)");
  const api = `https://api.telegram.org/bot${token}`;

  if (command.action === "remove") {
    await telegramJson(api, "removeMyProfilePhoto");
    console.log("Botek profile photo removed.");
    return;
  }

  if (command.action === "audio") {
    const rawUserId = command.userId ?? Number(process.env.OWNER_TELEGRAM_USER_ID);
    if (!Number.isSafeInteger(rawUserId) || rawUserId <= 0) {
      throw new Error("Profile audio requires a user id or OWNER_TELEGRAM_USER_ID");
    }
    const result = await telegramJson(api, "getUserProfileAudios", {
      user_id: rawUserId,
      limit: command.limit,
    });
    console.log(JSON.stringify(profileAudioSummary(result), null, 2));
    return;
  }

  if (["name", "description", "short-description"].includes(command.action)) {
    const request = profileTextRequest(command);
    await telegramJson(api, request.method, request.body);
    console.log(`Botek ${command.action} updated.`);
    return;
  }

  await setProfilePhoto(api, command);
  console.log(`Botek ${command.kind} profile photo updated.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
