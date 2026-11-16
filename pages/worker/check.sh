#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node --test tests/radio-now.test.mjs tests/radio-station.test.mjs tests/hub-worker.test.mjs
npx --yes eslint@10.12.0 worker functions/api functions/_shared/hub-backend.js
