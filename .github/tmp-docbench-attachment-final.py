from pathlib import Path

root = Path.cwd()


def replace_once(path, old, new, label):
    target = root / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing {label} in {path}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


replace_once(
    "docbench/public/pdf-app.mjs",
    '''  formatPdfSize,\n  mergePdfAttachmentSourceSets,''',
    '''  formatPdfSize,\n  mergePdfAttachmentSets,\n  mergePdfAttachmentSourceSets,''',
    "attachment merge helper import",
)

replace_once(
    "docbench/public/pdf-core.mjs",
    '''  const addSpec = (rawSpec, fileSpec, treeName = "") => {\n    const refKey = rawSpec instanceof PDFLib.PDFRef ? rawSpec.toString() : "";\n    if (refKey ? seenRefs.has(refKey) : seenDicts.has(fileSpec)) return;\n    if (refKey) seenRefs.add(refKey); else seenDicts.add(fileSpec);\n    const attachment = attachmentFromFileSpec(fileSpec, treeName, PDFLib);''',
    '''  const addSpec = (rawSpec, fileSpec, treeName = "", { allowAlias = false } = {}) => {\n    const refKey = rawSpec instanceof PDFLib.PDFRef ? rawSpec.toString() : "";\n    const alreadySeen = refKey ? seenRefs.has(refKey) : seenDicts.has(fileSpec);\n    if (alreadySeen && !allowAlias) return;\n    if (!alreadySeen) {\n      if (refKey) seenRefs.add(refKey); else seenDicts.add(fileSpec);\n    }\n    const attachment = attachmentFromFileSpec(fileSpec, treeName, PDFLib);''',
    "name-tree alias-aware FileSpec collection",
)
replace_once(
    "docbench/public/pdf-core.mjs",
    '''          addSpec(rawSpec, fileSpec, name);''',
    '''          addSpec(rawSpec, fileSpec, name, { allowAlias: true });''',
    "name-tree alias collection call",
)

# getRawAttachments() is suitable for reading attachment payloads, but its
# fileSpec objects are not the live name-tree dictionaries we must mutate.
replace_once(
    "docbench/public/pdf-core.mjs",
    '''  const targets = new Map(\n    (pdfDocument.getRawAttachments?.() || []).map(({ fileName, fileSpec }) => [pdfText(fileName, PDFLib), fileSpec]),\n  );''',
    '''  const targetRecords = [];\n  collectPdfAttachmentSpecs(pdfDocument, PDFLib, targetRecords);\n  const targets = new Map(\n    targetRecords.map(({ attachment, fileSpec }) => [attachment.name, fileSpec]),\n  );''',
    "live FileSpec targets",
)

replace_once(
    "docbench/public/pdf-core.mjs",
    '''      if (name === "/F" || name === "/UF" || name === "/Type") continue;\n      target.set(key, source.copier.copy(record.fileSpec.get(key)));''',
    '''      if (name === "/Type") continue;\n      if (name === "/EF") {\n        let sourceEf;\n        try { sourceEf = record.fileSpec.lookup(key, PDFLib.PDFDict); } catch {}\n        if (sourceEf) {\n          const restoredEf = pdfDocument.context.obj({});\n          for (const efKey of sourceEf.keys()) {\n            restoredEf.set(efKey, source.copier.copy(sourceEf.get(efKey)));\n          }\n          target.set(key, restoredEf);\n        }\n        continue;\n      }\n      if (name === "/F" || name === "/UF") {\n        let sourceName = "";\n        try { sourceName = pdfText(record.fileSpec.lookup(key), PDFLib); } catch {}\n        if (sourceName === record.attachment.name) continue;\n      }\n      target.set(key, source.copier.copy(record.fileSpec.get(key)));''',
    "source FileSpec restoration",
)

# A FileAttachment annotation can legitimately reference an external FileSpec
# without /EF. Such a target is outside Doc Bench's embedded-attachment model,
# so leave its /FS entry untouched instead of detaching it.
replace_once(
    "docbench/public/pdf-core.mjs",
    '''    locations.push({ kind: "FS", dict, records: [recordFor(rawSpec, fileSpec)], isCatalog: false });\n    dict.delete(fsKey);''',
    '''    const managedRecord = attachmentRecordFor(rawSpec, fileSpec, records, PDFLib);\n    if (!managedRecord) return;\n    locations.push({ kind: "FS", dict, records: [managedRecord], isCatalog: false });\n    dict.delete(fsKey);''',
    "unmanaged FileAttachment FS preservation",
)

