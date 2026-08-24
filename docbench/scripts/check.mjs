import { access, readFile, stat } from "node:fs/promises";

for (const path of [
  "public/index.html",
  "public/app.js",
  "public/document-enhancements.mjs",
  "public/document-enhancements.css",
  "public/pdf-app.mjs",
  "public/pdf-core.mjs",
  "public/fonts.css",
  "public/styles.css",
  "public/fonts/space-grotesk-latin-ext.woff2",
  "public/fonts/space-grotesk-latin.woff2",
  "public/fonts/space-mono-latin-ext-400.woff2",
  "public/fonts/space-mono-latin-400.woff2",
  "public/fonts/space-mono-latin-ext-700.woff2",
  "public/fonts/space-mono-latin-700.woff2",
  "public/vendor/js-yaml.min.js",
  "public/vendor/marked.umd.js",
  "public/vendor/jsonc-parser/impl/parser.js",
  "public/vendor/jsonc-parser/impl/scanner.js",
  "public/vendor/pdf-lib.min.js",
  "public/vendor/pdfjs/pdf.mjs",
  "public/vendor/pdfjs/pdf.worker.mjs",
  "public/vendor/qpdf-run/index.js",
  "public/vendor/qpdf-run/browserRunner.js",
  "public/vendor/qpdf-run/bytes.js",
  "public/vendor/qpdf-run/worker.js",
  "public/vendor/qpdf/lib/qpdf.js",
  "public/vendor/qpdf/lib/qpdf.wasm",
  "public/portable.html",
]) {
  await access(path);
}

const documentEnhancements = await readFile(
  "public/document-enhancements.mjs",
  "utf8",
);
if (documentEnhancements.includes("innerHTML")) {
  throw new Error("Rich document preview must not inject rendered HTML.");
}
for (const capability of [
  "showOpenFilePicker",
  "showSaveFilePicker",
  "createWritable",
  "writable.abort",
]) {
  if (!documentEnhancements.includes(capability)) {
    throw new Error(`Document workspace is missing ${capability} support.`);
  }
}
if (!documentEnhancements.includes("MAX_TREE_NODES")) {
  throw new Error("Structured previews must keep a bounded tree renderer.");
}
if (!documentEnhancements.includes("source.slice(node.offset, node.offset + node.length)")) {
  throw new Error("JSON tree preview must preserve source scalar lexemes.");
}
if (documentEnhancements.includes("JSON.parse(editor.value)")) {
  throw new Error("JSON tree preview must not coerce source numbers through JSON.parse.");
}
for (const fidelityGuard of [
  "preserveYamlNumericLexemes",
  "FAILSAFE_SCHEMA",
  "preservesXmlSpace",
  "PROCESSING_INSTRUCTION_NODE",
  "DOCUMENT_TYPE_NODE",
  'statusBadge.textContent === "Format failed"',
]) {
  if (!documentEnhancements.includes(fidelityGuard)) {
    throw new Error(`Structured preview is missing fidelity guard: ${fidelityGuard}`);
  }
}

const portable = await readFile("public/portable.html", "utf8");
const resourceHtml = portable.replace(
  /(<script\b[^>]*>)[\s\S]*?<\/script>/gi,
  "$1</script>",
);
const resourceUrls = [];
for (const match of resourceHtml.matchAll(/<(?:script|link|img|source|iframe)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
  resourceUrls.push(match[1]);
}
for (const leaked of [
  "/vendor/",
  "/fonts/",
  "/app.js",
  "/document-enhancements.mjs",
  "/pdf-app.mjs",
  "/pdf-core.mjs",
  "/fonts.css",
  "/styles.css",
  "/document-enhancements.css",
]) {
  if (resourceUrls.some((url) => url.startsWith(leaked))) {
    throw new Error(`Portable build still references ${leaked}`);
  }
}
if (portable.includes('./vendor/jsonc-parser/impl/parser.js')) {
  throw new Error("Portable build still references the external JSON parser module.");
}
if (resourceUrls.some((url) => /^https?:\/\//i.test(url))) {
  throw new Error("Portable build must not load third-party resources");
}
if (!portable.includes("Space Grotesk") || !portable.includes("Space Mono")) {
  throw new Error("Portable build is missing embedded Bench fonts");
}
if (!portable.includes("jsyaml")) throw new Error("Portable build is missing YAML runtime");
if (!portable.includes("marked")) throw new Error("Portable build is missing Markdown runtime");
if (!portable.includes("parseTree")) throw new Error("Portable build is missing JSON tree runtime");
if (!portable.includes("showSaveFilePicker") || !portable.includes("createWritable")) {
  throw new Error("Portable build is missing direct-save support");
}
if (!portable.includes("PDFLib")) throw new Error("Portable build is missing PDF mutation runtime");
if (!portable.includes("__docbenchPdfAssets")) {
  throw new Error("Portable build is missing embedded PDF runtime assets");
}
const portableSize = (await stat("public/portable.html")).size;
if (portableSize >= 24 * 1024 * 1024) {
  throw new Error("Portable Doc Bench exceeds the Cloudflare per-asset safety margin.");
}
console.log(`Doc Bench static checks passed (${(portableSize / 1024 / 1024).toFixed(1)} MiB portable).`);
