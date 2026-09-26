#!/usr/bin/env bash
set -euo pipefail
cd gh-apps/gremlin-operator
npm install --save-exact --no-audit --no-fund wrangler@4.136.2 @cloudflare/workers-types@5.20260922.1
npm ci --no-audit --no-fund
npm run check
