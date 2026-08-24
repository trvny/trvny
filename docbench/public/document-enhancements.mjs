import { parseTree } from "./vendor/jsonc-parser/impl/parser.js";

const $ = (selector) => document.querySelector(selector);

const editor = $("#editor");
const preview = $("#preview");
const previewTitle = $("#preview-title");
const formatSelect = $("#format-select");
const eolSelect = $("#eol-select");
const filenameLabel = $("#filename-label");
const encodingLabel = $("#encoding-label");
const detailStatus = $("#detail-status");
const statusBadge = $("#status-badge");
const fileInput = $("#file-input");
const openButton = $("#open-button");
const newButton = $("#new-button");
const saveButton = $("#save-button");
const downloadButton = $("#download-button");
const formatButton = $("#format-button");
const validateButton = $("#validate-button");
const dropZone = $("#drop-zone");
const documentWorkspace = $("#document-workspace");

const MAX_TREE_NODES = 5000;
const SOURCE_SCALAR = Symbol("source-scalar");
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const extensionToFormat = {
  txt: "txt",
  md: "md",
  markdown: "md",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
};
const mimeByFormat = {
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  json: "application/json;charset=utf-8",
  yaml: "application/yaml;charset=utf-8",
  xml: "application/xml;charset=utf-8",
};
const pickerTypes = [
  {
    description: "Text documents",
    accept: {
      "text/plain": [".txt"],
      "text/markdown": [".md", ".markdown"],
      "application/json": [".json"],
      "application/yaml": [".yml", ".yaml"],
      "application/xml": [".xml"],
    },
  },
];

const state = {
  handle: null,
  filename: filenameLabel.textContent || "untitled.txt",
  bom: false,
  mixedEol: false,
  eol: eolSelect.value,
};

const nativeOpenSupported = globalThis.isSecureContext
  && typeof globalThis.showOpenFilePicker === "function";
const nativeSaveSupported = globalThis.isSecureContext
  && typeof globalThis.showSaveFilePicker === "function";

function detectEol(raw) {
  const crlf = (raw.match(/\r\n/g) || []).length;
  const totalLf = (raw.match(/\n/g) || []).length;
  const lf = totalLf - crlf;
  const cr = (raw.match(/\r(?!\n)/g) || []).length;
  const present = [["CRLF", crlf], ["LF", lf], ["CR", cr]]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!present.length) return { target: "LF", mixed: false };
  return { target: present[0][0], mixed: present.length > 1 };
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function applyEol(text, kind) {
  const normalized = normalizeEol(text);
  if (kind === "CRLF") return normalized.replace(/\n/g, "\r\n");
  if (kind === "CR") return normalized.replace(/\n/g, "\r");
  return normalized;
}

function formatFromFilename(name) {
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
  return extensionToFormat[extension] || "txt";
}

async function readTextFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bom = bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf;
  const contentBytes = bom ? bytes.slice(3) : bytes;
  if (contentBytes.includes(0)) {
    throw new Error("Binary or UTF-16 input is not supported yet.");
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
  return { raw, bom, eol: detectEol(raw) };
}

function updateMeta() {
  const lines = editor.value.split("\n").length;
  const mixed = state.mixedEol ? `Mixed → ${eolSelect.value}` : eolSelect.value;
  const bom = state.bom ? "UTF-8 BOM" : "UTF-8";
  const linked = state.handle ? " · linked file" : "";
  encodingLabel.textContent = `${bom} · ${mixed}`;
  detailStatus.textContent = `${bom} · ${mixed} · ${lines} line${lines === 1 ? "" : "s"}${linked}`;
}

function updateSaveButton() {
  saveButton.textContent = state.handle || !nativeSaveSupported ? "Save" : "Save as…";
  saveButton.title = state.handle
    ? `Save directly to ${state.filename}`
    : nativeSaveSupported
      ? "Choose a file once, then later saves update it directly"
      : "Download the edited file";
}

function setPreviewMode(mode, title) {
  preview.className = `preview-${mode}`;
  previewTitle.textContent = title;
}

function setStatus(kind, text) {
  statusBadge.className = `status ${kind}`;
  statusBadge.textContent = text;
  statusBadge.removeAttribute("title");
}

function scalarText(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "undefined") return "undefined";
  return String(value);
}

