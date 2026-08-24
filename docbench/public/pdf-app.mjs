import {
  buildCombinedOutline,
  buildQpdfFinalizeRequest,
  buildQpdfPageRequest,
  formatPdfSize,
  readPdfOutline,
  replacePdfOutline,
} from "./pdf-core.mjs";

const $ = (selector) => document.querySelector(selector);
const pdfInput = $("#pdf-input");
const addPdfInput = $("#pdf-add-input");
const pagesHost = $("#pdf-pages");
const outlineHost = $("#pdf-outline");
const previewCanvas = $("#pdf-preview-canvas");
const pdfStatus = $("#pdf-status");
const pdfFilename = $("#pdf-filename");
const saveButton = $("#pdf-save-button");
const removeButton = $("#pdf-remove-page");
const leftButton = $("#pdf-move-left");
const rightButton = $("#pdf-move-right");
const optimizeToggle = $("#pdf-optimize");
const linearizeToggle = $("#pdf-linearize");

const state = {
  sources: [],
  plan: [],
  selectedIndex: -1,
  pdfjs: null,
  qpdfModule: null,
  qpdfRunner: null,
  renderToken: 0,
};

const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    thumbnailObserver.unobserve(entry.target);
    const index = Number(entry.target.dataset.pageIndex);
    renderThumbnail(index, entry.target).catch(showError);
  }
}, { root: pagesHost, rootMargin: "240px" });

function asset(name, fallback) {
  return globalThis.__docbenchPdfAssets?.[name] || fallback;
}

async function ensurePdfJs() {
  if (state.pdfjs) return state.pdfjs;
  state.pdfjs = await import(asset("pdfModuleUrl", "/vendor/pdfjs/pdf.mjs"));
  state.pdfjs.GlobalWorkerOptions.workerSrc = asset(
    "pdfWorkerUrl",
    "/vendor/pdfjs/pdf.worker.mjs",
  );
  return state.pdfjs;
}

async function ensureQpdf() {
  if (state.qpdfRunner) return state.qpdfRunner;
  state.qpdfModule = state.qpdfModule || await import(
    asset("qpdfModuleUrl", "/vendor/qpdf-run/index.js")
  );
  state.qpdfRunner = await state.qpdfModule.createQpdfRunner({
    workerUrl: asset("qpdfWorkerUrl", "/vendor/qpdf-run/worker.js"),
    qpdfJsUrl: asset("qpdfJsUrl", "/vendor/qpdf/lib/qpdf.js"),
    wasmUrl: asset("qpdfWasmUrl", "/vendor/qpdf/lib/qpdf.wasm"),
    timeoutMs: 90000,
  });
  return state.qpdfRunner;
}

function setStatus(message, bad = false) {
  pdfStatus.textContent = message;
  pdfStatus.classList.toggle("bad", bad);
}

function showError(error) {
  console.error(error);
  setStatus(error?.message || String(error), true);
}

async function openPdfDocument(bytes) {
  const pdfjs = await ensurePdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableScripting: false,
    isEvalSupported: false,
  });
  return loadingTask.promise;
}

async function makeSource(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") throw new Error(`${file.name}: not a PDF file.`);

  const pdf = await openPdfDocument(bytes);
  const outline = await readPdfOutline(pdf);
  return {
    filename: file.name || "document.pdf",
    bytes,
    pdf,
    outline,
    pageCount: pdf.numPages,
  };
}

async function closeSources() {
  const oldSources = state.sources.splice(0);
  await Promise.allSettled(oldSources.map((source) => source.pdf?.destroy?.()));
}

async function openFiles(files, append) {
  const selected = [...files];
  if (!selected.length) return;
  setStatus("Opening PDF…");

  const newSources = [];
  try {
    for (const file of selected) newSources.push(await makeSource(file));
  } catch (error) {
    await Promise.allSettled(newSources.map((source) => source.pdf?.destroy?.()));
    throw error;
  }

  if (!append) {
    await closeSources();
    state.plan = [];
  }
  const offset = state.sources.length;
  state.sources.push(...newSources);
  newSources.forEach((source, relativeSourceId) => {
    const sourceId = offset + relativeSourceId;
    for (let pageIndex = 0; pageIndex < source.pageCount; pageIndex += 1) {
      state.plan.push({ sourceId, pageIndex });
    }
  });
  state.selectedIndex = state.plan.length ? (append ? state.selectedIndex : 0) : -1;
  if (state.selectedIndex < 0 && state.plan.length) state.selectedIndex = 0;
  refreshPdfUi();
}

