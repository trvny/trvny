from pathlib import Path

root = Path.cwd() / "docbench"

def replace(path, old, new, count=1):
    p = root / path
    s = p.read_text(encoding="utf-8")
    if old not in s:
        raise SystemExit(f"pattern missing in {path}: {old[:120]!r}")
    p.write_text(s.replace(old, new, count), encoding="utf-8", newline="\n")

# FileAttachment annotations use /FS, not /AF. Scan both.
replace("public/pdf-core.mjs", '''    for (let index = 0; index < annots.size(); index += 1) {
      let annotation;
      try { annotation = annots.lookup(index, PDFLib.PDFDict); } catch { continue; }
      collectAssociated(annotation);
    }
  }
  return results;
}''', '''    for (let index = 0; index < annots.size(); index += 1) {
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
}''')

old_block = '''function attachmentRecordName(rawSpec, fileSpec, records, PDFLib) {
  const refKey = rawSpec instanceof PDFLib.PDFRef ? rawSpec.toString() : "";
  for (const record of records) {
    const recordRef = record.rawSpec instanceof PDFLib.PDFRef ? record.rawSpec.toString() : "";
    if ((refKey && recordRef === refKey) || (!refKey && record.fileSpec === fileSpec)) {
      return record.attachment.name;
    }
  }
  const specName = fileSpec.has(PDFLib.PDFName.of("UF"))
    ? pdfText(fileSpec.lookup(PDFLib.PDFName.of("UF")), PDFLib)
    : pdfText(fileSpec.lookup(PDFLib.PDFName.of("F")), PDFLib);
  return specName || "";
}

function detachAssociatedFileLocations(pdfDocument, records, PDFLib) {
  const locations = [];
  const afKey = PDFLib.PDFName.of("AF");
  const detach = (dict) => {
    if (!(dict instanceof PDFLib.PDFDict) || !dict.has(afKey)) return;
    const names = [];
    const associated = dict.lookup(afKey);
    if (associated instanceof PDFLib.PDFArray) {
      for (let index = 0; index < associated.size(); index += 1) {
        try {
          const rawSpec = associated.get(index);
          const fileSpec = associated.lookup(index, PDFLib.PDFDict);
          const name = attachmentRecordName(rawSpec, fileSpec, records, PDFLib);
          if (name) names.push(name);
        } catch {}
      }
    }
    dict.delete(afKey);
    if (names.length) locations.push({ dict, names });
  };

  for (const page of pdfDocument.getPages()) {
    detach(page.node);
    const annots = page.node.lookup(PDFLib.PDFName.of("Annots"));
    if (!(annots instanceof PDFLib.PDFArray)) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      try { detach(annots.lookup(index, PDFLib.PDFDict)); } catch {}
    }
  }
  return locations;
}
'''
new_block = '''function attachmentRecordFor(rawSpec, fileSpec, records, PDFLib) {
  const refKey = rawSpec instanceof PDFLib.PDFRef ? rawSpec.toString() : "";
  for (const record of records) {
    const recordRef = record.rawSpec instanceof PDFLib.PDFRef ? record.rawSpec.toString() : "";
    if ((refKey && recordRef === refKey) || (!refKey && record.fileSpec === fileSpec)) {
      return record;
    }
  }
  return null;
}

function attachmentPayloadMatches(left, right) {
  return left.mimeType === right.mimeType
    && left.afRelationship === right.afRelationship
    && left.description === right.description
    && left.creationDate === right.creationDate
    && left.modificationDate === right.modificationDate
    && sameBytes(left.checksum || new Uint8Array(), right.checksum || new Uint8Array())
    && sameBytes(left.data, right.data);
}

function assignAttachmentTargets(records, attachments) {
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
}

function detachAssociatedFileLocations(pdfDocument, records, PDFLib) {
  const locations = [];
  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");

  const detachAf = (dict) => {
    if (!(dict instanceof PDFLib.PDFDict) || !dict.has(afKey)) return;
    const recordList = [];
    const associated = dict.lookup(afKey);
    if (associated instanceof PDFLib.PDFArray) {
      for (let index = 0; index < associated.size(); index += 1) {
        let rawSpec;
        let fileSpec;
        try {
          rawSpec = associated.get(index);
          fileSpec = associated.lookup(index, PDFLib.PDFDict);
        } catch {
          continue;
        }
        const record = attachmentRecordFor(rawSpec, fileSpec, records, PDFLib);
        if (record) recordList.push(record);
      }
    }
    dict.delete(afKey);
    if (recordList.length) locations.push({ kind: "AF", dict, records: recordList });
  };

  const detachFs = (dict) => {
    if (!(dict instanceof PDFLib.PDFDict) || !dict.has(fsKey)) return;
    let rawSpec;
    let fileSpec;
    try {
      rawSpec = dict.get(fsKey);
      fileSpec = dict.lookup(fsKey, PDFLib.PDFDict);
    } catch {
      return;
    }
    const record = attachmentRecordFor(rawSpec, fileSpec, records, PDFLib);
    dict.delete(fsKey);
    if (record) locations.push({ kind: "FS", dict, records: [record] });
  };

  for (const page of pdfDocument.getPages()) {
    detachAf(page.node);
    const annots = page.node.lookup(PDFLib.PDFName.of("Annots"));
    if (!(annots instanceof PDFLib.PDFArray)) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      let annotation;
      try { annotation = annots.lookup(index, PDFLib.PDFDict); } catch { continue; }
      detachAf(annotation);
      detachFs(annotation);
    }
  }
  return locations;
}
'''
replace("public/pdf-core.mjs", old_block, new_block)

