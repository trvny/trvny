---
applyTo: "gh-apps/kanarek-companion/src/**/*.ts"
---

# Kanarek companion Worker

- Verify raw webhook body before parsing JSON.
- Log metadata only; never log payload bodies, signatures, tokens, or keys.
- Keep secrets in Cloudflare Worker secrets, never Wrangler variables or files.
- Before adding GitHub side effects, use installation auth and idempotent
  handling via GitHub delivery identifier.
