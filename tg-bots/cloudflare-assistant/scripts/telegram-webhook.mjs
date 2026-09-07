import { existsSync, readFileSync } from "node:fs";

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

loadDevVars();

const [command, webhookUrl] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing (.dev.vars is supported)");

const api = `https://api.telegram.org/bot${token}`;

async function telegram(method, body) {
  const response = await fetch(`${api}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(`${method} failed: ${JSON.stringify(payload)}`);
  return payload.result;
}

switch (command) {
  case "set": {
    if (!webhookUrl) throw new Error("Usage: npm run webhook:set -- https://worker.example/telegram/webhook");
    if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is missing");
    const result = await telegram("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
    });
    console.log("Webhook set:", result);
    break;
  }
  case "info":
    console.log(await telegram("getWebhookInfo"));
    break;
  case "delete":
    console.log("Webhook deleted:", await telegram("deleteWebhook", { drop_pending_updates: false }));
    break;
  case "updates":
    console.dir(await telegram("getUpdates"), { depth: 6 });
    break;
  default:
    console.log("Commands: updates | set <url> | info | delete");
    process.exitCode = 1;
}
