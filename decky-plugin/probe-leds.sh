#!/usr/bin/env bash
# Read-only: map the RGB LED sysfs interface on the ROG Ally X so we can drive it
# the way HueSync's "Priority 1" sysfs path does. Globs specific paths only.
set -euo pipefail

echo "== /sys/class/leds entries =="
found=0
for d in /sys/class/leds/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  mi="no"; [ -e "${d}multi_intensity" ] && mi="yes"
  idx="$(cat "${d}multi_index" 2>/dev/null || echo '-')"
  cur="$(cat "${d}multi_intensity" 2>/dev/null || echo '-')"
  bri="$(cat "${d}brightness" 2>/dev/null || echo '-')"
  maxb="$(cat "${d}max_brightness" 2>/dev/null || echo '-')"
  zones="no"; [ -e "${d}multi_intensity_zones" ] && zones="yes"
  echo "  ${name}"
  echo "      multi_intensity=${mi}  multi_index='${idx}'  current='${cur}'"
  echo "      brightness=${bri}  max_brightness=${maxb}  zones_file=${zones}"
  [ "$mi" = "yes" ] && found=1
done

echo
if [ "$found" = 1 ]; then
  echo "RESULT: an RGB LED node with multi_intensity exists — sysfs control will work."
  echo ">> Paste this whole output. I'll build the Lighting controls to this node."
else
  echo "RESULT: no multi_intensity node found. sysfs control may be unavailable on this"
  echo "        kernel; we'd need the HID path instead. Paste the output either way."
fi