function scalarClass(value) {
  if (value === null) return "null";
  if (["string", "number", "boolean", "undefined"].includes(typeof value)) {
    return typeof value;
  }
  return "other";
}

function appendScalar(parent, key, value) {
  const row = document.createElement("div");
  row.className = "tree-leaf";
  if (key !== null) {
    const keyNode = document.createElement("span");
    keyNode.className = "tree-key";
    keyNode.textContent = `${key}: `;
    row.append(keyNode);
  }
  const valueNode = document.createElement("span");
  valueNode.className = `tree-value tree-${scalarClass(value)}`;
  valueNode.textContent = scalarText(value);
  row.append(valueNode);
  parent.append(row);
}

function sourceScalar(text, type) {
  return { [SOURCE_SCALAR]: true, text, type };
}

function isSourceScalar(value) {
  return Boolean(value?.[SOURCE_SCALAR]);
}

function appendSourceScalar(parent, key, value) {
  const row = document.createElement("div");
  row.className = "tree-leaf";
  if (key !== null) {
    const keyNode = document.createElement("span");
    keyNode.className = "tree-key";
    keyNode.textContent = `${key}: `;
    row.append(keyNode);
  }
  const valueNode = document.createElement("span");
  valueNode.className = `tree-value tree-${value.type}`;
  valueNode.textContent = value.text;
  row.append(valueNode);
  parent.append(row);
}

function appendTreeLimit(fragment) {
  const note = document.createElement("p");
  note.className = "preview-limit-note";
  note.textContent = `Tree preview stopped after ${MAX_TREE_NODES.toLocaleString()} nodes.`;
  fragment.append(note);
}

function renderDataTree(value, rootLabel = "root") {
  const fragment = document.createDocumentFragment();
  const seen = new WeakSet();
  let nodes = 0;
  let truncated = false;

  function renderNode(parent, key, item, depth) {
    if (nodes >= MAX_TREE_NODES) {
      truncated = true;
      return;
    }
    nodes += 1;

    if (isSourceScalar(item)) {
      appendSourceScalar(parent, key, item);
      return;
    }
    if (!item || typeof item !== "object") {
      appendScalar(parent, key, item);
      return;
    }
    if (seen.has(item)) {
      appendScalar(parent, key, "[alias/circular reference]");
      return;
    }
    seen.add(item);

    const entries = Array.isArray(item)
      ? item.map((child, index) => [index, child])
      : Object.entries(item);
    const details = document.createElement("details");
    details.className = "tree-node";
    details.open = depth < 2;

    const summary = document.createElement("summary");
    const keyNode = document.createElement("span");
    keyNode.className = "tree-key";
    keyNode.textContent = key === null ? rootLabel : String(key);
    const metaNode = document.createElement("span");
    metaNode.className = "tree-meta";
    metaNode.textContent = Array.isArray(item)
      ? `Array(${entries.length})`
      : `Object(${entries.length})`;
    summary.append(keyNode, metaNode);
    details.append(summary);

    const children = document.createElement("div");
    children.className = "tree-children";
    for (const [childKey, childValue] of entries) {
      renderNode(children, childKey, childValue, depth + 1);
      if (truncated) break;
    }
    details.append(children);
    parent.append(details);
  }

  renderNode(fragment, null, value, 0);
  if (truncated) appendTreeLimit(fragment);
  return fragment;
}

function preserveYamlNumericLexemes(typed, raw, seen = new WeakMap()) {
  if (typeof typed === "number") {
    return sourceScalar(typeof raw === "string" ? raw : String(typed), "number");
  }
  if (!typed || typeof typed !== "object") return typed;
  if (seen.has(typed)) return seen.get(typed);

  const result = Array.isArray(typed) ? [] : {};
  seen.set(typed, result);
  if (Array.isArray(typed)) {
    typed.forEach((item, index) => {
      result[index] = preserveYamlNumericLexemes(item, raw?.[index], seen);
    });
  } else {
    for (const [key, item] of Object.entries(typed)) {
      result[key] = preserveYamlNumericLexemes(item, raw?.[key], seen);
    }
  }
  return result;
}

function jsonScalarClass(node) {
  if (node.type === "string") return "string";
  if (node.type === "number") return "number";
  if (node.type === "boolean") return "boolean";
  if (node.type === "null") return "null";
  return "other";
}

