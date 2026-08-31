import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function checkSyntax(path) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
}

for (const [directory, suffix] of [["src", ".js"], ["public", ".js"], ["scripts", ".mjs"]]) {
  for (const name of readdirSync(join(root, directory)).filter((entry) => entry.endsWith(suffix))) {
    checkSyntax(join(root, directory, name));
  }
}

execFileSync(process.execPath, [join(root, "scripts", "privacy-check.mjs")], {
  cwd: root,
  stdio: "inherit",
});

const windows = process.platform === "win32";
execFileSync(windows ? "npx.cmd" : "npx", ["wrangler", "deploy", "--dry-run"], {
  cwd: root,
  stdio: "inherit",
  shell: windows,
});

const source = readFileSync(join(root, "src", "index.ts"), "utf8");
const wrangler = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
const notFound = readFileSync(join(root, "public", "404.html"), "utf8");
const llms = readFileSync(join(root, "public", "llms.txt"), "utf8");
const index = readFileSync(join(root, "public", "index.html"), "utf8");
const portable = readFileSync(join(root, "public", "portable.html"), "utf8");
const webmcp = readFileSync(join(root, "public", "webmcp.js"), "utf8");

if (!source.includes('const SITE_URL = "https://codebench.trfny.com/";')) {
  throw new Error("Codebench canonical origin is not the custom domain");
}
if (!source.includes('href="/llms.txt"')) throw new Error("llms.txt discovery link is missing");
if (wrangler.assets?.not_found_handling !== "404-page") throw new Error("404 asset handling is missing");
if (!notFound.includes('name="robots" content="noindex,follow"')) throw new Error("404 page can be indexed");
if (!llms.includes("https://codebench.trfny.com/")) throw new Error("llms.txt canonical application URL is missing");
if (!index.includes('<script src="webmcp.js"></script>')) throw new Error("WebMCP page script is missing");
if (!index.includes("lastQrContent=data")) throw new Error("QR encoded payload cache is missing");
if (!webmcp.includes("QR payload is too large")) throw new Error("WebMCP QR capacity guard is missing");
if (!webmcp.includes("ui.hasQr()")) throw new Error("WebMCP QR export readiness guard is missing");
for (const toolName of ["read_code_state", "set_qr_code", "set_barcode", "export_code"]) {
  if (!portable.includes(`name: "${toolName}"`)) throw new Error(`Portable build is missing WebMCP tool: ${toolName}`);
}

console.log("Codebench checks passed.");
