---
applyTo: "kanarek-companion/src/**/*.ts"
---

# Kanarek companion Worker

- Verify the raw webhook body before parsing JSON.
- Log metadata only; never log payload bodies, signatures, tokens, or keys.
- Keep secrets in Cloudflare Worker secrets, not Wrangler variables or files.
- Before adding GitHub side effects, use installation authentication and make
  handling idempotent with the GitHub delivery identifier.
