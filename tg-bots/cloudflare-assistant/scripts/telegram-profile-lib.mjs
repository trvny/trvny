import { extname } from "node:path";

const USAGE = "Usage: telegram:profile -- set <photo.jpg|animation.mp4> [--frame <seconds>] | remove | audio [user-id] [--limit 1..100]";
const DEFAULT_PROFILE_AUDIO_LIMIT = 20;

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
  throw new Error(USAGE);
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
