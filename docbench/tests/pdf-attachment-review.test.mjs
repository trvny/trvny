import assert from "node:assert/strict";
import * as PDFLib from "@cantoo/pdf-lib";
import {
  mergePdfAttachmentSets,
  normalizePdfAttachment,
  readPdfAttachments,
  replacePdfAttachments,
  verifyPdfAttachments,
} from "../public/pdf-core.mjs";

async function onePagePdf({ pdfa } = {}) {
  const document = await PDFLib.PDFDocument.create({ updateMetadata: false });
  document.addPage([100, 100]);
  if (pdfa) document.convertToPDFA({ conformance: pdfa });
  return document.save();
}

function firstAttachmentFileSpec(document) {
  const names = document.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);
  const embedded = names.lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict);
  const entries = embedded.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
  return entries.lookup(1, PDFLib.PDFDict);
}

assert.equal(
  normalizePdfAttachment({ name: "form.xml", afRelationship: "FormData" }).afRelationship,
  "FormData",
);

const formBase = await onePagePdf();
const formBytes = await replacePdfAttachments(formBase, [{
  name: "form.xml",
  data: new TextEncoder().encode("<form/>") ,
  mimeType: "application/xml",
  afRelationship: "FormData",
}], PDFLib);
const formAttachments = await readPdfAttachments(formBytes, PDFLib);
assert.equal(formAttachments[0].afRelationship, "FormData");

const datedBase = await onePagePdf();
const datedBytes = await replacePdfAttachments(datedBase, [{
  name: "dated.txt",
  data: new TextEncoder().encode("date"),
  mimeType: "text/plain",
  creationDate: "2020-01-02T03:04:05.000Z",
  modificationDate: "2021-02-03T04:05:06.000Z",
}], PDFLib);
const datedDocument = await PDFLib.PDFDocument.load(datedBytes, { updateMetadata: false });
const datedSpec = firstAttachmentFileSpec(datedDocument);
const ef = datedSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const stream = ef.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFStream);
const params = stream.dict.lookup(PDFLib.PDFName.of("Params"), PDFLib.PDFDict);
params.set(
  PDFLib.PDFName.of("CreationDate"),
  PDFLib.PDFHexString.fromText("D:20200102030405Z"),
);
params.set(
  PDFLib.PDFName.of("ModDate"),
  PDFLib.PDFHexString.fromText("D:20210203040506Z"),
);
const hexDateBytes = await datedDocument.save({ updateFieldAppearances: false });
const hexDateAttachments = await readPdfAttachments(hexDateBytes, PDFLib);
assert.equal(hexDateAttachments[0].creationDate, "2020-01-02T03:04:05.000Z");
assert.equal(hexDateAttachments[0].modificationDate, "2021-02-03T04:05:06.000Z");

const pdfa2 = await onePagePdf({ pdfa: "2B" });
await assert.rejects(
  () => replacePdfAttachments(pdfa2, [{
    name: "payload.txt",
    data: new TextEncoder().encode("not a PDF/A file"),
    mimeType: "text/plain",
    afRelationship: "Data",
  }], PDFLib),
  /PDF\/A-2 permits only PDF\/A-1 or PDF\/A-2 attachments/,
);

const pdfa1Child = await onePagePdf({ pdfa: "1B" });
const compliantPdfa2 = await replacePdfAttachments(pdfa2, [{
  name: "archival-child.pdf",
  data: pdfa1Child,
  mimeType: "application/pdf",
  afRelationship: "Supplement",
}], PDFLib);
const compliantAttachments = await readPdfAttachments(compliantPdfa2, PDFLib);
assert.equal(compliantAttachments.length, 1);
assert.equal(compliantAttachments[0].name, "archival-child.pdf");

const spacedAttachment = mergePdfAttachmentSets([], [{
  name: " report.txt ",
  data: new TextEncoder().encode("spaces"),
  mimeType: "text/plain",
}]);
assert.equal(spacedAttachment[0].name, " report.txt ");
const spacedBytes = await replacePdfAttachments(await onePagePdf(), spacedAttachment, PDFLib);
const spacedRead = await readPdfAttachments(spacedBytes, PDFLib);
assert.equal(spacedRead[0].name, " report.txt ");

const collidingSortNames = [
  { name: "résumé.txt", data: new Uint8Array([1]), mimeType: "text/plain" },
  { name: "resume.txt", data: new Uint8Array([2]), mimeType: "text/plain" },
];
const collatingBytes = await replacePdfAttachments(await onePagePdf(), collidingSortNames, PDFLib);
await verifyPdfAttachments(collatingBytes, collidingSortNames, PDFLib);

console.log("Doc Bench PDF attachment review tests passed.");
