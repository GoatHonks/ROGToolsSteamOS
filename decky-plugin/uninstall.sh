#!/usr/bin/env bash
# Remove the ROGTools Decky plugin and restart Decky.
set -euo pipefail

PLUGIN_NAME="rog-tools-steamos"
DEST="${HOME}/homebrew/plugins/${PLUGIN_NAME}"

echo ">> Removing ${DEST} (needs sudo)"
sudo rm -rf "${DEST}"
sudo systemctl restart plugin_loader 2>/dev/null || true

echo ">> Done."
echo "   NOTE: this does not reset the fans to auto. Restore factory fan control with:"
echo "   for f in 1 2; do echo 2 | sudo tee /sys/class/hwmon/hwmon*/pwm\${f}_enable >/dev/null; done"