function appendJsonScalar(parent, key, node, source) {
  const row = document.createElement("div");
  row.className = "tree-leaf";
  if (key !== null) {
    const keyNode = document.createElement("span");
    keyNode.className = "tree-key";
    keyNode.textContent = `${key}: `;
    row.append(keyNode);
  }
  const valueNode = document.createElement("span");
  valueNode.className = `tree-value tree-${jsonScalarClass(node)}`;
  valueNode.textContent = source.slice(node.offset, node.offset + node.length);
  row.append(valueNode);
  parent.append(row);
}

function renderJsonTree(source) {
  const errors = [];
  const root = parseTree(source, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (!root || errors.length) return null;

  const fragment = document.createDocumentFragment();
  let nodes = 0;
  let truncated = false;

  function renderNode(parent, key, node, depth) {
    if (!node || nodes >= MAX_TREE_NODES) {
      truncated = true;
      return;
    }
    nodes += 1;

    if (!["object", "array"].includes(node.type)) {
      appendJsonScalar(parent, key, node, source);
      return;
    }

    const details = document.createElement("details");
    details.className = "tree-node";
    details.open = depth < 2;
    const summary = document.createElement("summary");
    const keyNode = document.createElement("span");
    keyNode.className = "tree-key";
    keyNode.textContent = key === null ? "JSON" : String(key);
    const metaNode = document.createElement("span");
    metaNode.className = "tree-meta";
    const count = node.children?.length || 0;
    metaNode.textContent = node.type === "array"
      ? `Array(${count})`
      : `Object(${count})`;
    summary.append(keyNode, metaNode);
    details.append(summary);

    const children = document.createElement("div");
    children.className = "tree-children";
    if (node.type === "array") {
      (node.children || []).forEach((child, index) => {
        if (!truncated) renderNode(children, index, child, depth + 1);
      });
    } else {
      for (const property of node.children || []) {
        const [propertyName, propertyValue] = property.children || [];
        const propertyKey = propertyName?.value ?? "?";
        renderNode(children, propertyKey, propertyValue, depth + 1);
        if (truncated) break;
      }
    }
    details.append(children);
    parent.append(details);
  }

  renderNode(fragment, null, root, 0);
  if (truncated) appendTreeLimit(fragment);
  return fragment;
}

function xmlParserError(doc) {
  const root = doc.documentElement;
  const namespaces = new Set([
    "http://www.mozilla.org/newlayout/xml/parsererror.xml",
    "http://www.w3.org/1999/xhtml",
  ]);
  return root?.localName === "parsererror" && namespaces.has(root.namespaceURI)
    ? root
    : null;
}

function preservesXmlSpace(node) {
  let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (element) {
    const mode = element.getAttributeNS?.(XML_NAMESPACE, "space");
    if (mode === "preserve") return true;
    if (mode === "default") return false;
    element = element.parentElement;
  }
  return false;
}

function renderXmlTree(doc) {
  const fragment = document.createDocumentFragment();
  let nodes = 0;
  let truncated = false;

  function renderNode(parent, node, depth) {
    if (nodes >= MAX_TREE_NODES) {
      truncated = true;
      return;
    }
    nodes += 1;

    if (node.nodeType === Node.ELEMENT_NODE) {
      const details = document.createElement("details");
      details.className = "tree-node xml-node";
      details.open = depth < 2;
      const summary = document.createElement("summary");
      const name = document.createElement("span");
      name.className = "tree-key";
      name.textContent = `<${node.nodeName}>`;
      summary.append(name);
      for (const attribute of node.attributes) {
        const attr = document.createElement("span");
        attr.className = "xml-attribute";
        attr.textContent = `${attribute.name}=${JSON.stringify(attribute.value)}`;
        summary.append(attr);
      }
      details.append(summary);
      const children = document.createElement("div");
      children.className = "tree-children";
      for (const child of node.childNodes) {
        renderNode(children, child, depth + 1);
        if (truncated) break;
      }
      details.append(children);
      parent.append(details);
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue || "";
      if (value.trim() || preservesXmlSpace(node)) {
        appendScalar(parent, "#text", value);
      }
      return;
    }
    if (node.nodeType === Node.CDATA_SECTION_NODE) {
      appendScalar(parent, "#cdata", node.nodeValue || "");
      return;
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      appendScalar(parent, "#comment", node.nodeValue || "");
    }
  }

  for (const child of doc.childNodes) {
    renderNode(fragment, child, 0);
    if (truncated) break;
  }
  if (truncated) appendTreeLimit(fragment);
  return fragment;
}

function safeHref(href) {
  if (!href) return null;
  if (href.startsWith("#")) return href;
  try {
    const resolved = new URL(href, globalThis.location.href);
    if (["http:", "https:", "mailto:"].includes(resolved.protocol)) return href;
  } catch {
    return null;
  }
  return null;
}

function markdownInline(tokens, parent) {
  for (const token of tokens || []) {
    if (token.type === "text" || token.type === "escape") {
      if (token.tokens?.length) markdownInline(token.tokens, parent);
      else parent.append(document.createTextNode(token.text || ""));
      continue;
    }
    if (["strong", "em", "del"].includes(token.type)) {
      const tag = token.type === "strong" ? "strong" : token.type;
      const element = document.createElement(tag);
      markdownInline(token.tokens, element);
      parent.append(element);
      continue;
    }
    if (token.type === "codespan") {
      const code = document.createElement("code");
      code.textContent = token.text || "";
      parent.append(code);
      continue;
    }
    if (token.type === "br") {
      parent.append(document.createElement("br"));
      continue;
    }
    if (token.type === "link") {
      const href = safeHref(token.href);
      if (!href) {
        markdownInline(token.tokens, parent);
        continue;
      }
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (token.title) link.title = token.title;
      markdownInline(token.tokens, link);
      parent.append(link);
      continue;
    }
    if (token.type === "image") {
      const image = document.createElement("span");
      image.className = "markdown-image-placeholder";
      image.textContent = token.text ? `[image: ${token.text}]` : "[image omitted]";
      if (token.href) {
        image.title = `Remote images are not loaded automatically: ${token.href}`;
      }
      parent.append(image);
      continue;
    }
    if (token.type === "html") {
      const raw = document.createElement("code");
      raw.className = "markdown-raw-html";
      raw.textContent = token.text || token.raw || "";
      parent.append(raw);
      continue;
    }
    if (token.tokens?.length) markdownInline(token.tokens, parent);
    else if (token.text) parent.append(document.createTextNode(token.text));
  }
}

function markdownCellTokens(cell) {
  if (Array.isArray(cell)) return cell;
  if (cell?.tokens) return cell.tokens;
  return [{ type: "text", text: cell?.text ?? String(cell ?? "") }];
}

function renderMarkdownBlocks(tokens, parent) {
  for (const token of tokens || []) {
    if (token.type === "space") continue;
    if (token.type === "heading") {
      const depth = Math.min(6, Math.max(1, token.depth || 1));
      const heading = document.createElement(`h${depth}`);
      markdownInline(token.tokens, heading);
      parent.append(heading);
      continue;
    }
    if (token.type === "paragraph" || token.type === "text") {
      const paragraph = document.createElement("p");
      markdownInline(token.tokens?.length ? token.tokens : [token], paragraph);
      parent.append(paragraph);
      continue;
    }
    if (token.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = token.text || "";
      if (token.lang) code.dataset.language = token.lang.split(/\s+/)[0];
      pre.append(code);
      parent.append(pre);
      continue;
    }
    if (token.type === "blockquote") {
      const quote = document.createElement("blockquote");
      renderMarkdownBlocks(token.tokens, quote);
      parent.append(quote);
      continue;
    }
    if (token.type === "list") {
      const list = document.createElement(token.ordered ? "ol" : "ul");
      if (token.ordered && Number.isFinite(token.start) && token.start !== 1) {
        list.start = token.start;
      }
      for (const itemToken of token.items || []) {
        const item = document.createElement("li");
        if (itemToken.task) {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = Boolean(itemToken.checked);
          checkbox.disabled = true;
          checkbox.setAttribute("aria-hidden", "true");
          item.append(checkbox, document.createTextNode(" "));
        }
        renderMarkdownBlocks(itemToken.tokens, item);
        list.append(item);
      }
      parent.append(list);
      continue;
    }
    if (token.type === "table") {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      (token.header || []).forEach((cell, index) => {
        const th = document.createElement("th");
        const align = token.align?.[index];
        if (["left", "center", "right"].includes(align)) th.style.textAlign = align;
        markdownInline(markdownCellTokens(cell), th);
        headRow.append(th);
      });
      thead.append(headRow);
      table.append(thead);
      const tbody = document.createElement("tbody");
      for (const row of token.rows || []) {
        const tr = document.createElement("tr");
        row.forEach((cell, index) => {
          const td = document.createElement("td");
          const align = token.align?.[index];
          if (["left", "center", "right"].includes(align)) td.style.textAlign = align;
          markdownInline(markdownCellTokens(cell), td);
          tr.append(td);
        });
        tbody.append(tr);
      }
      table.append(tbody);
      parent.append(table);
      continue;
    }
    if (token.type === "hr") {
      parent.append(document.createElement("hr"));
      continue;
    }
    if (token.type === "html") {
      const raw = document.createElement("pre");
      raw.className = "markdown-raw-html-block";
      const code = document.createElement("code");
      code.textContent = token.text || token.raw || "";
      raw.append(code);
      parent.append(raw);
      continue;
    }
    if (token.tokens?.length) renderMarkdownBlocks(token.tokens, parent);
  }
}

function renderMarkdown() {
  const markedApi = globalThis.marked;
  if (!markedApi?.lexer) {
    setPreviewMode("raw", "Markdown source");
    preview.textContent = editor.value;
    setStatus("bad", "Preview unavailable");
    return;
  }
  const tokens = markedApi.lexer(editor.value, { gfm: true, breaks: false });
  const fragment = document.createDocumentFragment();
  renderMarkdownBlocks(tokens, fragment);
  setPreviewMode("markdown", "Markdown preview");
  preview.replaceChildren(fragment);
  setStatus("neutral", "Rendered Markdown");
}

function renderEnhancedPreview() {
  const format = formatSelect.value;
  if (format === "txt") {
    setPreviewMode("raw", "Plain-text preview");
    preview.textContent = editor.value;
    setStatus("neutral", "Plain text");
    updateMeta();
    return;
  }
  if (format === "md") {
    renderMarkdown();
    updateMeta();
    return;
  }
  if (format === "json") {
    const tree = renderJsonTree(editor.value);
    if (!tree) {
      setPreviewMode("raw", "Parse error");
      updateMeta();
      return;
    }
    setPreviewMode("tree", "JSON tree");
    preview.replaceChildren(tree);
    setStatus("good", "Valid · tree");
    updateMeta();
    return;
  }
  if (format === "yaml") {
    try {
      const typed = [];
      const raw = [];
      globalThis.jsyaml.loadAll(editor.value, (doc) => typed.push(doc));
      globalThis.jsyaml.loadAll(editor.value, (doc) => raw.push(doc), {
        schema: globalThis.jsyaml.FAILSAFE_SCHEMA,
      });
      const merged = typed.map((doc, index) => {
        return preserveYamlNumericLexemes(doc, raw[index]);
      });
      const value = merged.length === 1 ? merged[0] : merged;
      setPreviewMode("tree", "YAML tree");
      preview.replaceChildren(
        renderDataTree(value, merged.length === 1 ? "YAML" : "YAML documents"),
      );
      setStatus("good", "Valid · tree");
    } catch {
      setPreviewMode("raw", "Parse error");
    }
    updateMeta();
    return;
  }
  if (format === "xml") {
    const doc = new DOMParser().parseFromString(editor.value, "application/xml");
    if (xmlParserError(doc)) {
      setPreviewMode("raw", "Parse error");
      updateMeta();
      return;
    }
    setPreviewMode("tree", "XML tree");
    preview.replaceChildren(renderXmlTree(doc));
    setStatus("good", "Valid · tree");
    updateMeta();
  }
}

let previewTimer;
function schedulePreview(delay = 145) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderEnhancedPreview, delay);
}

