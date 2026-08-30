(() => {
  "use strict";

  const context = document.modelContext;
  if (!context?.registerTool) return;

  const lifecycle = new AbortController();
  const register = (tool) => {
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal }))
        .catch((error) => console.warn("Docbench WebMCP registration failed", error));
    } catch (error) {
      console.warn("Docbench WebMCP registration failed", error);
    }
  };

  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });

  const editor = document.querySelector("#editor");
  const formatSelect = document.querySelector("#format-select");
  const eolSelect = document.querySelector("#eol-select");
  const statusBadge = document.querySelector("#status-badge");
  const preview = document.querySelector("#preview");
  const filenameLabel = document.querySelector("#filename-label");

  if (!editor || !formatSelect || !eolSelect || !statusBadge || !preview) return;

  const snapshot = ({ includeText = false } = {}) => {
    const value = editor.value;
    const result = {
      filename: filenameLabel?.textContent || "",
      format: formatSelect.value,
      lineEndings: eolSelect.value,
      status: statusBadge.textContent || "",
      preview: (preview.textContent || "").slice(0, 5000),
      lines: value.split("\n").length,
      characters: value.length,
    };
    if (includeText) {
      result.text = value.slice(0, 50000);
      result.textTruncated = value.length > 50000;
    }
    return result;
  };

  register({
    name: "read_document",
    title: "Read Docbench document",
    description: "Read the current Docbench document state and optionally its text without changing it.",
    inputSchema: {
      type: "object",
      properties: { includeText: { type: "boolean", default: false } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute({ includeText = false } = {}) {
      return snapshot({ includeText });
    },
  });

  register({
    name: "set_document_text",
    title: "Set Docbench document text",
    description: "Replace the document editor text and optionally select its format using the existing Docbench UI state.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: 500000 },
        format: { type: "string", enum: ["txt", "md", "json", "yaml", "xml"] },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute({ text, format }) {
      if (format) {
        formatSelect.value = format;
        formatSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      editor.value = String(text ?? "");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#validate-button")?.click();
      return snapshot({ includeText: true });
    },
  });

  register({
    name: "validate_document",
    title: "Validate Docbench document",
    description: "Validate the current TXT, Markdown, JSON, YAML or XML document and update the visible result.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute() {
      document.querySelector("#validate-button")?.click();
      return snapshot();
    },
  });

  register({
    name: "format_document",
    title: "Format Docbench document",
    description: "Auto-format the current document with Docbench's existing formatter and return the resulting text and status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute() {
      document.querySelector("#format-button")?.click();
      return snapshot({ includeText: true });
    },
  });

  register({
    name: "inspect_document",
    title: "Inspect Docbench document",
    description: "Run Docbench's local text-safety inspection for hidden characters, markers and prompt-injection-like patterns.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute() {
      const inspector = globalThis.DocBenchTextInspector;
      if (!inspector?.scanText || !inspector?.summarizeFindings) {
        return { ok: false, error: "Text inspector is not ready." };
      }
      const findings = inspector.scanText(editor.value);
      document.querySelector("#inspect-button")?.click();
      return {
        ok: true,
        count: findings.length,
        truncated: Boolean(findings.truncated),
        summary: inspector.summarizeFindings(findings),
        findings: findings.slice(0, 100).map((finding) => ({
          severity: finding.severity,
          label: finding.label,
          detail: finding.detail,
          line: finding.line,
          column: finding.column,
          offset: finding.offset,
          length: finding.length,
        })),
      };
    },
  });
})();
