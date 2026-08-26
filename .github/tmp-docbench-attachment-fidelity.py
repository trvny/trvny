from pathlib import Path

root = Path.cwd() / "docbench"

def replace(path, old, new, count=1):
    p = root / path
    s = p.read_text(encoding="utf-8")
    if old not in s:
        raise SystemExit(f"pattern missing in {path}: {old[:100]!r}")
    p.write_text(s.replace(old, new, count), encoding="utf-8", newline="\n")

replace("public/pdf-core.mjs", '''function pdfNameOrText(value, PDFLib) {
  if (value instanceof PDFLib.PDFName) return value.toString().slice(1);
  return pdfText(value, PDFLib);
}

export function normalizePdfAttachment(attachment = {}) {''', '''function pdfNameOrText(value, PDFLib) {
  if (value instanceof PDFLib.PDFName) return value.toString().slice(1);
  return pdfText(value, PDFLib);
}

function pdfRawBytes(value, PDFLib) {
  if (value instanceof PDFLib.PDFHexString || value instanceof PDFLib.PDFString) {
    try {
      const bytes = value.asBytes?.();
      if (bytes instanceof Uint8Array) return bytes.slice();
    } catch {}
  }
  return new Uint8Array();
}

function normalizeAttachmentChecksum(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value.slice();
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value);
}

export function normalizePdfAttachment(attachment = {}) {''')

replace("public/pdf-core.mjs", '''    description: String(attachment.description || ""),
    creationDate: normalizeAttachmentDate(attachment.creationDate),
    modificationDate: normalizeAttachmentDate(attachment.modificationDate),
  };''', '''    description: String(attachment.description || ""),
    creationDate: normalizeAttachmentDate(attachment.creationDate),
    modificationDate: normalizeAttachmentDate(attachment.modificationDate),
    checksum: normalizeAttachmentChecksum(attachment.checksum),
  };''', 1)

replace("public/pdf-core.mjs", '''  const modificationDate = params instanceof PDFLib.PDFDict
    ? pdfDate(params.lookup(PDFLib.PDFName.of("ModDate")), PDFLib)
    : "";
  const relationship = pdfNameOrText(''', '''  const modificationDate = params instanceof PDFLib.PDFDict
    ? pdfDate(params.lookup(PDFLib.PDFName.of("ModDate")), PDFLib)
    : "";
  const checksum = params instanceof PDFLib.PDFDict
    ? pdfRawBytes(params.lookup(PDFLib.PDFName.of("CheckSum")), PDFLib)
    : new Uint8Array();
  const relationship = pdfNameOrText(''')

replace("public/pdf-core.mjs", '''    creationDate,
    modificationDate,
  });
}''', '''    creationDate,
    modificationDate,
    checksum,
  });
}''', 1)

replace("public/pdf-core.mjs", '''  const description = pdfText(fileSpec.lookup(PDFLib.PDFName.of("Desc")), PDFLib);
  return normalizePdfAttachment({
    name: treeName || specName || "attachment",
    data: PDFLib.decodePDFRawStream(stream).decode(),''', '''  const description = pdfText(fileSpec.lookup(PDFLib.PDFName.of("Desc")), PDFLib);
  const attachmentName = treeName || specName || "attachment";
  let data;
  try {
    data = PDFLib.decodePDFRawStream(stream).decode();
  } catch (error) {
    throw new Error(
      `Could not decode PDF attachment ${attachmentName}; refusing to rewrite attachments.`,
      { cause: error },
    );
  }
  return normalizePdfAttachment({
    name: attachmentName,
    data,''')

replace("public/pdf-core.mjs", '''    for (let index = 0; index < associated.size(); index += 1) {
      try {
        const rawSpec = associated.get(index);
        const fileSpec = associated.lookup(index, PDFLib.PDFDict);
        addSpec(rawSpec, fileSpec);
      } catch {}
    }''', '''    for (let index = 0; index < associated.size(); index += 1) {
      let rawSpec;
      let fileSpec;
      try {
        rawSpec = associated.get(index);
        fileSpec = associated.lookup(index, PDFLib.PDFDict);
      } catch {
        continue;
      }
      addSpec(rawSpec, fileSpec);
    }''')

replace("public/pdf-core.mjs", '''        for (let index = 0; index + 1 < names.size(); index += 2) {
          try {
            const name = pdfText(names.lookup(index), PDFLib);
            const rawSpec = names.get(index + 1);
            const fileSpec = names.lookup(index + 1, PDFLib.PDFDict);
            addSpec(rawSpec, fileSpec, name);
          } catch {}
        }''', '''        for (let index = 0; index + 1 < names.size(); index += 2) {
          let name;
          let rawSpec;
          let fileSpec;
          try {
            name = pdfText(names.lookup(index), PDFLib);
            rawSpec = names.get(index + 1);
            fileSpec = names.lookup(index + 1, PDFLib.PDFDict);
          } catch {
            continue;
          }
          addSpec(rawSpec, fileSpec, name);
        }''')

replace("public/pdf-core.mjs", '''    for (let index = 0; index < annots.size(); index += 1) {
      try { collectAssociated(annots.lookup(index, PDFLib.PDFDict)); } catch {}
    }''', '''    for (let index = 0; index < annots.size(); index += 1) {
      let annotation;
      try { annotation = annots.lookup(index, PDFLib.PDFDict); } catch { continue; }
      collectAssociated(annotation);
    }''', 1)

