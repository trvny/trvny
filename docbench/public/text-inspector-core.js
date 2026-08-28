"use strict";

(() => {
const MAX_FINDINGS = 500;
const MAX_BASE64_DECODE_CHARS = 65536;
const BASE64_PREVIEW_CHARS = 8192;
const MAX_VARIATION_PREVIEW_BYTES = 512;
const MAX_TAG_PREVIEW_CHARS = 512;
const severityRank = { high: 0, medium: 1, low: 2 };

const specialCharacters = new Map([
  [0x00ad, ["medium", "Soft hyphen", "Invisible discretionary hyphen."]],
  [0x034f, ["medium", "Combining grapheme joiner", "Invisible combining control."]],
  [0x061c, ["medium", "Arabic letter mark", "Invisible bidi-affecting mark."]],
  [0x200b, ["medium", "Zero-width space", "Invisible separator often used for Unicode smuggling."]],
  [0x200c, ["low", "Zero-width non-joiner", "Can be legitimate in some writing systems; review unexpected use."]],
  [0x200d, ["low", "Zero-width joiner", "Used legitimately in scripts and emoji; review unexpected use."]],
  [0x200e, ["medium", "Left-to-right mark", "Invisible bidirectional text mark."]],
  [0x200f, ["medium", "Right-to-left mark", "Invisible bidirectional text mark."]],
  [0x202a, ["high", "Left-to-right embedding", "Bidi control can make source render in a misleading order."]],
  [0x202b, ["high", "Right-to-left embedding", "Bidi control can make source render in a misleading order."]],
  [0x202c, ["high", "Pop directional formatting", "Bidi control terminator."]],
  [0x202d, ["high", "Left-to-right override", "Bidi override can make source render in a misleading order."]],
  [0x202e, ["high", "Right-to-left override", "Bidi override can make source render in a misleading order."]],
]);

for (const [codePoint, name] of [
  [0x2060, "Word joiner"], [0x2061, "Function application"], [0x2062, "Invisible times"],
  [0x2063, "Invisible separator"], [0x2064, "Invisible plus"],
]) {
  specialCharacters.set(codePoint, ["medium", name, "Invisible formatting character."]);
}
for (const [codePoint, name] of [
  [0x2066, "Left-to-right isolate"], [0x2067, "Right-to-left isolate"],
  [0x2068, "First-strong isolate"], [0x2069, "Pop directional isolate"],
]) {
  specialCharacters.set(codePoint, ["high", name, "Bidi isolation control can conceal source ordering."]);
}
for (let codePoint = 0x206a; codePoint <= 0x206f; codePoint += 1) {
  specialCharacters.set(codePoint, ["high", "Deprecated bidi control", "Deprecated invisible directional control."]);
}
specialCharacters.set(0xfeff, ["medium", "Zero-width no-break space / BOM", "Unexpected inside document text."]);
specialCharacters.set(0xfffd, ["medium", "Replacement character", "May indicate text was decoded or copied with data loss earlier."]);

for (const codePoint of [
  0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x202f, 0x205f, 0x3000,
]) {
  specialCharacters.set(codePoint, ["low", "Unusual Unicode space", "Whitespace that can be hard to distinguish from an ordinary space."]);
}

const injectionPatterns = [
  /\b(?:ignore|disregard|forget)\b.{0,90}\b(?:previous|prior|above|system|developer)\b.{0,60}\b(?:instruction|instructions|prompt|message|messages)\b/gius,
  /\b(?:reveal|print|show|output|expose|dump)\b.{0,60}\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/gius,
  /\b(?:do not|don't)\s+(?:tell|show|inform)\s+(?:the\s+)?user\b/gius,
  /(?<!\p{L})(?:zignoruj|ignoruj|pomiń|zapomnij)(?!\p{L}).{0,90}\b(?:poprzednie|wcześniejsze|powyższe|systemowe|deweloperskie)\b.{0,60}\b(?:instrukcje|polecenia|prompt|wiadomości)\b/gius,
];

function isControl(codePoint) {
  return (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint))
    || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isNoncharacter(codePoint) {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
    || (codePoint & 0xffff) === 0xfffe
    || (codePoint & 0xffff) === 0xffff;
}

function isTagCharacter(codePoint) {
  return codePoint >= 0xe0000 && codePoint <= 0xe007f;
}

function isVariationSelector(codePoint) {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

function codePointLabel(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(codePoint <= 0xffff ? 4 : 6, "0")}`;
}

function escapedPreviewChar(char) {
  const codePoint = char.codePointAt(0);
  if (codePoint > 0x1f && codePoint !== 0x7f) return char;
  return `\\u${codePoint.toString(16).padStart(4, "0")}`;
}

function quotedPreview(value, limit = 180) {
  const compact = [...value].map(escapedPreviewChar).join("");
  const clipped = compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
  return JSON.stringify(clipped);
}

function hasVisibleText(value) {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint > 0x1f && codePoint !== 0x7f) return true;
  }
  return false;
}

function decodeBytes(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function makeLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) starts.push(index + 1);
  }
  return starts;
}

function lineIndexForOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(0, high);
}

function* segmentedGraphemeRanges(text, lineStart, lineEnd) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const part of segmenter.segment(text.slice(lineStart, lineEnd))) {
    const start = lineStart + part.index;
    yield { start, end: start + part.segment.length };
  }
}

function* codePointRanges(text, lineStart, lineEnd) {
  for (let cursor = lineStart; cursor < lineEnd;) {
    const codePoint = text.codePointAt(cursor);
    const width = codePoint > 0xffff ? 2 : 1;
    yield { start: cursor, end: cursor + width };
    cursor += width;
  }
}

function graphemeRanges(text, lineStart, lineEnd) {
  return typeof Intl?.Segmenter === "function"
    ? segmentedGraphemeRanges(text, lineStart, lineEnd)
    : codePointRanges(text, lineStart, lineEnd);
}

function columnsForOffsets(text, lineStart, lineEnd, offsets) {
  const targets = [...new Set(offsets)].sort((a, b) => a - b);
  const columns = new Map();
  let targetIndex = 0;
  let column = 1;
  for (const range of graphemeRanges(text, lineStart, lineEnd)) {
    while (targetIndex < targets.length && targets[targetIndex] < range.end) {
      if (targets[targetIndex] >= range.start) columns.set(targets[targetIndex], column);
      targetIndex += 1;
    }
    column += 1;
  }
  while (targetIndex < targets.length) columns.set(targets[targetIndex++], column);
  return columns;
}

function locateFindings(text, starts, findings) {
  const located = new Array(findings.length);
  const groups = new Map();
  findings.forEach((finding, index) => {
    const lineIndex = lineIndexForOffset(starts, finding.offset);
    if (!groups.has(lineIndex)) groups.set(lineIndex, []);
    groups.get(lineIndex).push({ finding, index });
  });
  for (const [lineIndex, entries] of groups) {
    const lineStart = starts[lineIndex];
    const lineEnd = lineIndex + 1 < starts.length ? starts[lineIndex + 1] - 1 : text.length;
    const columns = columnsForOffsets(text, lineStart, lineEnd, entries.map(({ finding }) => finding.offset));
    for (const { finding, index } of entries) {
      located[index] = { ...finding, line: lineIndex + 1, column: columns.get(finding.offset) || 1 };
    }
  }
  return located;
}

function replacementIndex(findings, finding) {
  const candidateRank = severityRank[finding.severity] ?? severityRank.low;
  let replacement = -1;
  let worstRank = candidateRank;
  findings.forEach((current, index) => {
    const rank = severityRank[current.severity] ?? severityRank.low;
    if (rank > worstRank) {
      worstRank = rank;
      replacement = index;
    }
  });
  return replacement;
}

function addFinding(findings, finding) {
  if (findings.length < MAX_FINDINGS) {
    findings.push(finding);
    return;
  }
  findings.truncated = true;
  const replacement = replacementIndex(findings, finding);
  if (replacement >= 0) findings[replacement] = finding;
}

function specialCharacterFinding(codePoint, offset, width) {
  const special = specialCharacters.get(codePoint);
  if (!special) return null;
  return {
    severity: special[0], kind: "invisible", label: special[1],
    detail: `${special[2]} ${codePointLabel(codePoint)}`, offset, length: width,
  };
}

function formatControlFinding(codePoint, offset, width) {
  if (!/\p{Cf}/u.test(String.fromCodePoint(codePoint))) return null;
  return {
    severity: "medium", kind: "invisible", label: "Unicode format control",
    detail: `Invisible or formatting control ${codePointLabel(codePoint)}. Review unexpected use.`, offset, length: width,
  };
}

function rawControlFinding(codePoint, offset, width) {
  if (!isControl(codePoint)) return null;
  return {
    severity: "high", kind: "control", label: "Control character",
    detail: `Unexpected non-printing control ${codePointLabel(codePoint)}.`, offset, length: width,
  };
}

function noncharacterFinding(codePoint, offset, width) {
  if (!isNoncharacter(codePoint)) return null;
  return {
    severity: "high", kind: "invalid-unicode", label: "Unicode noncharacter",
    detail: `${codePointLabel(codePoint)} is reserved as a noncharacter.`, offset, length: width,
  };
}

function privateUseFinding(codePoint, offset, width) {
  if (!/\p{Co}/u.test(String.fromCodePoint(codePoint))) return null;
  return {
    severity: "low", kind: "marker-carrier", label: "Private-use character",
    detail: `${codePointLabel(codePoint)} has no standardized meaning and can carry application-specific metadata.`,
    offset, length: width,
  };
}

const characterFindingFactories = [
  specialCharacterFinding,
  formatControlFinding,
  rawControlFinding,
  noncharacterFinding,
  privateUseFinding,
];

function findingForCodePoint(codePoint, offset, width) {
  if (isTagCharacter(codePoint)) return null;
  for (const factory of characterFindingFactories) {
    const finding = factory(codePoint, offset, width);
    if (finding) return finding;
  }
  return null;
}

function variationSelectorByte(codePoint) {
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return codePoint - 0xfe00;
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) return codePoint - 0xe0100 + 16;
  return null;
}

function variationBytesForward(text, start, end, limit) {
  const bytes = [];
  for (let offset = start; offset < end && bytes.length < limit;) {
    const codePoint = text.codePointAt(offset);
    const value = variationSelectorByte(codePoint);
    if (value !== null) bytes.push(value);
    offset += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

function isLowSurrogate(unit) {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

function isHighSurrogate(unit) {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function previousCodePointStart(text, offset) {
  const last = offset - 1;
  if (!isLowSurrogate(text.charCodeAt(last))) return last;
  const previous = last - 1;
  return previous >= 0 && isHighSurrogate(text.charCodeAt(previous)) ? previous : last;
}

function previousCodePoint(text, offset) {
  const start = previousCodePointStart(text, offset);
  return { codePoint: text.codePointAt(start), start };
}

function variationBytesBackward(text, start, end, limit) {
  const bytes = [];
  for (let offset = end; offset > start && bytes.length < limit;) {
    const previous = previousCodePoint(text, offset);
    const value = variationSelectorByte(previous.codePoint);
    if (value !== null) bytes.push(value);
    offset = previous.start;
  }
  return bytes.reverse();
}

function variationPreview(bytes) {
  const decoded = decodeBytes(Uint8Array.from(bytes));
  if (decoded && hasVisibleText(decoded)) return quotedPreview(decoded);
  return bytes.slice(0, 48).map((value) => value.toString(16).padStart(2, "0")).join(" ")
    + (bytes.length > 48 ? " …" : "");
}

function variationRunDetail(text, start, end, count) {
  const prefix = variationBytesForward(text, start, end, MAX_VARIATION_PREVIEW_BYTES);
  if (count <= MAX_VARIATION_PREVIEW_BYTES) {
    return `${count} consecutive variation selectors. Decoded payload: ${variationPreview(prefix)}`;
  }
  const suffix = variationBytesBackward(text, start, end, MAX_VARIATION_PREVIEW_BYTES);
  return `${count} consecutive variation selectors. Decoded prefix: ${variationPreview(prefix)}; suffix: ${variationPreview(suffix)}`;
}

function flushVariationRun(text, findings, state, end) {
  if (state.count >= 4) addFinding(findings, {
    severity: "medium", kind: "marker-carrier", label: "Variation-selector sequence",
    detail: variationRunDetail(text, state.start, end, state.count),
    offset: state.start, length: end - state.start,
  });
  state.start = -1;
  state.count = 0;
}

function updateVariationRun(text, findings, state, codePoint, offset) {
  if (!isVariationSelector(codePoint)) {
    flushVariationRun(text, findings, state, offset);
    return;
  }
  if (state.start < 0) state.start = offset;
  state.count += 1;
}

function scanCharacters(text, findings) {
  const variation = { start: -1, count: 0 };
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    const width = codePoint > 0xffff ? 2 : 1;
    updateVariationRun(text, findings, variation, codePoint, offset);
    const finding = findingForCodePoint(codePoint, offset, width);
    if (finding) addFinding(findings, finding);
    offset += width;
  }
  flushVariationRun(text, findings, variation, text.length);
}

function codePointWidth(codePoint) {
  return codePoint > 0xffff ? 2 : 1;
}

function tagAscii(codePoint) {
  const ascii = codePoint - 0xe0000;
  return ascii >= 0x20 && ascii <= 0x7e ? String.fromCharCode(ascii) : "";
}

function readUnicodeTagRun(text, start) {
  let offset = start;
  let payload = "";
  let count = 0;
  let truncated = false;
  while (offset < text.length && isTagCharacter(text.codePointAt(offset))) {
    const codePoint = text.codePointAt(offset);
    const char = tagAscii(codePoint);
    if (char && payload.length < MAX_TAG_PREVIEW_CHARS) payload += char;
    else if (char) truncated = true;
    count += 1;
    offset += codePointWidth(codePoint);
  }
  return { end: offset, payload, count, truncated };
}

function tagRunDetail(run) {
  if (!run.payload) return `${run.count} invisible Unicode tag characters.`;
  const suffix = run.truncated ? " (preview truncated)" : "";
  return `Hidden tag payload: ${quotedPreview(run.payload)}${suffix}`;
}

function scanUnicodeTags(text, findings) {
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    if (!isTagCharacter(codePoint)) {
      offset += codePointWidth(codePoint);
      continue;
    }
    const run = readUnicodeTagRun(text, offset);
    addFinding(findings, {
      severity: "high", kind: "marker-carrier", label: "Unicode tag sequence",
      detail: tagRunDetail(run), offset, length: run.end - offset,
    });
    offset = run.end;
  }
}

function scriptFlags(token) {
  return {
    latin: /\p{Script=Latin}/u.test(token),
    cyrillic: /\p{Script=Cyrillic}/u.test(token),
    greek: /\p{Script=Greek}/u.test(token),
  };
}

function scanMixedScripts(text, findings) {
  const tokenPattern = /[\p{L}\p{N}_-]{3,}/gu;
  for (const match of text.matchAll(tokenPattern)) {
    const flags = scriptFlags(match[0]);
    if (!flags.latin || (!flags.cyrillic && !flags.greek)) continue;
    addFinding(findings, {
      severity: "medium",
      kind: "confusable",
      label: "Mixed-script token",
      detail: `Mixed-script token: ${quotedPreview(match[0])}. Latin mixed with Cyrillic or Greek can create look-alike identifiers or links.`,
      offset: match.index,
      length: match[0].length,
    });
  }
}

function scanPromptInjection(text, findings) {
  for (const pattern of injectionPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      addFinding(findings, {
        severity: "medium",
        kind: "prompt-injection",
        label: "Prompt-injection-like instruction",
        detail: `Matched instruction: ${quotedPreview(match[0])}. Heuristic match only.`,
        offset: match.index,
        length: match[0].length,
      });
    }
  }
}

function decodedBase64(value) {
  if (value.length % 4 !== 0) return null;
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return decodeBytes(bytes);
  } catch {
    return null;
  }
}

function scanDecodedPrompt(value) {
  if (!value) return false;
  return injectionPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function decodedBase64Slices(value) {
  if (value.length <= MAX_BASE64_DECODE_CHARS) {
    const decoded = decodedBase64(value);
    return decoded ? [decoded] : [];
  }
  const chunk = BASE64_PREVIEW_CHARS - (BASE64_PREVIEW_CHARS % 4);
  const suffixStart = Math.max(0, value.length - chunk);
  return [value.slice(0, chunk), value.slice(suffixStart)]
    .map(decodedBase64)
    .filter(Boolean);
}

function encodedCandidates(text) {
  const results = [];
  const seen = new Set();
  const patterns = [
    /(?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g,
    /(?:[A-Za-z0-9+/]{32,}\r?\n[ \t]*)+[A-Za-z0-9+/]{4,}={0,2}/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const encoded = match[0].replace(/\s+/g, "");
      if (encoded.length % 4 !== 0) continue;
      const key = `${match.index}:${match[0].length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ encoded, offset: match.index, length: match[0].length });
    }
  }
  return results;
}

