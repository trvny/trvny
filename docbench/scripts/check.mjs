import { access, readFile, stat } from "node:fs/promises";

for (const path of [
  "public/index.html",
  "public/app.js",
  "public/pdf-app.mjs",
  "public/pdf-core.mjs",
  "public/styles.css",
  "public/vendor/js-yaml.min.js",
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

const portable = await readFile("public/portable.html", "utf8");
for (const leaked of [
  "/vendor/",
  "/app.js",
  "/pdf-app.mjs",
  "/pdf-core.mjs",
  "/styles.css",
]) {
  if (portable.includes(`src=\"${leaked}`) || portable.includes(`href=\"${leaked}`)) {
    throw new Error(`Portable build still references ${leaked}`);
  }
}
if (!portable.includes("jsyaml")) throw new Error("Portable build is missing YAML runtime");
if (!portable.includes("PDFLib")) throw new Error("Portable build is missing PDF mutation runtime");
if (!portable.includes("__docbenchPdfAssets")) {
  throw new Error("Portable build is missing embedded PDF runtime assets");
}
for (const external of ['src="http', "src='http", 'href="http', "href='http"]) {
  if (portable.includes(external)) throw new Error("Portable build must not load third-party resources");
}
const portableSize = (await stat("public/portable.html")).size;
if (portableSize >= 24 * 1024 * 1024) {
  throw new Error("Portable Doc Bench exceeds the Cloudflare per-asset safety margin.");
}
console.log(`Doc Bench static checks passed (${(portableSize / 1024 / 1024).toFixed(1)} MiB portable).`);
