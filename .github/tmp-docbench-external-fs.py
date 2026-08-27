from pathlib import Path

root = Path.cwd()


def replace_once(path, old, new, label):
    target = root / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing {label} in {path}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


replace_once(
    "docbench/public/pdf-core.mjs",
    '''    locations.push({ kind: "FS", dict, records: [recordFor(rawSpec, fileSpec)], isCatalog: false });\n    dict.delete(fsKey);''',
    '''    const managedRecord = attachmentRecordFor(rawSpec, fileSpec, records, PDFLib);\n    if (!managedRecord) return;\n    locations.push({ kind: "FS", dict, records: [managedRecord], isCatalog: false });\n    dict.delete(fsKey);''',
    "unmanaged FileAttachment FS preservation",
)

test_path = root / "docbench/tests/pdf-attachment-review.test.mjs"
tests = test_path.read_text(encoding="utf-8")
marker = 'console.log("Doc Bench PDF attachment review tests passed.");'
if marker not in tests:
    raise SystemExit("attachment review footer missing")

regression = r'''
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
externalDocument.getPage(0).node.set(
  PDFLib.PDFName.of("Annots"),
  externalDocument.context.obj([externalAnnotationRef]),
);
const externalBytes = await externalDocument.save({ updateFieldAppearances: false });
assert.equal((await readPdfAttachments(externalBytes, PDFLib)).length, 0);
const externalRoundTrip = await replacePdfAttachments(externalBytes, [], PDFLib);
const externalOutput = await PDFLib.PDFDocument.load(externalRoundTrip, { updateMetadata: false });
const externalAnnots = externalOutput.getPage(0).node.lookup(PDFLib.PDFName.of("Annots"), PDFLib.PDFArray);
const externalAnnotation = externalAnnots.lookup(0, PDFLib.PDFDict);
const externalSpec = externalAnnotation.lookup(PDFLib.PDFName.of("FS"), PDFLib.PDFDict);
assert.equal(externalSpec.lookup(PDFLib.PDFName.of("UF")).decodeText(), "manual.txt");

'''

test_path.write_text(tests.replace(marker, regression + marker, 1), encoding="utf-8", newline="\n")
print("external FileAttachment target hotfix applied")
