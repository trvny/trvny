from pathlib import Path
import re

root = Path.cwd() / "docbench"
core_path = root / "public/pdf-core.mjs"
test_path = root / "tests/pdf-attachment-review.test.mjs"
core = core_path.read_text(encoding="utf-8")
tests = test_path.read_text(encoding="utf-8")

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing {label}")
    return text.replace(old, new, 1)

def replace_between(text, start, end, new, label):
    left = text.find(start)
    if left < 0:
        raise SystemExit(f"missing start {label}")
    right = text.find(end, left)
    if right < 0:
        raise SystemExit(f"missing end {label}")
    return text[:left] + new + text[right:]

core = replace_once(core,
'''function supportedPdfaConformance(xml, PDFLib) {
  return PDFLib.parsePDFAConformanceFromXmp?.(xml);
}
''',
'''function supportedPdfaConformance(xml, PDFLib) {
  return PDFLib.parsePDFAConformanceFromXmp?.(xml);
}

function attachmentPdfaConformance(xml, PDFLib) {
  const parsed = supportedPdfaConformance(xml, PDFLib);
  if (parsed) return parsed;
  if (!xml || !xml.includes(PDFA_NAMESPACE)) return null;

  const readField = (localName) => {
    for (const prefix of namespacePrefixes(xml, PDFA_NAMESPACE)) {
      const escaped = escapeRegex(prefix);
      const local = escapeRegex(localName);
      const attribute = new RegExp(`${escaped}:${local}\\s*=\\s*["']([^"']+)["']`, "i").exec(xml)?.[1];
      if (attribute) return attribute.trim();
      const element = new RegExp(`<${escaped}:${local}\\b[^>]*>\\s*([^<]+?)\\s*</${escaped}:${local}\\s*>`, "i").exec(xml)?.[1];
      if (element) return element.trim();
    }
    return "";
  };

  const part = Number(readField("part"));
  const conformance = readField("conformance").toUpperCase();
  if (Number.isInteger(part) && part > 0) return { part, conformance };
  return { unsupported: true };
}
''', 'pdfa attachment parser')

core = replace_once(core,
'''    checksum: normalizeAttachmentChecksum(attachment.checksum),
  };
}''',
'''    checksum: normalizeAttachmentChecksum(attachment.checksum),
    sourcePdfBytes: attachment.sourcePdfBytes instanceof Uint8Array
      ? attachment.sourcePdfBytes
      : null,
    sourceSpecIndex: Number.isInteger(attachment.sourceSpecIndex)
      ? attachment.sourceSpecIndex
      : null,
  };
}''', 'attachment provenance')

walk_helper = r'''const MAX_ATTACHMENT_GRAPH_NODES = 50000;

function walkPdfObjectGraph(pdfDocument, PDFLib, visitDict) {
  const seenRefs = new Set();
  const seenObjects = new Set();
  let visited = 0;

  const walk = (rawValue) => {
    let value = rawValue;
    if (value instanceof PDFLib.PDFRef) {
      const key = value.toString();
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      try { value = pdfDocument.context.lookup(value); } catch { return; }
    }
    if (value instanceof PDFLib.PDFStream) return;
    if (value instanceof PDFLib.PDFDict) {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);
      visited += 1;
      if (visited > MAX_ATTACHMENT_GRAPH_NODES) {
        throw new Error("PDF object graph is too large to preserve attachment associations safely.");
      }
      visitDict(value);
      let type = "";
      try { type = pdfNameOrText(value.lookup(PDFLib.PDFName.of("Type")), PDFLib); } catch {}
      if (type === "Filespec") return;
      for (const key of value.keys()) {
        const name = key.toString();
        if (name === "/AF" || name === "/FS" || name === "/EF") continue;
        walk(value.get(key));
      }
      return;
    }
    if (value instanceof PDFLib.PDFArray) {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);
      visited += 1;
      if (visited > MAX_ATTACHMENT_GRAPH_NODES) {
        throw new Error("PDF object graph is too large to preserve attachment associations safely.");
      }
      for (let index = 0; index < value.size(); index += 1) walk(value.get(index));
    }
  };

  walk(pdfDocument.catalog);
  for (const page of pdfDocument.getPages()) walk(page.node);
}

'''
core = replace_once(core, 'function collectPdfAttachmentSpecs(pdfDocument, PDFLib, records = null) {', walk_helper + 'function collectPdfAttachmentSpecs(pdfDocument, PDFLib, records = null) {', 'graph walker')

