# ROGTools (SteamOS)

An all-in-one [Decky Loader](https://decky.xyz) plugin for the **ASUS ROG Ally X**
on **SteamOS**. Battery, cooling, controllers and RGB — organised into
**collapsible categories** in the Quick Access menu so the panel stays tidy (tap a
category's arrow to expand/collapse it). It replaces the author's separate battery
and fan plugins and folds in a controller fix and full RGB lighting control.

## Features

### 🔋 Battery
- Charge-limit slider + quick presets (80 / 85 / 90 / 100%).
- **Bypass charging** — pin the limit to the current % so the Ally runs off AC
  without charging (held across sleep/resume).
- Health/power dashboard: source, ± wattage, time-to-full/empty, health %,
  full-charge Wh vs design.
- A watchdog re-asserts the limit after sleep/resume (the firmware resets it).

### 🌀 Fan Control
- A custom fan-curve editor — the "Custom" profile the Ally lacks: per-fan
  8-point curves (CPU + GPU), named presets, live temps/RPM.
- A watchdog re-arms the curve after a performance-profile switch or resume.

### 🎮 Controllers
- **Force reconnect** the built-in gamepad after the cold-boot dropout — it
  re-enumerates the ASUS HID device **without** a reboot.
- **Auto-reconnect** watchdog: detects when the gamepad is dead (no
  `Microsoft X-Box 360 pad` input node) and revives it automatically — at boot,
  mid-session, or after resume. It only acts when the pad is actually dead
  (ignores transient Desktop⇄Game mode cycles) and backs off if a reconnect
  can't fix it, so it never spams.

### 💡 Lighting
Full control of the joystick-ring RGB — a self-contained replacement for HueSync,
driven directly so it **survives controller reconnects** (the LEDs are re-applied
the instant the gamepad is re-enumerated).
- **Modes:** Solid, Breathing, **Duality** (breathe between two colors),
  Rainbow, Spiral.
- **Reactive modes** (ROGTools-only): **Battery level** (red → yellow → green)
  and **Temperature** (blue → yellow → red), updated live from the sensors.
- HSV color picker (hue spectrum + saturation) with a hex field and presets;
  brightness and effect-speed controls.
- Live **color calibration** (per-channel gamma) so mixed colors match the swatch.

More categories can be added without restructuring — see `CLAUDE.md`.

## Install (on the device)

```bash
cd decky-plugin
./install.sh      # builds the frontend (nvm/corepack for pnpm) and installs to ~/homebrew/plugins
```

Then in Game Mode: **… (Quick Access) → Decky (plug icon) → ROGTools (SteamOS)**.
If it was already open, fully restart Steam so it reloads the plugin.

Other scripts: `./update.sh` (git pull + reinstall), `./uninstall.sh`,
`./package-zip.sh` (build a ZIP for Decky Developer Mode "Install from ZIP").

> **Node.js** is needed only to build the frontend, and is installed **without root**
> via [nvm](https://github.com/nvm-sh/nvm); `pnpm` comes from corepack automatically.

## Replacing the old plugins

This supersedes **ROG Battery (SteamOS)**, **ROG Fan Control (SteamOS)**, and
**HueSync** (for LED control). Remove/disable them before installing so two
plugins don't fight over the same sysfs/HID nodes.

## Diagnostics (read-only)

Handy if something doesn't match your unit:

```bash
cd decky-plugin
./probe-controller.sh    # lists the ASUS HID gamepad + the "working" detection signal
./probe-leds.sh          # maps the RGB LED sysfs node
sudo python3 probe-leds-hid.py   # tests the HID effects path (rainbow / solid)
```

## Safety

- Uninstalling does **not** return the fans to auto. Restore factory fan control with:
  ```bash
  for f in 1 2; do echo 2 | sudo tee /sys/class/hwmon/hwmon*/pwm${f}_enable >/dev/null; done
  ```
- The controller reconnect re-enumerates the whole ASUS HID device (an interface-
  only reset was tried and reverted — it caused a boot loop). This briefly resets
  the LEDs, which ROGTools re-applies automatically.

Tested on the ROG Ally X, SteamOS (kernel 6.x). Not affiliated with ASUS or Valve.
RGB protocol reimplemented from the documented ASUS/hhd/HueSync hardware interface.
