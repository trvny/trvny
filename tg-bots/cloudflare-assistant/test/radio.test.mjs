import assert from "node:assert/strict";
import test from "node:test";

import { isRadioRequest, BOTEK_COMMANDS } from "../src/commands.ts";
import { routeOwnerCommand } from "../src/owner-command-router.ts";
import { readRadioTrack, radioMiniAppUrl, radioNowResponse, radioReply } from "../src/radio.ts";

function trackResponse(overrides = {}) {
  return Response.json({
    title: " Song ", artist: " Artist ", album: " Album ",
    cover: "https://img.radioparadise.com/covers/m/123.jpg", ...overrides,
  });
}

test("radio shortcuts are exact and do not hijack ordinary chat", async () => {
  for (const command of ["/radio", "/radio@trvny_bot", "Dawaj MUZĘ!", "dawaj muze", "  puść   radio  "]) {
    const input = command.replace(/!$/u, "");
    assert.equal(isRadioRequest(input), true);
    assert.deepEqual((await routeOwnerCommand(input)).value, { kind: "radio" });
  }
  for (const input of ["dawaj muze o historii", "radioterapia", "nie dawaj muze", "/radio coś", "/task radio"]) {
    assert.equal(isRadioRequest(input), false);
  }
  assert.equal(BOTEK_COMMANDS.filter((command) => command.command === "radio").length, 1);
});

test("radio data is read only from the existing TRAVNY metadata endpoint", async () => {
  const called = [];
  const result = await readRadioTrack(async (url, init) => {
    called.push({ url, init });
    return trackResponse();
  });
  assert.equal(called[0].url, "https://travny.pages.dev/api/radio-now");
  assert.equal(called[0].init.redirect, "error");
  assert.equal(result.title, "Song");
  assert.equal(result.artist, "Artist");
  assert.equal(result.album, "Album");
  assert.equal(result.cover, "https://img.radioparadise.com/covers/m/123.jpg");
  assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
});

test("radio data rejects unsafe cover URLs, invalid payloads and oversized bodies", async () => {
  const unsafe = await readRadioTrack(() => Promise.resolve(trackResponse({
    title: "x".repeat(260),
    cover: "https://img.radioparadise.com.evil.invalid/covers/m/1.jpg",
  })));
  assert.equal(unsafe.title.length, 200);
  assert.equal(unsafe.cover, "");
  for (const response of [
    Response.json({ title: "", artist: "Artist" }),
    new Response("x".repeat(8 * 1024 + 1)),
    new Response("down", { status: 502 }),
  ]) {
    assert.equal(await readRadioTrack(() => Promise.resolve(response)), null);
  }
});

test("relay only supports GET, failed upstream stays uncached", async (t) => {
  const bad = await radioNowResponse(new Request("https://bot/mini-app/api/radio-now", { method: "POST" }));
  assert.equal(bad.status, 405);
  t.mock.method(globalThis, "fetch", () => Promise.resolve(new Response("down", { status: 500 })));
  const unavailable = await radioNowResponse(new Request("https://bot/mini-app/api/radio-now"));
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.deepEqual(await unavailable.json(), { error: "metadata_unavailable" });
});

test("owner radio card opens same-origin player without leaking tokens", async () => {
  const env = { TELEGRAM_WEBHOOK_URL: "https://tg-assistant.travny.workers.dev/telegram/webhook" };
  assert.equal(radioMiniAppUrl(env), "https://tg-assistant.travny.workers.dev/mini-app?tab=radio");
  const result = await radioReply(env, 123, 45, async () => ({
    title: "Song", artist: "Artist", album: "", cover: "", checkedAt: new Date().toISOString(),
  }));
  assert.equal(result.chatId, 123);
  assert.equal(result.replyToMessageId, 45);
  assert.match(result.text, /Artist · Song/u);
  assert.deepEqual(result.replyMarkup.inline_keyboard[0][0], {
    text: "▶️ Play in Botek",
    web_app: { url: "https://tg-assistant.travny.workers.dev/mini-app?tab=radio" },
  });
  const fallback = await radioReply({}, 123, 45, async () => null);
  assert.equal(fallback.replyMarkup, undefined);
  assert.doesNotMatch(fallback.text, /undefined|Bearer|token/iu);
});
