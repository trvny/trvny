import assert from "node:assert/strict";
import test from "node:test";

import {
  initializeConditionWatch,
  processConditionWatches,
} from "../src/watch-runner.ts";
import {
  TelegramWatchStore,
  beginConditionWatchSend,
  cancelConditionWatch,
  cancelConditionWatchWithStatus,
  claimConditionWatch,
  createConditionWatch,
  listConditionWatches,
  releaseConditionWatch,
  updateConditionWatch,
  watchIdForUpdate,
} from "../src/watches.ts";

function state() {
  const values = new Map();
  return {
    values,
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
      async deleteAll() { values.clear(); },
      async setAlarm() {},
    },
  };
}

function namespace(store) {
  return {
    idFromName() { return {}; },
    get() {
      return {
        fetch(input, init) {
          return store.fetch(input instanceof Request ? input : new Request(input, init));
        },
      };
    },
  };
}

function baseEnv(overrides = {}) {
  const store = new TelegramWatchStore(state());
  return {
    TELEGRAM_WATCHES: namespace(store),
    ...overrides,
  };
}

const message = {
  message_id: 77,
  chat: { id: 123, type: "private" },
};

test("stores, lists and cancels proactive watches idempotently", async () => {
  const env = baseEnv();
  const now = Date.now();
  const watch = {
    id: watchIdForUpdate(1234),
    chatId: 123,
    replyToMessageId: 77,
    createdAt: new Date(now).toISOString(),
    nextCheckAt: new Date(now + 60_000).toISOString(),
    status: "active",
    failures: 0,
    kind: "legion",
    condition: "offline",
    lastMatch: false,
  };

  const first = await createConditionWatch(env, watch);
  const duplicate = await createConditionWatch(env, watch);
  assert.equal(first.id, duplicate.id);
  assert.equal((await listConditionWatches(env)).length, 1);
  assert.equal(await cancelConditionWatch(env, watch.id), true);
  assert.equal(await cancelConditionWatch(env, watch.id), false);
  assert.deepEqual(await listConditionWatches(env), []);
});

test("Legion watch fires only on a future false-to-true transition", async () => {
  let stale = false;
  const env = baseEnv({
    PET_DISPATCHER: {
      async meta() {
        return { deviceId: "legion", transport: "test", protocol: 1, stale };
      },
    },
  });
  const now = Date.now();
  const watch = await initializeConditionWatch(
    env,
    { kind: "legion", condition: "offline" },
    2001,
    message,
    now - 3 * 60_000,
  );
  assert.equal(watch.lastMatch, false);

  stale = true;
  const sends = [];
  await processConditionWatches(
    env,
    async (_env, chatId, text, options) => {
      sends.push({ chatId, text, options });
    },
    now,
  );

  assert.equal(sends.length, 1);
  assert.equal(sends[0].chatId, 123);
  assert.match(sends[0].text, /offline/u);
  assert.equal((await listConditionWatches(env)).length, 0);
});

test("GitHub watch compares compact PR state and finishes after the condition matches", async () => {
  let failed = 0;
  const env = baseEnv({
    BOTEK_SPECIALISTS: {
      async githubPullStatus(repository, number) {
        return {
          ok: true,
          repository,
          number,
          title: "PR",
          state: "open",
          merged: false,
          draft: false,
          ci: { total: 2, pending: failed ? 0 : 1, failed, passed: failed ? 1 : 1 },
        };
      },
    },
  });
  const now = Date.now();
  const watch = await initializeConditionWatch(
    env,
    {
      kind: "github",
      repository: "trvny/trvny",
      number: 709,
      condition: "ci-failed",
    },
    2002,
    message,
    now - 4 * 60_000,
  );
  assert.equal(watch.lastMatch, false);

  failed = 1;
  const sends = [];
  await processConditionWatches(
    env,
    async (_env, _chatId, text) => { sends.push(text); },
    now,
  );

  assert.equal(sends.length, 1);
  assert.match(sends[0], /CI/u);
  assert.equal((await listConditionWatches(env)).length, 0);
});

