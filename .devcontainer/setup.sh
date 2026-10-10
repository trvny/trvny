#!/usr/bin/env bash
set -euo pipefail

root="${HOME}/.local/share/travny-devbox"
mkdir -p "$root" "$HOME/.local/bin"
launcher="$(cd "$(dirname "$0")" && pwd)/devbox"
rm -f "$HOME/.local/bin/devbox"
printf '#!/usr/bin/env bash\nexec bash %q "$@"\n' "$launcher" > "$HOME/.local/bin/devbox"
chmod 700 "$HOME/.local/bin/devbox"

for rc in "$HOME/.profile" "$HOME/.bashrc"; do
  if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$rc" 2>/dev/null; then
    printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
  fi
done
export PATH="$HOME/.local/bin:$PATH"

run_installer() {
  local url="$1" interpreter="$2" tmp status=0
  shift 2
  tmp="$(mktemp)"
  if ! curl -fsSL --retry 3 "$url" -o "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  "$interpreter" "$tmp" "$@" || status=$?
  rm -f "$tmp"
  return "$status"
}

install_uv() {
  if ! command -v uv >/dev/null 2>&1; then
    run_installer https://astral.sh/uv/install.sh sh
  fi
}

install_antigravity() {
  if ! command -v agy >/dev/null 2>&1; then
    run_installer https://antigravity.google/cli/install.sh bash
  fi
}

install_hermes() {
  if ! command -v hermes >/dev/null 2>&1; then
    HERMES_NONINTERACTIVE=1 run_installer \
      https://hermes-agent.nousresearch.com/install.sh \
      bash --non-interactive --skip-browser --skip-computer-use
  fi
}

install_utils() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo 'This profile needs Debian/Ubuntu apt' >&2
    return 1
  fi
  local missing=()
  local pkg
  for pkg in 7zip jq ripgrep fd-find tree file bc imagemagick shellcheck; do
    dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -qx 'install ok installed' || missing+=("$pkg")
  done
  if (( ${#missing[@]} )); then
    sudo apt-get update -qq
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
  fi
  if command -v fdfind >/dev/null 2>&1 && ! command -v fd >/dev/null 2>&1; then
    ln -sfn "$(command -v fdfind)" "$HOME/.local/bin/fd"
  fi
}

install_android() {
  install_utils
  if ! command -v apktool >/dev/null 2>&1; then
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends apktool
  fi
  if ! command -v android >/dev/null 2>&1; then
    run_installer https://dl.google.com/android/cli/latest/linux_x86_64/install.sh bash
  fi
  # SDK platforms, build-tools, emulator: project-specific and opt-in.
}

install_android_sdk() {
  install_android
  android sdk install cmdline-tools platform-tools
  echo 'Add SDK platforms/build-tools for each project via: android sdk install ...'
}

install_cloud() {
  if ! command -v gcloud >/dev/null 2>&1; then
    run_installer https://sdk.cloud.google.com bash --disable-prompts
  fi
  if [[ -x "$HOME/google-cloud-sdk/bin/gcloud" ]]; then
    ln -sfn "$HOME/google-cloud-sdk/bin/gcloud" "$HOME/.local/bin/gcloud"
  fi
}

install_node_tools() {
  npm install --prefix "$root" --no-save --no-audit --no-fund \
    @github/copilot playwright @playwright/cli @modelcontextprotocol/server-filesystem
  for cli in copilot playwright-cli mcp-server-filesystem; do
    if [[ -x "$root/node_modules/.bin/$cli" ]]; then
      ln -sfn "$root/node_modules/.bin/$cli" "$HOME/.local/bin/$cli"
    fi
  done
  # Official Playwright skill; shared user-level for compatible agents.
  "$root/node_modules/.bin/playwright-cli" install --skills -g
}

install_media() {
  install_uv
  if ! command -v yt-dlp >/dev/null 2>&1; then
    uv tool install 'yt-dlp[default]'
  fi
  if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo 'ffmpeg/ffprobe missing; install them with your system package manager' >&2
      return 1
    fi
    sudo apt-get update -qq
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg
  fi
}

install_browser() {
  install_node_tools
  "$root/node_modules/.bin/playwright" install --with-deps --no-shell chromium
  bash "$(dirname "$0")/install-ubol.sh"
}

case "${1:-all}" in
  all)
    install_utils
    install_uv
    install_antigravity
    install_browser
    install_media
    install_hermes
    ;;
  base) install_utils; install_uv ;;
  antigravity) install_antigravity ;;
  hermes) install_hermes ;;
  copilot) install_node_tools ;;
  browser) install_browser ;;
  ubol) bash "$(dirname "$0")/install-ubol.sh" ;;
  media) install_media ;;
  utils) install_utils ;;
  android) install_android ;;
  android-sdk) install_android_sdk ;;
  cloud) install_cloud ;;
  mcp) install_node_tools ;;
  *)
    echo "Usage: bash .devcontainer/setup.sh {all|base|utils|android|android-sdk|cloud|mcp|antigravity|hermes|copilot|browser|ubol|media}" >&2
    exit 2
    ;;
esac

echo "Devbox setup complete. Run: devbox doctor"
