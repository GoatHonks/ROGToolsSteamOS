#!/usr/bin/env bash
# Build and install the ROGTools Decky plugin on SteamOS.
# Builds the frontend, then copies the plugin into ~/homebrew/plugins (root-owned,
# so the copy needs sudo) and restarts Decky.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="rog-tools-steamos"
DEST="${HOME}/homebrew/plugins/${PLUGIN_NAME}"

cd "${SRC}"

# Find Node/pnpm across platforms without needing root (nvm, then Homebrew).
if ! command -v node >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1 && [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "!! Node.js not found. Install it without root using nvm:"
  echo "     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "     exec \$SHELL         # reload shell"
  echo "     nvm install --lts"
  echo "   then re-run ./install.sh  (pnpm is fetched automatically via corepack)."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
fi
PNPM="pnpm"
command -v pnpm >/dev/null 2>&1 || PNPM="corepack pnpm"

echo ">> Building frontend"
${PNPM} install
${PNPM} run build
[ -f dist/index.js ] || { echo "!! Build failed: dist/index.js missing"; exit 1; }

echo ">> Installing to ${DEST} (needs sudo; ~/homebrew is root-owned)"
sudo rm -rf "${DEST}"
sudo mkdir -p "${DEST}"
# package.json is REQUIRED — Decky reads its "type":"module" to load as an ES module.
sudo cp -r plugin.json package.json main.py dist "${DEST}/"

echo ">> Restarting Decky"
sudo systemctl restart plugin_loader

echo ">> Done. In Game Mode: ... (Quick Access) -> Decky (plug icon) -> ROGTools (SteamOS)."
echo "   If it was already open, fully restart Steam so it reloads the plugin."