test("Secretary idle watch sends one contextual Business reply and then disappears", async () => {
  const env = baseEnv({
    SECRETARY_AUTO_REPLY_SCOPE: "contacts-only",
    WORKERS_AI_MODEL: "@cf/test/model",
    AI: {
      async run() {
        return {
          response: "🤖 Botek tu. Tomek najwyraźniej wpadł do czarnej dziury powiadomień, ale szturchnąłem go w ten temat.",
        };
      },
    },
  });
  const now = Date.now();
  await createConditionWatch(env, {
    id: watchIdForUpdate(3001),
    chatId: 555,
    replyToMessageId: 99,
    createdAt: new Date(now - 13 * 60 * 60_000).toISOString(),
    nextCheckAt: new Date(now - 1_000).toISOString(),
    status: "active",
    failures: 0,
    kind: "secretary",
    connectionId: "business-1",
    sender: "Ada (@ada)",
    contextBlock: 'UNTRUSTED Telegram Business conversation context.\ncontact: "Hej, żyjesz?"',
  });

  const sends = [];
  await processConditionWatches(
    env,
    async (_env, chatId, text, options) => sends.push({ chatId, text, options }),
    now,
  );

  assert.equal(sends.length, 1);
  assert.equal(sends[0].chatId, 555);
  assert.match(sends[0].text, /Botek/u);
  assert.equal(sends[0].options.businessConnectionId, "business-1");
  assert.equal(sends[0].options.replyToMessageId, 99);
  assert.deepEqual(await listConditionWatches(env), []);
});

test("Feedseek watch seeds old entries and only announces unseen later matches", async () => {
  let phase = "seed";
  const calls = [];
  const env = baseEnv({
    BOTEK_SPECIALISTS: {
      async feedseekRecent(input) {
        calls.push(input);
        if (phase === "seed") {
          return { ok: true, entries: [{ id: "old", title: "Old", url: "https://example.test/old" }] };
        }
        return {
          ok: true,
          entries: [
            { id: "old", title: "Old", url: "https://example.test/old" },
            { id: "new", title: "Fresh AI", url: "https://example.test/new" },
          ],
        };
      },
    },
  });
  const now = Date.now();
  await initializeConditionWatch(
    env,
    { kind: "feedseek", query: "AI" },
    2003,
    message,
    now - 6 * 60_000,
  );

  phase = "poll";
  const sends = [];
  await processConditionWatches(
    env,
    async (_env, _chatId, text) => { sends.push(text); },
    now,
  );

  assert.equal(sends.length, 1);
  assert.match(sends[0], /Fresh AI/u);
  assert.doesNotMatch(sends[0], /\n• Old/u);
  const watches = await listConditionWatches(env);
  assert.equal(watches.length, 1);
  assert.equal(watches[0].kind, "feedseek");
  assert.deepEqual(new Set(watches[0].seenIds), new Set(["old", "new"]));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].since);
});

function deferred() {
  return Promise.withResolvers();
}

function githubSnapshot(repository, number, failed) {
  return {
    ok: true, repository, number, title: "PR", state: "open", merged: false, draft: false,
    ci: { total: 2, pending: failed ? 0 : 1, failed: failed ? 1 : 0, passed: 1 },
  };
}

test("watch cancellation before a due claim prevents notification", async () => {
  const env = baseEnv({ PET_DISPATCHER: { meta() { return Promise.resolve({ stale: false }); } } });
  const watch = await initializeConditionWatch(
    env, { kind: "legion", condition: "offline" }, 4001, message, Date.now() - 3 * 60_000,
  );
  assert.deepEqual(await cancelConditionWatchWithStatus(env, watch.id), {
    removed: true, deliveryStarted: false,
  });
  let sends = 0;
  await processConditionWatches(env, () => { sends++; return Promise.resolve(); });
  assert.equal(sends, 0);
});

test("GitHub cancellation after claim but during slow source read stops delivery", async () => {
  const entered = deferred();
  const resume = deferred();
  let reads = 0;
  const env = baseEnv({
    BOTEK_SPECIALISTS: {
      async githubPullStatus(repository, number) {
        if (++reads === 1) return githubSnapshot(repository, number, false);
        entered.resolve();
        await resume.promise;
        return githubSnapshot(repository, number, true);
      },
    },
  });
  const watch = await initializeConditionWatch(env, {
    kind: "github", repository: "trvny/trvny", number: 709, condition: "ci-failed",
  }, 4002, message, Date.now() - 4 * 60_000);
  let sends = 0;
  const processing = processConditionWatches(env, () => { sends++; return Promise.resolve(); });
  await entered.promise;
  assert.deepEqual(await cancelConditionWatchWithStatus(env, watch.id), {
    removed: true, deliveryStarted: false,
  });
  resume.resolve();
  await processing;
  assert.equal(sends, 0);
  assert.deepEqual(await listConditionWatches(env), []);
});