function selectedEntry() {
  return state.plan[state.selectedIndex] || null;
}

function updateControls() {
  const hasPage = Boolean(selectedEntry());
  saveButton.disabled = !state.plan.length;
  removeButton.disabled = !hasPage || state.plan.length <= 1;
  leftButton.disabled = !hasPage || state.selectedIndex <= 0;
  rightButton.disabled = !hasPage || state.selectedIndex >= state.plan.length - 1;
}

function refreshPdfUi() {
  state.renderToken += 1;
  const totalBytes = state.sources.reduce((sum, source) => sum + source.bytes.byteLength, 0);
  pdfFilename.textContent = state.sources.length
    ? state.sources.map((source) => source.filename).join(" + ")
    : "No PDF loaded";
  setStatus(
    state.sources.length
      ? `${state.plan.length} pages · ${state.sources.length} file${state.sources.length === 1 ? "" : "s"} · ${formatPdfSize(totalBytes)}`
      : "Open a PDF to begin.",
  );
  renderPageStrip();
  renderOutline();
  renderPreview().catch(showError);
  updateControls();
}

function renderPageStrip() {
  thumbnailObserver.disconnect();
  pagesHost.replaceChildren();
  state.plan.forEach((entry, index) => {
    const source = state.sources[entry.sourceId];
    const card = document.createElement("button");
    card.type = "button";
    card.className = `pdf-page-card${index === state.selectedIndex ? " selected" : ""}`;
    card.dataset.index = String(index);
    card.draggable = true;
    card.title = `${source.filename} · page ${entry.pageIndex + 1}`;

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-thumb";
    canvas.dataset.pageIndex = String(index);
    const label = document.createElement("span");
    label.textContent = `${index + 1}`;
    const sourceLabel = document.createElement("small");
    sourceLabel.textContent = state.sources.length > 1 ? source.filename : `Page ${entry.pageIndex + 1}`;
    card.append(canvas, label, sourceLabel);

    card.addEventListener("click", () => selectPage(index));
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData("text/plain"));
      if (Number.isInteger(from)) movePage(from, index);
    });

    pagesHost.append(card);
    thumbnailObserver.observe(canvas);
  });
}

async function renderPageIntoCanvas(planIndex, canvas, maxWidth) {
  const entry = state.plan[planIndex];
  if (!entry) return;
  const source = state.sources[entry.sourceId];
  const page = await source.pdf.getPage(entry.pageIndex + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const cssScale = Math.min(2, maxWidth / baseViewport.width);
  const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: cssScale * pixelRatio });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
  canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
  const context = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
}

async function renderThumbnail(index, canvas) {
  if (!canvas.isConnected || !state.plan[index]) return;
  await renderPageIntoCanvas(index, canvas, 150);
}

async function renderPreview() {
  const token = state.renderToken;
  const entry = selectedEntry();
  if (!entry) {
    previewCanvas.hidden = true;
    return;
  }
  previewCanvas.hidden = false;
  const hostWidth = previewCanvas.parentElement?.clientWidth || 900;
  await renderPageIntoCanvas(state.selectedIndex, previewCanvas, Math.max(300, hostWidth - 36));
  if (token !== state.renderToken) return;
}

function selectPage(index) {
  if (index < 0 || index >= state.plan.length) return;
  state.selectedIndex = index;
  refreshPdfUi();
}

function movePage(from, to) {
  if (from === to || from < 0 || from >= state.plan.length || to < 0 || to >= state.plan.length) return;
  const [page] = state.plan.splice(from, 1);
  state.plan.splice(to, 0, page);
  state.selectedIndex = to;
  refreshPdfUi();
}

function removeSelectedPage() {
  if (state.plan.length <= 1 || state.selectedIndex < 0) return;
  state.plan.splice(state.selectedIndex, 1);
  state.selectedIndex = Math.min(state.selectedIndex, state.plan.length - 1);
  refreshPdfUi();
}