old_collect_tail = r'''  collectAssociated(pdfDocument.catalog);
  for (const page of pdfDocument.getPages()) {
    collectAssociated(page.node);
    const annots = page.node.lookup(PDFLib.PDFName.of("Annots"));
    if (!(annots instanceof PDFLib.PDFArray)) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      let annotation;
      try { annotation = annots.lookup(index, PDFLib.PDFDict); } catch { continue; }
      collectAssociated(annotation);
      const fsKey = PDFLib.PDFName.of("FS");
      if (!annotation.has(fsKey)) continue;
      let rawSpec;
      let fileSpec;
      try {
        rawSpec = annotation.get(fsKey);
        fileSpec = annotation.lookup(fsKey, PDFLib.PDFDict);
      } catch {
        continue;
      }
      addSpec(rawSpec, fileSpec);
    }
  }
  return results;
}'''
new_collect_tail = r'''  walkPdfObjectGraph(pdfDocument, PDFLib, (dict) => {
    collectAssociated(dict);
    let subtype = "";
    try { subtype = pdfNameOrText(dict.lookup(PDFLib.PDFName.of("Subtype")), PDFLib); } catch {}
    const fsKey = PDFLib.PDFName.of("FS");
    if (subtype !== "FileAttachment" || !dict.has(fsKey)) return;
    let rawSpec;
    let fileSpec;
    try {
      rawSpec = dict.get(fsKey);
      fileSpec = dict.lookup(fsKey, PDFLib.PDFDict);
    } catch {
      return;
    }
    addSpec(rawSpec, fileSpec);
  });
  return results;
}'''
core = replace_once(core, old_collect_tail, new_collect_tail, 'generic attachment roots')

core = replace_once(core,
'''export async function readPdfAttachments(pdfBytes, PDFLib = globalThis.PDFLib) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");
  const pdfDocument = await PDFLib.PDFDocument.load(pdfBytes, { updateMetadata: false });
  return collectPdfAttachmentSpecs(pdfDocument, PDFLib);
}
''',
'''export async function readPdfAttachments(pdfBytes, PDFLib = globalThis.PDFLib) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");
  const sourcePdfBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDocument = await PDFLib.PDFDocument.load(sourcePdfBytes, { updateMetadata: false });
  return collectPdfAttachmentSpecs(pdfDocument, PDFLib).map((attachment, sourceSpecIndex) => ({
    ...attachment,
    sourcePdfBytes,
    sourceSpecIndex,
  }));
}
''', 'read provenance')

assign_start = 'function assignAttachmentTargets(records, attachments) {'
detach_start = 'function detachAssociatedFileLocations(pdfDocument, records, PDFLib) {'
assign_new = r'''function assignAttachmentTargets(records, attachments) {
  const used = new Set();
  const findMatch = (record, requireName) => {
    for (let index = 0; index < attachments.length; index += 1) {
      if (used.has(index)) continue;
      const candidate = attachments[index];
      if (requireName && candidate.name !== record.attachment.name) continue;
      if (attachmentPayloadMatches(record.attachment, candidate)) return index;
    }
    return -1;
  };

  for (const record of records) {
    let index = findMatch(record, true);
    if (index < 0) index = findMatch(record, false);
    record.targetName = index < 0 ? null : attachments[index].name;
    if (index >= 0) used.add(index);
  }
  return used;
}

'''
core = replace_between(core, assign_start, detach_start, assign_new, 'assign targets')

delete_start = 'function deleteOldAttachmentObjects(pdfDocument, records, PDFLib) {'
detach_new = r'''function detachAssociatedFileLocations(pdfDocument, records, PDFLib) {
  const locations = [];
  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");

  const recordFor = (rawSpec, fileSpec) => {
    const record = attachmentRecordFor(rawSpec, fileSpec, records, PDFLib);
    if (!record) {
      throw new Error("Could not preserve an associated-file reference safely.");
    }
    return record;
  };

  walkPdfObjectGraph(pdfDocument, PDFLib, (dict) => {
    if (dict.has(afKey)) {
      const recordList = [];
      const associated = dict.lookup(afKey);
      if (!(associated instanceof PDFLib.PDFArray)) {
        throw new Error("Could not preserve a malformed associated-file array safely.");
      }
      for (let index = 0; index < associated.size(); index += 1) {
        let rawSpec;
        let fileSpec;
        try {
          rawSpec = associated.get(index);
          fileSpec = associated.lookup(index, PDFLib.PDFDict);
        } catch (error) {
          throw new Error("Could not preserve an associated-file reference safely.", { cause: error });
        }
        recordList.push(recordFor(rawSpec, fileSpec));
      }
      locations.push({ kind: "AF", dict, records: recordList, isCatalog: dict === pdfDocument.catalog });
      dict.delete(afKey);
    }

    let subtype = "";
    try { subtype = pdfNameOrText(dict.lookup(PDFLib.PDFName.of("Subtype")), PDFLib); } catch {}
    if (subtype !== "FileAttachment" || !dict.has(fsKey)) return;
    let rawSpec;
    let fileSpec;
    try {
      rawSpec = dict.get(fsKey);
      fileSpec = dict.lookup(fsKey, PDFLib.PDFDict);
    } catch (error) {
      throw new Error("Could not preserve a FileAttachment /FS reference safely.", { cause: error });
    }
    locations.push({ kind: "FS", dict, records: [recordFor(rawSpec, fileSpec)], isCatalog: false });
    dict.delete(fsKey);
  });
  return locations;
}

'''
core = replace_between(core, detach_start, delete_start, detach_new, 'detach associations')

