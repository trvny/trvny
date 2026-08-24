import { readFile, writeFile } from "node:fs/promises";

const [html, css, yaml, app] = await Promise.all([
  readFile("public/index.html", "utf8"),
  readFile("public/styles.css", "utf8"),
  readFile("public/vendor/js-yaml.min.js", "utf8"),
  readFile("public/app.js", "utf8"),
]);

const safeScript = (value) => value.replaceAll("</script", "<\\/script");
const portable = html
  .replace('<link rel="stylesheet" href="/styles.css">', `<style>${css}</style>`)
  .replace('<script src="/vendor/js-yaml.min.js"></script>', `<script>${safeScript(yaml)}</script>`)
  .replace('<script src="/app.js"></script>', `<script>${safeScript(app)}</script>`)
  .replace('<link rel="manifest" href="/site.webmanifest">', "")
  .replace('<link rel="icon" type="image/svg+xml" href="/favicon.svg">', "");

await writeFile("public/portable.html", portable);