function documentBytes() {
  const raw = applyEol(editor.value, eolSelect.value);
  const encoded = new TextEncoder().encode(raw);
  if (!state.bom) return encoded;
  const result = new Uint8Array(encoded.length + 3);
  result.set([0xef, 0xbb, 0xbf]);
  result.set(encoded, 3);
  return result;
}

function downloadDocument() {
  const blob = new Blob(
    [documentBytes()],
    { type: mimeByFormat[formatSelect.value] || mimeByFormat.txt },
  );
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = state.filename || filenameLabel.textContent || "document.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function ensureWritePermission(handle) {
  if (typeof handle.queryPermission !== "function") return true;
  const options = { mode: "readwrite" };
  if (await handle.queryPermission(options) === "granted") return true;
  if (typeof handle.requestPermission !== "function") return false;
  return await handle.requestPermission(options) === "granted";
}

function flashSaveState(text) {
  saveButton.textContent = text;
  setTimeout(updateSaveButton, 1100);
}

async function writeHandle(handle) {
  if (!await ensureWritePermission(handle)) {
    throw new Error("Write permission was not granted.");
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(documentBytes());
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // Preserve the original write/close error.
    }
    throw error;
  }
  state.handle = handle;
  state.filename = handle.name || state.filename;
  filenameLabel.textContent = state.filename;
  updateMeta();
  updateSaveButton();
  flashSaveState("Saved ✓");
}

