import assert from "node:assert/strict";
import test from "node:test";

import { healTelegramWebhook } from "../src/webhook-heal.ts";

const EXPECTED = "https://tg-assistant.travny.workers.dev/telegram/webhook";
const ON_TICK = Date.UTC(2026, 9, 1, 19, 10);
const env = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  TELEGRAM_WEBHOOK_URL: EXPECTED,
  OWNER_TELEGRAM_USER_ID: "279058397",
};

function deps(currentUrl) {
  const calls = { info: 0, webhook: [], menu: [] };
  return {
    calls,
    deps: {
      fetcher: async () => {
        calls.info += 1;
        return Response.json({ ok: true, result: { url: currentUrl } });
      },
      setWebhook: async (_env, url) => { calls.webhook.push(url); },
      setMenu: async (_env, chatId, url) => { calls.menu.push([chatId, url]); },
    },
  };
}

test("re-points a stale webhook and the owner's Mini App button", async () => {
  const { calls, deps: d } = deps("https://travny-tg-assistant.travny.workers.dev/telegram/webhook");
  assert.equal(await healTelegramWebhook(env, ON_TICK, d), "healed");
  assert.deepEqual(calls.webhook, [EXPECTED]);
  assert.deepEqual(calls.menu, [[279058397, "https://tg-assistant.travny.workers.dev/mini-app"]]);
});

test("leaves a correct webhook alone", async () => {
  const { calls, deps: d } = deps(EXPECTED);
  assert.equal(await healTelegramWebhook(env, ON_TICK, d), "ok");
  assert.deepEqual(calls.webhook, []);
  assert.deepEqual(calls.menu, []);
});

test("checks only every ten minutes and only when configured", async () => {
  const { calls, deps: d } = deps("https://old.example/telegram/webhook");
  assert.equal(await healTelegramWebhook(env, ON_TICK + 60_000, d), "skipped");
  assert.equal(await healTelegramWebhook({ ...env, TELEGRAM_WEBHOOK_URL: undefined }, ON_TICK, d), "skipped");
  assert.equal(await healTelegramWebhook({ ...env, TELEGRAM_WEBHOOK_SECRET: undefined }, ON_TICK, d), "skipped");
  assert.equal(calls.info, 0);
});
