import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { routeOwnerCommand } from "../src/owner-command-router.ts";
import {
  DOC_PDF_MAX_UPLOAD_BYTES,
  handleDocStudioPdfSendRequest,
  validPdfSignature,
} from "../src/doc-studio-pdf.ts";
import { BOTEK_CAPABILITIES, toolDeckView } from "../src/capability-catalog.ts";
import { BOTEK_COMMANDS } from "../src/commands.ts";
import {
  DOC_STUDIO_MAX_TEXT_BYTES,
  docStudioFilename,
  docStudioReply,
  docStudioUrl,
  handleDocStudioSendRequest,
} from "../src/doc-studio.ts";

const TOKEN = "test-doc-bot-token";
const OWNER = "279058397";
const TIME = 1_800_000_000;
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

function initData(user = OWNER) {
  const params = new URLSearchParams({
    user: JSON.stringify({ id: Number(user), first_name: "Owner" }),
    auth_date: String(TIME),
    query_id: "test-query",
  });
  const check = [...params.entries()].map(([key, value]) => key + "=" + value).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
}

class FakeGate {
  state = null;
  token = "";
  calls = [];

  async fetch(request) {
    const path = new URL(request.url).pathname;
    this.calls.push(path);
    if (path === "/claim") {
      const payload = await request.json();
      if (this.state?.status === "sent" || this.state?.status === "failed" || this.state?.status === "ambiguous") {
        return Response.json({ outcome: "terminal", state: this.state });
      }
      if (this.state) return Response.json({ outcome: "busy", state: this.state });
      this.token = payload.token;
      this.state = { status: "preparing" };
      return Response.json({ outcome: "claimed", state: this.state });
    }
    if (request.headers.get("x-claim-token") !== this.token) return Response.json({ error: "claim" }, { status: 409 });
    if (path === "/prepare") {
      const payload = await request.json();
      assert.equal(payload.reply.text.startsWith("[doc] "), true);
      assert.ok(!JSON.stringify(payload).includes("secret document text"));
      this.state = { status: "prepared" };
    } else if (path === "/sending") this.state = { status: "sending" };
    else if (path === "/sent") this.state = { status: "sent" };
    else if (path === "/ambiguous") this.state = { status: "ambiguous" };
    else if (path === "/failed") this.state = { status: "failed" };
    else return Response.json({ error: "unknown" }, { status: 404 });
    return Response.json(this.state);
  }
}

function fakeEnv() {
  const gates = new Map();
  const env = {
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_URL: "https://tg-assistant.travny.workers.dev/telegram/webhook",
    OWNER_TELEGRAM_USER_ID: OWNER,
    TELEGRAM_DEDUP: {
      idFromName(name) { return name; },
      get(name) {
        if (!gates.has(name)) gates.set(name, new FakeGate());
        return gates.get(name);
      },
    },
  };
  return { env, gates };
}

function request(payload, extraHeaders = {}, method = "POST") {
  return new Request("https://tg-assistant.travny.workers.dev/mini-app/api/documents/send", {
    method,
    headers: {
      "x-telegram-init-data": initData(),
      "content-type": "application/json",
      origin: "https://tg-assistant.travny.workers.dev",
      ...extraHeaders,
    },
    ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
  });
}
function payload(extra = {}) {
  return { requestId: REQUEST_ID, title: "Meeting: notes?", text: "# secret document text", format: "md", ...extra };
}

test("exact /doc and /draft new route to editor, older draft still uses generator", async () => {
  for (const command of ["/doc", "/doc@trvny_bot", "/draft new"]) {
    assert.deepEqual((await routeOwnerCommand(command)).value, { kind: "doc-studio" });
  }
  assert.deepEqual((await routeOwnerCommand("/draft")).value, { kind: "draft-usage" });
  assert.deepEqual(await routeOwnerCommand("/draft write an email"), { matched: false });
  assert.deepEqual(await routeOwnerCommand("/docx"), { matched: false });
  assert.equal(BOTEK_COMMANDS.filter((x) => x.command === "doc").length, 1);
  assert.equal(BOTEK_CAPABILITIES.filter((x) => x.id === "documents").length, 1);
  assert.match(toolDeckView("documents").plain, /\/doc/u);
});

