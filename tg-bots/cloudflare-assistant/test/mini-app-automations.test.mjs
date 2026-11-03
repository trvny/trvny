import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  handleMiniAppAutomationCancelRequest,
  handleMiniAppAutomationListRequest,
} from "../src/mini-app-automations.ts";

const TOKEN = "test-botek-token";
const OWNER = "12345678";
const AUTH_DATE = 1_800_000_000;
const NOW = (AUTH_DATE + 30) * 1000;

function signedInitData() {
  const params = new URLSearchParams({
    auth_date: String(AUTH_DATE),
    user: JSON.stringify({ id: Number(OWNER) }),
  });
  const check = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

function request(path, method = "GET", authenticated = true) {
  return new Request(`https://bot.example${path}`, {
    method,
    ...(authenticated ? { headers: { "x-telegram-init-data": signedInitData() } } : {}),
  });
}

function fixture() {
  const calls = [];
  const reminder = {
    id: "r123", text: "Check PR", dueAt: "2026-11-04T10:00:00Z", state: "pending",
    chatId: 12345678, replyToMessageId: 42, createdAt: "2026-11-03T10:00:00Z",
  };
  const watch = {
    id: "w123", kind: "github", repository: "trvny/trvny", number: 203,
    condition: "ci-green", nextCheckAt: "2026-11-04T10:00:00Z",
    chatId: 12345678, replyToMessageId: 42, createdAt: "2026-11-03T10:00:00Z",
    failures: 0, lastMatch: false, status: "active",
  };
  const secretary = {
    ...watch, id: "wsecret", kind: "secretary", connectionId: "sensitive",
    sender: "contact", contextBlock: "private message",
  };
  const namespace = (type) => ({
    idFromName: () => ({}),
    get: () => ({
      fetch: (input, init) => {
        const path = new URL(typeof input === "string" ? input : input.url).pathname;
        calls.push([type, path]);
        if (path === "/list") return Response.json(type === "reminders" ? [reminder] : [watch, secretary]);
        if (path === "/cancel") {
          const id = JSON.parse(init.body).id;
          return Response.json({ removed: type === "reminders" ? id === reminder.id : id === watch.id });
        }
        return new Response("", { status: 404 });
      },
    }),
  });
  return {
    calls,
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      OWNER_TELEGRAM_USER_ID: OWNER,
      TELEGRAM_REMINDERS: namespace("reminders"),
      TELEGRAM_WATCHES: namespace("watches"),
    },
  };
}

test("Watchtower returns only owner-visible automation projections", async () => {
  const { env } = fixture();
  const response = await handleMiniAppAutomationListRequest(
    request("/mini-app/api/automations"), env, NOW,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body.reminders, [
    { id: "r123", text: "Check PR", dueAt: "2026-11-04T10:00:00Z", state: "pending" },
  ]);
  assert.deepEqual(body.watches, [
    { id: "w123", kind: "github", target: "trvny/trvny#203 · ci-green", status: "active", nextCheckAt: "2026-11-04T10:00:00Z" },
  ]);
  assert.doesNotMatch(JSON.stringify(body), /sensitive|private message|contact/u);
});

test("Watchtower preserves reminders when the watch store is unavailable", async () => {
  const { env } = fixture();
  env.TELEGRAM_WATCHES = {
    idFromName: () => ({}),
    get: () => ({ fetch: () => new Response(null, { status: 503 }) }),
  };
  const response = await handleMiniAppAutomationListRequest(
    request("/mini-app/api/automations"), env, NOW,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reminders.length, 1);
  assert.equal(body.watches, null);
});

test("Watchtower fails closed before touching the stores", async () => {
  const { env, calls } = fixture();
  const response = await handleMiniAppAutomationListRequest(
    request("/mini-app/api/automations", "GET", false), env, NOW,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test("Watchtower cancels owner reminders and watches", async () => {
  const { env, calls } = fixture();
  for (const [kind, id] of [["reminders", "r123"], ["watches", "w123"]]) {
    const response = await handleMiniAppAutomationCancelRequest(
      request(`/mini-app/api/automations/${kind}/${id}/cancel`, "POST"), env, kind, id, NOW,
    );
    assert.deepEqual(await response.json(), { ok: true, removed: true });
  }
  assert.ok(calls.some(([type, path]) => type === "reminders" && path === "/cancel"));
  assert.ok(calls.some(([type, path]) => type === "watches" && path === "/cancel"));
});

test("Watchtower cannot cancel secretary internals or malformed IDs", async () => {
  const { env, calls } = fixture();
  const secret = await handleMiniAppAutomationCancelRequest(
    request("/mini-app/api/automations/watches/wsecret/cancel", "POST"),
    env, "watches", "wsecret", NOW,
  );
  assert.equal(secret.status, 404);
  assert.equal(calls.some(([, path]) => path === "/cancel"), false);

  const malformed = await handleMiniAppAutomationCancelRequest(
    request("/mini-app/api/automations/watches/bad-id/cancel", "POST"),
    env, "watches", "bad-id", NOW,
  );
  assert.equal(malformed.status, 400);

  const missingAuth = await handleMiniAppAutomationCancelRequest(
    request("/mini-app/api/automations/reminders/r123/cancel", "POST", false),
    env, "reminders", "r123", NOW,
  );
  assert.equal(missingAuth.status, 401);

  const method = await handleMiniAppAutomationCancelRequest(
    request("/mini-app/api/automations/reminders/r123/cancel"),
    env, "reminders", "r123", NOW,
  );
  assert.equal(method.status, 405);
});