async function chooseSaveHandle() {
  return globalThis.showSaveFilePicker({
    suggestedName: state.filename || filenameLabel.textContent || "document.txt",
    types: pickerTypes,
  });
}

async function saveDocument() {
  try {
    if (state.handle) {
      await writeHandle(state.handle);
      return;
    }
    if (nativeSaveSupported) {
      const handle = await chooseSaveHandle();
      await writeHandle(handle);
      return;
    }
    downloadDocument();
    flashSaveState("Downloaded ✓");
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (!state.handle && ["TypeError", "SecurityError", "NotAllowedError"].includes(error?.name)) {
      downloadDocument();
      flashSaveState("Downloaded ✓");
      return;
    }
    setStatus("bad", "Save failed");
    statusBadge.title = error?.message || String(error);
  }
}

async function loadNativeHandle(handle) {
  const file = await handle.getFile();
  const { raw, bom, eol } = await readTextFile(file);
  state.handle = handle;
  state.filename = file.name || handle.name || "document.txt";
  state.bom = bom;
  state.mixedEol = eol.mixed;
  state.eol = eol.target;
  editor.value = normalizeEol(raw);
  eolSelect.value = eol.target;
  formatSelect.value = formatFromFilename(state.filename);
  filenameLabel.textContent = state.filename;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  updateSaveButton();
  schedulePreview();
}

