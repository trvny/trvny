#!/usr/bin/env bash
set -euo pipefail
cd gh-apps/kanarek-companion
npm ci --no-audit --no-fund
node ../../.bot/codemod-dedupe-helpers.ts src
node ../../.bot/codemod-dedupe-helpers.ts src | tail -n 1 | grep -qx 'removed 0 duplicated lines'
npm run check
