---
applyTo: "kanarek-companion/src/**/*.ts"
---

# Kanarek companion Worker

- Verify the raw webhook body before parsing JSON.
- Authenticate through the GitHub App installation, never a user token.
- Keep webhook handling idempotent using the GitHub delivery identifier.
- Log metadata only; never log payload bodies, signatures, tokens, or keys.
- Keep secrets in Cloudflare Worker secrets, not Wrangler variables or files.
