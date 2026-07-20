#!/usr/bin/env bash
# Build a ZIP that Decky Loader's Developer Mode "Install from ZIP" accepts.
# Produces ./rog-tools-steamos.zip containing a single top-level plugin folder.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="rog-tools-steamos"
OUT="${SRC}/${PLUGIN_NAME}.zip"
cd "${SRC}"

if ! command -v node >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1 && [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "!! Node.js not found. Install it with nvm (see README) and re-run."
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
fi
PNPM="pnpm"; command -v pnpm >/dev/null 2>&1 || PNPM="corepack pnpm"

echo ">> Building frontend"
${PNPM} install
${PNPM} run build
[ -f dist/index.js ] || { echo "!! Build failed: dist/index.js missing"; exit 1; }

echo ">> Staging plugin folder"
STAGE="$(mktemp -d)"
DEST="${STAGE}/${PLUGIN_NAME}"
mkdir -p "${DEST}"
cp -r plugin.json package.json main.py dist "${DEST}/"

echo ">> Writing ${OUT}"
rm -f "${OUT}"
( cd "${STAGE}" && zip -rq "${OUT}" "${PLUGIN_NAME}" )
rm -rf "${STAGE}"

echo ">> Done: ${OUT}"
echo "   Install it via Decky Developer Mode (see README: 'Install from ZIP')."
