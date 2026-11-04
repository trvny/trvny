// PDF quick tools for the existing Botek Mini App. PDF libraries load from maintained Docbench assets.
export const PDF_TOOLS_CSS = String.raw`
    .pdf-panel { padding: 18px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
    .pdf-panel[hidden] { display: none; }
    .pdf-panel .doc-field { margin: 12px 0; }
    .pdf-panel .doc-toolbar { margin-top: 12px; }
    .pdf-note { margin: 10px 0; color: var(--muted); font-size: 12px; }
    .pdf-note.warn { color: var(--warn); }
    .pdf-result[hidden] { display: none; }
    .pdf-result { padding: 12px; border-radius: 12px; background: var(--bg); }
    .doc-print-view { display: none; }
    @media print {
      body { background: white !important; color: black !important; }
      .app > *:not(.doc-print-view) { display: none !important; }
      .doc-print-view { display: block !important; padding: 0; margin: 0; max-width: none; color: #000; background: #fff; white-space: pre-wrap; overflow-wrap: anywhere; }
      .doc-print-view h1 { font-size: 22pt; margin: 0 0 12pt; }
      .doc-print-view p, .doc-print-view blockquote, .doc-print-view pre { margin: 0 0 7pt; }
      .doc-print-view pre { font: 9pt/1.5 monospace; white-space: pre-wrap; }
      .doc-print-view blockquote { padding-left: 12pt; border-left: 2pt solid #888; }
      @page { size: A4; margin: 18mm; }
    }
`;
export const PDF_TOOLS_HTML = String.raw`
    <section id="pdf-tools" class="pdf-panel" lang="en" aria-labelledby="pdf-title" hidden>
      <div class="section-head">
        <h2 id="pdf-title">📑 Docbench · PDF quick tools</h2>
        <button id="pdf-close" type="button" class="secondary">Close</button>
      </div>
      <p class="muted">Merge, extract, reorder, remove or rotate PDF pages locally. No file is uploaded until you explicitly choose Send.</p>
      <label class="doc-field">PDF files (1 for most actions, 2–6 for merge)
        <input id="pdf-files" type="file" accept=".pdf,application/pdf" multiple>
      </label>
      <p id="pdf-source-status" class="pdf-note">No PDFs selected. Maximum 12 MiB per file, 36 MiB total, 400 pages.</p>
      <label class="doc-field">Operation
        <select id="pdf-action">
          <option value="merge">Merge selected PDFs</option>
          <option value="extract">Extract pages (order in list)</option>
          <option value="remove">Remove pages</option>
          <option value="reorder">Reorder / select pages</option>
          <option value="rotate">Rotate pages</option>
          <option value="split">Split into one-page PDFs (ZIP)</option>
        </select>
      </label>
      <label class="doc-field">Pages, e.g. 1-3,5 or 4,1,2
        <input id="pdf-pages" type="text" inputmode="text" maxlength="200" placeholder="Leave blank for all pages when rotating or splitting">
      </label>
      <label class="doc-field">Rotation
        <select id="pdf-angle">
          <option value="90">90° clockwise</option>
          <option value="180">180°</option>
          <option value="270">90° counterclockwise</option>
        </select>
      </label>
      <div class="doc-toolbar">
        <button id="pdf-run" type="button">Run locally</button>
      </div>
      <p id="pdf-status" class="doc-status muted" role="status">Your files stay on this device.</p>
      <div id="pdf-result" class="pdf-result" hidden>
        <strong id="pdf-result-name"></strong>
        <div class="doc-toolbar">
          <button id="pdf-download" type="button" class="secondary">Download result</button>
          <button id="pdf-send" type="button">Send PDF to my private chat</button>
        </div>
        <p id="pdf-result-size" class="pdf-note"></p>
      </div>
      <p class="pdf-note warn">Rebuilding PDFs can drop signatures, forms, bookmarks and attachments. Inspect the result before using it. For high-fidelity preservation, optimization, PDF → DOCX and more, use the full Docbench.</p>
      <a href="https://docbench.travny.workers.dev/" target="_blank" rel="noopener noreferrer">Open full Docbench</a>
    </section>
    <article id="doc-print-view" class="doc-print-view" aria-hidden="true"></article>
`;
export const PDF_TOOLS_SCRIPT = String.raw`
    const pdfPanel = document.getElementById("pdf-tools");
    const pdfFiles = document.getElementById("pdf-files");
    const pdfAction = document.getElementById("pdf-action");
    const pdfPages = document.getElementById("pdf-pages");
    const pdfAngle = document.getElementById("pdf-angle");
    const pdfRun = document.getElementById("pdf-run");
    const pdfSend = document.getElementById("pdf-send");
    const pdfResult = document.getElementById("pdf-result");
    const pdfMaxSourceBytes = 12 * 1024 * 1024;
    const pdfMaxTotalBytes = 36 * 1024 * 1024;
    const pdfMaxSendBytes = 8 * 1024 * 1024;
    const pdfMaxPages = 400;
    const pdfVendorBase = "https://docbench.travny.workers.dev/vendor/";
    let pdfScriptLoad = null;
    let zipScriptLoad = null;
    let pdfOutput = null;
    let pdfBusy = false;

    function pdfStatus(message) { setText("pdf-status", message); }
    function pdfNamedSize(bytes) { return (bytes / (1024 * 1024)).toFixed(2) + " MiB"; }
    function pdfSafeName(text) {
      return String(text || "document").normalize("NFKC")
        .replace(/[^\p{L}\p{N}._ -]/gu, "")
        .replace(/[.\s]+/gu, "-")
        .replace(/^-+|-+$/gu, "").slice(0, 64) || "document";
    }
    function pdfForgetOutput() {
      pdfOutput = null;
      pdfResult.hidden = true;
      pdfSend.disabled = false;
    }
    function pdfSourceChanged() {
      pdfForgetOutput();
      const files = Array.from(pdfFiles.files || []);
      setText("pdf-source-status", files.length
        ? files.map((file) => file.name + " (" + pdfNamedSize(file.size) + ")").join(", ")
        : "No PDFs selected. Maximum 12 MiB per file, 36 MiB total, 400 pages.");
    }
    function pdfLoadScript(url, globalName) {
      if (window[globalName]) return Promise.resolve(window[globalName]);
      return new Promise((resolve, reject) => {
        const node = document.createElement("script");
        node.src = url;
        node.async = true;
        node.addEventListener("load", () => window[globalName]
          ? resolve(window[globalName])
          : reject(new Error("Document engine unavailable.")));
        node.addEventListener("error", () => reject(new Error("Could not load the document engine from Docbench.")));
        document.head.appendChild(node);
      });
    }
    async function pdfLib() {
      if (!pdfScriptLoad) pdfScriptLoad = pdfLoadScript(pdfVendorBase + "pdf-lib.min.js", "PDFLib");
      try { return await pdfScriptLoad; }
      catch (error) { pdfScriptLoad = null; throw error; }
    }
    async function pdfZipLib() {
      if (!zipScriptLoad) zipScriptLoad = pdfLoadScript(pdfVendorBase + "fflate.min.js", "fflate");
      try { return await zipScriptLoad; }
      catch (error) { zipScriptLoad = null; throw error; }
    }
    function pdfParsePages(spec, count, allowAll) {
      if (!Number.isInteger(count) || count < 1 || count > pdfMaxPages) throw new Error("Unsupported page count.");
      const input = String(spec || "").trim();
      if (!input) {
        if (!allowAll) throw new Error("Enter page numbers or ranges first.");
        return Array.from({ length: count }, (_, index) => index);
      }
      const selected = [];
      const seen = new Set();
      for (const part of input.split(",")) {
        const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/u.exec(part);
        if (!match) throw new Error("Invalid page list. Use 1-3,5,7.");
        const first = Number(match[1]), last = match[2] ? Number(match[2]) : first;
        if (first < 1 || last > count || last < first) throw new Error("Page out of range.");
        for (let page = first; page <= last; page += 1) {
          if (seen.has(page)) throw new Error("Repeated page " + page + ".");
          seen.add(page);
          selected.push(page - 1);
        }
      }
      return selected;
    }
    function pdfDownload() {
      if (!pdfOutput) return;
      const href = URL.createObjectURL(pdfOutput.blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = pdfOutput.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      pdfStatus("Download requested: " + pdfOutput.filename + ". Telegram client download support varies.");
    }
    async function pdfRunLocal() {
      if (pdfBusy) return;
      pdfBusy = true;
      pdfRun.disabled = true;
      pdfForgetOutput();
      try {
        const files = Array.from(pdfFiles.files || []);
        const action = pdfAction.value || "merge";
        if (!files.length || files.length > 6 || files.some((f) => !/\.pdf$/iu.test(f.name) || f.size > pdfMaxSourceBytes || !f.size)) {
          throw new Error("Choose 1–6 PDF files, at most 12 MiB each.");
        }
        if (files.reduce((sum, f) => sum + f.size, 0) > pdfMaxTotalBytes) {
          throw new Error("Total selected PDFs exceed 36 MiB.");
        }
        if (action === "merge" ? files.length < 2 : files.length !== 1) {
          throw new Error(action === "merge" ? "Select at least two PDFs to merge." : "Select exactly one PDF for this operation.");
        }
        pdfStatus("Processing locally…");
        const lib = await pdfLib();
        const sources = [];
        let totalPages = 0;
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error(file.name + " is not a PDF.");
          const document = await lib.PDFDocument.load(bytes, { updateMetadata: false });
          totalPages += document.getPageCount();
          if (totalPages > pdfMaxPages) throw new Error("The selected PDFs exceed 400 pages.");
          sources.push({ file, document });
        }
        const source = sources[0].document;
        const count = source.getPageCount();
        let blob, filename, pageTotal;
        if (action === "split") {
          const pageList = pdfParsePages(pdfPages.value, count, true);
          if (pageList.length > 40) throw new Error("Split up to 40 pages at once.");
          const zip = await pdfZipLib();
          const parts = {};
          for (const index of pageList) {
            const output = await lib.PDFDocument.create();
            const pages = await output.copyPages(source, [index]);
            output.addPage(pages[0]);
            parts["page-" + String(index + 1).padStart(3, "0") + ".pdf"] = new Uint8Array(await output.save());
          }
          blob = new Blob([new Uint8Array(zip.zipSync(parts, { level: 0 }))], { type: "application/zip" });
          filename = pdfSafeName(sources[0].file.name.replace(/\.pdf$/iu, "")) + "-pages.zip";
          pageTotal = pageList.length;
        } else if (action === "rotate") {
          const indexes = pdfParsePages(pdfPages.value, count, true);
          const delta = Number(pdfAngle.value || 90);
          if (![90, 180, 270].includes(delta)) throw new Error("Choose a valid rotation.");
          for (const index of indexes) {
            const page = source.getPage(index);
            const current = page.getRotation().angle || 0;
            page.setRotation(lib.degrees((current + delta) % 360));
          }
          blob = new Blob([new Uint8Array(await source.save())], { type: "application/pdf" });
          filename = pdfSafeName(sources[0].file.name.replace(/\.pdf$/iu, "")) + "-rotated.pdf";
          pageTotal = count;
        } else {
          let plan = [];
          if (action === "merge") {
            const merged = await lib.PDFDocument.create();
            for (const item of sources) {
              const pages = await merged.copyPages(item.document, item.document.getPageIndices());
              pages.forEach((page) => merged.addPage(page));
            }
            blob = new Blob([new Uint8Array(await merged.save())], { type: "application/pdf" });
            filename = "merged.pdf";
            pageTotal = totalPages;
          } else {
            const selected = pdfParsePages(pdfPages.value, count, false);
            if (action === "remove") {
              const removed = new Set(selected);
              plan = Array.from({ length: count }, (_, i) => i).filter((i) => !removed.has(i));
            } else if (action === "extract" || action === "reorder") {
              plan = selected;
            } else throw new Error("Unknown PDF operation.");
            if (!plan.length) throw new Error("The PDF must contain at least one page.");
            const output = await lib.PDFDocument.create();
            const pages = await output.copyPages(source, plan);
            pages.forEach((page) => output.addPage(page));
            blob = new Blob([new Uint8Array(await output.save())], { type: "application/pdf" });
            filename = pdfSafeName(sources[0].file.name.replace(/\.pdf$/iu, "")) + "-" + action + ".pdf";
            pageTotal = plan.length;
          }
        }
        pdfOutput = { blob, filename, requestId: null, sent: false };
        pdfResult.hidden = false;
        pdfSend.hidden = !filename.endsWith(".pdf") || blob.size > pdfMaxSendBytes;
        setText("pdf-result-name", filename);
        setText("pdf-result-size", pageTotal + " pages • " + pdfNamedSize(blob.size)
          + (blob.size > pdfMaxSendBytes && filename.endsWith(".pdf") ? " • over Telegram send limit (8 MiB)" : ""));
        pdfStatus("Completed locally. Inspect the exported PDF, especially forms, bookmarks and signatures.");
      } catch (error) {
        pdfStatus(error instanceof Error ? error.message : "PDF operation failed.");
      } finally {
        pdfBusy = false;
        pdfRun.disabled = false;
      }
    }
    async function pdfSendPrivate() {
      if (pdfBusy || !pdfOutput || pdfOutput.sent || pdfOutput.blob.type !== "application/pdf") return;
      const initData = webApp && webApp.initData ? webApp.initData : "";
      if (!initData) { pdfStatus("Open Botek in Telegram to send; local download still works."); return; }
      if (!(await confirmCancel("Send " + pdfOutput.filename + " to your private Botek chat?"))) return;
      pdfBusy = true;
      pdfSend.disabled = true;
      const current = pdfOutput;
      if (!current.requestId) current.requestId = docNewId();
      try {
        const response = await fetch("/mini-app/api/documents/send-pdf", {
          method: "POST", cache: "no-store",
          headers: {
            "content-type": "application/pdf",
            "x-telegram-init-data": initData,
            "x-doc-request-id": current.requestId,
            "x-doc-filename": encodeURIComponent(current.filename),
          },
          body: current.blob,
        });
        const result = await response.json();
        if (response.status === 202 || result.error === "previous_delivery_uncertain_or_failed") {
          pdfStatus("Delivery uncertain. Check your private chat before trying again.");
          return;
        }
        if (!response.ok || result.ok !== true) {
          pdfStatus(response.status === 401 ? "Telegram session expired. Reopen Botek."
            : "Upload not confirmed. Check the private chat before retrying.");
          return;
        }
        current.sent = true;
        pdfStatus(result.alreadySent ? "Previously sent to private chat." : "PDF sent to private chat.");
        if (webApp.HapticFeedback) webApp.HapticFeedback.notificationOccurred("success");
      } catch {
        pdfStatus("Connection lost. Check Telegram before retrying this file.");
      } finally {
        pdfBusy = false;
        pdfSend.disabled = current.sent;
      }
    }
    function docPrintPdf() {
      if (!String(docContent.value || "").trim()) {
        docStatus("Write a document before printing.");
        return;
      }
      docRenderPreview();
      const printable = document.getElementById("doc-print-view");
      const title = element("h1", "", String(docTitle.value || "").trim() || "Draft");
      printable.replaceChildren(title, ...Array.from(docPreview.children).map((node) => node.cloneNode(true)));
      docStatus("Select Print / Save as PDF in your device dialog. Telegram support varies.");
      if (window.print) window.print();
      else docStatus("Print dialog unavailable here. Open the full Docbench instead.");
    }
    document.getElementById("doc-print").addEventListener("click", docPrintPdf);
    document.getElementById("doc-pdf-open").addEventListener("click", () => {
      pdfPanel.hidden = false;
      pdfPanel.scrollIntoView && pdfPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    document.getElementById("pdf-close").addEventListener("click", () => { pdfPanel.hidden = true; });
    pdfFiles.addEventListener("change", pdfSourceChanged);
    for (const input of [pdfAction, pdfPages, pdfAngle]) input.addEventListener("change", pdfForgetOutput);
    pdfRun.addEventListener("click", () => { void pdfRunLocal(); });
    document.getElementById("pdf-download").addEventListener("click", pdfDownload);
    pdfSend.addEventListener("click", () => { void pdfSendPrivate(); });
`;
