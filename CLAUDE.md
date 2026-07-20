# CLAUDE.md — ROGTools (SteamOS)

Context for continuing this project in a new session. Read this first.

## What this is

An all-in-one Decky Loader plugin for the **ASUS ROG Ally X** on **SteamOS** that
merges two earlier plugins and adds a controller fix, grouped into **collapsible
categories** in the Quick Access panel:

1. **Battery** — charge limit + bypass + health dashboard (from `ROGBatteryLimitBazz`)
2. **Fan Control** — custom fan curves + named presets (from `ROGFanControlSteamOS`)
3. **Controllers** — "Force reconnect" for the cold-boot gamepad dropout (new here)

It supersedes the two source plugins; only one should be installed at a time or
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
                   bat_*  battery   fan_*  fan curves   ctl_*  controllers
                   led_*  RGB joystick-ring lighting
                 Each feature keeps its OWN state file in DECKY_PLUGIN_SETTINGS_DIR
                 (battery_state.json / fan_state.json). Battery + fan each run a
                 watchdog started in _main.
  src/index.tsx  Quick Access UI. `CATEGORIES` registry drives collapsible
                 `Category` sections; each has a self-contained Body component
                 that only polls while expanded (`active` prop).
  probe-controller.sh   Read-only: lists ASUS HID USB devices the reconnect targets.
  install.sh / update.sh / uninstall.sh / package-zip.sh   nvm/pnpm build flow,
                 same as the source plugins. Plugin dir name: rog-tools-steamos.
```

### Adding a new category later

1. Add a `<prefix>_*` method group to the `Plugin` class in `main.py` (own state
   file if it needs one; own watchdog task in `_main` if it must survive resume).
2. Add a `<Prefix>Body({ active })` component + a `CATEGORIES` entry in `index.tsx`.
   Nothing is wired by naming convention beyond the `callable("<method>")` strings.

## Controllers feature (the new part)

Cold boot (and sometimes a few minutes into a session) leaves the built-in gamepad
uninitialised; a warm reboot fixes it because it re-enumerates the USB device.
`ctl_reconnect` reproduces that WITHOUT a reboot: find ASUS (vendor `0b05`) USB
devices that have an HID interface (`bInterfaceClass == 03`) and toggle their USB
`authorized` node `0 → 1` (1s pause). `_usb_dev_dirs` skips interface dirs
(`3-2:1.0`) and root hubs (`usbN`). **Verified on-device** on an Ally X: the target
is `0b05:1b4c` "N-KEY Device" and the toggle revives the pad.

Detection (verified): the always-present `0b05` device / the `ASUS ROG Ally X
Gamepad` js node are NOT the signal — they exist even when the pad is dead. The
functional pad enumerates in XInput mode as a **`Microsoft X-Box 360 pad`**
joystick, which is absent on a dropout. `_controller_working()` keys off that
`js*` device name (`GAMEPAD_NAME_HINTS`).

Auto-reconnect is a **watchdog** (`_ctl_watchdog`), not a one-shot/timer: every
`CTL_WATCHDOG_SECONDS` it reconnects only while the pad is dead, resets on
recovery, and backs off after `CTL_MAX_FAILS` failures until it recovers. This
handles cold-boot AND mid-session/post-resume dropouts, and never toggles a
working pad (so Decky reloads don't disturb it). Opt-in via `ctl_set_auto`.

- Earlier blind approaches (single 3s shot; 15/30/45 timer; boot-only loop) were
  rejected: too-early toggles don't stick, and blind toggling spammed connect/
  disconnect notifications, dropped HueSync LEDs, and re-ran on Decky reload.
- ⚠️⚠️ **A "surgical" unbind/rebind of just the gamepad interface (`1-2:1.5`) via
  `/sys/bus/usb/drivers/usbhid/{unbind,bind}` — meant to spare the LED interface
  and HueSync — caused a full BOOT LOOP on SteamOS** (yanking the gamepad HID out
  during Steam Input's startup crashes the gamescope session, which restarts and
  re-triggers it). Reverted. Recovery required deleting the plugin dir from a
  live/recovery environment. Do NOT reintroduce interface unbind/rebind in the
  boot/watchdog path. The whole-device `authorized` toggle (`_reconnect_device`)
  is the only reconnect method known safe here — it resets LEDs too (HueSync must
  be re-toggled), which is an accepted tradeoff.
- ⚠️ Don't broaden the target beyond ASUS HID devices without care — toggling
  `authorized` on the wrong 0b05 device (MCU, etc.) could disrupt input.

## Lighting feature (led_*)

RGB stick rings live at `/sys/class/leds/ally:rgb:joystick_rings` (a Linux
multicolor LED). **Verified on-device:** `multi_index` = "rgb rgb rgb rgb" (4
zones); `multi_intensity` takes **one packed 0xRRGGBB integer PER ZONE** (4 values,
NOT 12) — writing "255 0 0 0" (255 == 0x0000FF) lit the LEFT ring blue. Separate
`brightness` node 0–255; off = brightness 0. `_led_apply` writes the same packed
color to all zones (per-zone is a future step; zone 0 = left). We drive sysfs
directly (no HID grab), so `_led_apply(_led_load())` is called at startup AND after
every controller reconnect (which resets the rings) — this is our own replacement
for HueSync and why owning it matters. Implemented from the hardware facts, not
HueSync's code (BSD-3, but protocol/sysfs paths are non-copyrightable facts).

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
(`battery`, `temp`) are software-driven: `_led_effect_loop` (task, every
`LED_EFFECT_SECONDS`) recomputes a colour from capacity / max(CPU,GPU) temp and
renders it as solid HID. `_led_apply` routes reactive→`_reactive_color`, else HID,
else sysfs.
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
- Not yet a git repo / not yet pushed. No remote set up yet.
