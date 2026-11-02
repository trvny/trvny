# DeepSource PR reports

DeepSource status events trigger the `deepsource_report` job in
`.github/workflows/mega-linter.yml`. It updates one PR comment with issue
file, line, rule, severity, and a link to the full analysis. Unlike native
DeepSource inline comments, it includes findings outside the changed diff.

## Enable

Create a Personal Access Token in DeepSource user settings, Tokens.
Store it as the GitHub Actions repository secret DEEPSOURCE_PAT in trvny/trvny.
Never put the token in issues, code, or workflow dispatch inputs.

Until that secret exists, the workflow exits successfully with a notice.
For backfill/testing, run workflow_dispatch with the full head commit SHA.
Only current open PRs from this repository are eligible.

This is read-only for DeepSource and does not change quality gates.
