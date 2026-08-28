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

/**
 * 判断代码点是否表示需要关注的控制字符。
 * @param {number} codePoint - 要检查的 Unicode 代码点。
 * @returns {boolean} 如果代码点属于控制字符且不是制表符、换行符或回车符，则为 `true`，否则为 `false`。
 */
function isControl(codePoint) {
  return (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint))
    || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/**
 * 判断 Unicode 码点是否属于非字符。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @return {boolean} 如果码点是非字符则为 `true`，否则为 `false`。
 */
function isNoncharacter(codePoint) {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
    || (codePoint & 0xffff) === 0xfffe
    || (codePoint & 0xffff) === 0xffff;
}

/**
 * 判断 Unicode 码点是否属于标签字符范围。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @return {boolean} 如果码点属于标签字符范围则为 `true`，否则为 `false`。
 */
function isTagCharacter(codePoint) {
  return codePoint >= 0xe0000 && codePoint <= 0xe007f;
}

/**
 * 判断码点是否属于 Unicode 变体选择符。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @return {boolean} 如果码点是变体选择符则为 `true`，否则为 `false`。
 */
function isVariationSelector(codePoint) {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

/**
 * 格式化 Unicode 码点标签。
 * @param {number} codePoint - 要格式化的 Unicode 码点。
 * @return {string} 采用 `U+` 前缀和大写十六进制表示的码点标签。
 */
function codePointLabel(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(codePoint <= 0xffff ? 4 : 6, "0")}`;
}

/**
 * 将字符格式化为可读的预览文本。
 * @param {string} char - 要格式化的单个字符。
 * @return {string} 可直接显示的字符，或控制字符对应的 Unicode 转义序列。
 */
function escapedPreviewChar(char) {
  const codePoint = char.codePointAt(0);
  if (codePoint > 0x1f && codePoint !== 0x7f) return char;
  return `\\u${codePoint.toString(16).padStart(4, "0")}`;
}

/**
 * 生成经过转义并限制长度的字符串预览。
 * @param {string} value - 要生成预览的文本。
 * @param {number} [limit=180] - 预览内容的最大长度。
 * @return {string} 带双引号的转义文本预览。
 */
function quotedPreview(value, limit = 180) {
  const compact = [...value].map(escapedPreviewChar).join("");
  const clipped = compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
  return JSON.stringify(clipped);
}

/**
 * 判断文本是否包含可见字符。
 * @param {string} value - 要检查的文本。
 * @return {boolean} 如果文本包含码点大于 `0x1F` 且不为 `0x7F` 的字符则为 `true`，否则为 `false`。
 */
function hasVisibleText(value) {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint > 0x1f && codePoint !== 0x7f) return true;
  }
  return false;
}

/**
 * 将字节数据严格解码为 UTF-8 文本。
 * @param {Uint8Array} bytes - 待解码的字节数据。
 * @return {string|null} 解码后的文本；字节数据不是有效 UTF-8 时返回 `null`。
 */
function decodeBytes(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 构建文本中每一行起始位置的索引。
 * @param {string} text - 要建立索引的文本。
 * @return {number[]} 按顺序排列的每一行起始字符偏移量。
 */
function makeLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) starts.push(index + 1);
  }
  return starts;
}

/**
 * 确定文本偏移量所在的行索引。
 * @param {number[]} starts - 各行起始偏移量，按升序排列。
 * @param {number} offset - 要定位的文本偏移量。
 * @return {number} 包含该偏移量的行索引。
 */
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

/**
 * 生成指定文本范围内的字素边界范围。
 * @param {string} text - 待处理的文本。
 * @param {number} lineStart - 范围起始偏移量。
 * @param {number} lineEnd - 范围结束偏移量。
 * @return {Array<[number, number]>} 按字素划分的偏移范围。
 */
function graphemeRanges(text, lineStart, lineEnd) {
  return typeof Intl?.Segmenter === "function"
    ? segmentedGraphemeRanges(text, lineStart, lineEnd)
    : codePointRanges(text, lineStart, lineEnd);
}

function assignColumnsInRange(targets, columns, state, range) {
  while (state.index < targets.length && targets[state.index] < range.end) {
    const target = targets[state.index];
    if (target >= range.start) columns.set(target, state.column);
    state.index += 1;
  }
}

/**
 * 为剩余目标项填充列位置。
 * @param {Array} targets - 待定位的目标项。
 * @param {Map} columns - 用于存储目标项列位置的映射。
 * @param {{index: number, column: number}} state - 当前处理索引及列位置状态。
 */
function fillRemainingColumns(targets, columns, state) {
  while (state.index < targets.length) {
    columns.set(targets[state.index], state.column);
    state.index += 1;
  }
}

/**
 * 将文本偏移量映射为对应的列号。
 * @param {string} text - 待计算列号的文本。
 * @param {number} lineStart - 行内容的起始偏移量。
 * @param {number} lineEnd - 行内容的结束偏移量。
 * @param {number[]} offsets - 要转换为列号的文本偏移量。
 * @return {Map<number, number>} 从文本偏移量到列号的映射。
 */
function columnsForOffsets(text, lineStart, lineEnd, offsets) {
  const targets = [...new Set(offsets)].sort((a, b) => a - b);
  const columns = new Map();
  const state = { index: 0, column: 1 };
  for (const range of graphemeRanges(text, lineStart, lineEnd)) {
    assignColumnsInRange(targets, columns, state, range);
    state.column += 1;
  }
  fillRemainingColumns(targets, columns, state);
  return columns;
}

/**
 * 为发现结果添加一-based 行号和列号。
 * @param {string} text - 用于计算位置的文本。
 * @param {number[]} starts - 各行起始偏移量。
 * @param {Array<object>} findings - 待定位的发现结果。
 * @return {Array<object>} 包含行号和列号的发现结果。
 */
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

/**
 * 查找可由新 finding 替换的最低优先级 finding。
 * @param {Array<Object>} findings - 当前已收集的 finding 列表。
 * @param {Object} finding - 待加入的 finding。
 * @return {number} 可替换 finding 的索引；没有合适项时返回 -1。
 */
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

/**
 * 将发现添加到结果集合中，并在达到数量上限时保留更高优先级的发现。
 * @param {Array} findings - 用于存储发现结果的集合。
 * @param {Object} finding - 待添加的发现。
 */
function addFinding(findings, finding) {
  if (findings.length < MAX_FINDINGS) {
    findings.push(finding);
    return;
  }
  findings.truncated = true;
  const replacement = replacementIndex(findings, finding);
  if (replacement >= 0) findings[replacement] = finding;
}

/**
 * 创建特殊字符检测结果。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @param {number} offset - 字符在文本中的起始偏移量。
 * @param {number} width - 字符占用的文本宽度。
 * @return {Object|null} 已知特殊字符的检测结果；未识别时返回 `null`。
 */
function specialCharacterFinding(codePoint, offset, width) {
  const special = specialCharacters.get(codePoint);
  if (!special) return null;
  return {
    severity: special[0], kind: "invisible", label: special[1],
    detail: `${special[2]} ${codePointLabel(codePoint)}`, offset, length: width,
  };
}

/**
 * 创建 Unicode 格式控制字符的检测结果。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @param {number} offset - 字符在文本中的起始偏移量。
 * @param {number} width - 字符占用的文本宽度。
 * @return {Object|null} 格式控制字符的中严重级别检测结果；如果码点不属于格式控制字符，则返回 `null`。
 */
function formatControlFinding(codePoint, offset, width) {
  if (!/\p{Cf}/u.test(String.fromCodePoint(codePoint))) return null;
  return {
    severity: "medium", kind: "invisible", label: "Unicode format control",
    detail: `Invisible or formatting control ${codePointLabel(codePoint)}. Review unexpected use.`, offset, length: width,
  };
}

/**
 * 为控制字符创建高严重性扫描结果。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @param {number} offset - 字符在文本中的起始偏移量。
 * @param {number} width - 字符占用的宽度。
 * @return {Object|null} 控制字符的扫描结果；如果码点不是控制字符，则返回 `null`。
 */
function rawControlFinding(codePoint, offset, width) {
  if (!isControl(codePoint)) return null;
  return {
    severity: "high", kind: "control", label: "Control character",
    detail: `Unexpected non-printing control ${codePointLabel(codePoint)}.`, offset, length: width,
  };
}

/**
 * 为 Unicode 非字符创建高严重级别的检测结果。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @param {number} offset - 该码点在文本中的起始偏移量。
 * @param {number} width - 该码点占用的文本宽度。
 * @return {Object|null} 非字符检测结果；如果码点不是非字符，则返回 `null`。
 */
function noncharacterFinding(codePoint, offset, width) {
  if (!isNoncharacter(codePoint)) return null;
  return {
    severity: "high", kind: "invalid-unicode", label: "Unicode noncharacter",
    detail: `${codePointLabel(codePoint)} is reserved as a noncharacter.`, offset, length: width,
  };
}

/**
 * 创建私有区 Unicode 字符的低严重级别发现项。
 * @param {number} codePoint - 要检查的 Unicode 码点。
 * @param {number} offset - 字符在文本中的起始偏移量。
 * @param {number} width - 字符占用的偏移宽度。
 * @return {object|null} 私有区字符的发现项；如果码点不属于私有区，则返回 `null`。
 */
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

/**
 * 为指定 Unicode 码点生成字符检测结果。
 * @param {number} codePoint - Unicode 码点值。
 * @param {number} offset - 字符在文本中的起始偏移量。
 * @param {number} width - 字符占用的文本宽度。
 * @return {Object|null} 匹配到的检测结果；标签字符或未匹配时返回 `null`。
 */
function findingForCodePoint(codePoint, offset, width) {
  if (isTagCharacter(codePoint)) return null;
  for (const factory of characterFindingFactories) {
    const finding = factory(codePoint, offset, width);
    if (finding) return finding;
  }
  return null;
}

/**
 * 将变体选择符转换为对应的字节值。
 * @param {number} codePoint - 要转换的 Unicode 码点。
 * @return {number|null} 对应的字节值；如果码点不是变体选择符，则返回 `null`。
 */
function variationSelectorByte(codePoint) {
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return codePoint - 0xfe00;
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) return codePoint - 0xe0100 + 16;
  return null;
}

/** 提取文本范围内变体选择符对应的字节值。 */
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

/**
 * 判断一个 UTF-16 码元是否为低代理项。
 * @param {number} unit - 要检查的 UTF-16 码元值。
 * @return {boolean} 如果码元位于低代理项范围内则为 `true`，否则为 `false`。
 */
function isLowSurrogate(unit) {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * 判断数值是否表示高代理项。
 * @param {number} unit - 要检查的 UTF-16 代码单元值。
 * @return {boolean} 如果数值位于高代理项范围内则为 `true`，否则为 `false`。
 */
function isHighSurrogate(unit) {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/**
 * 定位给定偏移量之前一个 Unicode 码点的起始位置。
 * @param {string} text - 要检查的文本。
 * @param {number} offset - 以 UTF-16 代码单元计的结束偏移量。
 * @return {number} 前一个 Unicode 码点的起始偏移量。
 */
function previousCodePointStart(text, offset) {
  const last = offset - 1;
  if (!isLowSurrogate(text.charCodeAt(last))) return last;
  const previous = last - 1;
  return previous >= 0 && isHighSurrogate(text.charCodeAt(previous)) ? previous : last;
}

/**
 * 获取指定偏移位置之前的 Unicode 码点及其起始偏移。
 * @param {number} offset - 用于定位前一个码点的字符串偏移量。
 * @return {{codePoint: number, start: number}} 前一个码点及其起始偏移。
 */
function previousCodePoint(text, offset) {
  const start = previousCodePointStart(text, offset);
  return { codePoint: text.codePointAt(start), start };
}

/**
 * 从指定范围内反向提取变体选择符编码的字节，并按原文本顺序返回。
 * @param {string} text - 待读取的文本。
 * @param {number} start - 扫描范围的起始偏移量。
 * @param {number} end - 扫描范围的结束偏移量。
 * @param {number} limit - 最多提取的字节数。
 * @return {number[]} 提取出的字节值。
 */
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

/**
 * 生成字节序列的可读预览。
 * @param {number[]} bytes - 按字节表示的数据序列。
 * @return {string} 可见文本的带引号预览，或字节的十六进制预览。
 */
function variationPreview(bytes) {
  const decoded = decodeBytes(Uint8Array.from(bytes));
  if (decoded && hasVisibleText(decoded)) return quotedPreview(decoded);
  return bytes.slice(0, 48).map((value) => value.toString(16).padStart(2, "0")).join(" ")
    + (bytes.length > 48 ? " …" : "");
}

/**
 * 生成连续变体选择符序列的载荷说明。
 * @param {string} text - 包含变体选择符序列的文本。
 * @param {number} start - 序列起始偏移量。
 * @param {number} end - 序列结束偏移量。
 * @param {number} count - 序列中的变体选择符数量。
 * @return {string} 包含序列长度及解码载荷预览的说明文本。
 */
function variationRunDetail(text, start, end, count) {
  const prefix = variationBytesForward(text, start, end, MAX_VARIATION_PREVIEW_BYTES);
  if (count <= MAX_VARIATION_PREVIEW_BYTES) {
    return `${count} consecutive variation selectors. Decoded payload: ${variationPreview(prefix)}`;
  }
  const suffix = variationBytesBackward(text, start, end, MAX_VARIATION_PREVIEW_BYTES);
  return `${count} consecutive variation selectors. Decoded prefix: ${variationPreview(prefix)}; suffix: ${variationPreview(suffix)}`;
}

/**
 * 处理变体选择符序列并记录达到检测阈值的序列。
 * @param {string} text - 待检查的文本。
 * @param {Array} findings - 用于收集检测结果的数组。
 * @param {Object} state - 当前变体选择符序列的起始位置和数量。
 * @param {number} end - 序列结束位置。
 */
function flushVariationRun(text, findings, state, end) {
  if (state.count >= 4) addFinding(findings, {
    severity: "medium", kind: "marker-carrier", label: "Variation-selector sequence",
    detail: variationRunDetail(text, state.start, end, state.count),
    offset: state.start, length: end - state.start,
  });
  state.start = -1;
  state.count = 0;
}

/**
 * 更新变体选择符序列的扫描状态。
 * @param {string} text - 待扫描文本。
 * @param {Array} findings - 用于记录扫描结果的 findings 数组。
 * @param {Object} state - 当前变体选择符序列的状态。
 * @param {number} codePoint - 当前字符的 Unicode 码点。
 * @param {number} offset - 当前字符在文本中的偏移量。
 */
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

/**
 * 确定 Unicode 码点在 UTF-16 中占用的代码单元数。
 * @param {number} codePoint - Unicode 码点。
 * @return {number} 码点占用的 UTF-16 代码单元数。
 */
function codePointWidth(codePoint) {
  return codePoint > 0xffff ? 2 : 1;
}

/**
 * 将 Unicode 标签字符的码点转换为对应的可打印 ASCII 字符。
 * @param {number} codePoint - Unicode 码点。
 * @return {string} 对应的 ASCII 字符；若码点不表示可打印 ASCII 字符，则返回空字符串。
 */
function tagAscii(codePoint) {
  const ascii = codePoint - 0xe0000;
  return ascii >= 0x20 && ascii <= 0x7e ? String.fromCharCode(ascii) : "";
}

/**
 * 将字符追加到 Unicode 标签预览，并在超出长度上限时标记预览已截断。
 * @param {{payload: string, truncated: boolean}} state - 标签预览状态。
 * @param {string} char - 要追加的字符。
 */
function appendTagPreview(state, char) {
  if (!char) return;
  if (state.payload.length < MAX_TAG_PREVIEW_CHARS) {
    state.payload += char;
    return;
  }
  state.truncated = true;
}

/**
 * 读取从指定位置开始的连续 Unicode 标签字符，并生成其 ASCII 预览。
 * @param {string} text - 待读取的文本。
 * @param {number} start - 标签字符序列的起始偏移量。
 * @return {{end: number, payload: string, count: number, truncated: boolean}} 标签序列的结束偏移量、ASCII 预览、字符数量及预览是否被截断。
 */
function readUnicodeTagRun(text, start) {
  const state = { offset: start, payload: "", count: 0, truncated: false };
  while (state.offset < text.length) {
    const codePoint = text.codePointAt(state.offset);
    if (!isTagCharacter(codePoint)) break;
    appendTagPreview(state, tagAscii(codePoint));
    state.count += 1;
    state.offset += codePointWidth(codePoint);
  }
  return { end: state.offset, payload: state.payload, count: state.count, truncated: state.truncated };
}

/**
 * 描述 Unicode 标签字符序列及其隐藏载荷。
 * @param {Object} run - Unicode 标签字符序列及其载荷信息。
 * @return {string} 标签字符数量或隐藏载荷的可读描述。
 */
function tagRunDetail(run) {
  if (!run.payload) return `${run.count} invisible Unicode tag characters.`;
  const suffix = run.truncated ? " (preview truncated)" : "";
  return `Hidden tag payload: ${quotedPreview(run.payload)}${suffix}`;
}

/**
 * 检测文本中的 Unicode 标签字符序列，并记录为高严重级别的标记载体发现。
 * @param {string} text - 待检查的文本。
 * @param {Array<Object>} findings - 用于收集检测结果的数组。
 */
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

/**
 * 检测文本标记中是否包含拉丁文、西里尔文或希腊文字符。
 * @param {string} token - 待检测的文本标记。
 * @returns {{latin: boolean, cyrillic: boolean, greek: boolean}} 各文字脚本是否出现在标记中的结果。
 */
function scriptFlags(token) {
  return {
    latin: /\p{Script=Latin}/u.test(token),
    cyrillic: /\p{Script=Cyrillic}/u.test(token),
    greek: /\p{Script=Greek}/u.test(token),
  };
}

/**
 * 检测混合拉丁字母与西里尔字母或希腊字母的文本标记，并记录潜在的混淆标识符或链接。
 * @param {string} text - 要检查的文本。
 * @param {Array<Object>} findings - 用于收集检测结果的 findings 数组。
 */
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

/**
 * 扫描文本中的疑似提示注入指令并记录匹配结果。
 * @param {string} text - 待扫描的文本。
 * @param {Array<Object>} findings - 用于收集扫描结果的发现列表。
 */
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

/**
 * 将标准或 URL 安全格式的 Base64 字符串规范化。
 * @param {string} value - 待规范化的 Base64 字符串。
 * @return {string|null} 使用标准字符集并补齐填充符的 Base64 字符串；长度余数为 1 时返回 `null`。
 */
function normalizedBase64(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = normalized.length % 4;
  if (remainder === 1) return null;
  return normalized + "=".repeat((4 - remainder) % 4);
}

/**
 * 解码 Base64 字符串并返回其 UTF-8 文本。
 * @param {string} value - 待解码的 Base64 字符串。
 * @return {?string} 解码后的文本；解码失败时返回 `null`。
 */
function decodedNormalizedBase64(value) {
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return decodeBytes(bytes);
  } catch {
    return null;
  }
}

/**
 * 检测文本是否包含疑似提示注入指令。
 * @param {string} value - 待检测的文本。
 * @return {boolean} 如果文本匹配任一提示注入模式则为 `true`，否则为 `false`。
 */
function scanDecodedPrompt(value) {
  if (!value) return false;
  return injectionPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

/**
 * 解码 Base64 值，并为超长值返回前缀和后缀切片的解码结果。
 * @param {string} value - 待处理的 Base64 文本。
 * @return {string[]} 成功解码的文本片段列表。
 */
function decodedBase64Slices(value) {
  const normalized = normalizedBase64(value);
  if (!normalized) return [];
  if (normalized.length <= MAX_BASE64_DECODE_CHARS) {
    const decoded = decodedNormalizedBase64(normalized);
    return decoded ? [decoded] : [];
  }
  const chunk = BASE64_PREVIEW_CHARS - (BASE64_PREVIEW_CHARS % 4);
  const suffixStart = Math.max(0, normalized.length - chunk);
  return [normalized.slice(0, chunk), normalized.slice(suffixStart)]
    .map(decodedNormalizedBase64)
    .filter(Boolean);
}

/**
 * 查找由多行组成的 Base64 编码候选片段。
 * @param {string} text - 待检查的文本。
 * @return {Array<{encoded: string, offset: number, length: number}>} 检测到的编码内容及其在文本中的偏移量和长度。
 */
function wrappedBase64Candidates(text) {
  if (!text.includes("\n")) return [];
  const results = [];
  let run = null;
  let lineStart = 0;
  const flush = () => {
    if (!run || run.parts.length < 2) { run = null; return; }
    const body = run.parts.slice(0, -1);
    if (body.some((part) => part.length < 32) || run.parts.at(-1).length < 2) { run = null; return; }
    const encoded = run.parts.join("");
    if (normalizedBase64(encoded)) results.push({ encoded, offset: run.start, length: run.end - run.start });
    run = null;
  };
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const rawEnd = newline < 0 ? text.length : newline;
    const lineEnd = rawEnd > lineStart && text.charCodeAt(rawEnd - 1) === 0x0d ? rawEnd - 1 : rawEnd;
    const part = text.slice(lineStart, lineEnd).trim();
    if (/^[A-Za-z0-9+/_-]+={0,2}$/u.test(part) && part.length >= 2) {
      if (!run) run = { start: lineStart, end: lineEnd, parts: [] };
      run.parts.push(part);
      run.end = lineEnd;
    } else flush();
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  flush();
  return results;
}

/**
 * 查找文本中的连续或换行包装的 Base64 候选片段。
 * @param {string} text - 待检查的文本。
 * @return {Array<{encoded: string, offset: number, length: number}>} Base64 候选片段及其在文本中的偏移量和长度。
 */
function encodedCandidates(text) {
  const results = [...text.matchAll(/[A-Za-z0-9+/_-]{32,}={0,2}/gu)].map((match) => ({
    encoded: match[0], offset: match.index, length: match[0].length,
  }));
  const seen = new Set(results.map((candidate) => `${candidate.offset}:${candidate.length}`));
  for (const candidate of wrappedBase64Candidates(text)) {
    const key = `${candidate.offset}:${candidate.length}`;
    if (!seen.has(key)) results.push(candidate);
  }
  return results;
}

/**
 * 扫描文本中的 Base64 编码内容，识别其中可能包含的提示注入指令或大型标记载体。
 * @param {string} text - 要扫描的文本。
 * @param {Array<Object>} findings - 用于收集扫描结果的 findings 数组。
 */
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

/**
 * 扫描文本中的特殊字符、混合脚本、提示注入模式及编码内容。
 * @return {Array} 按文本位置和严重级别排序的检测结果，并附带表示结果是否被截断的 `truncated` 属性。
 */
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

/**
 * 统计各严重级别发现的数量。
 * @param {Array<{severity: string}>} findings - 待统计的发现项。
 * @return {{high: number, medium: number, low: number}} 各严重级别对应的发现数量。
 */
function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    summary[finding.severity] += 1;
    return summary;
  }, { high: 0, medium: 0, low: 0 });
}

globalThis.DocBenchTextInspector = Object.freeze({ scanText, summarizeFindings });
})();
