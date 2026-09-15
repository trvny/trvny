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

if [[ -z "$value" ]]; then
  if [[ "$mode" == "required" ]]; then
    echo "$source_env must be configured" >&2
    exit 1
  fi
  secrets_json="$("${wrangler[@]}" secret list --name "$worker" --format json)"
  if jq -e --arg name "$target_secret" '[.[].name] | index($name) != null' <<<"$secrets_json" >/dev/null; then
    "${wrangler[@]}" secret delete "$target_secret" --name "$worker"
  fi
  echo "$source_env is absent; $target_secret is disabled on $worker."
  exit 0
fi
printf '%s' "$value" | "${wrangler[@]}" secret put "$target_secret" --name "$worker"
secrets_json="$("${wrangler[@]}" secret list --name "$worker" --format json)"
jq -e --arg name "$target_secret" '[.[].name] | index($name) != null' <<<"$secrets_json" >/dev/null

echo "$target_secret synced to $worker from $source_env."