# Test helpers must locate a specific FileSpec by its name-tree key. The first
# entry is not stable once multiple attachments are present.
replace_once(
    "docbench/tests/pdf-attachment-review.test.mjs",
    '''function firstAttachmentFileSpec(document) {\n  const names = document.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);\n  const embedded = names.lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict);\n  const entries = embedded.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);\n  return entries.lookup(1, PDFLib.PDFDict);\n}\n''',
    '''function firstAttachmentFileSpec(document) {\n  const names = document.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);\n  const embedded = names.lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict);\n  const entries = embedded.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);\n  return entries.lookup(1, PDFLib.PDFDict);\n}\n\nfunction attachmentFileSpecByName(document, expectedName) {\n  const names = document.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);\n  const embedded = names.lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict);\n  const entries = embedded.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);\n  for (let index = 0; index + 1 < entries.size(); index += 2) {\n    if (entries.lookup(index).decodeText() === expectedName) {\n      return entries.lookup(index + 1, PDFLib.PDFDict);\n    }\n  }\n  throw new Error(`Missing attachment FileSpec for ${expectedName}`);\n}\n''',
    "named FileSpec helper",
)
replace_once(
    "docbench/tests/pdf-attachment-review.test.mjs",
    '''const richRaw = richDocument.getRawAttachments();\nconst richSpec = richRaw[0].fileSpec;''',
    '''const richRaw = richDocument.getRawAttachments();\nconst richRawEntry = richRaw.find(({ fileName }) => fileName.decodeText() === "rich.bin");\nassert.ok(richRawEntry, "rich.bin raw attachment should exist");\nconst richSpec = attachmentFileSpecByName(richDocument, "rich.bin");''',
    "rich fixture FileSpec",
)
replace_once(
    "docbench/tests/pdf-attachment-review.test.mjs",
    '''const originalUf = richEf.get(PDFLib.PDFName.of("UF"));''',
    '''const originalUf = richEf.get(PDFLib.PDFName.of("UF")) || richEf.get(PDFLib.PDFName.of("F"));''',
    "multi-EF fixture fallback",
)
replace_once(
    "docbench/tests/pdf-attachment-review.test.mjs",
    '''richDocument.catalog.set(PDFLib.PDFName.of("AF"), richDocument.context.obj([richRaw[0].specRef]));''',
    '''richDocument.catalog.set(PDFLib.PDFName.of("AF"), richDocument.context.obj([richRawEntry.specRef]));''',
    "rich catalog AF",
)
replace_once(
    "docbench/tests/pdf-attachment-review.test.mjs",
    '''const structElem = richDocument.context.obj({ Type: "StructElem", S: "P", AF: [richRaw[0].specRef] });''',
    '''const structElem = richDocument.context.obj({ Type: "StructElem", S: "P", AF: [richRawEntry.specRef] });''',
    "rich struct AF",
)
replace_once(
    "docbench/tests/pdf-attachment-review.test.mjs",
    '''const richSourceBytes = await richDocument.save({ updateFieldAppearances: false });\nconst richAttachments = await readPdfAttachments(richSourceBytes, PDFLib);''',
    '''const richSourceBytes = await richDocument.save({ updateFieldAppearances: false });\nconst richSourceCheck = await PDFLib.PDFDocument.load(richSourceBytes, { updateMetadata: false });\nconst richSourceSpec = attachmentFileSpecByName(richSourceCheck, "rich.bin");\nconst richSourceEf = richSourceSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);\nassert.equal(richSourceEf.has(PDFLib.PDFName.of("F")), true, "fixture should contain /EF/F");\nassert.equal(richSourceEf.has(PDFLib.PDFName.of("UF")), true, "fixture should contain /EF/UF");\nassert.deepEqual([...PDFLib.decodePDFRawStream(richSourceEf.lookup(PDFLib.PDFName.of("UF"), PDFLib.PDFRawStream)).decode()], [40, 41]);\nconst richAttachments = await readPdfAttachments(richSourceBytes, PDFLib);''',
    "rich source fixture validation",
)
replace_once(
    "docbench/tests/pdf-attachment-review.test.mjs",
    '''const richOutputRaw = richOutput.getRawAttachments();\nconst richOutputSpec = richOutputRaw.find(({ fileName }) => fileName.decodeText() === "rich.bin").fileSpec;''',
    '''const richOutputSpec = attachmentFileSpecByName(richOutput, "rich.bin");''',
    "rich output FileSpec inspection",
)

# Add focused regressions for aliases, independent FileSpec filenames and
# unmanaged external FileAttachment targets.
test_path = root / "docbench/tests/pdf-attachment-review.test.mjs"
tests = test_path.read_text(encoding="utf-8")
marker = 'console.log("Doc Bench PDF attachment review tests passed.");'
if marker not in tests:
    raise SystemExit("attachment review test footer missing")
