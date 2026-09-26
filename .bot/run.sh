#!/usr/bin/env bash
set -euo pipefail
# miniflare now pins sharp 0.35.4 itself; the old 0.35.3 override forces the
# vulnerable version (GHSA-rgj7-g3m4-5g8c). Drop it and let the lock resolve.
for dir in gh-apps/kanarek-companion gh-apps/kanarek-review gh-apps/gremlin-operator mcp/status-mcp; do
  (
    cd "$dir"
    node -e '
      const fs = require("fs");
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      delete pkg.overrides.sharp;
      if (!Object.keys(pkg.overrides).length) delete pkg.overrides;
      fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
    '
    npm install --package-lock-only --no-audit --no-fund
    node -e '
      const lock = require("./package-lock.json");
      const found = Object.entries(lock.packages)
        .filter(([path]) => /(^|\/)node_modules\/sharp$/.test(path))
        .map(([path, entry]) => `${path}@${entry.version}`);
      console.log(process.cwd(), found);
      if (!found.length || found.some((entry) => !entry.endsWith("@0.35.4"))) process.exit(1);
    '
    npm ci --no-audit --no-fund
    npm run check
  )
done
