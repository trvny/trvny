import assert from "node:assert/strict";
import * as PDFLib from "@cantoo/pdf-lib";
import {
  mergePdfAttachmentSets,
  mergePdfAttachmentSourceSets,
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

const caseDistinctSources = mergePdfAttachmentSourceSets([
  [
    { name: "A.txt", data: new Uint8Array([10]), mimeType: "text/plain" },
    { name: "a.txt", data: new Uint8Array([11]), mimeType: "text/plain" },
  ],
  [
    { name: "A.txt", data: new Uint8Array([12]), mimeType: "text/plain" },
  ],
]);
assert.deepEqual(
  caseDistinctSources.map((attachment) => attachment.name),
  ["A.txt", "a.txt", "A (2).txt"],
);

const checksumDocument = await PDFLib.PDFDocument.load(datedBytes, { updateMetadata: false });
const checksumSpec = firstAttachmentFileSpec(checksumDocument);
const checksumEf = checksumSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const checksumStream = checksumEf.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFStream);
const checksumParams = checksumStream.dict.lookup(PDFLib.PDFName.of("Params"), PDFLib.PDFDict);
const checksumValue = PDFLib.PDFHexString.of("00112233445566778899aabbccddeeff");
checksumParams.set(PDFLib.PDFName.of("CheckSum"), checksumValue);
const checksumBytes = await checksumDocument.save({ updateFieldAppearances: false });
const checksumAttachments = await readPdfAttachments(checksumBytes, PDFLib);
assert.deepEqual([...checksumAttachments[0].checksum], [...checksumValue.asBytes()]);
const rebuiltChecksumBytes = await replacePdfAttachments(checksumBytes, checksumAttachments, PDFLib);
const rebuiltChecksumAttachments = await readPdfAttachments(rebuiltChecksumBytes, PDFLib);
assert.deepEqual([...rebuiltChecksumAttachments[0].checksum], [...checksumValue.asBytes()]);
await verifyPdfAttachments(rebuiltChecksumBytes, checksumAttachments, PDFLib);

const undecodableDocument = await PDFLib.PDFDocument.load(datedBytes, { updateMetadata: false });
const undecodableSpec = firstAttachmentFileSpec(undecodableDocument);
const undecodableEf = undecodableSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const undecodableStream = undecodableEf.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFStream);
undecodableStream.dict.set(PDFLib.PDFName.of("Filter"), PDFLib.PDFName.of("UnsupportedDocbenchFilter"));
const undecodableBytes = await undecodableDocument.save({ updateFieldAppearances: false });
await assert.rejects(
  () => readPdfAttachments(undecodableBytes, PDFLib),
  /Could not decode PDF attachment dated\.txt; refusing to rewrite attachments/,
);

const associatedDocument = await PDFLib.PDFDocument.load(formBytes, { updateMetadata: false });
const [{ specRef: oldSpecRef, fileSpec: oldFileSpec }] = associatedDocument.getRawAttachments();
const oldEf = oldFileSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const oldStreamRef = oldEf.get(PDFLib.PDFName.of("F"));
const associatedPage = associatedDocument.getPage(0);
associatedPage.node.set(PDFLib.PDFName.of("AF"), associatedDocument.context.obj([oldSpecRef]));
const annotation = associatedDocument.context.obj({
  Type: "Annot",
  Subtype: "Text",
  Rect: [0, 0, 10, 10],
  AF: [oldSpecRef],
});
const annotationRef = associatedDocument.context.register(annotation);
associatedPage.node.set(PDFLib.PDFName.of("Annots"), associatedDocument.context.obj([annotationRef]));
const associatedBytes = await associatedDocument.save({ updateFieldAppearances: false });
assert.equal((await readPdfAttachments(associatedBytes, PDFLib)).length, 1);
const removedAssociatedBytes = await replacePdfAttachments(associatedBytes, [], PDFLib);
assert.equal((await readPdfAttachments(removedAssociatedBytes, PDFLib)).length, 0);
const removedAssociatedDocument = await PDFLib.PDFDocument.load(removedAssociatedBytes, { updateMetadata: false });
const removedPage = removedAssociatedDocument.getPage(0);
assert.equal(removedPage.node.has(PDFLib.PDFName.of("AF")), false);
const removedAnnots = removedPage.node.lookup(PDFLib.PDFName.of("Annots"), PDFLib.PDFArray);
const removedAnnotation = removedAnnots.lookup(0, PDFLib.PDFDict);
assert.equal(removedAnnotation.has(PDFLib.PDFName.of("AF")), false);
assert.equal(removedAssociatedDocument.context.lookup(oldSpecRef), undefined);
assert.equal(removedAssociatedDocument.context.lookup(oldStreamRef), undefined);

const oversizedTreeDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });
oversizedTreeDocument.addPage([100, 100]);
const oversizedKids = oversizedTreeDocument.context.obj([]);
for (let index = 0; index < 10000; index += 1) {
  oversizedKids.push(oversizedTreeDocument.context.obj({}));
}
const oversizedEmbedded = oversizedTreeDocument.context.obj({ Kids: oversizedKids });
const oversizedNames = oversizedTreeDocument.context.obj({ EmbeddedFiles: oversizedEmbedded });
oversizedTreeDocument.catalog.set(PDFLib.PDFName.of("Names"), oversizedNames);
const oversizedTreeBytes = await oversizedTreeDocument.save({ updateFieldAppearances: false });
await assert.rejects(
  () => readPdfAttachments(oversizedTreeBytes, PDFLib),
  /PDF attachment name tree is too large/,
);

console.log("Doc Bench PDF attachment review tests passed.");