extra = r'''
const externalDocument = await PDFLib.PDFDocument.load(await onePagePdf(), { updateMetadata: false });
const externalSpecRef = externalDocument.context.register(externalDocument.context.obj({
  Type: "Filespec",
  F: PDFLib.PDFString.of("manual.txt"),
  UF: PDFLib.PDFHexString.fromText("manual.txt"),
}));
const externalAnnotationRef = externalDocument.context.register(externalDocument.context.obj({
  Type: "Annot",
  Subtype: "FileAttachment",
  Rect: [0, 0, 10, 10],
  FS: externalSpecRef,
}));
externalDocument.getPage(0).node.set(PDFLib.PDFName.of("Annots"), externalDocument.context.obj([externalAnnotationRef]));
const externalBytes = await externalDocument.save({ updateFieldAppearances: false });
assert.equal((await readPdfAttachments(externalBytes, PDFLib)).length, 0);
const externalRoundTrip = await replacePdfAttachments(externalBytes, [], PDFLib);
const externalOutput = await PDFLib.PDFDocument.load(externalRoundTrip, { updateMetadata: false });
const externalAnnots = externalOutput.getPage(0).node.lookup(PDFLib.PDFName.of("Annots"), PDFLib.PDFArray);
const externalAnnotation = externalAnnots.lookup(0, PDFLib.PDFDict);
const externalSpec = externalAnnotation.lookup(PDFLib.PDFName.of("FS"), PDFLib.PDFDict);
assert.equal(externalSpec.lookup(PDFLib.PDFName.of("UF")).decodeText(), "manual.txt");

const aliasBase = await replacePdfAttachments(await onePagePdf(), [{
  name: "canonical.bin",
  data: new Uint8Array([71, 72]),
  mimeType: "application/octet-stream",
}], PDFLib);
const aliasDocument = await PDFLib.PDFDocument.load(aliasBase, { updateMetadata: false });
const aliasRaw = aliasDocument.getRawAttachments()[0];
const aliasNames = aliasDocument.catalog
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
aliasNames.set(0, PDFLib.PDFHexString.fromText("alias-one.bin"));
aliasNames.push(PDFLib.PDFHexString.fromText("alias-two.bin"));
aliasNames.push(aliasRaw.specRef);
const aliasBytes = await aliasDocument.save({ updateFieldAppearances: false });
const aliasAttachments = await readPdfAttachments(aliasBytes, PDFLib);
assert.deepEqual(aliasAttachments.map((attachment) => attachment.name), ["alias-one.bin", "alias-two.bin"]);
const aliasRoundTrip = await replacePdfAttachments(aliasBytes, aliasAttachments, PDFLib);
assert.deepEqual(
  (await readPdfAttachments(aliasRoundTrip, PDFLib)).map((attachment) => attachment.name),
  ["alias-one.bin", "alias-two.bin"],
);

const filenamesBase = await replacePdfAttachments(await onePagePdf(), [{
  name: "tree-name.bin",
  data: new Uint8Array([81, 82]),
  mimeType: "application/octet-stream",
}], PDFLib);
const filenamesDocument = await PDFLib.PDFDocument.load(filenamesBase, { updateMetadata: false });
const filenamesSpec = attachmentFileSpecByName(filenamesDocument, "tree-name.bin");
filenamesSpec.set(PDFLib.PDFName.of("F"), PDFLib.PDFString.of("platform-name.bin"));
filenamesSpec.set(PDFLib.PDFName.of("UF"), PDFLib.PDFHexString.fromText("unicode-name.bin"));
const filenamesBytes = await filenamesDocument.save({ updateFieldAppearances: false });
const filenamesAttachments = await readPdfAttachments(filenamesBytes, PDFLib);
assert.equal(filenamesAttachments[0].name, "tree-name.bin");
const filenamesRoundTrip = await replacePdfAttachments(filenamesBytes, filenamesAttachments, PDFLib);
const filenamesOutput = await PDFLib.PDFDocument.load(filenamesRoundTrip, { updateMetadata: false });
const filenamesOutputSpec = attachmentFileSpecByName(filenamesOutput, "tree-name.bin");
assert.equal(filenamesOutputSpec.lookup(PDFLib.PDFName.of("F")).decodeText(), "platform-name.bin");
assert.equal(filenamesOutputSpec.lookup(PDFLib.PDFName.of("UF")).decodeText(), "unicode-name.bin");

'''
test_path.write_text(tests.replace(marker, extra + marker, 1), encoding="utf-8", newline="\n")

print("final attachment preservation fixes applied")
