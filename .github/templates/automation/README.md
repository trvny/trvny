# GitHub automation templates

Shared automation sources for trvny repositories.

- `gemini-dispatch.yml`: deterministic routing and automatic PR review triggers.
- `gemini-assistant.yml`: Gemini-powered review and repository assistance.

Documentation drift is handled centrally from `trvny/trvny` by `docs-orchestrator.md` and `docs-worker.md` instead of copying a scheduled updater into every repository.

Install the package with `gh aw add trvny/trvny/.github/templates/automation` when using gh-aw, or copy the raw Gemini workflows to `.github/workflows/`.