test("private-chat document button is canonical; groups never get Web App buttons", () => {
  const { env } = fakeEnv();
  assert.equal(docStudioUrl(env), "https://tg-assistant.travny.workers.dev/mini-app?tab=doc");
  const reply = docStudioReply(env, 101, 202, "private");
  assert.equal(reply.chatId, 101);
  assert.equal(reply.replyToMessageId, 202);
  assert.deepEqual(reply.replyMarkup.inline_keyboard[0][0], {
    text: "📄 Create document",
    web_app: { url: "https://tg-assistant.travny.workers.dev/mini-app?tab=doc" },
  });
  assert.equal(docStudioReply(env, -101, 202, "supergroup").replyMarkup, undefined);
  assert.equal(docStudioUrl({}), null);
  assert.equal(docStudioFilename("../🦊 Memo?.evil", "md"), "Memo-evil.md");
});

test("authenticated sendDocument targets only the owner's private chat", async (t) => {
  const { env, gates } = fakeEnv();
  let sent = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    sent += 1;
    assert.match(String(url), /^https:\/\/api\.telegram\.org\/bottest-doc-bot-token\/sendDocument$/u);
    assert.equal(init.method, "POST");
    const form = init.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get("chat_id"), OWNER);
    const file = form.get("document");
    assert.equal(file.name, "Meeting-notes.md");
    assert.equal(await file.text(), "# secret document text");
    return Response.json({ ok: true, result: { message_id: 9 } });
  });
  const result = await handleDocStudioSendRequest(request(payload({ chatId: "999999" })), env, (TIME + 40) * 1000);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, filename: "Meeting-notes.md" });
  assert.equal(sent, 1);
  assert.equal(gates.size, 1);
  const gate = [...gates.values()][0];
  assert.deepEqual(gate.calls, ["/claim", "/prepare", "/sending", "/sent"]);
  assert.equal(gate.state.status, "sent");
  const duplicate = await handleDocStudioSendRequest(request(payload({ chatId: "-123" })), env, (TIME + 40) * 1000);
  assert.deepEqual(await duplicate.json(), { ok: true, alreadySent: true });
  assert.equal(sent, 1);
});

test("forged, stale, cross-origin and invalid submissions never reach Telegram", async (t) => {
  const { env, gates } = fakeEnv();
  let sent = 0;
  t.mock.method(globalThis, "fetch", async () => { sent += 1; return Response.json({ ok: true }); });
  const unauth = await handleDocStudioSendRequest(new Request("https://bot.example/mini-app/api/documents/send", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()),
  }), env, (TIME + 40) * 1000);
  assert.equal(unauth.status, 401);
  const forged = new URLSearchParams(initData());
  forged.set("user", JSON.stringify({ id: Number(OWNER) + 1, first_name: "Mallory" }));
  const invalidSignature = await handleDocStudioSendRequest(
    request(payload(), { "x-telegram-init-data": forged.toString() }),
    env, (TIME + 40) * 1000,
  );
  assert.equal(invalidSignature.status, 401);

  const stale = await handleDocStudioSendRequest(request(payload()), env, (TIME + 4000) * 1000);
  assert.equal(stale.status, 401);
  const origin = await handleDocStudioSendRequest(request(payload(), { origin: "https://bad.example" }), env, (TIME + 40) * 1000);
  assert.equal(origin.status, 403);
  const method = await handleDocStudioSendRequest(request(null, {}, "GET"), env, (TIME + 40) * 1000);
  assert.equal(method.status, 405);

  for (const input of [
    payload({ text: "" }),
    payload({ title: "" }),
    payload({ format: "pdf" }),
    payload({ requestId: "invalid" }),
  ]) {
    const res = await handleDocStudioSendRequest(request(input), env, (TIME + 40) * 1000);
    assert.equal(res.status, 400);
  }
  assert.equal((await handleDocStudioSendRequest(request(payload({
    text: "x".repeat(DOC_STUDIO_MAX_TEXT_BYTES + 1),
  })), env, (TIME + 40) * 1000)).status, 413);
  assert.equal((await handleDocStudioSendRequest(request(payload({
    text: "x".repeat(100000),
  })), env, (TIME + 40) * 1000)).status, 413);
  assert.equal(gates.size, 0);
  assert.equal(sent, 0);
});

