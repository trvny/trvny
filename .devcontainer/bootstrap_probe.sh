#!/usr/bin/env bash
# Read-only Devbox bootstrap inventory; never display environment or credentials.
set -euo pipefail
printf 'Probe running as: '
id -un
printf 'Operating system: '
(. /etc/os-release && printf '%s\n' "$PRETTY_NAME") || true
printf 'Git workspace: '
if [[ -d /workspaces/trvny/.git ]]; then echo present; else echo missing; fi
printf 'Devcontainer configuration: '
if [[ -f /workspaces/trvny/.devcontainer/devcontainer.json ]]; then echo present; else echo missing; fi
printf 'Bootstrap state paths:\n'
for dir in "$HOME/.local/share/travny-devbox" "$HOME/.local/bin" /usr/local/share; do
  if [[ -d "$dir" ]]; then
    printf '  available: %s\n' "$dir"
  else
    printf '  absent: %s\n' "$dir"
  fi
done
printf 'Known entry points:\n'
for executable in sudo apt-get curl bash gh node npm python3 uv agy copilot hermes yt-dlp; do
  if command -v "$executable" >/dev/null 2>&1; then
    printf '  present: %s\n' "$executable"
  else
    printf '  missing: %s\n' "$executable"
  fi
done
printf 'Devbox user tool manifest: '
if [[ -f "$HOME/.local/share/travny-devbox/package.json" ]]; then
  echo present
else
  echo absent
fi
