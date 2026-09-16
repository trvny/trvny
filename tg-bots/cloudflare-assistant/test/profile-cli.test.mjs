import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProfileCommand,
  profileAudioSummary,
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

test("parses bounded profile audio inspection", () => {
  assert.deepEqual(parseProfileCommand(["audio"]), { action: "audio", limit: 20 });
  assert.deepEqual(parseProfileCommand(["audio", "123456", "--limit", "5"]), {
    action: "audio",
    userId: 123456,
    limit: 5,
  });
  assert.deepEqual(parseProfileCommand(["audio", "--limit", "100"]), {
    action: "audio",
    limit: 100,
  });
});

test("rejects invalid profile audio targets and limits", () => {
  assert.throws(() => parseProfileCommand(["audio", "abc"]), /user id/i);
  assert.throws(() => parseProfileCommand(["audio", "1", "--limit", "0"]), /limit/i);
  assert.throws(() => parseProfileCommand(["audio", "1", "--limit", "101"]), /limit/i);
});

test("summarizes profile audio metadata without unrelated Telegram fields", () => {
  assert.deepEqual(profileAudioSummary({
    total_count: 3,
    audios: [{
      file_id: "audio-file",
      file_unique_id: "audio-unique",
      duration: 42,
      performer: "Ada",
      title: "Theme",
      file_name: "theme.mp3",
      mime_type: "audio/mpeg",
      file_size: 1234,
      thumbnail: { file_id: "thumb" },
    }],
  }), {
    totalCount: 3,
    audios: [{
      fileId: "audio-file",
      fileUniqueId: "audio-unique",
      durationSeconds: 42,
      performer: "Ada",
      title: "Theme",
      fileName: "theme.mp3",
      mimeType: "audio/mpeg",
      fileSize: 1234,
    }],
  });
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
