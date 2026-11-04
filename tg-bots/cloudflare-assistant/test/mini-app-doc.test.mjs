import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { Script } from "node:vm";

import { miniAppHtmlResponse } from "../src/mini-app-ui.ts";

class FakeElement {
  constructor() {
    this.events = {};
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.style = {};
    this.files = [];
    this.disabled = false;
  }
  addEventListener(name, handler) { this.events[name] = handler; }
  dispatch(name) { return this.events[name]?.(); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  scrollIntoView() { this.scrolled = true; }
  click() { this.clicked = true; }
  remove() { this.removed = true; }
}

async function harness({ signed = true, saved = null, sendResponse = Response.json({ ok: true, filename: "Hello.md" }) } = {}) {
  const html = await miniAppHtmlResponse().text();
  const start = html.indexOf("<script>") + "<script>".length;
  const source = html.slice(start, html.indexOf("</script>", start));
  assert.doesNotThrow(() => new Script(source));

  const nodes = new Map();
  const requests = [];
  const savedData = new Map(saved ? [["botek_doc_draft_v1", JSON.stringify(saved)]] : []);
  const downloads = [];
  const doc = {
    hidden: false,
    body: { appendChild(node) { downloads.push(node); } },
    createElement() { return new FakeElement(); },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new FakeElement());
      return nodes.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  doc.getElementById("doc-format").value = "md";
  doc.getElementById("doc-volume").value = "0.8";
  const storage = {
    getItem: (key) => savedData.get(key) || null,
    setItem: (key, value) => savedData.set(key, value),
    removeItem: (key) => savedData.delete(key),
  };
  const webApp = {
    initData: signed ? "signed-init-data" : "",
    ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
    showConfirm: (_text, callback) => callback(true),
    HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
  };
  const window = {
    location: { search: "?tab=doc" },
    localStorage: storage,
    Telegram: { WebApp: webApp },
    addEventListener() {},
  };
  const fetch = (url, options) => {
    requests.push({ url, options });
    if (url === "/mini-app/api/status") return Promise.resolve(Response.json({ ok: true, legion: {}, tasks: [] }));
    if (url === "/mini-app/api/automations") return Promise.resolve(Response.json({ ok: true, reminders: [], watches: [] }));
    if (url === "/mini-app/api/documents/send") return Promise.resolve(sendResponse.clone());
    throw new Error("Unexpected request " + url);
  };
  new Script(source).runInNewContext({
    document: doc, window, fetch, Date, Response, URLSearchParams,
    TextEncoder, Blob, Uint8Array, crypto: webcrypto,
    setTimeout: () => 1, clearTimeout: () => {},
    URL: { createObjectURL: (blob) => { downloads.push(blob); return "blob:local-draft"; }, revokeObjectURL() {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { nodes, requests, savedData, downloads, html, webApp };
}

test("Mini App provides native editor, export and private send without auto-upload", async () => {
  const { nodes, requests, html } = await harness();
  assert.match(html, /id="doc-open"/u);
  assert.match(html, /id="doc-studio"/u);
  assert.match(html, /id="doc-autosave"/u);
  assert.match(html, /https:\/\/docbench\.travny\.workers\.dev/u);
  assert.equal(nodes.get("doc-studio").hidden, false);
  assert.equal(nodes.get("doc-open").attributes["aria-expanded"], "true");
  assert.equal(requests.filter((r) => r.url.includes("documents/send")).length, 0);
  assert.match(html, /Private until you send\. Maximum 64 KiB\./u);
});

test("preview builds text nodes, never interpreted HTML", async () => {
  const { nodes } = await harness();
  nodes.get("doc-content").value = "# Heading\n<script>alert(1)</script>\n- Item";
  nodes.get("doc-content").dispatch("input");
  nodes.get("doc-preview-button").dispatch("click");
  const rows = nodes.get("doc-preview").children;
  assert.equal(rows[0].textContent, "Heading");
  assert.equal(rows[1].textContent, "<script>alert(1)</script>");
  assert.equal(rows[2].textContent, "• Item");
  assert.equal(nodes.get("doc-editor").hidden, true);
  assert.equal(nodes.get("doc-preview").hidden, false);
});

test("drafts are kept only in memory until local storage opt-in", async () => {
  const { nodes, savedData } = await harness();
  nodes.get("doc-title").value = "Private note";
  nodes.get("doc-content").value = "Text";
  nodes.get("doc-content").dispatch("input");
  assert.equal(savedData.size, 0);
  nodes.get("doc-save").dispatch("click");
  assert.equal(savedData.size, 0);
  nodes.get("doc-autosave").checked = true;
  nodes.get("doc-autosave").dispatch("change");
  assert.deepEqual(JSON.parse(savedData.get("botek_doc_draft_v1")), {
    title: "Private note", text: "Text", format: "md",
  });
  nodes.get("doc-forget").dispatch("click");
  assert.equal(savedData.size, 0);
  assert.equal(nodes.get("doc-content").value, "Text");
});

test("opted-in draft restores without contacting a backend", async () => {
  const { nodes, requests } = await harness({
    saved: { title: "Saved", text: "# Safe\n\nDraft", format: "md" },
  });
  assert.equal(nodes.get("doc-title").value, "Saved");
  assert.equal(nodes.get("doc-content").value, "# Safe\n\nDraft");
  assert.equal(nodes.get("doc-autosave").checked, true);
  assert.equal(requests.filter((r) => r.url.includes("documents/send")).length, 0);
});

test("user-confirmed send includes Telegram init data and idempotency key", async () => {
  const { nodes, requests } = await harness();
  nodes.get("doc-title").value = "Hello";
  nodes.get("doc-content").value = "# Hello";
  nodes.get("doc-content").dispatch("input");
  nodes.get("doc-send").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  const sent = requests.filter((r) => r.url === "/mini-app/api/documents/send");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.headers["x-telegram-init-data"], "signed-init-data");
  const body = JSON.parse(sent[0].options.body);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/iu);
  assert.deepEqual({ title: body.title, text: body.text, format: body.format },
    { title: "Hello", text: "# Hello", format: "md" });
  assert.match(nodes.get("doc-status").textContent, /Sent/u);
  assert.equal(nodes.get("doc-send").disabled, true);
});

test("without Telegram init data export stays possible but send is blocked", async () => {
  const { nodes, requests } = await harness({ signed: false });
  nodes.get("doc-content").value = "# Hello";
  nodes.get("doc-title").value = "Hello";
  nodes.get("doc-send").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.filter((r) => r.url.includes("documents/send")).length, 0);
  assert.match(nodes.get("doc-status").textContent, /requires the private Telegram/u);
});

test("export downloads a local Markdown blob, never calls the server", async () => {
  const { nodes, requests, downloads } = await harness();
  nodes.get("doc-title").value = "My note";
  nodes.get("doc-content").value = "# Hello";
  nodes.get("doc-export").dispatch("click");
  assert.equal(downloads[0] instanceof Blob, true);
  assert.equal(await downloads[0].text(), "# Hello");
  assert.equal(downloads[1].download, "My-note.md");
  assert.equal(downloads[1].clicked, true);
  assert.equal(requests.filter((r) => r.url.includes("documents/send")).length, 0);
});
