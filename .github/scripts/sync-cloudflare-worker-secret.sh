#!/usr/bin/env bash
set -euo pipefail

worker="${1:?worker name required}"
target_secret="${2:?Worker secret name required}"
source_env="${3:?source env name required}"
mode="${4:-required}"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be configured}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID must be configured}"

value="${!source_env:-}"
wrangler=(npx --yes wrangler@4.131.1)

has_secret() {
  local json="$1"
  printf '%s' "$json" | node --input-type=module -e '
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const target = process.argv[1];
    const secrets = JSON.parse(input);
    process.exit(secrets.some((secret) => secret.name === target) ? 0 : 1);
  ' "$target_secret"
}

if [[ -z "$value" ]]; then
  if [[ "$mode" == "required" ]]; then
    echo "$source_env must be configured" >&2
    exit 1
  fi
  secrets_json="$("${wrangler[@]}" secret list --name "$worker" --format json)"
  if has_secret "$secrets_json"; then
    "${wrangler[@]}" secret delete "$target_secret" --name "$worker"
  fi
  echo "$source_env is absent; $target_secret is disabled on $worker."
  exit 0
fi

printf '%s' "$value" | "${wrangler[@]}" secret put "$target_secret" --name "$worker"
secrets_json="$("${wrangler[@]}" secret list --name "$worker" --format json)"
has_secret "$secrets_json"

echo "$target_secret synced to $worker from $source_env."