core = replace_once(core,
'''      if (ef instanceof PDFLib.PDFDict) {
        deleteRef(ef.get(PDFLib.PDFName.of("UF")));
        deleteRef(ef.get(PDFLib.PDFName.of("F")));
      }''',
'''      if (ef instanceof PDFLib.PDFDict) {
        for (const key of ef.keys()) deleteRef(ef.get(key));
      }''', 'delete all EF streams')

restore_start = 'function restoreAssociatedFileLocations(pdfDocument, locations, PDFLib) {'
options_start = 'function attachmentOptions(attachment) {'
restore_new = r'''function restoreAssociatedFileLocations(pdfDocument, locations, newAttachmentNames, PDFLib) {
  const rawAttachments = pdfDocument.getRawAttachments?.() || [];
  const byName = new Map(rawAttachments.map(({ fileName, specRef }) => [pdfText(fileName, PDFLib), specRef]));
  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");
  pdfDocument.catalog.delete(afKey);

  let catalogLocation = null;
  for (const location of locations) {
    if (location.isCatalog) catalogLocation = location;
    const refs = location.records
      .map((record) => record.targetName ? byName.get(record.targetName) : null)
      .filter(Boolean);
    if (location.kind === "AF" && refs.length) {
      location.dict.set(afKey, pdfDocument.context.obj(refs));
    } else if (location.kind === "FS" && refs[0]) {
      location.dict.set(fsKey, refs[0]);
    }
  }

  const newRefs = newAttachmentNames.map((name) => byName.get(name)).filter(Boolean);
  if (!newRefs.length) return;
  if (catalogLocation) {
    const current = pdfDocument.catalog.lookup(afKey);
    const refs = [];
    if (current instanceof PDFLib.PDFArray) {
      for (let index = 0; index < current.size(); index += 1) refs.push(current.get(index));
    }
    refs.push(...newRefs);
    pdfDocument.catalog.set(afKey, pdfDocument.context.obj(refs));
  } else {
    pdfDocument.catalog.set(afKey, pdfDocument.context.obj(newRefs));
  }
}

async function restoreSourceFileSpecs(pdfDocument, attachments, PDFLib) {
  if (!attachments.some((attachment) => attachment.sourcePdfBytes && Number.isInteger(attachment.sourceSpecIndex))) return;
  if (!PDFLib.PDFObjectCopier?.for) {
    throw new Error("PDF object copier is unavailable; refusing to rewrite source attachment FileSpecs.");
  }

  const targets = new Map(
    (pdfDocument.getRawAttachments?.() || []).map(({ fileName, fileSpec }) => [pdfText(fileName, PDFLib), fileSpec]),
  );
  const loaded = new Map();
  for (const attachment of attachments) {
    if (!attachment.sourcePdfBytes || !Number.isInteger(attachment.sourceSpecIndex)) continue;
    let source = loaded.get(attachment.sourcePdfBytes);
    if (!source) {
      const document = await PDFLib.PDFDocument.load(attachment.sourcePdfBytes, { updateMetadata: false });
      const records = [];
      collectPdfAttachmentSpecs(document, PDFLib, records);
      source = { document, records, copier: PDFLib.PDFObjectCopier.for(document.context, pdfDocument.context) };
      loaded.set(attachment.sourcePdfBytes, source);
    }
    const record = source.records[attachment.sourceSpecIndex];
    const target = targets.get(attachment.name);
    if (!record || !target) {
      throw new Error(`Could not restore source FileSpec for ${attachment.name}.`);
    }
    for (const key of record.fileSpec.keys()) {
      const name = key.toString();
      if (name === "/F" || name === "/UF" || name === "/Type") continue;
      target.set(key, source.copier.copy(record.fileSpec.get(key)));
    }
  }
}

'''
core = replace_between(core, restore_start, options_start, restore_new, 'restore associations and FileSpecs')

