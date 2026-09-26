#!/usr/bin/env bash
set -euo pipefail
for dir in mcp/status-mcp mcp/pet-dispatcher; do
  node .bot/pin-exact.mjs "$dir"
  (cd "$dir" && npm install --package-lock-only --no-audit --no-fund)
done
cd mcp/status-mcp
npm pkg set scripts.check="npm run typecheck && npm test && wrangler deploy --dry-run --outdir dist"
npm ci --no-audit --no-fund
npm run check
cd ../pet-dispatcher
npm ci --no-audit --no-fund
npm run typecheck
