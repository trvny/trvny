const DESTINATION_TYPES = new Set([
  "XYZ",
  "Fit",
  "FitH",
  "FitV",
  "FitR",
  "FitB",
  "FitBH",
  "FitBV",
]);

function clampByte(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
}

function normalizeDestinationView(explicitDestination) {
  if (!Array.isArray(explicitDestination) || explicitDestination.length < 2) {
    return { type: "Fit", args: [] };
  }

  const rawType = explicitDestination[1]?.name;
  const type = DESTINATION_TYPES.has(rawType) ? rawType : "Fit";
  const expectedArgs = {
    XYZ: 3,
    Fit: 0,
    FitH: 1,
    FitV: 1,
    FitR: 4,
    FitB: 0,
    FitBH: 1,
    FitBV: 1,
  }[type];
  const args = explicitDestination.slice(2, 2 + expectedArgs).map((value) => {
    return Number.isFinite(value) ? Number(value) : null;
  });
  while (args.length < expectedArgs) args.push(null);
  return { type, args };
}

async function resolveDestination(pdfDocument, destination) {
  if (!destination) return null;

  let explicit = destination;
  if (typeof destination === "string") {
    explicit = await pdfDocument.getDestination(destination);
  }
  if (!Array.isArray(explicit) || !explicit.length) return null;

  const pageReference = explicit[0];
  let pageIndex = null;
  if (Number.isInteger(pageReference)) {
    pageIndex = pageReference;
  } else if (pageReference) {
    try {
      pageIndex = await pdfDocument.getPageIndex(pageReference);
    } catch {
      return null;
    }
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;

  return {
    kind: "page",
    pageIndex,
    view: normalizeDestinationView(explicit),
  };
}

async function readOutlineItems(pdfDocument, items) {
  const result = [];
  for (const item of items || []) {
    let target = await resolveDestination(pdfDocument, item.dest);
    if (!target && item.url) {
      target = { kind: "url", url: item.url, newWindow: Boolean(item.newWindow) };
    } else if (!target && item.action) {
      target = { kind: "named", action: item.action };
    }

    result.push({
      title: String(item.title || "Untitled bookmark"),
      target,
      color: Array.from(item.color || []).slice(0, 3).map(clampByte),
      bold: Boolean(item.bold),
      italic: Boolean(item.italic),
      open: Number(item.count || 0) >= 0,
      children: await readOutlineItems(pdfDocument, item.items),
    });
  }
  return result;
}

export async function readPdfOutline(pdfDocument) {
  return readOutlineItems(pdfDocument, await pdfDocument.getOutline());
}

function cloneTarget(target) {
  if (!target) return null;
  if (target.kind === "page") {
    return {
      kind: "page",
      pageIndex: target.pageIndex,
      view: {
        type: target.view?.type || "Fit",
        args: [...(target.view?.args || [])],
      },
    };
  }
  return { ...target };
}

function cloneBookmark(bookmark) {
  return {
    ...bookmark,
    target: cloneTarget(bookmark.target),
    color: [...(bookmark.color || [])],
    children: (bookmark.children || []).map(cloneBookmark),
  };
}

export function remapOutline(outline, mapPageIndex) {
  let dropped = 0;

  function visit(bookmark) {
    const next = cloneBookmark(bookmark);
    next.children = next.children.map(visit).filter(Boolean);

    if (next.target?.kind === "page") {
      const mapped = mapPageIndex(next.target.pageIndex);
      if (mapped === null || mapped === undefined || mapped < 0) {
        next.target = null;
        if (!next.children.length) {
          dropped += 1;
          return null;
        }
      } else {
        next.target.pageIndex = mapped;
      }
    }
    return next;
  }

  return {
    outline: (outline || []).map(visit).filter(Boolean),
    dropped,
  };
}

export function buildCombinedOutline(sources, pagePlan) {
  const surviving = new Map();
  for (let outputIndex = 0; outputIndex < pagePlan.length; outputIndex += 1) {
    const page = pagePlan[outputIndex];
    const key = `${page.sourceId}:${page.pageIndex}`;
    if (!surviving.has(key)) surviving.set(key, outputIndex);
  }

  const results = [];
  let dropped = 0;
  const multipleSources = sources.length > 1;

  for (let sourceId = 0; sourceId < sources.length; sourceId += 1) {
    const source = sources[sourceId];
    const firstOutputPage = pagePlan.findIndex((page) => page.sourceId === sourceId);
    if (firstOutputPage < 0) continue;

    const remapped = remapOutline(source.outline, (oldPageIndex) => {
      return surviving.get(`${sourceId}:${oldPageIndex}`) ?? null;
    });
    dropped += remapped.dropped;

    if (!multipleSources) {
      results.push(...remapped.outline);
      continue;
    }

    results.push({
      title: source.filename,
      target: {
        kind: "page",
        pageIndex: firstOutputPage,
        view: { type: "Fit", args: [] },
      },
      color: [],
      bold: false,
      italic: false,
      open: true,
      children: remapped.outline,
    });
  }

  return { outline: results, dropped };
}

export function buildQpdfPageRequest(sources, pagePlan, outputName = "output.pdf") {
  if (!sources.length) throw new Error("At least one PDF source is required.");
  if (!pagePlan.length) throw new Error("A PDF must contain at least one page.");

  const inputNames = sources.map((_, index) => `source-${index}.pdf`);
  const inputs = Object.fromEntries(
    sources.map((source, index) => [inputNames[index], source.bytes]),
  );
  const args = [inputNames[0], "--pages"];

  for (const page of pagePlan) {
    const name = inputNames[page.sourceId];
    if (!name || !Number.isInteger(page.pageIndex) || page.pageIndex < 0) {
      throw new Error("Invalid PDF page plan.");
    }
    args.push(name, String(page.pageIndex + 1));
  }
  args.push("--", outputName);

  return { inputs, args, outputs: [outputName], outputName };
}

export function buildQpdfFinalizeRequest(
  pdfBytes,
  { optimize = false, linearize = false } = {},
  outputName = "output.pdf",
) {
  const inputName = "input.pdf";
  const args = [inputName];
  if (optimize) {
    args.push("--object-streams=generate", "--recompress-flate", "--compression-level=9");
  }
  if (linearize) args.push("--linearize");
  args.push(outputName);
  return {
    inputs: { [inputName]: pdfBytes },
    args,
    outputs: [outputName],
    outputName,
  };
}

function setIf(dict, key, value, PDFLib) {
  if (value !== undefined && value !== null) {
    dict.set(PDFLib.PDFName.of(key), value);
  }
}

function applyBookmarkTarget(pdfDocument, dict, target, PDFLib) {
  if (!target) return;

  if (target.kind === "page") {
    if (target.pageIndex < 0 || target.pageIndex >= pdfDocument.getPageCount()) return;
    const pageRef = pdfDocument.getPage(target.pageIndex).ref;
    const type = DESTINATION_TYPES.has(target.view?.type) ? target.view.type : "Fit";
    const args = (target.view?.args || []).map((value) => {
      return Number.isFinite(value) ? Number(value) : null;
    });
    dict.set(
      PDFLib.PDFName.of("Dest"),
      pdfDocument.context.obj([pageRef, PDFLib.PDFName.of(type), ...args]),
    );
    return;
  }

  if (target.kind === "url" && target.url) {
    dict.set(
      PDFLib.PDFName.of("A"),
      pdfDocument.context.obj({
        S: "URI",
        URI: PDFLib.PDFString.of(target.url),
        ...(target.newWindow ? { NewWindow: true } : {}),
      }),
    );
    return;
  }

  if (target.kind === "named" && target.action) {
    dict.set(
      PDFLib.PDFName.of("A"),
      pdfDocument.context.obj({
        S: "Named",
        N: PDFLib.PDFName.of(target.action),
      }),
    );
  }
}

function buildOutlineLevel(pdfDocument, bookmarks, parentRef, PDFLib) {
  const context = pdfDocument.context;
  const records = (bookmarks || []).map((bookmark) => {
    const dict = context.obj({
      Title: PDFLib.PDFHexString.fromText(bookmark.title || "Untitled bookmark"),
      Parent: parentRef,
    });
    return { bookmark, dict, ref: context.register(dict), descendants: 0 };
  });

  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    if (index > 0) current.dict.set(PDFLib.PDFName.of("Prev"), records[index - 1].ref);
    if (index + 1 < records.length) {
      current.dict.set(PDFLib.PDFName.of("Next"), records[index + 1].ref);
    }

    applyBookmarkTarget(pdfDocument, current.dict, current.bookmark.target, PDFLib);

    if ((current.bookmark.color || []).length === 3) {
      const color = current.bookmark.color.map((value) => clampByte(value) / 255);
      current.dict.set(PDFLib.PDFName.of("C"), context.obj(color));
    }
    const flags = (current.bookmark.italic ? 1 : 0) | (current.bookmark.bold ? 2 : 0);
    if (flags) current.dict.set(PDFLib.PDFName.of("F"), context.obj(flags));

    if (current.bookmark.children?.length) {
      const children = buildOutlineLevel(
        pdfDocument,
        current.bookmark.children,
        current.ref,
        PDFLib,
      );
      setIf(current.dict, "First", children.first, PDFLib);
      setIf(current.dict, "Last", children.last, PDFLib);
      current.descendants = children.total;
      current.dict.set(
        PDFLib.PDFName.of("Count"),
        context.obj(current.bookmark.open === false ? -children.total : children.total),
      );
    }
  }

  return {
    first: records[0]?.ref,
    last: records.at(-1)?.ref,
    total: records.reduce((sum, record) => sum + 1 + record.descendants, 0),
  };
}

export async function replacePdfOutline(pdfBytes, outline, PDFLib = globalThis.PDFLib) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");

  const pdfDocument = await PDFLib.PDFDocument.load(pdfBytes, {
    updateMetadata: false,
  });
  const outlinesKey = PDFLib.PDFName.of("Outlines");
  pdfDocument.catalog.delete(outlinesKey);

  if (outline?.length) {
    const root = pdfDocument.context.obj({ Type: "Outlines" });
    const rootRef = pdfDocument.context.register(root);
    const children = buildOutlineLevel(pdfDocument, outline, rootRef, PDFLib);
    setIf(root, "First", children.first, PDFLib);
    setIf(root, "Last", children.last, PDFLib);
    root.set(PDFLib.PDFName.of("Count"), pdfDocument.context.obj(children.total));
    pdfDocument.catalog.set(outlinesKey, rootRef);
  }

  return pdfDocument.save({
    useObjectStreams: true,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

export function formatPdfSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
