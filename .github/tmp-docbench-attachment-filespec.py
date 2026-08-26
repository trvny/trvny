from pathlib import Path

root = Path.cwd() / "docbench"

def replace(path, old, new, count=1):
    p = root / path
    s = p.read_text(encoding="utf-8")
    if old not in s:
        raise SystemExit(f"pattern missing in {path}: {old[:120]!r}")
    p.write_text(s.replace(old, new, count), encoding="utf-8", newline="\n")

# Parse valid PDF/A A-level declarations independently of the dependency's B/U-only parser.
replace("public/pdf-core.mjs", '''function supportedPdfaConformance(xml, PDFLib) {
  return PDFLib.parsePDFAConformanceFromXmp?.(xml);
}

function synchronizeCatalogXmp''', '''function supportedPdfaConformance(xml, PDFLib) {
  return PDFLib.parsePDFAConformanceFromXmp?.(xml);
}

function xmpNamespacedValue(xml, prefix, localName) {
  const name = `${escapeRegex(prefix)}:${escapeRegex(localName)}`;
  const element = new RegExp(`<${name}\\b[^>]*>\\s*([^<]+?)\\s*<\\/${name}\\s*>`, "i").exec(xml);
  if (element) return element[1].trim();
  const attribute = new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(xml);
  return attribute?.[1]?.trim() || "";
}

function attachmentPdfaConformance(xml, PDFLib) {
  const supported = supportedPdfaConformance(xml, PDFLib);
  if (supported) return supported;
  if (!xml || !xml.includes(PDFA_NAMESPACE)) return null;
  for (const prefix of namespacePrefixes(xml, PDFA_NAMESPACE)) {
    const partText = xmpNamespacedValue(xml, prefix, "part");
    const conformance = xmpNamespacedValue(xml, prefix, "conformance").toUpperCase();
    const part = Number(partText);
    if (Number.isInteger(part) && part > 0 && /^[ABU]$/.test(conformance)) {
      return { part, conformance };
    }
  }
  throw new Error("This PDF/A XMP declaration cannot be validated safely by Doc Bench.");
}

function synchronizeCatalogXmp''')

# Track unmatched targets so new user-added attachments can remain catalog-associated.
replace("public/pdf-core.mjs", '''  for (const record of records) {
    let index = findMatch(record, true);
    if (index < 0) index = findMatch(record, false);
    record.targetName = index < 0 ? null : attachments[index].name;
    if (index >= 0) used.add(index);
  }
}''', '''  for (const record of records) {
    let index = findMatch(record, true);
    if (index < 0) index = findMatch(record, false);
    record.targetName = index < 0 ? null : attachments[index].name;
    if (index >= 0) used.add(index);
  }
  return attachments
    .filter((_, index) => !used.has(index))
    .map((attachment) => attachment.name);
}''')

# Capture catalog /AF membership separately from page/annotation associations.
replace("public/pdf-core.mjs", '''  const detachAf = (dict) => {
    if (!(dict instanceof PDFLib.PDFDict) || !dict.has(afKey)) return;
    const recordList = [];
    const associated = dict.lookup(afKey);''', '''  const detachAf = (dict, { catalog = false, always = false } = {}) => {
    if (!(dict instanceof PDFLib.PDFDict)) return;
    const hadAf = dict.has(afKey);
    if (!hadAf && !always) return;
    const recordList = [];
    const associated = hadAf ? dict.lookup(afKey) : null;''')
replace("public/pdf-core.mjs", '''    dict.delete(afKey);
    if (recordList.length) locations.push({ kind: "AF", dict, records: recordList });
  };

  const detachFs''', '''    if (hadAf) dict.delete(afKey);
    if (recordList.length || always) {
      locations.push({ kind: "AF", dict, records: recordList, catalog });
    }
  };

  const detachFs''')
replace("public/pdf-core.mjs", '''  for (const page of pdfDocument.getPages()) {
    detachAf(page.node);''', '''  detachAf(pdfDocument.catalog, { catalog: true, always: true });
  for (const page of pdfDocument.getPages()) {
    detachAf(page.node);''')

