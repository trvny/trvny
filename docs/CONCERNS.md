# Codebase Concerns

## Current risks

| Severity | Concern | Evidence | Safe handling |
| --- | --- | --- | --- |
| high | Kanarek/GPTomek can perform privileged GitHub and Cloudflare actions | `gh-apps/kanarek-companion/src/` | keep guards, expected-state checks and focused tests with every capability change |
| high | Pet Dispatcher bridges a public control plane to a trusted development machine | `mcp/pet-dispatcher/` | preserve HMAC auth, device binding, Queue credentials, workspace confinement and fail-closed recovery |
| medium | status-mcp accepts a token in the URL path for connector compatibility | `mcp/status-mcp/src/entry.ts` | bearer auth remains preferred; invocation logs stay disabled |
| medium | Remotely Save patch anchors depend on minified upstream output | `remotely-save-gdrive-patch/patch_gdrive.py` | keep the verification workflow and fail loudly on anchor drift |
| medium | status-mcp CI typechecks but has no behavior suite | `.github/workflows/status-mcp-ci.yml` | add auth/cache/partial-failure tests when behavior changes |

## Fragile areas

- `gh-apps/kanarek-companion/src/` is the largest and most privileged code area. Prefer narrow changes over broad rewrites.
- `mcp/pet-dispatcher/` combines local Git state, filesystem confinement, process execution, remote delivery and recovery. Preserve the existing capability split and journal semantics.
- `remotely-save-gdrive-patch/` intentionally patches a user-owned installed bundle only. CI must never publish the patched derivative.
- README language variants and repository policy files are shared navigation contracts; keep them synchronized.

## Operational gaps

- There is no root build/test command because runnable components are independent.
- Pet Dispatcher has a comprehensive package `check`, but no dedicated GitHub Actions workflow in this repository.
- There is no repository-wide coverage threshold or credential-rotation policy.