function scanEncodedPrompts(text, findings) {
  for (const candidate of encodedCandidates(text)) {
    const decodedSlices = decodedBase64Slices(candidate.encoded);
    const decoded = decodedSlices.find(scanDecodedPrompt);
    if (decoded) {
      addFinding(findings, {
        severity: "high", kind: "prompt-injection", label: "Encoded prompt-like instruction",
        detail: `Base64 decoded payload: ${quotedPreview(decoded)}`,
        offset: candidate.offset, length: candidate.length,
      });
      continue;
    }
    if (candidate.encoded.length > MAX_BASE64_DECODE_CHARS) {
      addFinding(findings, {
        severity: "medium", kind: "marker-carrier", label: "Large Base64 carrier",
        detail: `Encoded run is ${candidate.encoded.length} characters; only bounded edge previews were decoded. Hidden content may exist inside.`,
        offset: candidate.offset, length: candidate.length,
      });
    }
  }
}

function scanText(text) {
  const findings = [];
  scanCharacters(text, findings);
  scanUnicodeTags(text, findings);
  scanMixedScripts(text, findings);
  scanPromptInjection(text, findings);
  scanEncodedPrompts(text, findings);

  const starts = makeLineStarts(text);
  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.offset}:${finding.length}:${finding.label}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  const result = locateFindings(text, starts, [...unique.values()])
    .sort((a, b) => a.offset - b.offset || severityRank[a.severity] - severityRank[b.severity])
    .slice(0, MAX_FINDINGS);
  Object.defineProperty(result, "truncated", { value: Boolean(findings.truncated) });
  return result;
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    summary[finding.severity] += 1;
    return summary;
  }, { high: 0, medium: 0, low: 0 });
}

globalThis.DocBenchTextInspector = Object.freeze({ scanText, summarizeFindings });
})();
