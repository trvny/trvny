import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { handleMiniAppStatusRequest, validateMiniAppInitData } from "../src/mini-app.ts";

const BOT_TOKEN = "botek-test-token";
const OWNER_ID = "279058397";
const AUTH_DATE = 1_800_000_000;

function signedInitData(userId = OWNER_ID, authDate = AUTH_DATE) {
  const params = new URLSearchParams({
    query_id: "test-query",
    user: JSON.stringify({ id: Number(userId), first_name: "Owner" }),
    auth_date: String(authDate),
    signature: "synthetic-third-party-signature",
  });
  const check = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

const INIT_DATA = signedInitData();

test("accepts fresh Telegram Mini App init data for the configured owner", async () => {
  const result = await validateMiniAppInitData(INIT_DATA, BOT_TOKEN, OWNER_ID, (AUTH_DATE + 60) * 1000);
  assert.deepEqual(result, { ok: true, userId: OWNER_ID, authDate: AUTH_DATE });
});

test("rejects tampered, stale and non-owner init data", async () => {
  const tampered = new URLSearchParams(INIT_DATA);
  tampered.set("user", JSON.stringify({ id: 279058398, first_name: "Mallory" }));
  assert.equal((await validateMiniAppInitData(tampered.toString(), BOT_TOKEN, "279058398", (AUTH_DATE + 60) * 1000)).ok, false);
  assert.deepEqual(await validateMiniAppInitData(INIT_DATA, BOT_TOKEN, OWNER_ID, (AUTH_DATE + 3601) * 1000), {
    ok: false,
    reason: "expired",
  });
  assert.deepEqual(await validateMiniAppInitData(INIT_DATA, BOT_TOKEN, "1", (AUTH_DATE + 60) * 1000), {
    ok: false,
    reason: "forbidden",
  });
});

test("serves owner-only Legion status without exposing dispatcher credentials", async () => {
  let reads = 0;
  const env = {
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    OWNER_TELEGRAM_USER_ID: OWNER_ID,
    PET_DISPATCHER: {
      meta: async () => { reads += 1; return { deviceId: "legion", stale: false, activeSessions: 1 }; },
      recentTasks: async (limit) => { reads += 1; assert.equal(limit, 10); return [{ taskId: "task-1", status: "running" }]; },
    },
  };
  const request = new Request("https://bot.example/mini-app/api/status", {
    headers: { "x-telegram-init-data": INIT_DATA },
  });
  const response = await handleMiniAppStatusRequest(request, env, (AUTH_DATE + 60) * 1000);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    legion: { deviceId: "legion", stale: false, activeSessions: 1 },
    tasks: [{ taskId: "task-1", status: "running" }],
  });
  assert.equal(reads, 2);
});

test("rejects Mini App API requests before dispatcher access", async () => {
  let touched = false;
  const env = {
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    OWNER_TELEGRAM_USER_ID: OWNER_ID,
    PET_DISPATCHER: {
      meta: async () => { touched = true; return {}; },
      recentTasks: async () => { touched = true; return []; },
    },
  };
  const response = await handleMiniAppStatusRequest(
    new Request("https://bot.example/mini-app/api/status"),
    env,
    (AUTH_DATE + 60) * 1000,
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(touched, false);
});
