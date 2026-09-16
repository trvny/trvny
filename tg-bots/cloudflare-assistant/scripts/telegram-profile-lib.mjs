import { extname } from "node:path";

const USAGE = "Usage: telegram:profile -- set <photo.jpg|animation.mp4> [--frame <seconds>] | remove | audio [user-id] [--limit 1..100] | name <text> [--lang xx] | description <text> [--lang xx] | short-description <text> [--lang xx]";
const DEFAULT_PROFILE_AUDIO_LIMIT = 20;
const PROFILE_TEXT_FIELDS = {
  name: { maxChars: 64, method: "setMyName", bodyKey: "name" },
  description: { maxChars: 512, method: "setMyDescription", bodyKey: "description" },
  "short-description": { maxChars: 120, method: "setMyShortDescription", bodyKey: "short_description" },
};

function setCommand(args) {
  const [path, ...rest] = args;
  if (!path) throw new Error(USAGE);

  const extension = extname(path).toLowerCase();
  let kind;
  if (extension === ".jpg" || extension === ".jpeg") kind = "static";
  else if (extension === ".mp4") kind = "animated";
  else throw new Error("Telegram profile photos must be JPG or MP4");

  const command = { action: "set", path, kind };
  if (!rest.length) return command;
  if (rest.length !== 2 || rest[0] !== "--frame") throw new Error(USAGE);
  if (kind !== "animated") throw new Error("--frame is valid only for animated MP4 profile photos");

  const mainFrameTimestamp = Number(rest[1]);
  if (!Number.isFinite(mainFrameTimestamp) || mainFrameTimestamp < 0) {
    throw new Error("Animated profile frame timestamp must be a non-negative number");
  }
  return { ...command, mainFrameTimestamp };
}

function parseUserId(raw) {
  if (!/^\d+$/u.test(raw)) throw new Error("Telegram profile audio user id must be a positive integer");
  const userId = Number(raw);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Telegram profile audio user id must be a positive safe integer");
  }
  return userId;
}

function profileTextCommand(action, args) {
  const field = PROFILE_TEXT_FIELDS[action];
  const [value, ...rest] = args;
  if (!field || value === undefined) throw new Error(USAGE);
  if ([...value].length > field.maxChars) {
    throw new Error(`Telegram profile ${action} must be at most ${field.maxChars} characters`);
  }

  let languageCode;
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== "--lang") throw new Error(USAGE);
    if (!/^[a-z]{2}$/iu.test(rest[1])) {
      throw new Error("Telegram profile language code must be a two-letter ISO 639-1 code");
    }
    languageCode = rest[1].toLowerCase();
  }
  return { action, value, ...(languageCode === undefined ? {} : { languageCode }) };
}

function audioCommand(args) {
  const rest = [...args];
  let userId;
  if (rest[0] && rest[0] !== "--limit") userId = parseUserId(rest.shift());

  let limit = DEFAULT_PROFILE_AUDIO_LIMIT;
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== "--limit") throw new Error(USAGE);
    limit = Number(rest[1]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Telegram profile audio limit must be an integer from 1 to 100");
    }
  }
  return { action: "audio", ...(userId === undefined ? {} : { userId }), limit };
}

export function parseProfileCommand(args) {
  const [action, ...rest] = args;
  if (action === "remove") {
    if (rest.length) throw new Error(USAGE);
    return { action: "remove" };
  }
  if (action === "set") return setCommand(rest);
  if (action === "audio") return audioCommand(rest);
  if (action in PROFILE_TEXT_FIELDS) return profileTextCommand(action, rest);
  throw new Error(USAGE);
}

export function profileTextRequest(command) {
  const field = PROFILE_TEXT_FIELDS[command?.action];
  if (!field) throw new Error("Profile text request requires a profile text command");
  return {
    method: field.method,
    body: {
      [field.bodyKey]: command.value,
      ...(command.languageCode === undefined ? {} : { language_code: command.languageCode }),
    },
  };
}

export function profileAudioSummary(result) {
  return {
    totalCount: Number.isSafeInteger(result?.total_count) ? result.total_count : 0,
    audios: Array.isArray(result?.audios)
      ? result.audios.map((audio) => ({
          fileId: audio.file_id,
          fileUniqueId: audio.file_unique_id,
          durationSeconds: audio.duration,
          ...(audio.performer === undefined ? {} : { performer: audio.performer }),
          ...(audio.title === undefined ? {} : { title: audio.title }),
          ...(audio.file_name === undefined ? {} : { fileName: audio.file_name }),
          ...(audio.mime_type === undefined ? {} : { mimeType: audio.mime_type }),
          ...(audio.file_size === undefined ? {} : { fileSize: audio.file_size }),
        }))
      : [],
  };
}

export function profilePhotoDescriptor(command) {
  if (command.action !== "set") throw new Error("Profile photo descriptor requires a set command");
  if (command.kind === "static") {
    return { type: "static", photo: "attach://profile" };
  }
  if (command.kind !== "animated") throw new Error("Unsupported profile photo kind");
  return {
    type: "animated",
    animation: "attach://profile",
    ...(command.mainFrameTimestamp === undefined
      ? {}
      : { main_frame_timestamp: command.mainFrameTimestamp }),
  };
}
