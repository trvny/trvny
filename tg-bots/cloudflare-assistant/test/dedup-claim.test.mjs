import assert from "node:assert/strict";
import test from "node:test";

import { TelegramUpdateDedup } from "../src/dedup.ts";

const FIRST_TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reply = { chatId: 42, text: "one delivery" };

function fixture() {
  const values = new Map();
  const dedup = new TelegramUpdateDedup({
    storage: {
      async get(key) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return values.get(key);
      },
      put(key, value) { values.set(key, value); return Promise.resolve(); },
      setAlarm() { return Promise.resolve(); },
      deleteAll() { values.clear(); return Promise.resolve(); },
    },
  });
  async function post(path, token, payload = {}) {
    const response = await dedup.fetch(new Request(`https://dedup/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-claim-token": token } : {}) },
      body: JSON.stringify(payload),
    }));
    return { status: response.status, data: await response.json() };
  }
  return {
    values,
    post,
    claim: (token) => post("claim", undefined, { token }),
  };
}

test("simultaneous queue workers get one atomic owner, not two send permits", async () => {
  const { post, claim } = fixture();
  const [a, b] = await Promise.all([claim(FIRST_TOKEN), claim(OTHER_TOKEN)]);
  assert.deepEqual([a.data.outcome, b.data.outcome].sort(), ["busy", "claimed"]);
  const winner = a.data.outcome === "claimed" ? FIRST_TOKEN : OTHER_TOKEN;
  const loser = winner === FIRST_TOKEN ? OTHER_TOKEN : FIRST_TOKEN;
  assert.equal((await post("prepare", loser, { reply })).status, 409);
  assert.equal((await post("prepare", winner, { reply })).status, 201);
  assert.equal((await post("sending", loser)).status, 409);
  assert.equal((await post("sending", winner)).status, 200);
  assert.equal((await claim(loser)).data.outcome, "busy");
  assert.equal((await post("sent", winner)).data.status, "sent");
  assert.equal((await claim(loser)).data.outcome, "terminal");
  assert.equal((await post("sending", loser)).status, 409);
});

test("interrupted work before send can be reclaimed without replaying generation", async () => {
  const { values, post, claim } = fixture();
  assert.equal((await claim(FIRST_TOKEN)).data.outcome, "claimed");
  await post("prepare", FIRST_TOKEN, { reply });
  values.get("record").claim.expiresAt = Date.now() - 1;
  const next = await claim(OTHER_TOKEN);
  assert.equal(next.data.outcome, "claimed");
  assert.deepEqual(next.data.state.reply, reply);
  assert.equal((await post("sending", FIRST_TOKEN)).status, 409);
  assert.equal((await post("prepare", OTHER_TOKEN, { reply: { chatId: 99, text: "wrong" } })).data.reply.text,
    reply.text);
  assert.equal((await post("sending", OTHER_TOKEN)).status, 200);
  assert.equal((await post("sent", OTHER_TOKEN)).data.status, "sent");
});

test("stale pre-send claim without a reply can be reclaimed", async () => {
  const { values, post, claim } = fixture();
  await claim(FIRST_TOKEN);
  values.get("record").claim.expiresAt = Date.now() - 1;
  const next = await claim(OTHER_TOKEN);
  assert.equal(next.data.outcome, "claimed");
  assert.equal(next.data.state.status, "preparing");
  assert.equal("reply" in next.data.state, false);
  assert.equal((await post("sent", FIRST_TOKEN)).status, 409);
  assert.equal((await post("sent", OTHER_TOKEN)).data.status, "sent");
});

test("stale send is marked ambiguous and never authorized again", async () => {
  const { values, post, claim } = fixture();
  await claim(FIRST_TOKEN);
  await post("prepare", FIRST_TOKEN, { reply });
  await post("sending", FIRST_TOKEN);
  values.get("record").claim.expiresAt = Date.now() - 1;
  assert.equal((await claim(OTHER_TOKEN)).data.outcome, "uncertain");
  assert.equal((await claim(OTHER_TOKEN)).data.outcome, "terminal");
  assert.equal((await post("sent", FIRST_TOKEN)).status, 409);
  assert.equal(values.get("record").status, "ambiguous");
});

test("renewal holds the same owner through a long preparation and send", async () => {
  const { values, post, claim } = fixture();
  await claim(FIRST_TOKEN);
  values.get("record").claim.expiresAt = Date.now() + 10;
  const preparing = await post("renew", FIRST_TOKEN);
  assert.equal(preparing.status, 200);
  assert.ok(preparing.data.claim.expiresAt > Date.now() + 120_000);
  assert.equal((await claim(OTHER_TOKEN)).data.outcome, "busy");
  await post("prepare", FIRST_TOKEN, { reply });
  await post("sending", FIRST_TOKEN);
  const sending = await post("renew", FIRST_TOKEN);
  assert.equal(sending.data.status, "sending");
  assert.equal((await claim(OTHER_TOKEN)).data.outcome, "busy");
  assert.equal((await post("renew", OTHER_TOKEN)).status, 409);
  assert.equal((await post("sent", FIRST_TOKEN)).data.status, "sent");
  assert.equal((await post("renew", FIRST_TOKEN)).status, 409);
});

test("lost /sending response can be retried by the same owner, not another", async () => {
  const { post, claim } = fixture();
  await claim(FIRST_TOKEN);
  await post("prepare", FIRST_TOKEN, { reply });
  const first = await post("sending", FIRST_TOKEN);
  assert.equal(first.data.status, "sending");
  const recovered = await post("sending", FIRST_TOKEN);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.status, "sending");
  assert.equal((await post("sending", OTHER_TOKEN)).status, 409);
  assert.equal((await post("sent", FIRST_TOKEN)).data.status, "sent");
});

test("known retryable rejection releases send permit, retaining the reply", async () => {
  const { post, claim } = fixture();
  await claim(FIRST_TOKEN);
  await post("prepare", FIRST_TOKEN, { reply });
  await post("sending", FIRST_TOKEN);
  assert.equal((await post("retry", FIRST_TOKEN)).data.status, "prepared");
  assert.equal((await post("sent", FIRST_TOKEN)).status, 409);
  const next = await claim(OTHER_TOKEN);
  assert.equal(next.data.outcome, "claimed");
  assert.deepEqual(next.data.state.reply, reply);
  await post("sending", OTHER_TOKEN);
  assert.equal((await post("sent", OTHER_TOKEN)).data.status, "sent");
});

test("failed generation releases claim and leaves no phantom send", async () => {
  const { post, claim } = fixture();
  await claim(FIRST_TOKEN);
  assert.equal((await post("release", FIRST_TOKEN)).data.status, "preparing");
  assert.equal((await claim(OTHER_TOKEN)).data.outcome, "claimed");
  assert.equal((await post("sent", FIRST_TOKEN)).status, 409);
  assert.equal((await post("sent", OTHER_TOKEN)).data.status, "sent");
});