test("ambiguous Telegram failures stay terminal and are never blindly replayed", async (t) => {
  const { env, gates } = fakeEnv();
  let sent = 0;
  t.mock.method(globalThis, "fetch", () => {
    sent += 1;
    throw new Error("connection dropped after upload");
  });
  const response = await handleDocStudioSendRequest(request(payload()), env, (TIME + 40) * 1000);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { error: "delivery_uncertain" });
  const gate = [...gates.values()][0];
  assert.equal(gate.state.status, "ambiguous");
  assert.equal((await handleDocStudioSendRequest(request(payload()), env, (TIME + 40) * 1000)).status, 409);
  assert.equal(sent, 1);
});

test("definitively rejected upload records failure without reattempting", async (t) => {
  const { env, gates } = fakeEnv();
  let sent = 0;
  t.mock.method(globalThis, "fetch", async () => {
    sent += 1;
    return Response.json({ ok: false }, { status: 400 });
  });
  const res = await handleDocStudioSendRequest(request(payload()), env, (TIME + 40) * 1000);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "telegram_rejected" });
  assert.equal([...gates.values()][0].state.status, "failed");
  assert.equal(sent, 1);
});

test("lost Durable Object /sending acknowledgment is retried before the only Telegram upload", async (t) => {
  const { env, gates } = fakeEnv();
  const key = "doc-send:" + OWNER + ":" + REQUEST_ID;
  const gate = new FakeGate();
  const original = gate.fetch.bind(gate);
  let dropped = false;
  gate.fetch = async (request) => {
    const response = await original(request);
    if (new URL(request.url).pathname === "/sending" && !dropped) {
      dropped = true;
      throw new Error("lost DO ack");
    }
    return response;
  };
  gates.set(key, gate);
  let sent = 0;
  t.mock.method(globalThis, "fetch", async () => {
    sent += 1;
    return Response.json({ ok: true, result: {} });
  });
  const response = await handleDocStudioSendRequest(request(payload()), env, (TIME + 40) * 1000);
  assert.equal(response.status, 200);
  assert.equal(sent, 1);
  assert.equal(gate.state.status, "sent");
  assert.equal(gate.calls.filter((path) => path === "/sending").length, 2);
});

test("64 KiB control-character documents fit bounded escaped JSON transport", async (t) => {
  const { env } = fakeEnv();
  const source = "\u0000".repeat(DOC_STUDIO_MAX_TEXT_BYTES);
  let sent = 0;
  t.mock.method(globalThis, "fetch", async () => {
    sent += 1;
    return Response.json({ ok: true, result: {} });
  });
  const result = await handleDocStudioSendRequest(request(payload({ text: source })), env, (TIME + 40) * 1000);
  assert.equal(result.status, 200);
  assert.equal(sent, 1);
});

test("Telegram HTTP 200 with ok:false is a definite rejection", async (t) => {
  const { env, gates } = fakeEnv();
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, description: "rejected" }));
  const result = await handleDocStudioSendRequest(request(payload()), env, (TIME + 40) * 1000);
  assert.equal(result.status, 502);
  assert.equal([...gates.values()][0].state.status, "failed");
});


