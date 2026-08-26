from pathlib import Path

p = Path("docbench/tests/pdf-attachment-review.test.mjs")
s = p.read_text(encoding="utf-8")
old = 'const pdfa2a = await onePagePdf({ pdfa: "2A" });\n'
new = '''const pdfa2aBase = await onePagePdf({ pdfa: "2B" });
const pdfa2aDocument = await PDFLib.PDFDocument.load(pdfa2aBase, { updateMetadata: false });
const pdfa2aMetadata = pdfa2aDocument.catalog.lookup(PDFLib.PDFName.of("Metadata"));
const pdfa2aXml = new TextDecoder().decode(PDFLib.decodePDFRawStream(pdfa2aMetadata).decode())
  .replace(/(<pdfaid:conformance\\b[^>]*>\\s*)B(\\s*<\\/pdfaid:conformance>)/i, "$1A$2");
const pdfa2aStream = pdfa2aDocument.context.stream(new TextEncoder().encode(pdfa2aXml), {
  Type: "Metadata",
  Subtype: "XML",
});
pdfa2aDocument.catalog.set(
  PDFLib.PDFName.of("Metadata"),
  pdfa2aDocument.context.register(pdfa2aStream),
);
const pdfa2a = await pdfa2aDocument.save({ updateFieldAppearances: false });
'''
if old not in s:
    raise SystemExit("PDF/A 2A fixture marker missing")
p.write_text(s.replace(old, new, 1), encoding="utf-8", newline="\n")
print("PDF/A A-level fixture patched")