core = replace_once(core,
'''    const document = await PDFLib.PDFDocument.load(data, { updateMetadata: false });
    return supportedPdfaConformance(readCatalogMetadataXml(document, PDFLib), PDFLib) || null;''',
'''    const document = await PDFLib.PDFDocument.load(data, { updateMetadata: false });
    return attachmentPdfaConformance(readCatalogMetadataXml(document, PDFLib), PDFLib);''', 'embedded pdfa detection')

core = replace_once(core,
'''  const part = Number(conformance?.part);
  if (part === 1 && attachments.length) {''',
'''  if (conformance?.unsupported) {
    throw new Error("This PDF/A declaration cannot be validated safely for embedded files.");
  }
  const part = Number(conformance?.part);
  if (part === 1 && attachments.length) {''', 'unsupported pdfa guard')

core = replace_once(core,
'''    const key = attachment.name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate attachment name: ${attachment.name}`);
    names.add(key);''',
'''    const key = attachment.name;
    if (names.has(key)) throw new Error(`Duplicate attachment name: ${attachment.name}`);
    names.add(key);''', 'case-sensitive export names')

core = replace_once(core,
'''  const conformance = supportedPdfaConformance(readCatalogMetadataXml(pdfDocument, PDFLib), PDFLib);
  await validatePdfaAttachmentSet(conformance, normalized, PDFLib);
  const oldRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, oldRecords);
  assignAttachmentTargets(oldRecords, normalized);
  const associatedLocations = clearPdfAttachmentRoots(pdfDocument, oldRecords, PDFLib);''',
'''  const conformance = attachmentPdfaConformance(readCatalogMetadataXml(pdfDocument, PDFLib), PDFLib);
  await validatePdfaAttachmentSet(conformance, normalized, PDFLib);
  const oldRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, oldRecords);
  const matchedTargets = assignAttachmentTargets(oldRecords, normalized);
  const newAttachmentNames = normalized
    .filter((_, index) => !matchedTargets.has(index))
    .map((attachment) => attachment.name);
  const associatedLocations = clearPdfAttachmentRoots(pdfDocument, oldRecords, PDFLib);''', 'replace prelude')

core = replace_once(core,
'''  await pdfDocument.flush();
  restoreFormDataRelationships(pdfDocument, normalized, PDFLib);
  restoreAttachmentChecksums(pdfDocument, normalized, PDFLib);
  restoreAssociatedFileLocations(pdfDocument, associatedLocations, PDFLib);''',
'''  await pdfDocument.flush();
  await restoreSourceFileSpecs(pdfDocument, normalized, PDFLib);
  restoreFormDataRelationships(pdfDocument, normalized, PDFLib);
  restoreAttachmentChecksums(pdfDocument, normalized, PDFLib);
  restoreAssociatedFileLocations(pdfDocument, associatedLocations, newAttachmentNames, PDFLib);''', 'replace restore order')

# Add focused regressions before the oversized-tree test.
marker = 'const oversizedTreeDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });'
if marker not in tests:
    raise SystemExit('missing test marker')
