#!/usr/bin/env bash
# Figure out the exact multi_intensity format for the Ally X RGB rings by trying
# candidate value-counts and letting you WATCH the rings. Safe + self-restoring:
# it saves the current color/brightness first and puts them back at the end. A
# rejected write just prints "REJECTED" and changes nothing.
#
# Run it and WATCH the joystick-ring LEDs; note what happens at each step.
set -uo pipefail

# Find the RGB rings node (the leds dir that has multi_intensity).
LED=""
for d in /sys/class/leds/*/; do
  [ -e "${d}multi_intensity" ] && { LED="${d%/}"; break; }
done
[ -n "$LED" ] || { echo "!! no multi_intensity LED node found"; exit 1; }
echo ">> Using: $LED"

MI="$LED/multi_intensity"
BR="$LED/brightness"
save_mi="$(cat "$MI" 2>/dev/null || echo '')"
save_br="$(cat "$BR" 2>/dev/null || echo '')"
echo ">> Saved current: multi_intensity='${save_mi}'  brightness='${save_br}'"
echo

wr() { # wr "<values>"  -> writes to multi_intensity, reports accepted/rejected
  local v="$1"
  if printf '%s' "$v" | sudo tee "$MI" >/dev/null 2>&1; then
    echo "   ACCEPTED: '$v'   (reads back: '$(cat "$MI")')"
  else
    echo "   REJECTED: '$v'"
  fi
}

echo ">> Setting brightness to 255 so effects are visible"
echo 255 | sudo tee "$BR" >/dev/null 2>&1 || true
echo

echo "TEST A: 12 values (4 zones x R,G,B) = all RED. Watch the rings."
wr "255 0 0 255 0 0 255 0 0 255 0 0"; sleep 3
echo
echo "TEST B: 12 values, 4 DIFFERENT zones = red, green, blue, white."
wr "255 0 0  0 255 0  0 0 255  255 255 255"; sleep 3
echo
echo "TEST C: 3 values (single R,G,B) = RED."
wr "255 0 0"; sleep 3
echo
echo "TEST D: 4 values = RED (in case each zone is one packed value)."
wr "255 0 0 0"; sleep 3
echo

echo ">> Restoring your original color + brightness"
[ -n "$save_mi" ] && printf '%s' "$save_mi" | sudo tee "$MI" >/dev/null 2>&1 || true
[ -n "$save_br" ] && printf '%s' "$save_br" | sudo tee "$BR" >/dev/null 2>&1 || true

echo
echo ">> Tell me, for EACH test A-D: was it ACCEPTED or REJECTED, and what did the"
echo "   rings actually do? (all one colour? 4 separate colours? nothing?) That"
echo "   pins down the exact format and how many zones we can address."
