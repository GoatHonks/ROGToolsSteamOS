# CLAUDE.md — ROGTools (SteamOS)

Context for continuing this project in a new session. Read this first.

## What this is

An all-in-one Decky Loader plugin for the **ASUS ROG Ally X** on **SteamOS**
(currently **v1.1.0**), grouped into **collapsible categories** in the Quick
Access panel:

1. **Battery** — charge limit + presets + 80↔100 quick toggle, bypass, health
   dashboard (from `ROGBatteryLimitBazz`)
2. **Fan Control** — custom fan curves + named presets + one-tap Max/Silent
   (from `ROGFanControlSteamOS`)
3. **Lighting** — joystick-ring RGB (modes, Duality, per-side, reactive
   battery/temp/GPU-load, low-battery alert, live gamma calibration), our own
   HueSync replacement (re-applied after suspend/resume)
4. **Settings** — cross-cutting UI prefs: open behavior (remember/fixed), show/hide
   categories, apply-lighting-at-startup, low-battery-alert threshold, About +
   reset-all

A **Controllers** category (force-reconnect + auto-reconnect watchdog for the
cold-boot gamepad dropout) existed but was **removed**: the real fix is disabling
**BIOS Fast Boot**, and the software reconnect became unreliable / harmful on
current SteamOS builds (see history below). The `ctl_*` code is gone.

It supersedes the two source plugins (and HueSync for LEDs); only one should be
installed at a time or
their watchdogs fight over the same sysfs nodes.

- Local: `/Users/goathonks/Documents/ClaudeApps/ROGToolsSteamOS`
- Source plugins: `../ROGBatteryLimitBazz`, `../ROGFanControlSteamOS` (their
  CLAUDE.md files have the hard-won hardware facts; this repo copies their logic
  verbatim, only renaming methods/state).
- Dev on macOS, run/test on the Ally X. **No Node and no device here** → TS can't
  be compiled or run locally; verify by reading. Build on-device via `./install.sh`.

## Architecture

```
decky-plugin/
  main.py        ONE root Plugin class (Decky loads only one). Split into three
                 name-spaced feature groups so methods can't collide:
                   bat_*  battery   fan_*  fan curves   led_*  RGB lighting
                   app_*  small cross-cutting UI settings
                 Each feature keeps its OWN state file in DECKY_PLUGIN_SETTINGS_DIR
                 (battery_state.json / fan_state.json / led_state.json /
                 app_state.json). Battery + fan run a watchdog; lighting runs an
                 effect loop (reactive fade + resume relight), all started in _main.
  src/index.tsx  Quick Access UI. `CATEGORIES` registry drives collapsible
                 `Category` sections (Settings stays last); each has a
                 self-contained Body component that only polls while expanded.
  install.sh / update.sh / uninstall.sh / package-zip.sh   nvm/pnpm build flow,
                 same as the source plugins. Plugin dir name: rog-tools-steamos.
```

### Adding a new category later

1. Add a `<prefix>_*` method group to the `Plugin` class in `main.py` (own state
   file if it needs one; own watchdog task in `_main` if it must survive resume).
2. Add a `<Prefix>Body({ active })` component + a `CATEGORIES` entry in `index.tsx`.
   Nothing is wired by naming convention beyond the `callable("<method>")` strings.

## Controllers feature — REMOVED (history / do not resurrect blindly)

There used to be a `ctl_*` category that force-reconnected the built-in gamepad
after the cold-boot dropout (toggling the USB `authorized` node on the ASUS
`0b05:1b4c` device). **The real fix turned out to be disabling BIOS Fast Boot** —
with that off the pad connects reliably, so the whole feature was removed.

Hard-won reasons it's gone (don't reintroduce without remembering these):
- ⚠️⚠️ A "surgical" unbind/rebind of just the gamepad interface (`1-2:1.5`) via
  `/sys/bus/usb/drivers/usbhid/{unbind,bind}` caused a full **BOOT LOOP** on
  SteamOS (recovery needed deleting the plugin dir from a live USB).
- On later SteamOS/Steam builds the whole-device `authorized` toggle started
  binding a transient "XInput Controller" and could wedge the device (dead power
  button). It's a kernel-driver handshake issue a Decky plugin can't fix.