extra_tests = r'''
const caseDistinctBase = await onePagePdf();
const caseDistinctBytes = await replacePdfAttachments(caseDistinctBase, [
  { name: "A.txt", data: new Uint8Array([31]), mimeType: "text/plain" },
  { name: "a.txt", data: new Uint8Array([32]), mimeType: "text/plain" },
], PDFLib);
assert.deepEqual((await readPdfAttachments(caseDistinctBytes, PDFLib)).map((item) => item.name).sort(), ["A.txt", "a.txt"]);

const pdfa2aDocument = await PDFLib.PDFDocument.load(await onePagePdf({ pdfa: "2B" }), { updateMetadata: false });
const metadataKey = PDFLib.PDFName.of("Metadata");
const metadataStream = pdfa2aDocument.catalog.lookup(metadataKey, PDFLib.PDFRawStream);
const metadataXml = new TextDecoder().decode(PDFLib.decodePDFRawStream(metadataStream).decode());
const levelAXml = metadataXml.replace(/(<[^:>]+:conformance\b[^>]*>\s*)B(\s*<\/[^:>]+:conformance\s*>)/i, "$1A$2");
assert.notEqual(levelAXml, metadataXml, "PDF/A fixture should expose a conformance element");
const levelAStream = pdfa2aDocument.context.stream(new TextEncoder().encode(levelAXml), { Type: "Metadata", Subtype: "XML" });
pdfa2aDocument.catalog.set(metadataKey, pdfa2aDocument.context.register(levelAStream));
const pdfa2aBytes = await pdfa2aDocument.save({ updateFieldAppearances: false });
await assert.rejects(
  () => replacePdfAttachments(pdfa2aBytes, [{ name: "payload.txt", data: new Uint8Array([1]), mimeType: "text/plain" }], PDFLib),
  /PDF\/A-2 permits only PDF\/A-1 or PDF\/A-2 attachments/,
);

const richBase = await replacePdfAttachments(await onePagePdf(), [
  { name: "rich.bin", data: new Uint8Array([40, 41]), mimeType: "application/octet-stream" },
  { name: "plain.bin", data: new Uint8Array([50]), mimeType: "application/octet-stream" },
], PDFLib);
const richDocument = await PDFLib.PDFDocument.load(richBase, { updateMetadata: false });
const richRaw = richDocument.getRawAttachments();
const richSpec = richRaw[0].fileSpec;
const richEf = richSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const originalUf = richEf.get(PDFLib.PDFName.of("UF"));
const alternateStream = richDocument.context.flateStream(new Uint8Array([90, 91, 92]), { Type: "EmbeddedFile" });
richEf.set(PDFLib.PDFName.of("F"), richDocument.context.register(alternateStream));
richEf.set(PDFLib.PDFName.of("UF"), originalUf);
richSpec.set(PDFLib.PDFName.of("CI"), richDocument.context.obj({ Department: PDFLib.PDFHexString.fromText("Legal"), Rank: 7 }));
richDocument.catalog.set(PDFLib.PDFName.of("AF"), richDocument.context.obj([richRaw[0].specRef]));
const structElem = richDocument.context.obj({ Type: "StructElem", S: "P", AF: [richRaw[0].specRef] });
richDocument.catalog.set(PDFLib.PDFName.of("StructTreeRoot"), richDocument.context.obj({ Type: "StructTreeRoot", K: [structElem] }));
const richSourceBytes = await richDocument.save({ updateFieldAppearances: false });
const richAttachments = await readPdfAttachments(richSourceBytes, PDFLib);
const richRoundTrip = await replacePdfAttachments(richSourceBytes, richAttachments, PDFLib);
const richOutput = await PDFLib.PDFDocument.load(richRoundTrip, { updateMetadata: false });
const richOutputRaw = richOutput.getRawAttachments();
const richOutputSpec = richOutputRaw.find(({ fileName }) => fileName.decodeText() === "rich.bin").fileSpec;
const outputEf = richOutputSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
assert.equal(outputEf.has(PDFLib.PDFName.of("F")), true);
assert.equal(outputEf.has(PDFLib.PDFName.of("UF")), true);
assert.deepEqual([...PDFLib.decodePDFRawStream(outputEf.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFRawStream)).decode()], [90, 91, 92]);
assert.deepEqual([...PDFLib.decodePDFRawStream(outputEf.lookup(PDFLib.PDFName.of("UF"), PDFLib.PDFRawStream)).decode()], [40, 41]);
const outputCi = richOutputSpec.lookup(PDFLib.PDFName.of("CI"), PDFLib.PDFDict);
assert.equal(outputCi.lookup(PDFLib.PDFName.of("Department")).decodeText(), "Legal");
assert.equal(outputCi.lookup(PDFLib.PDFName.of("Rank"), PDFLib.PDFNumber).asNumber(), 7);
const outputCatalogAf = richOutput.catalog.lookup(PDFLib.PDFName.of("AF"), PDFLib.PDFArray);
assert.equal(outputCatalogAf.size(), 1, "catalog /AF subset should stay a subset");
const outputStruct = richOutput.catalog.lookup(PDFLib.PDFName.of("StructTreeRoot"), PDFLib.PDFDict);
const outputStructKids = outputStruct.lookup(PDFLib.PDFName.of("K"), PDFLib.PDFArray);
const outputStructElem = outputStructKids.lookup(0, PDFLib.PDFDict);
const outputStructAf = outputStructElem.lookup(PDFLib.PDFName.of("AF"), PDFLib.PDFArray);
assert.equal(outputStructAf.size(), 1, "structure-element /AF should be rebound");

'''
tests = tests.replace(marker, extra_tests + marker, 1)

core_path.write_text(core, encoding="utf-8", newline="\n")
test_path.write_text(tests, encoding="utf-8", newline="\n")
print("attachment round-trip hardening applied")
