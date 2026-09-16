import { extname } from "node:path";

const USAGE = "Usage: telegram:profile -- set <photo.jpg|animation.mp4> [--frame <seconds>] | remove";

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

export function parseProfileCommand(args) {
  const [action, ...rest] = args;
  if (action === "remove") {
    if (rest.length) throw new Error(USAGE);
    return { action: "remove" };
  }
  if (action === "set") return setCommand(rest);
  throw new Error(USAGE);
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
