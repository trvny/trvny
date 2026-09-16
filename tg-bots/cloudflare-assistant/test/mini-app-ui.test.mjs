import assert from "node:assert/strict";
import test from "node:test";

import { telegramMiniAppMenuButton } from "../src/mini-app-menu.ts";
import { miniAppHtmlResponse } from "../src/mini-app-ui.ts";

test("serves a Telegram-native Control Center shell", async () => {
  const response = miniAppHtmlResponse();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/u);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /telegram-web-app\.js\?63/u);
  assert.match(html, /\/mini-app\/api\/status/u);
  assert.match(html, /x-telegram-init-data/u);
  assert.match(html, /\.initData/u);
  assert.match(html, /Legion/u);
  assert.match(html, /Ostatnie zadania/u);
  assert.doesNotMatch(html, /TELEGRAM_BOT_TOKEN|PET_DISPATCHER/u);
});
test("builds the HTTPS Web App menu button used for the owner chat", () => {
  assert.deepEqual(telegramMiniAppMenuButton("https://bot.example/mini-app"), {
    type: "web_app",
    text: "Control Center",
    web_app: { url: "https://bot.example/mini-app" },
  });
  assert.throws(
    () => telegramMiniAppMenuButton("http://bot.example/mini-app"),
    /HTTPS/u,
  );
});
