# Coding Conventions

## Naming and layout

- TypeScript/JavaScript modules are predominantly kebab-case; types/classes use PascalCase; functions use camelCase.
- Worker bindings, secrets and major constants use uppercase names such as `STATUS_MCP_TOKEN` and `TASK_QUEUE`.
- Imports are package-local and relative; there is no repository-wide barrel or path-alias convention.
- Keep feature code inside its owning component instead of adding a parallel shared layer without a real reuse case.

## Formatting and modules

- There is no root Prettier or ESLint configuration. Preserve the local style of the package being edited.
- `.gitattributes` owns line-ending normalization. `.github/.editorconfig` applies only to the `.github` tree.
- Worker and Node TypeScript code uses ES modules and strict TypeScript configurations.
- MegaLinter is the repository-wide documentation/configuration gate; package checks remain component-specific.

## Errors, logging and secrets

- Public Workers return structured errors rather than stack traces.
- Privileged actions validate identity, scope and expected state before mutation.
- Secrets stay in Cloudflare/GitHub/runtime environment bindings and must not enter config examples, task payloads or logs.
- status-mcp keeps invocation logs disabled because connector auth may appear in the URL path.
- Pet Dispatcher keeps host authority local and exposes only capability-filtered tools to providers and remote callers.

## Tests

- Kanarek Companion uses Node's built-in test runner plus explicit runtime/network fakes.
- Pet Dispatcher uses `tsx --test` with unit and integration coverage around confinement, Git, providers, remote transport and direct sessions.
- status-mcp currently relies on strict TypeScript checking.
