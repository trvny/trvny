import { readFile, writeFile } from "node:fs/promises";

const [
  html,
  fonts,
  css,
  enhancementsCss,
  yaml,
  marked,
  pdfLib,
  app,
  documentEnhancements,
  jsonParser,
  jsonScanner,
  pdfCore,
  pdfApp,
  pdfJs,
  pdfWorker,
  qpdfBrowserRunner,
  qpdfBytes,
  qpdfWorker,
  qpdfJs,
  qpdfWasm,
] = await Promise.all([
  readFile("public/index.html", "utf8"),
  readFile("public/fonts.css", "utf8"),
  readFile("public/styles.css", "utf8"),
  readFile("public/document-enhancements.css", "utf8"),
  readFile("public/vendor/js-yaml.min.js", "utf8"),
  readFile("public/vendor/marked.umd.js", "utf8"),
  readFile("public/vendor/pdf-lib.min.js", "utf8"),
  readFile("public/app.js", "utf8"),
  readFile("public/document-enhancements.mjs", "utf8"),
  readFile("public/vendor/jsonc-parser/impl/parser.js", "utf8"),
  readFile("public/vendor/jsonc-parser/impl/scanner.js", "utf8"),
  readFile("public/pdf-core.mjs", "utf8"),
  readFile("public/pdf-app.mjs", "utf8"),
  readFile("public/vendor/pdfjs/pdf.mjs", "utf8"),
  readFile("public/vendor/pdfjs/pdf.worker.mjs", "utf8"),
  readFile("public/vendor/qpdf-run/browserRunner.js", "utf8"),
  readFile("public/vendor/qpdf-run/bytes.js", "utf8"),
  readFile("public/vendor/qpdf-run/worker.js", "utf8"),
  readFile("public/vendor/qpdf/lib/qpdf.js", "utf8"),
  readFile("public/vendor/qpdf/lib/qpdf.wasm"),
]);

const safeScript = (value) => value.replaceAll("</script", "<\\/script");
const dataUrl = (mime, value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return `data:${mime};base64,${bytes.toString("base64")}`;
};

let portableFonts = fonts;
for (const filename of [
  "space-grotesk-latin-ext.woff2",
  "space-grotesk-latin.woff2",
  "space-mono-latin-ext-400.woff2",
  "space-mono-latin-400.woff2",
  "space-mono-latin-ext-700.woff2",
  "space-mono-latin-700.woff2",
]) {
  const fontUrl = dataUrl("font/woff2", await readFile(`public/fonts/${filename}`));
  portableFonts = portableFonts.replaceAll(`/fonts/${filename}`, fontUrl);
}

const jsonScannerUrl = dataUrl("text/javascript", jsonScanner);
const jsonParserPortable = jsonParser
  .replaceAll("'./scanner.js'", JSON.stringify(jsonScannerUrl))
  .replaceAll('"./scanner.js"', JSON.stringify(jsonScannerUrl));
const jsonParserUrl = dataUrl("text/javascript", jsonParserPortable);
const documentEnhancementsPortable = documentEnhancements.replace(
  'from "./vendor/jsonc-parser/impl/parser.js";',
  `from ${JSON.stringify(jsonParserUrl)};`,
);

const qpdfBytesUrl = dataUrl("text/javascript", qpdfBytes);
const browserRunnerPortable = qpdfBrowserRunner.replaceAll(
  "'./bytes.js'",
  JSON.stringify(qpdfBytesUrl),
);
const qpdfBrowserRunnerUrl = dataUrl("text/javascript", browserRunnerPortable);
const qpdfModuleUrl = dataUrl(
  "text/javascript",
  `export { createBrowserQpdfRunner as createQpdfRunner } from ${JSON.stringify(qpdfBrowserRunnerUrl)};`,
);
const pdfCoreUrl = dataUrl("text/javascript", pdfCore);
const pdfAppPortable = pdfApp.replace(
  'from "./pdf-core.mjs";',
  `from ${JSON.stringify(pdfCoreUrl)};`,
);

const assets = {
  pdfModuleUrl: dataUrl("text/javascript", pdfJs),
  pdfWorkerUrl: dataUrl("text/javascript", pdfWorker),
  qpdfModuleUrl,
  qpdfWorkerUrl: dataUrl("text/javascript", qpdfWorker),
  qpdfJsUrl: dataUrl("text/javascript", qpdfJs),
  qpdfWasmUrl: dataUrl("application/wasm", qpdfWasm),
};

const portablePdfScripts = [
  `<script>globalThis.__docbenchPdfAssets=${JSON.stringify(assets)}</script>`,
  `<script type="module">${safeScript(pdfAppPortable)}</script>`,
].join("\n");

const portable = html
  .replace(
    '<link rel="stylesheet" href="/fonts.css">',
    `<style data-portable-fonts>${portableFonts}</style>`,
  )
  .replace('<link rel="stylesheet" href="/styles.css">', `<style>${css}</style>`)
  .replace(
    '<link rel="stylesheet" href="/document-enhancements.css">',
    `<style>${enhancementsCss}</style>`,
  )
  .replace(
    '<script src="/vendor/js-yaml.min.js"></script>',
    `<script>${safeScript(yaml)}</script>`,
  )
  .replace(
    '<script src="/vendor/marked.umd.js"></script>',
    `<script>${safeScript(marked)}</script>`,
  )
  .replace(
    '<script src="/vendor/pdf-lib.min.js"></script>',
    `<script>${safeScript(pdfLib)}</script>`,
  )
  .replace('<script src="/app.js"></script>', `<script>${safeScript(app)}</script>`)
  .replace(
    '<script type="module" src="/document-enhancements.mjs"></script>',
    `<script type="module">${safeScript(documentEnhancementsPortable)}</script>`,
  )
  .replace('<script type="module" src="/pdf-app.mjs"></script>', portablePdfScripts)
  .replace('<link rel="manifest" href="/site.webmanifest">', "")
  .replace('<link rel="canonical" href="https://docbench.travny.workers.dev/">', "")
  .replace('<link rel="icon" type="image/svg+xml" href="/favicon.svg">', "");

await writeFile("public/portable.html", portable);
