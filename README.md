# ROGTools (SteamOS)

An all-in-one [Decky Loader](https://decky.xyz) plugin for the **ASUS ROG Ally X**
on **SteamOS**. Battery, cooling and RGB — organised into **collapsible categories** in the Quick
Access menu so the panel stays tidy (tap a category's arrow to expand/collapse it).
It replaces the author's separate battery and fan plugins and adds full RGB
lighting control.

## Features

### 🔋 Battery
- Charge-limit slider + quick presets (80 / 85 / 90 / 100%) and a one-tap
  **80 ↔ 100% toggle**.
- **Bypass charging** — pin the limit to the current % so the Ally runs off AC
  without charging (held across sleep/resume).
- Health/power dashboard: source, ± wattage, time-to-full/empty, health %,
  full-charge Wh vs design.
- A watchdog re-asserts the limit after sleep/resume (the firmware resets it).

### 🌀 Fan Control
- A custom fan-curve editor — the "Custom" profile the Ally lacks: per-fan
  8-point curves (CPU + GPU), named presets, live temps/RPM.
- One-tap **Max** and **Silent** presets.
- A watchdog re-arms the curve after a performance-profile switch or resume.

### 💡 Lighting
Full control of the joystick-ring RGB — a self-contained replacement for HueSync,
driven directly (sysfs + the ASUS HID protocol) and re-applied automatically after
a suspend/resume.
- **Modes:** Solid, Breathing, **Duality** (breathe between two colors),
  Rainbow, Spiral.
- **Per-side colors** (Solid): independent left/right ring colors.
- **Reactive modes** (ROGTools-only): **Battery level** (red → yellow → green),
  **Temperature** (blue → yellow → red), and **GPU load** (green → yellow → red),
  updated live from the sensors with smooth fading.
- **Low-battery alert**: pulse the rings red below a chosen % while on battery.
- HSV color picker (hue spectrum + saturation) with a hex field and presets;
  brightness and effect-speed controls.
- Live **color calibration** (per-channel gamma) so mixed colors match the swatch.

### ⚙️ Settings
- **On open**: remember the last-opened category, or always open a fixed one.
- **Show/hide categories** you don't use.
- **Apply lighting at startup** toggle.
- **Low-battery alert** threshold.
- **About** (version) + **Reset all settings**.

More categories can be added without restructuring — see `CLAUDE.md`.

> **Controllers:** the built-in gamepad dropping out after a cold boot is a
> **BIOS Fast Boot** issue — disable *Fast Boot* in the ASUS BIOS and it connects
> reliably. (Earlier versions shipped a software reconnect; it became unreliable on
> current SteamOS builds and was removed in favour of the real fix.)

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

Handy if the lighting doesn't match your unit:

```bash
cd decky-plugin
./probe-leds.sh                  # maps the RGB LED sysfs node
sudo python3 probe-leds-hid.py   # tests the HID effects path (rainbow / solid)
```

## Safety

- Uninstalling does **not** return the fans to auto. Restore factory fan control with:
  ```bash
  for f in 1 2; do echo 2 | sudo tee /sys/class/hwmon/hwmon*/pwm${f}_enable >/dev/null; done
  ```

Tested on the ROG Ally X, SteamOS (kernel 6.x). Not affiliated with ASUS or Valve.
RGB protocol reimplemented from the documented ASUS/hhd/HueSync hardware interface.