test("Feedseek cancellation during slow source read stops notification and refresh", async () => {
  const entered = deferred();
  const resume = deferred();
  let reads = 0;
  const env = baseEnv({
    BOTEK_SPECIALISTS: {
      async feedseekRecent() {
        if (++reads === 1) return { ok: true, entries: [{ id: "old", title: "Old" }] };
        entered.resolve();
        await resume.promise;
        return { ok: true, entries: [{ id: "old", title: "Old" }, { id: "new", title: "New" }] };
      },
    },
  });
  const watch = await initializeConditionWatch(
    env, { kind: "feedseek", query: "AI" }, 4003, message, Date.now() - 7 * 60_000,
  );
  let sends = 0;
  const processing = processConditionWatches(env, () => { sends++; return Promise.resolve(); });
  await entered.promise;
  assert.deepEqual(await cancelConditionWatchWithStatus(env, watch.id), {
    removed: true, deliveryStarted: false,
  });
  resume.resolve();
  await processing;
  assert.equal(sends, 0);
  assert.deepEqual(await listConditionWatches(env), []);
});

test("Secretary cancellation during slow AI generation suppresses Business reply", async () => {
  const entered = deferred();
  const resume = deferred();
  const env = baseEnv({
    SECRETARY_AUTO_REPLY_SCOPE: "contacts-only",
    WORKERS_AI_MODEL: "@cf/test/model",
    AI: { async run() {
      entered.resolve();
      await resume.promise;
      return { response: "Botek auto reply" };
    } },
  });
  const now = Date.now();
  const id = watchIdForUpdate(4004);
  await createConditionWatch(env, {
    id, chatId: 555, replyToMessageId: 99,
    createdAt: new Date(now - 13 * 60 * 60_000).toISOString(),
    nextCheckAt: new Date(now - 1000).toISOString(),
    status: "active", failures: 0, kind: "secretary",
    connectionId: "business-1", sender: "Contact", contextBlock: "contact says hi",
  });
  let sends = 0;
  const processing = processConditionWatches(env, () => { sends++; return Promise.resolve(); });
  await entered.promise;
  assert.deepEqual(await cancelConditionWatchWithStatus(env, id), {
    removed: true, deliveryStarted: false,
  });
  resume.resolve();
  await processing;
  assert.equal(sends, 0);
  assert.deepEqual(await listConditionWatches(env), []);
});

test("cancellation during watch delivery reports in-flight and does not revive watch", async () => {
  let stale = false;
  const env = baseEnv({
    PET_DISPATCHER: { meta() { return Promise.resolve({ stale }); } },
  });
  const watch = await initializeConditionWatch(
    env, { kind: "legion", condition: "offline" }, 4005, message, Date.now() - 3 * 60_000,
  );
  stale = true;
  let sends = 0;
  await processConditionWatches(env, async () => {
    sends++;
    assert.deepEqual(await cancelConditionWatchWithStatus(env, watch.id), {
      removed: true, deliveryStarted: true,
    });
  });
  assert.equal(sends, 1);
  assert.deepEqual(await listConditionWatches(env), []);
});

test("old lease token cannot start a send or release a replacement claim", async () => {
  const memory = state();
  const env = { TELEGRAM_WATCHES: namespace(new TelegramWatchStore(memory)) };
  const now = Date.now();
  const id = watchIdForUpdate(4006);
  await createConditionWatch(env, {
    id, chatId: 123, replyToMessageId: 77,
    createdAt: new Date(now - 60_000).toISOString(),
    nextCheckAt: new Date(now - 1000).toISOString(),
    status: "active", failures: 0, kind: "legion", condition: "offline",
    lastMatch: false,
  });
  const older = await claimConditionWatch(env, id);
  assert.ok(older?.claimToken);
  const stored = memory.values.get("condition-watches");
  stored[0].leaseUntil = new Date(Date.now() - 1000).toISOString();
  const newer = await claimConditionWatch(env, id);
  assert.ok(newer?.claimToken);
  assert.notEqual(older.claimToken, newer.claimToken);
  assert.equal(await beginConditionWatchSend(env, id, older.claimToken), false);
  await releaseConditionWatch(env, id, 60_000, older.claimToken);
  assert.equal((await listConditionWatches(env))[0].claimToken, newer.claimToken);
  assert.equal(await updateConditionWatch(env, {
    ...older, status: "active",
  }), false);
  assert.equal(await beginConditionWatchSend(env, id, newer.claimToken), true);
  assert.equal(await beginConditionWatchSend(env, id, newer.claimToken), false);
  assert.deepEqual(await cancelConditionWatchWithStatus(env, id), {
    removed: true, deliveryStarted: true,
  });
});