function pdfBytes() {
  return new TextEncoder().encode("%PDF-1.7\n" + "body".repeat(24) + "\n%%EOF\n");
}
function pdfRequest(data = pdfBytes(), headers = {}, method = "POST") {
  return new Request("https://tg-assistant.travny.workers.dev/mini-app/api/documents/send-pdf", {
    method,
    headers: {
      origin: "https://tg-assistant.travny.workers.dev",
      "content-type": "application/pdf",
      "x-telegram-init-data": initData(),
      "x-doc-request-id": REQUEST_ID,
      "x-doc-filename": encodeURIComponent("Notes 2026.pdf"),
      ...headers,
    },
    ...(method === "POST" ? { body: data } : {}),
  });
}

test("PDF upload validates magic and EOF markers before Telegram", () => {
  const valid = pdfBytes();
  assert.equal(validPdfSignature(valid), true);
  assert.equal(validPdfSignature(new TextEncoder().encode("not PDF")), false);
  assert.equal(validPdfSignature(new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(70))), false);
});

test("owner PDF upload uses the existing gate and a real Telegram file", async (t) => {
  const { env, gates } = fakeEnv();
  let sends = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    sends += 1;
    assert.match(String(url), /\/sendDocument$/u);
    const form = init.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get("chat_id"), OWNER);
    assert.equal(form.get("document").name, "Notes-2026.pdf");
    assert.equal(form.get("document").type, "application/pdf");
    assert.equal(await form.get("document").text(), new TextDecoder().decode(pdfBytes()));
    return Response.json({ ok: true, result: { message_id: 73 } });
  });
  const result = await handleDocStudioPdfSendRequest(pdfRequest(), env, (TIME + 40) * 1000);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, filename: "Notes-2026.pdf" });
  assert.equal(sends, 1);
  assert.equal([...gates.values()][0].state.status, "sent");

  const replay = await handleDocStudioPdfSendRequest(pdfRequest(), env, (TIME + 40) * 1000);
  assert.deepEqual(await replay.json(), { ok: true, alreadySent: true });
  assert.equal(sends, 1);
});

test("PDF upload rejects outsider, malformed and oversized files before side effects", async (t) => {
  const { env, gates } = fakeEnv();
  let sends = 0;
  t.mock.method(globalThis, "fetch", async () => { sends += 1; return Response.json({ ok: true }); });

  const forged = new URLSearchParams(initData());
  forged.set("user", JSON.stringify({ id: 1, first_name: "Intruder" }));
  const cases = [
    [pdfRequest(pdfBytes(), { "x-telegram-init-data": forged.toString() }), 401],
    [pdfRequest(pdfBytes(), { origin: "https://evil.example" }), 403],
    [pdfRequest(pdfBytes(), { "content-type": "text/plain" }), 415],
    [pdfRequest(pdfBytes(), { "x-doc-request-id": "oops" }), 400],
    [pdfRequest(pdfBytes(), { "x-doc-filename": encodeURIComponent("../unsafe.pdf") }), 400],
    [pdfRequest(new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(64))), 400],
    [pdfRequest(pdfBytes(), {}, "GET"), 405],
  ];
  for (const [request, status] of cases) {
    const response = await handleDocStudioPdfSendRequest(request, env, (TIME + 40) * 1000);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const expired = await handleDocStudioPdfSendRequest(pdfRequest(), env, (TIME + 4000) * 1000);
  assert.equal(expired.status, 401);
  assert.equal(sends, 0);
  assert.equal(gates.size, 0);

  const tooLarge = new Uint8Array(DOC_PDF_MAX_UPLOAD_BYTES + 1);
  tooLarge.set(new TextEncoder().encode("%PDF-1.7"));
  const large = await handleDocStudioPdfSendRequest(pdfRequest(tooLarge), env, (TIME + 40) * 1000);
  assert.equal(large.status, 413);
  assert.equal(sends, 0);
});
