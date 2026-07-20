# ROGTools (SteamOS)

An all-in-one [Decky Loader](https://decky.xyz) plugin for the **ASUS ROG Ally X**
on **SteamOS**. It merges the author's separate battery and fan plugins and adds
a controller fix, organised into **collapsible categories** in the Quick Access
menu so the panel stays tidy — tap a category's arrow to expand/collapse it.

## Categories

1. **Battery** — charge-limit slider + presets (80/85/90/100%), charging *bypass*
   (run off AC at the current %), and a health/power dashboard. A watchdog
   re-asserts the limit after sleep/resume (the firmware resets it).
2. **Fan Control** — a custom fan-curve editor (the "Custom" profile the Ally
   lacks): per-fan 8-point curves, named presets, live temps/RPM, and a watchdog
   that re-arms the curve after a profile switch or resume.
3. **Controllers** — **Force reconnect**. After a *cold boot* the built-in
   gamepad sometimes fails to initialize and only returns on a warm reboot. This
   button re-enumerates the ASUS HID USB device(s) (toggles the USB `authorized`
   node) so the controller comes back **without** restarting SteamOS.

More categories can be added later without restructuring — see `CLAUDE.md`.

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

This supersedes **ROG Battery (SteamOS)** and **ROG Fan Control (SteamOS)**. Run
their `uninstall.sh` (or remove them in Decky) before installing this, so two
plugins don't fight over the same sysfs nodes.

## Controllers: verifying the fix

The reconnect targets ASUS (vendor `0b05`) USB devices that expose an HID
interface. To see exactly what that matches on your unit:

```bash
cd decky-plugin
./probe-controller.sh
```

Devices listed as `HID=yes` are what the button re-enumerates.

## Safety

- Uninstalling does **not** return the fans to auto. Restore factory fan control with:
  ```bash
  for f in 1 2; do echo 2 | sudo tee /sys/class/hwmon/hwmon*/pwm${f}_enable >/dev/null; done
  ```

Tested on the ROG Ally X, SteamOS 3.8 (kernel 6.x). Not affiliated with ASUS or Valve.
