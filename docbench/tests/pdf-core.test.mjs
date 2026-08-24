import assert from "node:assert/strict";
import * as PDFLib from "@cantoo/pdf-lib";
import {
  buildCombinedOutline,
  buildQpdfFinalizeRequest,
  buildQpdfPageRequest,
  clonePdfOutline,
  readPdfOutline,
  remapOutline,
  remapOutlineToPagePlan,
  replacePdfOutline,
} from "../public/pdf-core.mjs";

const fakePdfJs = {
  async getOutline() {
    return [
      {
        title: "Rozdział 1",
        dest: "chapter-1",
        color: new Uint8ClampedArray([12, 34, 56]),
        bold: true,
        italic: false,
        count: 1,
        items: [
          {
            title: "Nested",
            dest: [{ num: 7, gen: 0 }, { name: "XYZ" }, 10, 20, 1.25],
            items: [],
          },
        ],
      },
      { title: "Website", url: "https://example.com/", newWindow: true, items: [] },
    ];
  },
  async getDestination(name) {
    assert.equal(name, "chapter-1");
    return [{ num: 3, gen: 0 }, { name: "FitH" }, 700];
  },
  async getPageIndex(ref) {
    return ref.num === 3 ? 0 : 2;
  },
};

const read = await readPdfOutline(fakePdfJs);
assert.equal(read[0].title, "Rozdział 1");
assert.equal(read[0].target.pageIndex, 0);
assert.equal(read[0].target.view.type, "FitH");
assert.equal(read[0].children[0].target.pageIndex, 2);
assert.equal(read[1].target.kind, "url");

const cloned = clonePdfOutline(read);
cloned[0].title = "Edited";
assert.equal(read[0].title, "Rozdział 1");

const remapped = remapOutline(read, (pageIndex) => ({ 0: 2, 2: null })[pageIndex]);
assert.equal(remapped.outline[0].target.pageIndex, 2);
assert.equal(remapped.outline[0].children.length, 0);
assert.equal(remapped.dropped, 1);

const oldPlan = [
  { sourceId: 0, pageIndex: 0 },
  { sourceId: 0, pageIndex: 1 },
  { sourceId: 0, pageIndex: 2 },
];
const reorderedPlan = [oldPlan[2], oldPlan[0], oldPlan[1]];
const editedOutline = [{
  title: "My edited title",
  target: { kind: "page", pageIndex: 0, view: { type: "Fit", args: [] } },
  children: [{
    title: "Deleted target",
    target: { kind: "page", pageIndex: 1, view: { type: "Fit", args: [] } },
    children: [],
  }],
}];
const reorderedOutline = remapOutlineToPagePlan(editedOutline, oldPlan, reorderedPlan);
assert.equal(reorderedOutline.outline[0].title, "My edited title");
assert.equal(reorderedOutline.outline[0].target.pageIndex, 1);
assert.equal(reorderedOutline.outline[0].children[0].target.pageIndex, 2);

const deletedPlan = [oldPlan[2], oldPlan[0]];
const afterDelete = remapOutlineToPagePlan(reorderedOutline.outline, reorderedPlan, deletedPlan);
assert.equal(afterDelete.outline[0].target.pageIndex, 1);
assert.equal(afterDelete.outline[0].children.length, 0);
assert.equal(afterDelete.dropped, 1);

const sources = [
  { filename: "one.pdf", outline: read, bytes: new Uint8Array([1]) },
  {
    filename: "two.pdf",
    outline: [{
      title: "Second",
      target: { kind: "page", pageIndex: 0, view: { type: "Fit", args: [] } },
      children: [],
    }],
    bytes: new Uint8Array([2]),
  },
];
const plan = [
  { sourceId: 1, pageIndex: 0 },
  { sourceId: 0, pageIndex: 2 },
  { sourceId: 0, pageIndex: 0 },
];
const combined = buildCombinedOutline(sources, plan);
assert.deepEqual(combined.outline.map((item) => item.title), ["one.pdf", "two.pdf"]);
assert.equal(combined.outline[0].target.pageIndex, 1);
assert.equal(combined.outline[1].target.pageIndex, 0);

const qpdfRequest = buildQpdfPageRequest(sources, plan);
assert.deepEqual(qpdfRequest.args, [
  "source-0.pdf",
  "--pages",
  "source-1.pdf",
  "1",
  "source-0.pdf",
  "3",
  "source-0.pdf",
  "1",
  "--",
  "output.pdf",
]);
assert.equal(qpdfRequest.inputs["source-1.pdf"][0], 2);

const finalizeRequest = buildQpdfFinalizeRequest(
  new Uint8Array([4, 5, 6]),
  { optimize: true, linearize: true },
);
assert.deepEqual(finalizeRequest.args, [
  "input.pdf",
  "--object-streams=generate",
  "--recompress-flate",
  "--compression-level=9",
  "--linearize",
  "output.pdf",
]);
assert.deepEqual([...finalizeRequest.inputs["input.pdf"]], [4, 5, 6]);

const lossyRequest = buildQpdfFinalizeRequest(
  new Uint8Array([7, 8]),
  { lossyImages: true, jpegQuality: 60 },
);
assert.deepEqual(lossyRequest.args, [
  "input.pdf",
  "--optimize-images",
  "--jpeg-quality=60",
  "output.pdf",
]);

const clampedLossyRequest = buildQpdfFinalizeRequest(
  new Uint8Array([9]),
  { lossyImages: true, jpegQuality: 999 },
);
assert.ok(clampedLossyRequest.args.includes("--jpeg-quality=100"));

const document = await PDFLib.PDFDocument.create();
document.addPage([300, 400]);
document.addPage([300, 400]);
document.addPage([300, 400]);
const originalBytes = await document.save();
const outline = [
  {
    title: "Zażółć gęślą jaźń",
    target: { kind: "page", pageIndex: 1, view: { type: "XYZ", args: [10, 20, 1] } },
    color: [255, 10, 20],
    bold: true,
    italic: true,
    open: true,
    children: [
      {
        title: "Child",
        target: { kind: "page", pageIndex: 2, view: { type: "Fit", args: [] } },
        children: [],
      },
    ],
  },
  {
    title: "External",
    target: { kind: "url", url: "https://example.com/", newWindow: true },
    children: [],
  },
];
const outlinedBytes = await replacePdfOutline(originalBytes, outline, PDFLib);
const reloaded = await PDFLib.PDFDocument.load(outlinedBytes, { updateMetadata: false });
const rootRef = reloaded.catalog.get(PDFLib.PDFName.of("Outlines"));
assert.ok(rootRef, "outline root should be present");
const root = reloaded.context.lookup(rootRef, PDFLib.PDFDict);
assert.equal(root.lookup(PDFLib.PDFName.of("Count"), PDFLib.PDFNumber).asNumber(), 3);
assert.ok(root.get(PDFLib.PDFName.of("First")));
assert.ok(root.get(PDFLib.PDFName.of("Last")));

console.log("Doc Bench PDF core tests passed.");
