import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

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
  assert.match(html, /\/mini-app\/api\/tasks\//u);
  assert.match(html, /showConfirm/u);
  assert.match(html, /Anuluj/u);
  assert.match(html, /Watchtower/u);
  assert.match(html, /\/mini-app\/api\/automations/u);
  assert.match(html, /renderAutomationRows/u);
  assert.doesNotMatch(html, /TELEGRAM_BOT_TOKEN|PET_DISPATCHER/u);
});
test("renders Bench launch tiles through Telegram openLink", async () => {
  const response = miniAppHtmlResponse();
  const html = await response.text();

  assert.match(html, /https:\/\/codebench\.trfny\.com/u);
  assert.match(html, /https:\/\/streambench\.trfny\.com/u);
  assert.match(html, /https:\/\/docbench\.travny\.workers\.dev/u);
  assert.match(html, /data-tool-url/u);
  assert.match(html, /webApp\.openLink\(url\)/u);
});

test("parses the embedded Control Center client script", async () => {
  const html = await miniAppHtmlResponse().text();
  const start = html.indexOf("<script>") + "<script>".length;
  const end = html.indexOf("</script>", start);
  assert.ok(start >= "<script>".length && end > start);
  assert.doesNotThrow(() => new Script(html.slice(start, end)));
});

test("Watchtower stays responsive to stalled status and ignores superseded loads", async () => {
  const html = await miniAppHtmlResponse().text();
  const start = html.indexOf("<script>") + "<script>".length;
  const end = html.indexOf("</script>", start);
  const elements = new Map();
  const pending = [];

  function element() {
    return {
      children: [], events: {}, textContent: "", className: "", disabled: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, handler) { this.events[type] = handler; },
      getAttribute() { return null; },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    querySelectorAll: () => [],
  };
  const webApp = {
    initData: "signed-in-test",
    ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
    HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
  };
  const fetch = (path) => path === "/mini-app/api/status"
    ? new Promise(() => {})
    : new Promise((resolve) => pending.push(resolve));

  new Script(html.slice(start, end)).runInNewContext({ document, window: { Telegram: { WebApp: webApp } }, fetch, Response, Date });

  assert.equal(pending.length, 1);
  elements.get("refresh").events.click();
  assert.equal(pending.length, 2);

  pending[1](Response.json({
    ok: true,
    reminders: [{ id: "rnew", text: "Newest reminder", state: "pending", dueAt: "2026-11-04T10:00:00Z" }],
    watches: [],
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("reminder-count").textContent, "1");
  assert.equal(elements.get("reminders").children[0].children[1].textContent, "Newest reminder");
  assert.equal(elements.get("refresh").disabled, false);

  pending[0](Response.json({
    ok: true,
    reminders: [{ id: "rold", text: "Stale reminder", state: "pending", dueAt: "2026-11-04T10:00:00Z" }],
    watches: [],
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("reminders").children[0].children[1].textContent, "Newest reminder");
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
