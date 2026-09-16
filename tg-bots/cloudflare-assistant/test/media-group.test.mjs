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
