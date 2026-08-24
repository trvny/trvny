(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const editor = $("#editor");
  const preview = $("#preview");
  const formatSelect = $("#format-select");
  const eolSelect = $("#eol-select");
  const statusBadge = $("#status-badge");
  const detailStatus = $("#detail-status");
  const filenameLabel = $("#filename-label");
  const encodingLabel = $("#encoding-label");
  const fileInput = $("#file-input");
  const dropZone = $("#drop-zone");

  const state = { filename: "untitled.txt", bom: false, mixedEol: false };
  const extensionToFormat = {
    txt: "txt", md: "md", markdown: "md", json: "json",
    yml: "yaml", yaml: "yaml", xml: "xml",
  };
  const preferredExtension = { txt: "txt", md: "md", json: "json", yaml: "yml", xml: "xml" };

  function detectEol(raw) {
    const crlf = (raw.match(/\r\n/g) || []).length;
    const lf = (raw.match(/(^|[^\r])\n/g) || []).length;
    const cr = (raw.match(/\r(?!\n)/g) || []).length;
    const present = [["CRLF", crlf], ["LF", lf], ["CR", cr]].filter(([, count]) => count > 0);
    if (!present.length) return { target: "LF", mixed: false };
    present.sort((a, b) => b[1] - a[1]);
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

  function positionFromOffset(text, offset) {
    const before = text.slice(0, Math.max(0, offset));
    const lines = before.split("\n");
    return { line: lines.length, column: lines.at(-1).length + 1 };
  }

  function jsonError(error, text) {
    const match = String(error.message).match(/position\s+(\d+)/i);
    const position = match ? positionFromOffset(text, Number(match[1])) : null;
    return { message: error.message, position };
  }

  function xmlError(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const error = doc.querySelector("parsererror");
    if (!error) return null;
    const message = error.textContent.trim().replace(/\s+/g, " ");
    const lineMatch = message.match(/line\s+(\d+).*column\s+(\d+)/i);
    return {
      message,
      position: lineMatch ? { line: Number(lineMatch[1]), column: Number(lineMatch[2]) } : null,
    };
  }

  function parseCurrent() {
    const text = editor.value;
    switch (formatSelect.value) {
      case "json":
        try { return { ok: true, value: JSON.parse(text || "null") }; }
        catch (error) { return { ok: false, error: jsonError(error, text) }; }
      case "yaml":
        try {
          const docs = [];
          globalThis.jsyaml.loadAll(text, (doc) => docs.push(doc));
          return { ok: true, value: docs.length === 1 ? docs[0] : docs };
        } catch (error) {
          const mark = error.mark;
          return {
            ok: false,
            error: {
              message: error.reason || error.message,
              position: mark ? { line: mark.line + 1, column: mark.column + 1 } : null,
            },
          };
        }
      case "xml": {
        const error = xmlError(text);
        return error ? { ok: false, error } : { ok: true, value: text };
      }
      default:
        return { ok: true, value: text };
    }
  }

  function updateMeta() {
    const lines = editor.value.split("\n").length;
    const mixed = state.mixedEol ? `Mixed → ${eolSelect.value}` : eolSelect.value;
    const bom = state.bom ? "UTF-8 BOM" : "UTF-8";
    encodingLabel.textContent = `${bom} · ${mixed}`;
    detailStatus.textContent = `${bom} · ${mixed} · ${lines} line${lines === 1 ? "" : "s"}`;
  }

  function renderValidation() {
    const result = parseCurrent();
    const format = formatSelect.value;
    if (["txt", "md"].includes(format)) {
      statusBadge.className = "status neutral";
      statusBadge.textContent = format === "md" ? "Markdown" : "Plain text";
      preview.textContent = editor.value;
      updateMeta();
      return result;
    }

    if (result.ok) {
      statusBadge.className = "status good";
      statusBadge.textContent = "Valid";
      if (format === "xml") preview.textContent = editor.value;
      else preview.textContent = JSON.stringify(result.value, null, 2);
    } else {
      statusBadge.className = "status bad";
      const at = result.error.position ? ` · ${result.error.position.line}:${result.error.position.column}` : "";
      statusBadge.textContent = `Invalid${at}`;
      preview.textContent = result.error.message;
    }
    updateMeta();
    return result;
  }

  function formatXml(text) {
    const error = xmlError(text);
    if (error) throw new Error(error.message);
    const serialized = new XMLSerializer().serializeToString(new DOMParser().parseFromString(text, "application/xml"));
    const tokens = serialized.replace(/>\s*</g, "><").replace(/</g, "\n<").trim().split("\n");
    let depth = 0;
    return tokens.map((token) => {
      if (/^<\//.test(token)) depth = Math.max(0, depth - 1);
      const line = `${"  ".repeat(depth)}${token}`;
      if (/^<[^!?/][^>]*[^/]>/i.test(token) && !/<\/[^>]+>$/.test(token)) depth += 1;
      return line;
    }).join("\n");
  }

  function formatDocument() {
    const result = parseCurrent();
    if (!result.ok) return renderValidation();
    try {
      if (formatSelect.value === "json") editor.value = `${JSON.stringify(result.value, null, 2)}\n`;
      if (formatSelect.value === "yaml") {
        const docs = [];
        globalThis.jsyaml.loadAll(editor.value, (doc) => docs.push(doc));
        editor.value = docs.map((doc) => globalThis.jsyaml.dump(doc, { noRefs: true })).join("---\n");
      }
      if (formatSelect.value === "xml") editor.value = `${formatXml(editor.value)}\n`;
      state.mixedEol = false;
      renderValidation();
    } catch (error) {
      statusBadge.className = "status bad";
      statusBadge.textContent = "Format failed";
      preview.textContent = error.message;
    }
  }

  function setFormatFromFilename(name) {
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
    formatSelect.value = extensionToFormat[ext] || "txt";
  }

  async function openFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const contentBytes = state.bom ? bytes.slice(3) : bytes;
    if (contentBytes.includes(0)) throw new Error("Binary or UTF-16 input is not supported yet.");
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
    const eol = detectEol(raw);
    state.filename = file.name || "document.txt";
    state.mixedEol = eol.mixed;
    editor.value = normalizeEol(raw);
    eolSelect.value = eol.target;
    filenameLabel.textContent = state.filename;
    setFormatFromFilename(state.filename);
    renderValidation();
  }

  function saveFile() {
    const raw = applyEol(editor.value, eolSelect.value);
    const data = new TextEncoder().encode(raw);
    const parts = state.bom ? [new Uint8Array([0xef, 0xbb, 0xbf]), data] : [data];
    const blob = new Blob(parts, { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = state.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function newDocument() {
    state.filename = `untitled.${preferredExtension[formatSelect.value]}`;
    state.bom = false;
    state.mixedEol = false;
    eolSelect.value = "LF";
    editor.value = "";
    filenameLabel.textContent = state.filename;
    renderValidation();
    editor.focus();
  }

  $("#open-button").addEventListener("click", () => fileInput.click());
  $("#new-button").addEventListener("click", newDocument);
  $("#validate-button").addEventListener("click", renderValidation);
  $("#format-button").addEventListener("click", formatDocument);
  $("#save-button").addEventListener("click", saveFile);
  $("#copy-button").addEventListener("click", async () => navigator.clipboard.writeText(editor.value));
  fileInput.addEventListener("change", async () => {
    if (!fileInput.files?.[0]) return;
    try { await openFile(fileInput.files[0]); }
    catch (error) { preview.textContent = error.message; statusBadge.className = "status bad"; statusBadge.textContent = "Open failed"; }
    fileInput.value = "";
  });
  formatSelect.addEventListener("change", () => {
    if (state.filename.startsWith("untitled.")) {
      state.filename = `untitled.${preferredExtension[formatSelect.value]}`;
      filenameLabel.textContent = state.filename;
    }
    renderValidation();
  });
  eolSelect.addEventListener("change", () => { state.mixedEol = false; updateMeta(); });
  let validationTimer;
  editor.addEventListener("input", () => {
    clearTimeout(validationTimer);
    validationTimer = setTimeout(renderValidation, 120);
  });

  for (const event of ["dragenter", "dragover"]) {
    dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.add("drop-active"); });
  }
  for (const event of ["dragleave", "drop"]) {
    dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.remove("drop-active"); });
  }
  dropZone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try { await openFile(file); }
    catch (error) { preview.textContent = error.message; statusBadge.className = "status bad"; statusBadge.textContent = "Open failed"; }
  });

  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach((item) => item.classList.toggle("active", item === tab));
      const pdf = tab.dataset.mode === "pdf";
      $("#document-workspace").hidden = pdf;
      $("#pdf-workspace").hidden = !pdf;
    });
  });

  renderValidation();
})();