replace("public/pdf-core.mjs", '''function restoreAssociatedFileLocations(pdfDocument, locations, PDFLib) {
  if (!locations.length) return;
  const byName = new Map();
  for (const { fileName, specRef } of pdfDocument.getRawAttachments?.() || []) {
    byName.set(pdfText(fileName, PDFLib), specRef);
  }
  const afKey = PDFLib.PDFName.of("AF");
  for (const { dict, names } of locations) {
    const refs = names.map((name) => byName.get(name)).filter(Boolean);
    if (refs.length) dict.set(afKey, pdfDocument.context.obj(refs));
  }
}''', '''function restoreAssociatedFileLocations(pdfDocument, locations, PDFLib) {
  if (!locations.length) return;
  const byName = new Map();
  for (const { fileName, specRef } of pdfDocument.getRawAttachments?.() || []) {
    byName.set(pdfText(fileName, PDFLib), specRef);
  }
  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");
  for (const { kind, dict, records } of locations) {
    const refs = records
      .map((record) => record.targetName ? byName.get(record.targetName) : null)
      .filter(Boolean);
    if (kind === "AF" && refs.length) {
      dict.set(afKey, pdfDocument.context.obj(refs));
    } else if (kind === "FS" && refs[0]) {
      dict.set(fsKey, refs[0]);
    }
  }
}''')

replace("public/pdf-core.mjs", '''  const oldRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, oldRecords);
  const associatedLocations = clearPdfAttachmentRoots(pdfDocument, oldRecords, PDFLib);''', '''  const oldRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, oldRecords);
  assignAttachmentTargets(oldRecords, normalized);
  const associatedLocations = clearPdfAttachmentRoots(pdfDocument, oldRecords, PDFLib);''')

# Expand the existing association regression to cover /FS and retained rebinding.
replace("tests/pdf-attachment-review.test.mjs", '''const annotation = associatedDocument.context.obj({
  Type: "Annot",
  Subtype: "Text",
  Rect: [0, 0, 10, 10],
  AF: [oldSpecRef],
});''', '''const annotation = associatedDocument.context.obj({
  Type: "Annot",
  Subtype: "FileAttachment",
  Rect: [0, 0, 10, 10],
  AF: [oldSpecRef],
  FS: oldSpecRef,
});''')