function renderOutline() {
  outlineHost.replaceChildren();
  if (!state.sources.length) {
    outlineHost.textContent = "No bookmarks yet.";
    return;
  }
  const combined = buildCombinedOutline(state.sources, state.plan);
  if (!combined.outline.length) {
    outlineHost.textContent = "This PDF has no bookmarks.";
    return;
  }

  function appendLevel(bookmarks, parent, depth) {
    for (const bookmark of bookmarks) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "outline-item";
      row.style.setProperty("--outline-depth", String(depth));
      row.textContent = bookmark.title;
      const pageIndex = bookmark.target?.kind === "page" ? bookmark.target.pageIndex : null;
      row.disabled = pageIndex === null;
      if (pageIndex !== null) row.addEventListener("click", () => selectPage(pageIndex));
      parent.append(row);
      appendLevel(bookmark.children || [], parent, depth + 1);
    }
  }
  appendLevel(combined.outline, outlineHost, 0);

  if (combined.dropped) {
    const note = document.createElement("p");
    note.className = "outline-note";
    note.textContent = `${combined.dropped} bookmark${combined.dropped === 1 ? "" : "s"} to deleted pages will be pruned.`;
    outlineHost.append(note);
  }
}

function outlineSignature(outline) {
  return (outline || []).map((bookmark) => {
    let target = null;
    if (bookmark.target?.kind === "page") {
      target = ["page", bookmark.target.pageIndex, bookmark.target.view?.type || "Fit"];
    } else if (bookmark.target?.kind === "url") {
      target = ["url", bookmark.target.url];
    } else if (bookmark.target?.kind === "named") {
      target = ["named", bookmark.target.action];
    }
    return {
      title: bookmark.title,
      target,
      children: outlineSignature(bookmark.children),
    };
  });
}

async function verifyOutput(bytes, expectedPages, expectedOutline) {
  const pdf = await openPdfDocument(bytes);
  try {
    if (pdf.numPages !== expectedPages) {
      throw new Error(`Output verification failed: expected ${expectedPages} pages, got ${pdf.numPages}.`);
    }
    const outline = await readPdfOutline(pdf);
    if (JSON.stringify(outlineSignature(outline)) !== JSON.stringify(outlineSignature(expectedOutline))) {
      throw new Error("Output verification failed: bookmark tree or destinations changed.");
    }
  } finally {
    await pdf.destroy();
  }
}

async function savePdf() {
  if (!state.plan.length) return;
  saveButton.disabled = true;
  setStatus("Building PDF locally…");
  try {
    const qpdf = await ensureQpdf();
    const pageRequest = buildQpdfPageRequest(state.sources, state.plan);
    const pageResult = await qpdf.run(pageRequest);
    const pageBytes = pageResult.outputs[pageRequest.outputName];
    const combined = buildCombinedOutline(state.sources, state.plan);
    let finalBytes = await replacePdfOutline(pageBytes, combined.outline);
    const warnings = [...(pageResult.warnings || [])];

    if (optimizeToggle.checked || linearizeToggle.checked) {
      const finalizeRequest = buildQpdfFinalizeRequest(finalBytes, {
        optimize: optimizeToggle.checked,
        linearize: linearizeToggle.checked,
      });
      const finalizeResult = await qpdf.run(finalizeRequest);
      finalBytes = finalizeResult.outputs[finalizeRequest.outputName];
      warnings.push(...(finalizeResult.warnings || []));
    }

    await verifyOutput(finalBytes, state.plan.length, combined.outline);

    const filename = state.sources.length === 1
      ? state.sources[0].filename.replace(/\.pdf$/i, "") + "-docbench.pdf"
      : "merged-docbench.pdf";
    const blob = new Blob([finalBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);

    const warningText = warnings.length ? ` · ${warnings.length} qpdf warning(s)` : "";
    setStatus(`Saved ${state.plan.length} pages · ${formatPdfSize(finalBytes.byteLength)}${warningText}`);
  } catch (error) {
    showError(error);
  } finally {
    updateControls();
  }
}

$("#pdf-open-button").addEventListener("click", () => pdfInput.click());
$("#pdf-add-button").addEventListener("click", () => addPdfInput.click());
pdfInput.addEventListener("change", async () => {
  try { await openFiles(pdfInput.files || [], false); } catch (error) { showError(error); }
  pdfInput.value = "";
});
addPdfInput.addEventListener("change", async () => {
  try { await openFiles(addPdfInput.files || [], true); } catch (error) { showError(error); }
  addPdfInput.value = "";
});
leftButton.addEventListener("click", () => movePage(state.selectedIndex, state.selectedIndex - 1));
rightButton.addEventListener("click", () => movePage(state.selectedIndex, state.selectedIndex + 1));
removeButton.addEventListener("click", removeSelectedPage);
saveButton.addEventListener("click", savePdf);
window.addEventListener("beforeunload", () => state.qpdfRunner?.destroy?.());

refreshPdfUi();
