// Draft Studio source for the existing Mini App shell.
export const DOC_STUDIO_CSS = String.raw`
    .doc-studio { display: grid; gap: 12px; padding: 18px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
    .doc-studio[hidden], .doc-preview[hidden], #doc-editor[hidden] { display: none; }
    .doc-field { display: grid; gap: 5px; font-weight: 600; font-size: 13px; }
    .doc-field input, .doc-field select, .doc-field textarea {
      width: 100%; min-width: 0; border: 1px solid var(--line); border-radius: 10px;
      background: var(--bg); color: var(--text); font: inherit; font-weight: 400; padding: 10px 12px;
    }
    .doc-field textarea { min-height: 240px; resize: vertical; font: 13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .doc-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .doc-toolbar button { padding: 8px 10px; font-size: 13px; }
    .doc-toolbar button.secondary { background: var(--bg); color: var(--text); border: 1px solid var(--line); }
    .doc-preview { min-height: 160px; padding: 12px; border-radius: 12px; background: var(--bg); overflow-wrap: anywhere; white-space: pre-wrap; }
    .doc-preview > * { margin: 0 0 8px; }
    .doc-preview pre { font: 13px/1.4 ui-monospace, monospace; white-space: pre-wrap; }
    .doc-preview blockquote { margin-left: 4px; border-left: 3px solid var(--accent); padding-left: 12px; }
    .doc-options { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .doc-options label { font-size: 13px; color: var(--muted); }
    .doc-status { min-height: 20px; margin: 0; font-size: 13px; }
    .doc-studio a { color: var(--accent); }
`;
export const DOC_STUDIO_HTML = String.raw`
    <section id="doc-studio" class="doc-studio" lang="en" aria-labelledby="doc-title-heading" hidden>
      <div class="section-head">
        <h2 id="doc-title-heading">📄 Docbench · Draft Studio</h2>
        <button id="doc-close" type="button" class="secondary">Close</button>
      </div>
      <p class="muted">Write locally, preview safely, then export or explicitly send a file to your private Botek chat. Nothing is uploaded while editing.</p>
      <label class="doc-field">Title
        <input id="doc-title" type="text" maxlength="100" placeholder="Untitled document" autocomplete="off">
      </label>
      <label class="doc-field">Template
        <select id="doc-template">
          <option value="">Choose a template</option>
          <option value="note">Note</option>
          <option value="memo">Memo</option>
          <option value="meeting">Meeting notes</option>
        </select>
      </label>
      <div class="doc-toolbar" role="group" aria-label="Editor view">
        <button id="doc-edit-button" type="button" aria-pressed="true">Edit</button>
        <button id="doc-preview-button" type="button" class="secondary" aria-pressed="false">Preview</button>
        <span id="doc-size" class="muted">0 bytes</span>
      </div>
      <label id="doc-editor" class="doc-field">Markdown / plain text
        <textarea id="doc-content" maxlength="65536" spellcheck="true" placeholder="# Your document"></textarea>
      </label>
      <div id="doc-preview" class="doc-preview" aria-label="Document preview" hidden></div>
      <label class="doc-field">Import a local Markdown or text file (replaces editor content)
        <input id="doc-import" type="file" accept=".md,.txt,text/plain,text/markdown">
      </label>
      <div class="doc-options">
        <label><input id="doc-autosave" type="checkbox"> Remember this draft on this device (not encrypted)</label>
        <button id="doc-save" type="button" class="secondary">Save locally</button>
        <button id="doc-forget" type="button" class="secondary">Forget saved copy</button>
      </div>
      <label class="doc-field">Export / send format
        <select id="doc-format">
          <option value="md">Markdown (.md)</option>
          <option value="txt">Plain text (.txt)</option>
        </select>
      </label>
      <div class="doc-toolbar">
        <button id="doc-export" type="button" class="secondary">Download file</button>
        <button id="doc-print" type="button" class="secondary">Print / Save as PDF</button>
        <button id="doc-pdf-open" type="button" class="secondary">PDF tools</button>
        <button id="doc-send" type="button">Send to my private Telegram chat</button>
      </div>
      <p id="doc-status" class="doc-status muted" role="status">Private until you send. Maximum 64 KiB.</p>
      <a href="https://docbench.travny.workers.dev/" target="_blank" rel="noopener noreferrer">Open full Docbench for advanced formats</a>
    </section>
`;
export const DOC_STUDIO_SCRIPT = String.raw`
    const docPanel = document.getElementById("doc-studio");
    const docOpenButton = document.getElementById("doc-open");
    const docTitle = document.getElementById("doc-title");
    const docContent = document.getElementById("doc-content");
    const docTemplate = document.getElementById("doc-template");
    const docFormat = document.getElementById("doc-format");
    const docPreview = document.getElementById("doc-preview");
    const docEditor = document.getElementById("doc-editor");
    const docAutosave = document.getElementById("doc-autosave");
    const docSend = document.getElementById("doc-send");
    const docStorageKey = "botek_doc_draft_v1";
    const docMaxBytes = 64 * 1024;
    const docTemplates = {
      note: { title: "Note", body: "# Note\n\n" },
      memo: { title: "Memo", body: "# Memo\n\nTo:\nFrom:\nSubject:\n\n" },
      meeting: { title: "Meeting notes", body: "# Meeting notes\n\nDate:\nAttendees:\n\n## Agenda\n\n## Decisions\n\n## Actions\n\n" }
    };
    let docOpened = false;
    let docSending = false;
    let docRequestId = "";
    let docSaveTimer = null;

    function docStatus(message) { setText("doc-status", message); }
    function docText() {
      const markdown = String(docContent.value || "");
      if (docFormat.value !== "txt") return markdown;
      const tick = String.fromCharCode(96);
      const source = markdown.split("\n")
        .filter((line) => !line.trim().startsWith(tick.repeat(3))).join("\n");
      return source.replace(/^#{1,6}\s+/gmu, "")
        .replace(/^\s*[-*]\s+/gmu, "• ")
        .replace(/^>\s?/gmu, "")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, "$1 ($2)")
        .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
        .replace(/\*([^*\n]+)\*/gu, "$1")
        .replace(/_([^_\n]+)_/gu, "$1")
        .replace(new RegExp(tick + "([^" + tick + "\\n]+)" + tick, "gu"), "$1");
    }
    function docByteCount(text) { return new TextEncoder().encode(text).byteLength; }
    function docFilename() {
      const name = String(docTitle.value || "").normalize("NFKC")
        .replace(/[^\p{L}\p{N}._ -]/gu, "").replace(/[.\s]+/gu, "-")
        .replace(/^-+|-+$/gu, "").slice(0, 64) || "draft";
      return name + "." + (docFormat.value === "txt" ? "txt" : "md");
    }
    function docUpdateSize() {
      const size = docByteCount(docText());
      setText("doc-size", size + " / " + docMaxBytes + " bytes");
      return size;
    }
    function docChanged() {
      docRequestId = "";
      if (!docSending) docSend.disabled = false;
      docUpdateSize();
      if (!docPreview.hidden) docRenderPreview();
      if (docAutosave.checked) {
        clearTimeout(docSaveTimer);
        docSaveTimer = setTimeout(docSaveLocal, 500);
      }
    }
    function docSaveLocal() {
      clearTimeout(docSaveTimer);
      if (!docAutosave.checked) {
        docStatus("Enable local saving first. Nothing stored.");
        return;
      }
      try {
        window.localStorage.setItem(docStorageKey, JSON.stringify({
          title: String(docTitle.value || ""),
          text: String(docContent.value || ""),
          format: docFormat.value === "txt" ? "txt" : "md",
        }));
        docStatus("Saved on this device. Not encrypted.");
      } catch {
        docStatus("Local storage unavailable. Export a file instead.");
      }
    }
    function docRestore() {
      try {
        const raw = window.localStorage.getItem(docStorageKey);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved || typeof saved.text !== "string" || saved.text.length > 65536 ||
            typeof saved.title !== "string" || saved.title.length > 100) return;
        docTitle.value = saved.title;
        docContent.value = saved.text;
        docFormat.value = saved.format === "txt" ? "txt" : "md";
        docAutosave.checked = true;
        docStatus("Loaded the locally saved draft. Not encrypted.");
      } catch {
        docStatus("Could not read a saved draft.");
      }
    }
    function docRenderPreview() {
      const source = String(docContent.value || "").replace(/\r\n/g, "\n").split("\n");
      const fragment = [];
      const fence = String.fromCharCode(96).repeat(3);
      let code = null;
      for (const line of source) {
        if (line.trim().startsWith(fence)) {
          if (code !== null) {
            fragment.push(element("pre", "", code.join("\n")));
            code = null;
          } else code = [];
          continue;
        }
        if (code !== null) { code.push(line); continue; }
        const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
        const list = /^\s*[-*]\s+(.+)$/u.exec(line);
        if (heading) {
          const node = element("h3", "", heading[2]);
          node.style && (node.style.fontSize = heading[1].length === 1 ? "21px" : "16px");
          fragment.push(node);
        } else if (list) fragment.push(element("p", "", "• " + list[1]));
        else if (line.startsWith("> ")) fragment.push(element("blockquote", "", line.slice(2)));
        else fragment.push(element("p", "", line || " "));
      }
      if (code !== null) fragment.push(element("pre", "", code.join("\n")));
      docPreview.replaceChildren(...fragment);
    }
    function docView(preview) {
      docEditor.hidden = preview;
      docPreview.hidden = !preview;
      document.getElementById("doc-edit-button").setAttribute("aria-pressed", String(!preview));
      document.getElementById("doc-preview-button").setAttribute("aria-pressed", String(preview));
      if (preview) docRenderPreview();
    }
    function openDocStudio() {
      if (!docOpened) {
        docOpened = true;
        docRestore();
        docUpdateSize();
      }
      docPanel.hidden = false;
      docOpenButton.setAttribute("aria-expanded", "true");
      docPanel.scrollIntoView && docPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function docNewId() {
      if (crypto.randomUUID) return crypto.randomUUID();
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    }
    function docDownload() {
      const text = docText();
      if (!text.trim() || docUpdateSize() > docMaxBytes) {
        docStatus("Enter a document under 64 KiB first.");
        return;
      }
      const format = docFormat.value === "txt" ? "txt" : "md";
      const blob = new Blob([text], { type: format === "txt" ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href; link.download = docFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      docStatus("Exported " + link.download + ". File download support varies by Telegram client.");
    }
    async function docSendPrivate() {
      if (docSending) return;
      const text = docText();
      if (!text.trim() || docUpdateSize() > docMaxBytes) {
        docStatus("Enter a document under 64 KiB first.");
        return;
      }
      const initData = webApp && webApp.initData ? webApp.initData : "";
      if (!initData) {
        docStatus("Sending requires the private Telegram Mini App. You can still export.");
        return;
      }
      if (!(await confirmCancel("Send " + docFilename() + " to your private Botek chat?"))) return;
      docSending = true;
      const attemptSnapshot = JSON.stringify([docTitle.value, docContent.value, docFormat.value]);
      let confirmed = false;
      docSend.disabled = true;
      docStatus("Sending document…");
      if (!docRequestId) docRequestId = docNewId();
      try {
        const response = await fetch("/mini-app/api/documents/send", {
          method: "POST", cache: "no-store",
          headers: { "content-type": "application/json", "x-telegram-init-data": initData },
          body: JSON.stringify({
            requestId: docRequestId,
            title: String(docTitle.value || "").trim() || "Draft",
            text,
            format: docFormat.value === "txt" ? "txt" : "md",
          }),
        });
        const result = await response.json();
        if (response.status === 202 || result.error === "previous_delivery_uncertain_or_failed") {
          docStatus("Delivery uncertain. Check your private chat before starting a new attempt.");
          return;
        }
        if (!response.ok || result.ok !== true) {
          docStatus(response.status === 401 ? "Telegram session expired. Reopen the Mini App."
            : "Send failed. Check the private chat before trying again.");
          return;
        }
        confirmed = true;
        docStatus(result.alreadySent ? "This document was already sent."
          : "Sent " + result.filename + " to your private Botek chat.");
        if (webApp.HapticFeedback) webApp.HapticFeedback.notificationOccurred("success");
      } catch {
        docStatus("Connection lost. Delivery may have succeeded. Check Telegram before retrying.");
      } finally {
        docSending = false;
        // Repeated submissions reuse the same idempotency key until an edit.
        docSend.disabled = confirmed &&
          JSON.stringify([docTitle.value, docContent.value, docFormat.value]) === attemptSnapshot;
      }
    }
    async function docImportFile() {
      const input = document.getElementById("doc-import");
      const file = input.files && input.files[0];
      if (!file) return;
      input.value = "";
      if (!/\.(md|txt)$/iu.test(file.name) || file.size > docMaxBytes) {
        docStatus("Import a .md or .txt file up to 64 KiB.");
        return;
      }
      if (docContent.value && !(await confirmCancel("Replace existing document text?"))) return;
      try {
        const content = await file.text();
        if (docByteCount(content) > docMaxBytes) throw new Error("size");
        docTitle.value = file.name.replace(/\.(md|txt)$/iu, "").slice(0, 100);
        docContent.value = content;
        docFormat.value = /\.txt$/iu.test(file.name) ? "txt" : "md";
        docChanged();
        docStatus("Imported locally. Nothing uploaded.");
      } catch {
        docStatus("Could not import the file.");
      }
    }
    docOpenButton.addEventListener("click", openDocStudio);
    document.getElementById("doc-close").addEventListener("click", () => {
      docPanel.hidden = true;
      docOpenButton.setAttribute("aria-expanded", "false");
    });
    document.getElementById("doc-edit-button").addEventListener("click", () => docView(false));
    document.getElementById("doc-preview-button").addEventListener("click", () => docView(true));
    for (const input of [docTitle, docContent, docFormat]) input.addEventListener("input", docChanged);
    docTemplate.addEventListener("change", async () => {
      const template = docTemplates[docTemplate.value];
      if (!template) return;
      if ((docContent.value || docTitle.value) &&
          !(await confirmCancel("Replace current document with this template?"))) {
        docTemplate.value = "";
        return;
      }
      docTitle.value = template.title; docContent.value = template.body;
      docTemplate.value = "";
      docChanged();
    });
    document.getElementById("doc-import").addEventListener("change", () => { void docImportFile(); });
    document.getElementById("doc-export").addEventListener("click", docDownload);
    docSend.addEventListener("click", () => { void docSendPrivate(); });
    document.getElementById("doc-save").addEventListener("click", docSaveLocal);
    document.getElementById("doc-forget").addEventListener("click", () => {
      try { window.localStorage.removeItem(docStorageKey); } catch { /* storage unavailable */ }
      docAutosave.checked = false;
      clearTimeout(docSaveTimer);
      docStatus("Saved copy forgotten. The open editor is unchanged.");
    });
    docAutosave.addEventListener("change", () => {
      if (docAutosave.checked) docSaveLocal();
      else {
        try { window.localStorage.removeItem(docStorageKey); } catch { /* storage unavailable */ }
        docStatus("Local saving off. Previous saved copy deleted.");
      }
    });
    if (window.location && new URLSearchParams(window.location.search).get("tab") === "doc") openDocStudio();
`;
