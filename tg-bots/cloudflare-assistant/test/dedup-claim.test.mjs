import assert from "node:assert/strict";
import test from "node:test";

import { TelegramUpdateDedup } from "../src/dedup.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reply = { chatId: 42, text: "one delivery" };

function fixture() {
  const values = new Map();
  const dedup = new TelegramUpdateDedup({
    storage: {
      async get(key) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return values.get(key);
      },
      async put(key, value) { values.set(key, value); },
      async setAlarm() {},
      async deleteAll() { values.clear(); },
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
  const [a, b] = await Promise.all([claim(A), claim(B)]);
  assert.deepEqual([a.data.outcome, b.data.outcome].sort(), ["busy", "claimed"]);
  const winner = a.data.outcome === "claimed" ? A : B;
  const loser = winner === A ? B : A;
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
  assert.equal((await claim(A)).data.outcome, "claimed");
  await post("prepare", A, { reply });
  values.get("record").claim.expiresAt = Date.now() - 1;
  const next = await claim(B);
  assert.equal(next.data.outcome, "claimed");
  assert.deepEqual(next.data.state.reply, reply);
  assert.equal((await post("sending", A)).status, 409);
  assert.equal((await post("prepare", B, { reply: { chatId: 99, text: "wrong" } })).data.reply.text,
    reply.text);
  assert.equal((await post("sending", B)).status, 200);
  assert.equal((await post("sent", B)).data.status, "sent");
});

test("stale send is marked ambiguous and never authorized again", async () => {
  const { values, post, claim } = fixture();
  await claim(A);
  await post("prepare", A, { reply });
  await post("sending", A);
  values.get("record").claim.expiresAt = Date.now() - 1;
  assert.equal((await claim(B)).data.outcome, "uncertain");
  assert.equal((await claim(B)).data.outcome, "terminal");
  assert.equal((await post("sent", A)).status, 409);
  assert.equal(values.get("record").status, "ambiguous");
});

test("known retryable rejection releases send permit, retaining the reply", async () => {
  const { post, claim } = fixture();
  await claim(A);
  await post("prepare", A, { reply });
  await post("sending", A);
  assert.equal((await post("retry", A)).data.status, "prepared");
  assert.equal((await post("sent", A)).status, 409);
  const next = await claim(B);
  assert.equal(next.data.outcome, "claimed");
  assert.deepEqual(next.data.state.reply, reply);
  await post("sending", B);
  assert.equal((await post("sent", B)).data.status, "sent");
});

test("failed generation releases claim and leaves no phantom send", async () => {
  const { post, claim } = fixture();
  await claim(A);
  assert.equal((await post("release", A)).data.status, "preparing");
  assert.equal((await claim(B)).data.outcome, "claimed");
  assert.equal((await post("sent", A)).status, 409);
  assert.equal((await post("sent", B)).data.status, "sent");
});