async function syncFallbackFile(file) {
  try {
    const { bom, eol } = await readTextFile(file);
    state.handle = null;
    state.filename = file.name || filenameLabel.textContent || "document.txt";
    state.bom = bom;
    state.mixedEol = eol.mixed;
    state.eol = eol.target;
    setTimeout(() => {
      state.filename = filenameLabel.textContent || state.filename;
      updateSaveButton();
      renderEnhancedPreview();
    }, 170);
  } catch {
    state.handle = null;
    updateSaveButton();
  }
}

openButton.addEventListener("click", (event) => {
  if (!nativeOpenSupported) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void (async () => {
    try {
      const [handle] = await globalThis.showOpenFilePicker({
        multiple: false,
        types: pickerTypes,
      });
      if (handle) await loadNativeHandle(handle);
    } catch (error) {
      if (error?.name === "AbortError") return;
      fileInput.click();
    }
  })();
}, true);

saveButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  void saveDocument();
}, true);

downloadButton.addEventListener("click", downloadDocument);

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void syncFallbackFile(file);
});

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) void syncFallbackFile(file);
}, true);

newButton.addEventListener("click", () => {
  queueMicrotask(() => {
    state.handle = null;
    state.filename = filenameLabel.textContent || "untitled.txt";
    state.bom = false;
    state.mixedEol = false;
    state.eol = eolSelect.value;
    updateSaveButton();
    renderEnhancedPreview();
  });
});

editor.addEventListener("input", () => schedulePreview());
formatSelect.addEventListener("change", () => {
  queueMicrotask(() => {
    if (state.handle) filenameLabel.textContent = state.filename;
    else state.filename = filenameLabel.textContent || state.filename;
    schedulePreview();
  });
});
eolSelect.addEventListener("change", () => {
  state.mixedEol = false;
  state.eol = eolSelect.value;
  setTimeout(updateMeta, 0);
});
formatButton.addEventListener("click", () => {
  state.mixedEol = false;
  queueMicrotask(() => {
    if (statusBadge.textContent === "Format failed") {
      updateMeta();
      return;
    }
    renderEnhancedPreview();
  });
});
validateButton.addEventListener("click", () => schedulePreview(20));

document.addEventListener("keydown", (event) => {
  if (documentWorkspace.hidden) return;
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return;
  if (event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void saveDocument();
}, true);

updateSaveButton();
schedulePreview(0);