replace("public/pdf-core.mjs", '''function restoreAssociatedFileLocations(pdfDocument, locations, PDFLib) {
  if (!locations.length) return;
  const byName = new Map();''', '''function restoreAssociatedFileLocations(pdfDocument, locations, newAttachmentNames, PDFLib) {
  if (!locations.length) return;
  const byName = new Map();''')
replace("public/pdf-core.mjs", '''  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");
  for (const { kind, dict, records } of locations) {
    const refs = records
      .map((record) => record.targetName ? byName.get(record.targetName) : null)
      .filter(Boolean);
    if (kind === "AF" && refs.length) {
      dict.set(afKey, pdfDocument.context.obj(refs));''', '''  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");
  pdfDocument.catalog.delete(afKey);
  for (const { kind, dict, records, catalog } of locations) {
    const targetNames = records
      .map((record) => record.targetName)
      .filter(Boolean);
    if (catalog) targetNames.push(...newAttachmentNames);
    const refs = [...new Set(targetNames)]
      .map((name) => byName.get(name))
      .filter(Boolean);
    if (kind === "AF" && refs.length) {
      dict.set(afKey, pdfDocument.context.obj(refs));''')

# Preserve FileSpec extension fields such as Portfolio /CI, platform names and custom keys.
insert = '''const OWNED_FILESPEC_KEYS = new Set([
  "/Type", "/F", "/UF", "/EF", "/Desc", "/AFRelationship",
]);

function restoreFileSpecExtras(pdfDocument, records, PDFLib) {
  const byName = new Map();
  for (const { fileName, fileSpec } of pdfDocument.getRawAttachments?.() || []) {
    byName.set(pdfText(fileName, PDFLib), fileSpec);
  }
  for (const record of records) {
    if (!record.targetName) continue;
    const target = byName.get(record.targetName);
    if (!(target instanceof PDFLib.PDFDict)) continue;
    for (const [key, value] of record.fileSpec.entries()) {
      if (OWNED_FILESPEC_KEYS.has(key.toString())) continue;
      target.set(key, value);
    }
  }
}

'''
replace("public/pdf-core.mjs", '''function attachmentOptions(attachment) {''', insert + '''function attachmentOptions(attachment) {''')

# Use robust PDF/A detection for parent and embedded PDF validation.
replace("public/pdf-core.mjs", '''  try {
    const document = await PDFLib.PDFDocument.load(data, { updateMetadata: false });
    return supportedPdfaConformance(readCatalogMetadataXml(document, PDFLib), PDFLib) || null;
  } catch {
    return null;
  }
}''', '''  let document;
  try {
    document = await PDFLib.PDFDocument.load(data, { updateMetadata: false });
  } catch {
    return null;
  }
  return attachmentPdfaConformance(readCatalogMetadataXml(document, PDFLib), PDFLib);
}''')
replace("public/pdf-core.mjs", '''  const conformance = supportedPdfaConformance(readCatalogMetadataXml(pdfDocument, PDFLib), PDFLib);
  await validatePdfaAttachmentSet(conformance, normalized, PDFLib);
  const oldRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, oldRecords);
  assignAttachmentTargets(oldRecords, normalized);''', '''  const conformance = attachmentPdfaConformance(readCatalogMetadataXml(pdfDocument, PDFLib), PDFLib);
  await validatePdfaAttachmentSet(conformance, normalized, PDFLib);
  const oldRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, oldRecords);
  const newAttachmentNames = assignAttachmentTargets(oldRecords, normalized);''')
replace("public/pdf-core.mjs", '''  await pdfDocument.flush();
  restoreFormDataRelationships(pdfDocument, normalized, PDFLib);
  restoreAttachmentChecksums(pdfDocument, normalized, PDFLib);
  restoreAssociatedFileLocations(pdfDocument, associatedLocations, PDFLib);''', '''  await pdfDocument.flush();
  restoreFileSpecExtras(pdfDocument, oldRecords, PDFLib);
  restoreFormDataRelationships(pdfDocument, normalized, PDFLib);
  restoreAttachmentChecksums(pdfDocument, normalized, PDFLib);
  restoreAssociatedFileLocations(pdfDocument, associatedLocations, newAttachmentNames, PDFLib);''')

