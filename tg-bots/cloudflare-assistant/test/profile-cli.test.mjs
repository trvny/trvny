import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProfileCommand,
  profilePhotoDescriptor,
} from "../scripts/telegram-profile-lib.mjs";

test("parses static and animated profile photo commands", () => {
  assert.deepEqual(parseProfileCommand(["set", "botek.jpg"]), {
    action: "set",
    path: "botek.jpg",
    kind: "static",
  });
  assert.deepEqual(parseProfileCommand(["set", "botek.mp4", "--frame", "1.5"]), {
    action: "set",
    path: "botek.mp4",
    kind: "animated",
    mainFrameTimestamp: 1.5,
  });
});

test("parses profile photo removal", () => {
  assert.deepEqual(parseProfileCommand(["remove"]), { action: "remove" });
});

test("rejects unsupported profile media and invalid frame timestamps", () => {
  assert.throws(() => parseProfileCommand(["set", "botek.png"]), /JPG or MP4/);
  assert.throws(() => parseProfileCommand(["set", "botek.mp4", "--frame", "-1"]), /frame/i);
  assert.throws(() => parseProfileCommand(["set", "botek.jpg", "--frame", "1"]), /animated/i);
});

test("builds attach descriptors required by Bot API", () => {
  assert.deepEqual(profilePhotoDescriptor({ action: "set", path: "botek.jpg", kind: "static" }), {
    type: "static",
    photo: "attach://profile",
  });
  assert.deepEqual(profilePhotoDescriptor({
    action: "set",
    path: "botek.mp4",
    kind: "animated",
    mainFrameTimestamp: 2.25,
  }), {
    type: "animated",
    animation: "attach://profile",
    main_frame_timestamp: 2.25,
  });
});
