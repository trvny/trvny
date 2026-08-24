import { cp, mkdir } from "node:fs/promises";

await mkdir("public/vendor", { recursive: true });
await cp(
  "node_modules/js-yaml/dist/browser/js-yaml.umd.min.js",
  "public/vendor/js-yaml.min.js",
);
await cp(
  "node_modules/marked/lib/marked.umd.js",
  "public/vendor/marked.umd.js",
);
await cp(
  "node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js",
  "public/vendor/pdf-lib.min.js",
);

await mkdir("public/fonts", { recursive: true });
for (const [source, target] of [
  ["@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2", "space-grotesk-latin.woff2"],
  ["@fontsource-variable/space-grotesk/files/space-grotesk-latin-ext-wght-normal.woff2", "space-grotesk-latin-ext.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-400-normal.woff2", "space-mono-latin-400.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-ext-400-normal.woff2", "space-mono-latin-ext-400.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-700-normal.woff2", "space-mono-latin-700.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-ext-700-normal.woff2", "space-mono-latin-ext-700.woff2"],
]) {
  await cp(`node_modules/${source}`, `public/fonts/${target}`);
}

await mkdir("public/vendor/pdfjs", { recursive: true });
await cp("node_modules/pdfjs-dist/build/pdf.mjs", "public/vendor/pdfjs/pdf.mjs");
await cp(
  "node_modules/pdfjs-dist/build/pdf.worker.mjs",
  "public/vendor/pdfjs/pdf.worker.mjs",
);

await mkdir("public/vendor/qpdf-run", { recursive: true });
for (const file of ["index.js", "browserRunner.js", "bytes.js", "worker.js"]) {
  await cp(`node_modules/qpdf-run/src/${file}`, `public/vendor/qpdf-run/${file}`);
}
await mkdir("public/vendor/qpdf/lib", { recursive: true });
await cp(
  "node_modules/qpdf-run/vendor/qpdf/lib/qpdf.js",
  "public/vendor/qpdf/lib/qpdf.js",
);
await cp(
  "node_modules/qpdf-run/vendor/qpdf/lib/qpdf.wasm",
  "public/vendor/qpdf/lib/qpdf.wasm",
);
