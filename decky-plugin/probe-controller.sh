#!/usr/bin/env bash
# Identify the ROG Ally X built-in gamepad on the USB bus (read-only).
#
# The plugin's "Force reconnect" toggles the USB `authorized` node on ASUS
# (vendor 0b05) devices that expose an HID interface. Run this to see exactly
# which devices that matches on YOUR unit, so we can pin it if needed.
#
# Safe: only reads sysfs. Does NOT touch `authorized`.
set -euo pipefail

VENDOR="0b05"   # ASUS
USB="/sys/bus/usb/devices"

echo "== ASUS (${VENDOR}) USB devices =="
found=0
for d in "${USB}"/*; do
  base="$(basename "$d")"
  # Skip interfaces (e.g. 3-2:1.0) and root hubs (usb1, usb2, ...).
  case "$base" in
    *:*|usb*) continue ;;
  esac
  [ -f "$d/idVendor" ] || continue
  v="$(cat "$d/idVendor" 2>/dev/null || true)"
  [ "$v" = "$VENDOR" ] || continue

  pid="$(cat "$d/idProduct" 2>/dev/null || echo '????')"
  product="$(cat "$d/product" 2>/dev/null || echo '(no product string)')"
  manuf="$(cat "$d/manufacturer" 2>/dev/null || echo '')"
  authz="$(cat "$d/authorized" 2>/dev/null || echo '?')"

  # Collect the interface classes (03 = HID).
  classes=""
  for c in "$d/$base:"*/bInterfaceClass; do
    [ -f "$c" ] || continue
    classes="${classes} $(cat "$c")"
  done

  hid="no"
  case "$classes" in *03*) hid="yes";; esac

  found=1
  echo "  device ${base}  ${VENDOR}:${pid}  authorized=${authz}  HID=${hid}"
  echo "    product : ${product}"
  [ -n "$manuf" ] && echo "    vendor  : ${manuf}"
  echo "    iface classes:${classes:- (none)}"
  echo
done

[ "$found" = 1 ] || echo "  (none found — is this a ROG Ally X? try 'lsusb | grep -i asus')"

echo "Devices marked HID=yes are what 'Force reconnect' will re-enumerate."
echo "If your gamepad is one of these, the plugin button should fix the cold-boot dropout."
