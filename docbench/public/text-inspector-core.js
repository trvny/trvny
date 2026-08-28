(() => {
  "use strict";

const MAX_FINDINGS = 500;
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

function humanColumn(text, lineStart, offset) {
  const prefix = text.slice(lineStart, offset);
  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(prefix)].length + 1;
  }
  return [...prefix].length + 1;
}

function locate(text, starts, finding) {
  const lineIndex = lineIndexForOffset(starts, finding.offset);
  return {
    ...finding,
    line: lineIndex + 1,
    column: humanColumn(text, starts[lineIndex], finding.offset),
  };
}

function addFinding(findings, finding) {
  if (findings.length < MAX_FINDINGS) {
    findings.push(finding);
    return;
  }
  findings.truncated = true;
  const candidateRank = severityRank[finding.severity] ?? severityRank.low;
  let replacement = -1;
  let worstRank = candidateRank;
  for (let index = findings.length - 1; index >= 0; index -= 1) {
    const rank = severityRank[findings[index].severity] ?? severityRank.low;
    if (rank <= worstRank) continue;
    worstRank = rank;
    replacement = index;
    if (worstRank === severityRank.low) break;
  }
  if (replacement >= 0) findings[replacement] = finding;
}

function scanCharacters(text, findings) {
  let variationStart = -1;
  let variationCount = 0;
  const flushVariationRun = (end) => {
    if (variationCount >= 4) {
      addFinding(findings, {
        severity: "medium",
        kind: "marker-carrier",
        label: "Variation-selector sequence",
        detail: `${variationCount} consecutive variation selectors can carry hidden metadata. This is not proof of AI origin.`,
        offset: variationStart,
        length: end - variationStart,
      });
    }
    variationStart = -1;
    variationCount = 0;
  };

  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    const width = codePoint > 0xffff ? 2 : 1;
    if (isVariationSelector(codePoint)) {
      if (variationStart < 0) variationStart = offset;
      variationCount += 1;
    } else {
      flushVariationRun(offset);
    }

    const special = specialCharacters.get(codePoint);
    if (special) {
      addFinding(findings, {
        severity: special[0], kind: "invisible", label: special[1],
        detail: `${special[2]} ${codePointLabel(codePoint)}`,
        offset, length: width,
      });
    } else if (isTagCharacter(codePoint)) {
      addFinding(findings, {
        severity: "high", kind: "marker-carrier", label: "Unicode tag character",
        detail: `${codePointLabel(codePoint)} is normally invisible and can encode hidden text or markers.`, offset, length: width,
      });
    } else if (/\p{Cf}/u.test(String.fromCodePoint(codePoint))) {
      addFinding(findings, {
        severity: "medium", kind: "invisible", label: "Unicode format control",
        detail: `Invisible or formatting control ${codePointLabel(codePoint)}. Review unexpected use.`, offset, length: width,
      });
    } else if (isControl(codePoint)) {
      addFinding(findings, {
        severity: "high", kind: "control", label: "Control character",
        detail: `Unexpected non-printing control ${codePointLabel(codePoint)}.`, offset, length: width,
      });
    } else if (isNoncharacter(codePoint)) {
      addFinding(findings, {
        severity: "high",
        kind: "invalid-unicode",
        label: "Unicode noncharacter",
        detail: `${codePointLabel(codePoint)} is reserved as a noncharacter.`,
        offset,
        length: width,
      });
    } else if (/\p{Co}/u.test(String.fromCodePoint(codePoint))) {
      addFinding(findings, {
        severity: "low",
        kind: "marker-carrier",
        label: "Private-use character",
        detail: `${codePointLabel(codePoint)} has no standardized meaning and can carry application-specific metadata.`,
        offset,
        length: width,
      });
    }
    offset += width;
  }
  flushVariationRun(text.length);
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
      detail: "Latin mixed with Cyrillic or Greek can create look-alike identifiers or links.",
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
        detail: "Heuristic match only. Review before passing this content to an AI agent.",
        offset: match.index,
        length: match[0].length,
      });
    }
  }
}

function decodedBase64(value) {
  if (value.length > 8192 || value.length % 4 !== 0) return null;
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function scanEncodedPrompts(text, findings) {
  const candidates = /(?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
  for (const match of text.matchAll(candidates)) {
    const decoded = decodedBase64(match[0]);
    if (!decoded) continue;
    if (!injectionPatterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(decoded);
    })) continue;
    addFinding(findings, {
      severity: "high",
      kind: "prompt-injection",
      label: "Encoded prompt-like instruction",
      detail: "Base64 content decodes to an instruction matching prompt-injection heuristics.",
      offset: match.index,
      length: match[0].length,
    });
  }
}

function scanText(text) {
  const findings = [];
  scanCharacters(text, findings);
  scanMixedScripts(text, findings);
  scanPromptInjection(text, findings);
  scanEncodedPrompts(text, findings);

  const starts = makeLineStarts(text);
  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.offset}:${finding.length}:${finding.label}`;
    if (!unique.has(key)) unique.set(key, locate(text, starts, finding));
  }
  const result = [...unique.values()]
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
