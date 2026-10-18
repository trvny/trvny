#!/usr/bin/env bash
set -euo pipefail

# Canonical GitHub App OAuth secrets live only in the GREMLIN_* repository entries.
# Pet receives separate Worker bindings, written together in one new version.
: "${CLOUDFLARE_API_TOKEN:?Cloudflare token is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?Cloudflare account is required}"
: "${GREMLIN_OAUTH_CLIENT_ID:?Existing GPTomek OAuth client ID is required}"
: "${GREMLIN_OAUTH_CLIENT_SECRET:?Existing GPTomek OAuth client secret is required}"

payload="$(mktemp)"
trap 'rm -f "$payload"' EXIT
chmod 600 "$payload"
node --input-type=module - "$payload" <<'NODE'
import { writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("Missing temporary secret file");
writeFileSync(file, JSON.stringify({
  PET_OAUTH_GITHUB_CLIENT_ID: process.env.GREMLIN_OAUTH_CLIENT_ID,
  PET_OAUTH_GITHUB_CLIENT_SECRET: process.env.GREMLIN_OAUTH_CLIENT_SECRET,
}), { mode: 0o600 });
NODE

# One secret bulk update publishes the pair in one Worker version.
npx --no-install wrangler secret bulk "$payload" --name pet-dispatcher-control

# Inspect only secret names. Values are never printed or committed.
npx --no-install wrangler secret list --name pet-dispatcher-control --format json |
  node --input-type=module -e '
    let data = "";
    for await (const part of process.stdin) data += part;
    const names = new Set(JSON.parse(data).map((entry) => entry.name));
    for (const name of ["PET_OAUTH_GITHUB_CLIENT_ID", "PET_OAUTH_GITHUB_CLIENT_SECRET"]) {
      if (!names.has(name)) throw new Error("Missing Pet OAuth Worker secret: " + name);
    }
  '

echo "Pet Dispatcher OAuth credentials synchronized as one pair."