# Regressions: PDF/A level A, catalog /AF subset, Portfolio /CI.
tests = r'''
const pdfa2a = await onePagePdf({ pdfa: "2A" });
await assert.rejects(
  () => replacePdfAttachments(pdfa2a, [{
    name: "level-a.txt",
    data: new TextEncoder().encode("not archival PDF"),
    mimeType: "text/plain",
  }], PDFLib),
  /PDF\/A-2 permits only PDF\/A-1 or PDF\/A-2 attachments/,
);

const membershipBase = await onePagePdf();
const membershipBytes = await replacePdfAttachments(membershipBase, [
  { name: "associated.txt", data: new Uint8Array([31]), mimeType: "text/plain" },
  { name: "ordinary.txt", data: new Uint8Array([32]), mimeType: "text/plain" },
], PDFLib);
const membershipDocument = await PDFLib.PDFDocument.load(membershipBytes, { updateMetadata: false });
const membershipRaw = membershipDocument.getRawAttachments();
membershipDocument.catalog.set(
  PDFLib.PDFName.of("AF"),
  membershipDocument.context.obj([membershipRaw[0].specRef]),
);
const subsetBytes = await membershipDocument.save({ updateFieldAppearances: false });
const subsetAttachments = await readPdfAttachments(subsetBytes, PDFLib);
const rebuiltSubsetBytes = await replacePdfAttachments(subsetBytes, subsetAttachments, PDFLib);
const rebuiltSubsetDocument = await PDFLib.PDFDocument.load(rebuiltSubsetBytes, { updateMetadata: false });
const rebuiltCatalogAf = rebuiltSubsetDocument.catalog.lookup(PDFLib.PDFName.of("AF"), PDFLib.PDFArray);
assert.equal(rebuiltCatalogAf.size(), 1);
const rebuiltAssociatedSpec = rebuiltCatalogAf.lookup(0, PDFLib.PDFDict);
assert.equal(rebuiltAssociatedSpec.lookup(PDFLib.PDFName.of("UF")).decodeText(), "associated.txt");

const portfolioDocument = await PDFLib.PDFDocument.load(formBytes, { updateMetadata: false });
const portfolioSpec = firstAttachmentFileSpec(portfolioDocument);
portfolioSpec.set(PDFLib.PDFName.of("CI"), portfolioDocument.context.obj({
  CustomColumn: PDFLib.PDFHexString.fromText("keep me"),
}));
portfolioSpec.set(PDFLib.PDFName.of("DocbenchCustom"), PDFLib.PDFString.of("also keep"));
const portfolioBytes = await portfolioDocument.save({ updateFieldAppearances: false });
const portfolioAttachments = await readPdfAttachments(portfolioBytes, PDFLib);
const rebuiltPortfolioBytes = await replacePdfAttachments(portfolioBytes, portfolioAttachments, PDFLib);
const rebuiltPortfolioDocument = await PDFLib.PDFDocument.load(rebuiltPortfolioBytes, { updateMetadata: false });
const rebuiltPortfolioSpec = firstAttachmentFileSpec(rebuiltPortfolioDocument);
const rebuiltCi = rebuiltPortfolioSpec.lookup(PDFLib.PDFName.of("CI"), PDFLib.PDFDict);
assert.equal(rebuiltCi.lookup(PDFLib.PDFName.of("CustomColumn")).decodeText(), "keep me");
assert.equal(rebuiltPortfolioSpec.lookup(PDFLib.PDFName.of("DocbenchCustom")).decodeText(), "also keep");

'''
replace("tests/pdf-attachment-review.test.mjs", '''const oversizedTreeDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });''', tests + '''const oversizedTreeDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });''')

print("attachment FileSpec fidelity patch applied")