replace("tests/pdf-attachment-review.test.mjs", '''const associatedBytes = await associatedDocument.save({ updateFieldAppearances: false });
assert.equal((await readPdfAttachments(associatedBytes, PDFLib)).length, 1);
const removedAssociatedBytes = await replacePdfAttachments(associatedBytes, [], PDFLib);''', '''const associatedBytes = await associatedDocument.save({ updateFieldAppearances: false });
const associatedAttachments = await readPdfAttachments(associatedBytes, PDFLib);
assert.equal(associatedAttachments.length, 1);
const retainedAssociatedBytes = await replacePdfAttachments(associatedBytes, associatedAttachments, PDFLib);
const retainedAssociatedDocument = await PDFLib.PDFDocument.load(retainedAssociatedBytes, { updateMetadata: false });
const retainedPage = retainedAssociatedDocument.getPage(0);
const retainedAnnots = retainedPage.node.lookup(PDFLib.PDFName.of("Annots"), PDFLib.PDFArray);
const retainedAnnotation = retainedAnnots.lookup(0, PDFLib.PDFDict);
assert.equal(retainedAnnotation.has(PDFLib.PDFName.of("FS")), true);
assert.equal(retainedAnnotation.has(PDFLib.PDFName.of("AF")), true);

const fsOnlyDocument = await PDFLib.PDFDocument.load(associatedBytes, { updateMetadata: false });
const fsOnlyNames = fsOnlyDocument.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);
fsOnlyNames.delete(PDFLib.PDFName.of("EmbeddedFiles"));
fsOnlyDocument.catalog.delete(PDFLib.PDFName.of("AF"));
const fsOnlyBytes = await fsOnlyDocument.save({ updateFieldAppearances: false });
assert.equal((await readPdfAttachments(fsOnlyBytes, PDFLib)).length, 1, "FS-only attachment should be read");

const removedAssociatedBytes = await replacePdfAttachments(associatedBytes, [], PDFLib);''')

replace("tests/pdf-attachment-review.test.mjs", '''assert.equal(removedAnnotation.has(PDFLib.PDFName.of("AF")), false);
assert.equal(removedAssociatedDocument.context.lookup(oldSpecRef), undefined);''', '''assert.equal(removedAnnotation.has(PDFLib.PDFName.of("AF")), false);
assert.equal(removedAnnotation.has(PDFLib.PDFName.of("FS")), false);
assert.equal(removedAssociatedDocument.context.lookup(oldSpecRef), undefined);''')

collision_test = r'''
const collisionBase = await PDFLib.PDFDocument.create({ updateMetadata: false });
collisionBase.addPage([100, 100]);
collisionBase.addPage([100, 100]);
let collisionBytes = await collisionBase.save();
collisionBytes = await replacePdfAttachments(collisionBytes, [
  { name: "dup.txt", data: new Uint8Array([21]), mimeType: "text/plain" },
  { name: "other.txt", data: new Uint8Array([22]), mimeType: "text/plain" },
], PDFLib);
const collisionDocument = await PDFLib.PDFDocument.load(collisionBytes, { updateMetadata: false });
const collisionRaw = collisionDocument.getRawAttachments();
const collisionNames = collisionDocument.catalog
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
for (let index = 0; index < 2; index += 1) {
  collisionNames.set(index * 2, PDFLib.PDFHexString.fromText("dup.txt"));
  collisionRaw[index].fileSpec.set(PDFLib.PDFName.of("F"), PDFLib.PDFString.of("dup.txt"));
  collisionRaw[index].fileSpec.set(PDFLib.PDFName.of("UF"), PDFLib.PDFHexString.fromText("dup.txt"));
  collisionDocument.getPage(index).node.set(
    PDFLib.PDFName.of("AF"),
    collisionDocument.context.obj([collisionRaw[index].specRef]),
  );
}
const duplicateNameBytes = await collisionDocument.save({ updateFieldAppearances: false });
const duplicateAttachments = await readPdfAttachments(duplicateNameBytes, PDFLib);
assert.deepEqual(duplicateAttachments.map((attachment) => attachment.name), ["dup.txt", "dup.txt"]);
const collisionDesired = mergePdfAttachmentSourceSets(
  duplicateAttachments.map((attachment) => [attachment]),
);
assert.deepEqual(collisionDesired.map((attachment) => attachment.name), ["dup.txt", "dup (2).txt"]);
const remappedCollisionBytes = await replacePdfAttachments(duplicateNameBytes, collisionDesired, PDFLib);
const remappedCollisionDocument = await PDFLib.PDFDocument.load(remappedCollisionBytes, { updateMetadata: false });
const pageAssociationNames = remappedCollisionDocument.getPages().map((page) => {
  const af = page.node.lookup(PDFLib.PDFName.of("AF"), PDFLib.PDFArray);
  const spec = af.lookup(0, PDFLib.PDFDict);
  return spec.lookup(PDFLib.PDFName.of("UF")).decodeText();
});
assert.deepEqual(pageAssociationNames, ["dup.txt", "dup (2).txt"]);

'''
replace("tests/pdf-attachment-review.test.mjs", '''const oversizedTreeDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });''', collision_test + '''const oversizedTreeDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });''')

print("attachment association identity patch applied")
