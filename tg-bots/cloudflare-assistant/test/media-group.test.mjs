import assert from "node:assert/strict";
import test from "node:test";

const mediaGroupModule = await import("../src/media-group.ts").catch(() => null);

function albumUpdate(updateId, messageId, fileId) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      media_group_id: "album-7",
      chat: { id: 123, type: "private" },
      from: { id: 123, first_name: "Owner" },
      photo: [{
        file_id: fileId,
        file_unique_id: `${fileId}-unique`,
        width: 320,
        height: 240,
      }],
    },
  };
}

function state() {
  const values = new Map();
  return {
    values,
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
      async setAlarm() {},
      async deleteAll() { values.clear(); },
    },
  };
}

test("routes owner album items to one durable media-group gate", async () => {
  assert.ok(mediaGroupModule?.enqueueTelegramMediaGroup, "media-group routing helper should exist");
  let gated = null;
  const env = {
    OWNER_TELEGRAM_USER_ID: "123",
    TELEGRAM_MEDIA_GROUPS: {
      idFromName(name) { return name; },
      get(id) {
        return {
          async fetch(_url, init) {
            gated = { id, body: JSON.parse(init.body) };
            return Response.json({ accepted: true }, { status: 202 });
          },
        };
      },
    },
  };

  const accepted = await mediaGroupModule.enqueueTelegramMediaGroup(env, albumUpdate(101, 44, "photo-1"));
  assert.equal(accepted, true);
  assert.equal(gated.id, "123:album-7");
  assert.equal(gated.body.update.update_id, 101);
});
test("coalesces album updates into one queued request", async () => {
  assert.ok(mediaGroupModule?.TelegramMediaGroupGate, "media-group durable object should exist");
  const sent = [];
  const gate = new mediaGroupModule.TelegramMediaGroupGate(state(), {
    TELEGRAM_UPDATES: { async send(update) { sent.push(update); } },
  });

  for (const update of [
    albumUpdate(102, 45, "photo-2"),
    albumUpdate(101, 44, "photo-1"),
    albumUpdate(102, 45, "photo-2"),
  ]) {
    const response = await gate.fetch(new Request("https://media-group/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update }),
    }));
    assert.equal(response.status, 202);
  }

  await gate.alarm();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].update_id, 101);
  assert.deepEqual(sent[0].message.media_group_items.map((item) => item.message_id), [44, 45]);
  assert.equal(sent[0].message.media_group_id, "album-7");
});
test("selects one largest photo per album item in message order", () => {
  assert.ok(mediaGroupModule?.telegramAlbumPhotos, "album photo selector should exist");
  const first = albumUpdate(101, 44, "small").message;
  first.photo.push({
    file_id: "large",
    file_unique_id: "large-unique",
    width: 1280,
    height: 960,
  });
  const second = albumUpdate(102, 45, "second").message;
  const aggregate = {
    ...first,
    media_group_items: [first, second],
  };

  const selected = mediaGroupModule.telegramAlbumPhotos(aggregate);
  assert.deepEqual(selected.map((item) => item.file_id), ["large", "second"]);
});
test("analyzes album photos independently and keeps partial success", async () => {
  assert.ok(mediaGroupModule?.analyzeTelegramAlbumPhotos, "album analyzer should exist");
  const first = albumUpdate(101, 44, "photo-1").message;
  const second = albumUpdate(102, 45, "photo-2").message;
  const aggregate = { ...first, media_group_items: [first, second] };
  const calls = [];

  const result = await mediaGroupModule.analyzeTelegramAlbumPhotos(
    aggregate,
    async (photo, index) => {
      calls.push(photo.file_id);
      if (index === 1) throw new RangeError("too large");
      return `description:${photo.file_id}`;
    },
  );

  assert.deepEqual(calls, ["photo-1", "photo-2"]);
  assert.equal(result.totalItems, 2);
  assert.deepEqual(result.items, [
    { index: 1, description: "description:photo-1" },
    { index: 2, error: "too_large" },
  ]);
});

test("coalesces photo and video items into one mixed-media album", async () => {
  const sent = [];
  const gate = new mediaGroupModule.TelegramMediaGroupGate(state(), {
    TELEGRAM_UPDATES: { async send(update) { sent.push(update); } },
  });
  const photo = albumUpdate(201, 50, "photo");
  const video = albumUpdate(202, 51, "unused-photo");
  delete video.message.photo;
  video.message.caption = "Porównaj te materiały";
  video.message.video = {
    file_id: "video-1",
    file_unique_id: "video-1-unique",
    width: 1280,
    height: 720,
    duration: 8,
    thumbnail: {
      file_id: "video-thumb",
      file_unique_id: "video-thumb-unique",
      width: 320,
      height: 180,
    },
  };

  for (const update of [photo, video]) {
    await gate.fetch(new Request("https://media-group/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update }),
    }));
  }
  await gate.alarm();

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].message.media_group_items.map((item) => item.message_id), [50, 51]);
  assert.equal(sent[0].message.caption, "Porównaj te materiały");
});

test("selects ordered photo and video entries from a mixed-media album", () => {
  assert.ok(mediaGroupModule?.telegramAlbumVisualMedia, "mixed album selector should exist");
  const photo = albumUpdate(201, 50, "small").message;
  photo.photo.push({
    file_id: "large",
    file_unique_id: "large-unique",
    width: 1280,
    height: 960,
  });
  const video = albumUpdate(202, 51, "unused").message;
  delete video.photo;
  video.video = {
    file_id: "video-1",
    file_unique_id: "video-1-unique",
    width: 1920,
    height: 1080,
    duration: 9,
  };
  const aggregate = { ...photo, media_group_items: [photo, video] };

  assert.deepEqual(mediaGroupModule.telegramAlbumVisualMedia(aggregate).map((item) => ({
    kind: item.kind,
    fileId: item.kind === "photo" ? item.photo.file_id : item.video.file_id,
  })), [
    { kind: "photo", fileId: "large" },
    { kind: "video", fileId: "video-1" },
  ]);
});
