"use strict";

(() => {
const { scanText, summarizeFindings } = globalThis.DocBenchTextInspector;

const select = (selector) => document.querySelector(selector);
const editor = select("#editor");
const preview = select("#preview");
const previewTitle = select("#preview-title");
const statusBadge = select("#status-badge");
const inspectButton = select("#inspect-button");

/**
 * 更新状态徽章的样式、文本及提示信息。
 * @param {string} kind - 状态类型，用于设置对应的 CSS 类名。
 * @param {string} text - 要显示的状态文本。
 */
function setStatus(kind, text) {
  statusBadge.className = `status ${kind}`;
  statusBadge.textContent = text;
  statusBadge.removeAttribute("title");
}

/**
 * 在编辑器中定位并选中指定的检查结果。
 * @param {Object} finding - 包含文本偏移量和长度的检查结果。
 */
function revealFinding(finding) {
  const start = Math.max(0, Math.min(editor.value.length, finding.offset));
  const end = Math.max(start, Math.min(editor.value.length, start + finding.length));
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, end);
}

/**
 * 将严重级别映射为界面显示标签。
 * @param {string} severity - 严重级别。
 * @return {string} 对应的显示标签：`High`、`Review` 或 `Info`。
 */
function severityLabel(severity) {
  if (severity === "high") return "High";
  if (severity === "medium") return "Review";
  return "Info";
}/**
 * 创建可点击的检查发现项，并显示其严重级别、位置、标签和详细信息。
 * @param {Object} finding - 检查发现，包含严重级别、标签、行列位置和详细信息。
 * @return {HTMLButtonElement} 显示检查发现内容的按钮。
 */
function findingRow(finding) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `inspect-finding severity-${finding.severity}`;
  button.addEventListener("click", () => revealFinding(finding));

  const heading = document.createElement("span");
  heading.className = "inspect-finding-heading";
  const severity = document.createElement("span");
  severity.className = `inspect-severity severity-${finding.severity}`;
  severity.textContent = severityLabel(finding.severity);
  const title = document.createElement("strong");
  title.textContent = finding.label;
  const position = document.createElement("span");
  position.className = "inspect-position";
  position.textContent = `line ${finding.line}:${finding.column}`;
  heading.append(severity, title, position);

  const detail = document.createElement("span");
  detail.className = "inspect-detail";
  detail.textContent = finding.detail;
  button.append(heading, detail);
  return button;
}

/**
 * 创建未发现可疑文本模式时显示的结果提示。
 * @return {HTMLDivElement} 包含扫描结果标题和启发式扫描免责声明的提示元素。
 */
function cleanResult() {
  const box = document.createElement("div");
  box.className = "inspect-clean";
  const title = document.createElement("strong");
  title.textContent = "No suspicious text patterns found";
  const note = document.createElement("span");
  note.textContent = "This is a local heuristic scan, not proof that a document is safe.";
  box.append(title, note);
  return box;
}/**
 * 创建检查结果摘要行，显示各严重级别的发现数量及结果说明。
 * @param {Object} summary - 按严重级别统计的发现数量。
 * @param {boolean} truncated - 是否因结果截断而仅显示优先级最高的发现。
 * @return {HTMLDivElement} 包含严重级别摘要和说明文本的元素。
 */
function summaryRow(summary, truncated) {
  const row = document.createElement("div");
  row.className = "inspect-summary";
  for (const [severity, count] of Object.entries(summary)) {
    const chip = document.createElement("span");
    chip.className = `inspect-summary-chip severity-${severity}`;
    chip.textContent = `${severityLabel(severity)} ${count}`;
    row.append(chip);
  }
  const note = document.createElement("span");
  note.className = "inspect-summary-note";
  note.textContent = truncated
    ? "Showing the highest-priority findings; additional matches were truncated. Click a finding to jump to source."
    : "Prompt-injection and marker findings are heuristic; click any finding to jump to source.";
  row.append(note);
  return row;
}

/**
 * 检查编辑器中的文本并渲染可疑模式及其严重级别摘要。
 */
function inspectDocument() {
  document.dispatchEvent(new Event("docbench:inspect-start"));
  const findings = scanText(editor.value);
  const summary = summarizeFindings(findings);
  preview.className = "preview-inspector";
  previewTitle.textContent = "Text safety inspection";
  if (!findings.length) {
    preview.replaceChildren(cleanResult());
    setStatus("good", "Inspect · clean");
    return;
  }
  const list = document.createElement("div");
  list.className = "inspect-findings";
  for (const finding of findings) list.append(findingRow(finding));
  preview.replaceChildren(summaryRow(summary, findings.truncated), list);
  setStatus(summary.high ? "bad" : "neutral", `Inspect · ${findings.length}${findings.truncated ? "+" : ""}`);
}

inspectButton.addEventListener("click", inspectDocument);
})();
