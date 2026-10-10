#!/usr/bin/env bash
set -euo pipefail

root="${HOME}/.local/share/travny-devbox"
mkdir -p "$root" "$HOME/.local/bin"
launcher="$(cd "$(dirname "$0")" && pwd)/devbox"
rm -f "$HOME/.local/bin/devbox"
printf '#!/usr/bin/env bash\\nexec bash %q "$@"\\n' "$launcher" > "$HOME/.local/bin/devbox"
chmod 700 "$HOME/.local/bin/devbox"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.profile" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.profile"
fi
export PATH="$HOME/.local/bin:$PATH"

install_uv() {
  if ! command -v uv >/dev/null 2>&1; then
    curl -fsSL https://astral.sh/uv/install.sh | sh
  fi
}

install_antigravity() {
  if ! command -v agy >/dev/null 2>&1; then
    curl -fsSL https://antigravity.google/cli/install.sh | bash
  fi
}

install_hermes() {
  if ! command -v hermes >/dev/null 2>&1; then
    HERMES_NONINTERACTIVE=1 bash -c \
      'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-browser --skip-computer-use'
  fi
}

install_node_tools() {
  npm install --prefix "$root" --no-save --no-audit --no-fund \
    @github/copilot playwright
  ln -sfn "$root/node_modules/.bin/copilot" "$HOME/.local/bin/copilot"
}

install_browser() {
  install_node_tools
  "$root/node_modules/.bin/playwright" install --with-deps chromium
  bash "$(dirname "$0")/install-ubol.sh"
}

case "${1:-all}" in
  all)
    install_uv
    install_antigravity
    install_browser
    install_hermes
    ;;
  base) install_uv ;;
  antigravity) install_antigravity ;;
  hermes) install_hermes ;;
  copilot) install_node_tools ;;
  browser) install_browser ;;
  ubol) bash "$(dirname "$0")/install-ubol.sh" ;;
  *)
    echo "Usage: bash .devcontainer/setup.sh {all|base|antigravity|hermes|copilot|browser|ubol}" >&2
    exit 2
    ;;
esac

echo "Devbox setup complete. Run: devbox doctor"
