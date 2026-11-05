import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { Script } from "node:vm";
import test from "node:test";

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
  addEventListener(event, handler) { this.events[event] = handler; }
  dispatch(event) { return this.events[event]?.(); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  scrollIntoView() {}
  click() { this.clicked = true; }
  remove() {}
  cloneNode(deep) {
    const node = new FakeElement();
    node.textContent = this.textContent;
    node.style = { ...this.style };
    if (deep) node.children = this.children.map((child) => child.cloneNode(true));
    return node;
  }
}

class FakePage {
  constructor(sourceIndex, angle = 0) { this.sourceIndex = sourceIndex; this.angle = angle; }
  getRotation() { return { angle: this.angle }; }
  setRotation(rotation) { this.angle = rotation.angle; }
}

class FakePDFDocument {
  constructor(pages = []) { this.pages = pages; }
  static async load(bytes) {
    const text = new TextDecoder().decode(bytes);
    const pages = Number(/PAGES:(\d+)/u.exec(text)?.[1] ?? 1);
    return new FakePDFDocument(Array.from({ length: pages }, (_, n) => new FakePage(n + 1)));
  }
  static async create() { return new FakePDFDocument(); }
  getPageCount() { return this.pages.length; }
  getPageIndices() { return this.pages.map((_, index) => index); }
  getPage(index) { return this.pages[index]; }
  async copyPages(source, indexes) {
    return indexes.map((index) => new FakePage(source.pages[index].sourceIndex, source.pages[index].angle));
  }
  addPage(page) { this.pages.push(page); }
  async save() {
    return new TextEncoder().encode(
      "%PDF-1.7\nPAGES:" + this.pages.length + "\n" +
      this.pages.map((p) => p.sourceIndex + ":" + p.angle).join(",") + "\n" +
      "x".repeat(80) + "\n%%EOF",
    );
  }
}

function fakeFile(name, pages = 3) {
  const data = new TextEncoder().encode("%PDF-1.7\nPAGES:" + pages + "\n" + "x".repeat(70) + "\n%%EOF");
  return { name, size: data.length, async arrayBuffer() { return data.buffer; } };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function harness({ signed = true } = {}) {
  const html = await miniAppHtmlResponse().text();
  const start = html.indexOf("<script>") + "<script>".length;
  const source = html.slice(start, html.indexOf("</script>", start));
  assert.doesNotThrow(() => new Script(source));
  const nodes = new Map(), requests = [], downloads = [];
  let prints = 0;
  const document = {
    body: { appendChild(node) { downloads.push(node); } },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new FakeElement());
      return nodes.get(id);
    },
    createElement: () => new FakeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  document.getElementById("pdf-action").value = "merge";
  document.getElementById("pdf-angle").value = "90";
  document.getElementById("doc-format").value = "md";
  document.getElementById("doc-preview").hidden = true;
  document.getElementById("pdf-tools").hidden = true;
  const webApp = {
    initData: signed ? "signed-miniapp" : "",
    ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
    showConfirm(_message, callback) { callback(true); },
    HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
  };
  const window = {
    Telegram: { WebApp: webApp },
    location: { search: "?tab=doc" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    print() { prints += 1; },
    PDFLib: {
      PDFDocument: FakePDFDocument,
      degrees: (angle) => ({ angle }),
    },
    fflate: {
      zipSync: (files) => new TextEncoder().encode("ZIP:" + Object.keys(files).join("|")),
    },
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === "/mini-app/api/status") return Response.json({ ok: true, legion: {}, tasks: [] });
    if (url === "/mini-app/api/automations") return Response.json({ ok: true, reminders: [], watches: [] });
    if (url === "/mini-app/api/documents/send-pdf") return Response.json({ ok: true, filename: "merged.pdf" });
    throw new Error("Unexpected request: " + url);
  };
  const objectUrls = [];
  const urlApi = {
    createObjectURL(blob) { objectUrls.push(blob); return "blob:pdf-result"; },
    revokeObjectURL() {},
  };
  new Script(source).runInNewContext({
    document, window, fetch, Date, Response, URLSearchParams, URL: urlApi,
    TextEncoder, TextDecoder, Blob, Uint8Array, crypto: webcrypto,
    setTimeout: () => 1, clearTimeout() {},
  });
  await settle();
  return { nodes, requests, downloads, objectUrls, html, prints: () => prints };
}

test("PDF tools are embedded, local-first, and never start an upload at launch", async () => {
  const { html, nodes, requests } = await harness();
  assert.match(html, /id="pdf-tools"/u);
  assert.match(html, /id="doc-print"/u);
  assert.match(html, /vendor\/pdf-lib\.min\.js/u);
  assert.match(html, /vendor\/fflate\.min\.js/u);
  assert.match(html, /\/mini-app\/api\/documents\/send-pdf/u);
  assert.match(html, /Rebuilding PDFs can drop signatures/u);
  assert.equal(nodes.get("pdf-tools").hidden, true);
  nodes.get("doc-pdf-open").dispatch("click");
  assert.equal(nodes.get("pdf-tools").hidden, false);
  assert.equal(requests.some((r) => String(r.url).includes("send-pdf")), false);
});

test("merge outputs one PDF in selected file order without server requests", async () => {
  const { nodes, requests, downloads, objectUrls } = await harness();
  nodes.get("pdf-files").files = [fakeFile("a.pdf", 2), fakeFile("b.pdf", 1)];
  nodes.get("pdf-files").dispatch("change");
  nodes.get("pdf-run").dispatch("click");
  await settle();
  assert.equal(nodes.get("pdf-result").hidden, false);
  assert.equal(nodes.get("pdf-result-name").textContent, "merged.pdf");
  assert.match(nodes.get("pdf-result-size").textContent, /^3 pages/u);
  nodes.get("pdf-download").dispatch("click");
  assert.equal(downloads[1].download, "merged.pdf");
  assert.equal(objectUrls.length, 1);
  assert.match(await objectUrls[0].text(), /1:0,2:0,1:0/u);
  assert.equal(requests.filter((r) => String(r.url).includes("send-pdf")).length, 0);
});

