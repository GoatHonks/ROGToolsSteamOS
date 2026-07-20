#!/usr/bin/env bash
# Update the Decky plugin: pull the latest code (if this is a git checkout),
# then rebuild and reinstall.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if git -C "${SRC}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo ">> Pulling latest changes"
  git -C "${SRC}" pull --ff-only
else
  echo "!! This isn't a git checkout (looks like a ZIP download)."
  echo "   Re-download the latest ZIP, then run ./install.sh — or clone the repo"
  echo "   once so future updates are just ./update.sh."
fi

exec "${SRC}/install.sh"