replace("public/pdf-core.mjs", '''function restoreFormDataRelationships(pdfDocument, attachments, PDFLib) {
  const formDataNames = new Set(''', '''function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function restoreAttachmentChecksums(pdfDocument, attachments, PDFLib) {
  const checksums = new Map(
    attachments
      .filter((attachment) => attachment.checksum?.byteLength)
      .map((attachment) => [attachment.name, attachment.checksum]),
  );
  if (!checksums.size) return;

  for (const { fileName, fileSpec } of pdfDocument.getRawAttachments?.() || []) {
    const checksum = checksums.get(pdfText(fileName, PDFLib));
    if (!checksum) continue;
    const ef = fileSpec.lookup(PDFLib.PDFName.of("EF"));
    if (!(ef instanceof PDFLib.PDFDict)) continue;
    const stream = ef.has(PDFLib.PDFName.of("UF"))
      ? ef.lookup(PDFLib.PDFName.of("UF"))
      : ef.lookup(PDFLib.PDFName.of("F"));
    if (!(stream instanceof PDFLib.PDFStream)) continue;
    const paramsKey = PDFLib.PDFName.of("Params");
    let params = stream.dict.lookup(paramsKey);
    if (!(params instanceof PDFLib.PDFDict)) {
      params = pdfDocument.context.obj({});
      stream.dict.set(paramsKey, params);
    }
    params.set(
      PDFLib.PDFName.of("CheckSum"),
      PDFLib.PDFHexString.of(bytesToHex(checksum)),
    );
  }
}

function restoreFormDataRelationships(pdfDocument, attachments, PDFLib) {
  const formDataNames = new Set(''')

replace("public/pdf-core.mjs", '''  await pdfDocument.flush();
  restoreFormDataRelationships(pdfDocument, normalized, PDFLib);
  restoreAssociatedFileLocations(pdfDocument, associatedLocations, PDFLib);''', '''  await pdfDocument.flush();
  restoreFormDataRelationships(pdfDocument, normalized, PDFLib);
  restoreAttachmentChecksums(pdfDocument, normalized, PDFLib);
  restoreAssociatedFileLocations(pdfDocument, associatedLocations, PDFLib);''')

replace("public/pdf-core.mjs", '''    creationDate: attachment.creationDate,
    modificationDate: attachment.modificationDate,
  };''', '''    creationDate: attachment.creationDate,
    modificationDate: attachment.modificationDate,
    checksum: [...(attachment.checksum || [])],
  };''', 1)

replace("public/pdf-core.mjs", '''export function mergePdfAttachmentSets(existing = [], incoming = []) {
  const merged = [];
  const used = new Set();
  for (const raw of [...existing, ...incoming]) {
    const attachment = normalizePdfAttachment(raw);
    attachment.name = uniqueAttachmentName(attachment.name, used);
    used.add(attachment.name.toLowerCase());
    merged.push(attachment);
  }
  return merged;
}''', '''export function mergePdfAttachmentSets(existing = [], incoming = []) {
  const merged = existing.map(normalizePdfAttachment);
  const used = new Set(merged.map((attachment) => attachment.name.toLowerCase()));
  for (const raw of incoming) {
    const attachment = normalizePdfAttachment(raw);
    attachment.name = uniqueAttachmentName(attachment.name, used);
    used.add(attachment.name.toLowerCase());
    merged.push(attachment);
  }
  return merged;
}

export function mergePdfAttachmentSourceSets(sourceSets = [], existing = null) {
  let merged = existing == null ? null : existing.map(normalizePdfAttachment);
  for (const sourceSet of sourceSets) {
    const normalized = (sourceSet || []).map(normalizePdfAttachment);
    if (merged == null) {
      merged = normalized;
    } else {
      merged = mergePdfAttachmentSets(merged, normalized);
    }
  }
  return merged || [];
}''')

replace("public/pdf-app.mjs", '''  mergePdfAttachmentSets,
  readPdfAttachments,''', '''  mergePdfAttachmentSourceSets,
  readPdfAttachments,''')
replace("public/pdf-app.mjs", '''const incomingAttachments = newSources.flatMap((source) => source.attachments || []);
state.attachments = append && oldSourceCount
  ? mergePdfAttachmentSets(state.attachments, incomingAttachments)
  : mergePdfAttachmentSets([], incomingAttachments);''', '''  state.attachments = mergePdfAttachmentSourceSets(
    newSources.map((source) => source.attachments || []),
    append && oldSourceCount ? state.attachments : null,
  );''')

replace("tests/pdf-attachment-review.test.mjs", '''  mergePdfAttachmentSets,
  normalizePdfAttachment,''', '''  mergePdfAttachmentSets,
  mergePdfAttachmentSourceSets,
  normalizePdfAttachment,''')

test_insert = r'''const caseDistinctSources = mergePdfAttachmentSourceSets([
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

'''
replace("tests/pdf-attachment-review.test.mjs", '''const associatedDocument = await PDFLib.PDFDocument.load(formBytes, { updateMetadata: false });''', test_insert + '''const associatedDocument = await PDFLib.PDFDocument.load(formBytes, { updateMetadata: false });''')

print("attachment final fidelity patch applied")