test("extract page ranges in requested order; rotate selected pages", async () => {
  const { nodes, objectUrls } = await harness();
  nodes.get("pdf-files").files = [fakeFile("report.pdf", 4)];
  nodes.get("pdf-files").dispatch("change");
  nodes.get("pdf-action").value = "extract";
  nodes.get("pdf-pages").value = "4,1-2";
  nodes.get("pdf-run").dispatch("click");
  await settle();
  nodes.get("pdf-download").dispatch("click");
  assert.match(await objectUrls[0].text(), /4:0,1:0,2:0/u);
  assert.equal(nodes.get("pdf-result-name").textContent, "report-extract.pdf");

  nodes.get("pdf-action").value = "rotate";
  nodes.get("pdf-action").dispatch("change");
  nodes.get("pdf-pages").value = "2";
  nodes.get("pdf-run").dispatch("click");
  await settle();
  nodes.get("pdf-download").dispatch("click");
  assert.match(await objectUrls[1].text(), /1:0,2:90,3:0,4:0/u);
  assert.equal(nodes.get("pdf-result-name").textContent, "report-rotated.pdf");
});

test("remove, reorder and split use bounded page selections", async () => {
  const { nodes, objectUrls } = await harness();
  nodes.get("pdf-files").files = [fakeFile("a.pdf", 3)];
  nodes.get("pdf-action").value = "remove";
  nodes.get("pdf-pages").value = "2";
  nodes.get("pdf-run").dispatch("click");
  await settle();
  nodes.get("pdf-download").dispatch("click");
  assert.match(await objectUrls[0].text(), /1:0,3:0/u);
  nodes.get("pdf-action").value = "reorder";
  nodes.get("pdf-pages").value = "3,1-2";
  nodes.get("pdf-run").dispatch("click");
  await settle();
  nodes.get("pdf-download").dispatch("click");
  assert.match(await objectUrls[1].text(), /3:0,1:0,2:0/u);
  nodes.get("pdf-action").value = "split";
  nodes.get("pdf-pages").value = "1,3";
  nodes.get("pdf-run").dispatch("click");
  await settle();
  nodes.get("pdf-download").dispatch("click");
  assert.equal(nodes.get("pdf-result-name").textContent, "a-pages.zip");
  assert.equal(nodes.get("pdf-send").hidden, true);
  assert.match(await objectUrls[2].text(), /ZIP:page-001\.pdf\|page-003\.pdf/u);
});

test("invalid selections fail without accidental PDF export or send", async () => {
  const { nodes, requests } = await harness();
  nodes.get("pdf-files").files = [fakeFile("a.pdf", 3)];
  nodes.get("pdf-action").value = "extract";
  nodes.get("pdf-pages").value = "1,1";
  nodes.get("pdf-run").dispatch("click");
  await settle();
  assert.match(nodes.get("pdf-status").textContent, /Repeated page/u);
  assert.equal(nodes.get("pdf-result").hidden, true);
  assert.equal(requests.filter((r) => String(r.url).includes("send-pdf")).length, 0);
});

test("send PDF requires explicit click, uses immutable blob and signed owner headers", async () => {
  const { nodes, requests } = await harness();
  nodes.get("pdf-files").files = [fakeFile("a.pdf", 2), fakeFile("b.pdf", 1)];
  nodes.get("pdf-run").dispatch("click");
  await settle();
  nodes.get("pdf-send").dispatch("click");
  await settle();
  const uploads = requests.filter((r) => r.url === "/mini-app/api/documents/send-pdf");
  assert.equal(uploads.length, 1);
  const options = uploads[0].options;
  assert.equal(options.headers["x-telegram-init-data"], "signed-miniapp");
  assert.equal(options.headers["content-type"], "application/pdf");
  assert.equal(decodeURIComponent(options.headers["x-doc-filename"]), "merged.pdf");
  assert.match(options.headers["x-doc-request-id"], /^[a-f0-9-]{36}$/iu);
  assert.ok(options.body instanceof Blob);
  assert.match(await options.body.text(), /^%PDF-/u);
  assert.equal(nodes.get("pdf-send").disabled, true);
});

test("unsigned Mini App can work locally but cannot upload a PDF", async () => {
  const { nodes, requests } = await harness({ signed: false });
  nodes.get("pdf-files").files = [fakeFile("a.pdf", 2), fakeFile("b.pdf", 1)];
  nodes.get("pdf-run").dispatch("click");
  await settle();
  nodes.get("pdf-send").dispatch("click");
  await settle();
  assert.equal(requests.filter((r) => r.url === "/mini-app/api/documents/send-pdf").length, 0);
  assert.match(nodes.get("pdf-status").textContent, /Open Botek in Telegram/u);
});

test("print to PDF uses the local text preview, not a remote conversion service", async () => {
  const { nodes, prints, requests, html } = await harness();
  nodes.get("doc-title").value = "Polish document";
  nodes.get("doc-content").value = "# Zażółć gęślą jaźń\nLine two";
  nodes.get("doc-print").dispatch("click");
  const printable = nodes.get("doc-print-view");
  assert.equal(printable.children[0].textContent, "Polish document");
  assert.equal(printable.children[1].children[0].textContent, "Zażółć gęślą jaźń");
  assert.equal(prints(), 1);
  assert.match(html, /\.app > \*:not\(\.doc-print-view\)/u);
  assert.equal(requests.filter((r) => String(r.url).includes("send")).length, 0);
});