- Detection that worked: the functional pad is the `Microsoft X-Box 360 pad` js
  node (absent on a dropout); the always-present `ASUS ROG Ally X Gamepad` node is
  NOT the signal. (Kept here in case it's ever useful again.)

## Lighting feature (led_*)

RGB stick rings live at `/sys/class/leds/ally:rgb:joystick_rings` (a Linux
multicolor LED). **Verified on-device:** `multi_index` = "rgb rgb rgb rgb" (4
zones); `multi_intensity` takes **one packed 0xRRGGBB integer PER ZONE** (4 values,
NOT 12) — writing "255 0 0 0" (255 == 0x0000FF) lit the LEFT ring blue. Separate
`brightness` node 0–255; off = brightness 0. `_led_apply` writes the packed color
to all zones (or per-side; zone 0 = left). We drive it directly (no HID grab), so
`_led_apply(_led_load())` runs at startup (unless `led_startup` is off), and
`_led_effect_loop` **relights on resume**: a big wall-clock jump (`gap > 5`) means
we were suspended, so it re-cycles off→on **unconditionally** — do NOT gate this on
the sysfs `brightness` read, which is unreliable because HID writes don't update
that node (that was the intermittent-relight bug). The sysfs-brightness check
(`_led_hw_off`) is only a best-effort periodic path for non-suspend resets. Our own
HueSync replacement, from the hardware facts, not HueSync's code (BSD-3 anyway).

**HID path (primary, `_led_apply_hid`):** the sysfs multi_intensity channel balance
is wrong (green too strong — orange needs g≈35 not 90). So colour+effects go through
the ASUS-native HID `0x5A` protocol: 64-byte OUTPUT reports to the `/dev/hidrawN`
tied to the same HID device as the LED node (found via `LED_NODE/device/hidraw/*`,
**rediscovered each apply** because a reconnect renumbers hidraw). Verified
`/dev/hidraw1`, rainbow + solid green work. Reports: `RGB_INIT`, config
`5A D1 09 01 02`, brightness `5A BA C5 C4 <0-3>`, set-color
`5A B3 zone mode r g b speed dir 00 r2 g2 b2`, `RGB_SET 5A B5`, `RGB_APPLY 5A B4`.
Modes solid(00)/breathing(01)/duality(01+2nd colour)/rainbow(02)/spiral(03); speed
low EB/med F0/high F5 (shifted up from stock E1/EB/F5). Per-channel **gamma**
(`gamma_r/g/b`, default 1.0/2.0/1.2) corrects the rings' mid-level green/blue
over-brightness — user-tunable live via calibration sliders. **Reactive** modes
(`battery`, `temp`, `gpu`) are software-driven: `_led_effect_loop` (task) EASES the
ring colour toward the sensor target each `LED_FADE_TICK` (fraction `LED_FADE_ALPHA`),
writing only while moving — smooth fade, silent at steady state. Colours from
`_grad(BATTERY_STOPS/TEMP_STOPS/GPU_STOPS, f)`; GPU load via
`/sys/class/drm/card*/device/gpu_busy_percent`. `_led_apply` routes
reactive→`_reactive_color`, else HID, else sysfs. **Per-side** (Solid only):
`split` sends the primary colour to zones 1,2 (left ring) and `right_*` to zones
3,4 (right ring); otherwise zone 0x00 (all). **Low-battery alert** (app setting):
the effect loop pulses the RED CHANNEL (dark↔bright, full brightness) below the
threshold while discharging, and does a clean off→on restore when it clears.
`_led_apply` = HID if a hidraw exists, else `_led_apply_sysfs` (solid only, off-balance).
⚠️ HID LED *writes* are safe (unlike the reverted interface unbind/rebind).

## Hardware facts

See the source plugins' CLAUDE.md — all verified battery (`BAT0`, limit resets on
resume, 0 == 100) and fan (`asus_custom_fan_curve` hwmon, pwm 0–255, enable 1/2)
facts carry over unchanged. ⚠️ **Never `grep -r` across `/sys/`** — it can
kernel-panic the ASUS WMI nodes; the probe scripts glob specific paths only.

## Conventions

- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Git user: GoatHonks / ftagamer99@gmail.com. No GitHub Actions (Actions storage full).
- Test Python logic against a fake sysfs dir before committing; TSX can't be
  compiled here — rely on on-device testing.
- Repo: https://github.com/GoatHonks/ROGToolsSteamOS (public, branch `main`, push over SSH).

## Quick actions / settings backend map

- Battery: `bat_toggle_limit` (80↔100). Fan: `fan_quick("max"|"silent")` upserts a
  dedicated "Max"/"Silent" named profile (leaves the user's own profiles intact;
  Silent stays quiet when cool but ramps to 100% when hot — never a low top end).
- `app_*` settings (app_state.json): `default_category`, `open_behavior`
  (remember|fixed), `led_startup`, `hidden` (category keys), `low_batt_alert`,
  `low_batt_pct`. `app_reset_all` deletes all state files. Frontend `Content` seeds
  the open category from these; `SettingsBody` edits them; `VERSION` const → About.

## Status (as of v1.1.0) — considered DONE

Everything above works and is verified on-device (sleep relight confirmed across
3 tests; color calibration, HID effects, per-side, reactive fade, alert restore
all confirmed). Repo is clean and pushed.

### Ideas discussed but NOT built (pick up here if continuing)

- **Named lighting profiles** — save/recall whole lighting setups via a dropdown,
  mirroring the fan profile CRUD (`add/rename/delete/select`). Highest-value next.
- **Per-zone reactive** — e.g. left ring = battery, right ring = temp, using the
  4 zones + the reactive engine together.
- **CPU-load reactive** — complete the set alongside GPU load (compute from
  `/proc/stat` deltas; there's no direct cpu_busy sysfs).
- **Charging-aware lighting** — green pulse while plugged in; flash when the charge
  limit is reached.
- **Backup/restore settings**, **full-charge toast**, **timed auto-dim** (interaction-
  based, NOT true idle — can't detect mid-game from the backend; be honest about it).
- Deliberately declined: **FPS reactive** (not readable from backend), **true idle
  dim** (would dim mid-game), reintroducing any **controller reconnect** (see history).
