import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function checkSyntax(path) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
}

checkSyntax(join(root, "src", "index.js"));

for (const [directory, suffix] of [["public", ".js"], ["scripts", ".mjs"]]) {
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

console.log("Codebench checks passed.");
