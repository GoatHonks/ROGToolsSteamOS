"""Decky Loader backend for ROGTools (SteamOS) — all-in-one ROG Ally X tools.

Decky runs this backend as root, so it writes the sysfs nodes directly. The
frontend calls these methods via @decky/api's callable(). Everything lives in one
Plugin class (Decky only loads one), but the code is split into three feature
areas whose methods are name-spaced so they can't collide:

    bat_*   Battery charge limit + bypass
    fan_*   Custom fan curves (named profiles)
    ctl_*   Controllers (force-reconnect the built-in gamepad after a cold boot)

Each feature persists its own state file in DECKY_PLUGIN_SETTINGS_DIR, and the
battery + fan features each run their own watchdog (the firmware resets both on
suspend/resume / profile switch).

To add a NEW feature/category later: add a `<prefix>_*` group of methods here and
a matching category block in src/index.tsx. Nothing else is wired by name.
"""

import asyncio
import glob
import json
import os
import uuid

import decky  # provided by Decky Loader at runtime


# =====================================================================
# Shared sysfs helpers
# =====================================================================
def _read_int(path):
    with open(path) as f:
        return int(f.read().strip())


def _read_opt(path):
    """Read an int from sysfs, or None if the node is missing/unreadable."""
    try:
        return _read_int(path)
    except (FileNotFoundError, ValueError, OSError):
        return None


def _read_str(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return "Unknown"


def _write(path, value):
    with open(path, "w") as f:
        f.write(f"{value}\n")


def _settings_dir():
    d = decky.DECKY_PLUGIN_SETTINGS_DIR
    os.makedirs(d, exist_ok=True)
    return d


def _load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f)


# =====================================================================
# Battery feature (bat_*)
# =====================================================================
BAT = "BAT0"
PSY = f"/sys/class/power_supply/{BAT}"
LIMIT_FILE = f"{PSY}/charge_control_end_threshold"
CAPACITY_FILE = f"{PSY}/capacity"
STATUS_FILE = f"{PSY}/status"
ENERGY_FULL_FILE = f"{PSY}/energy_full"
ENERGY_FULL_DESIGN_FILE = f"{PSY}/energy_full_design"
ENERGY_NOW_FILE = f"{PSY}/energy_now"
POWER_FILE = f"{PSY}/power_now"
CURRENT_FILE = f"{PSY}/current_now"
VOLTAGE_FILE = f"{PSY}/voltage_now"
AC_ONLINE_FILE = "/sys/class/power_supply/AC0/online"

BAT_MIN_LIMIT = 20
BAT_MAX_LIMIT = 100
BAT_WATCHDOG_SECONDS = 20  # firmware resets the limit on resume


def _bat_state_path():
    return os.path.join(_settings_dir(), "battery_state.json")


def _bat_load():
    return _load_json(_bat_state_path(), {})


def _bat_save(state):
    _save_json(_bat_state_path(), state)


def _bat_clamp(v):
    return max(BAT_MIN_LIMIT, min(BAT_MAX_LIMIT, int(v)))


def _bat_get_limit():
    # The ASUS driver reports 0 to mean "no limit" (charge to 100%). Normalize to 100.
    v = _read_int(LIMIT_FILE)
    return BAT_MAX_LIMIT if v == 0 else v


def _bat_write_limit(v):
    _write(LIMIT_FILE, _bat_clamp(v))


def _bat_desired_limit(state):
    d = state.get("desired_limit")
    return _bat_clamp(d) if d is not None else None


def _bat_power_raw_uw():
    raw = _read_opt(POWER_FILE)
    if raw is None:
        cur = _read_opt(CURRENT_FILE)      # µA
        volt = _read_opt(VOLTAGE_FILE)     # µV
        if cur is None or volt is None:
            return None
        raw = abs(cur) * volt // 1_000_000  # µW
    return raw


def _bat_power_watts(status):
    raw = _bat_power_raw_uw()
    if raw is None:
        return None
    watts = raw / 1_000_000.0
    if status == "Discharging":
        return -watts
    if status == "Charging":
        return watts
    return 0.0


def _bat_eta_minutes(status, energy_now, energy_full):
    raw = _bat_power_raw_uw()  # µW
    if not raw or energy_now is None:
        return None, None
    if status == "Charging" and energy_full and energy_full > energy_now:
        return round((energy_full - energy_now) / raw * 60), "full"
    if status == "Discharging":
        return round(energy_now / raw * 60), "empty"
    return None, None


def _bat_enforce_once():
    try:
        state = _bat_load()
        desired = _bat_desired_limit(state)
        if desired is None:
            return
        if _read_int(LIMIT_FILE) != desired:
            _bat_write_limit(desired)
            decky.logger.info("Enforced charge limit %s%%", desired)
    except Exception:  # noqa: BLE001
        decky.logger.exception("battery enforce failed")


# =====================================================================
# Fan feature (fan_*)
# =====================================================================
FANS = (1, 2)
FAN_LABELS = {1: "CPU Fan", 2: "GPU Fan"}
NUM_POINTS = 8
PWM_MAX = 255
TEMP_MIN, TEMP_MAX = 20, 100
FAN_WATCHDOG_SECONDS = 10

DEFAULT_CURVES = {
    1: [(33, 5), (42, 17), (50, 29), (60, 41), (71, 49), (81, 60), (91, 60), (100, 60)],
    2: [(33, 9), (42, 16), (50, 24), (60, 41), (71, 59), (81, 76), (91, 76), (100, 76)],
}


def _hwmon_by_name(name):
    for name_file in glob.glob("/sys/class/hwmon/hwmon*/name"):
        try:
            with open(name_file) as f:
                if f.read().strip() == name:
                    return os.path.dirname(name_file)
        except OSError:
            continue
    return None


HW = _hwmon_by_name("asus_custom_fan_curve")
CPU_HW = _hwmon_by_name("k10temp")
GPU_HW = _hwmon_by_name("amdgpu")
ASUS_HW = _hwmon_by_name("asus")
ACPI_FAN_HW = _hwmon_by_name("acpi_fan")


def _p_temp(fan, n):
    return f"{HW}/pwm{fan}_auto_point{n}_temp"


def _p_pwm(fan, n):
    return f"{HW}/pwm{fan}_auto_point{n}_pwm"


def _p_enable(fan):
    return f"{HW}/pwm{fan}_enable"


def _pct_to_raw(pct):
    return max(0, min(PWM_MAX, round(int(pct) * PWM_MAX / 100)))


def _raw_to_pct(raw):
    return max(0, min(100, round(int(raw) * 100 / PWM_MAX)))


def _clamp_temp(t):
    return max(TEMP_MIN, min(TEMP_MAX, int(t)))


def _temp_c(hwmon, idx=1):
    if not hwmon:
        return None
    v = _read_opt(f"{hwmon}/temp{idx}_input")  # millidegC
    return round(v / 1000) if v is not None else None


def _fan_rpm(fan):
    for base in (ASUS_HW, ACPI_FAN_HW, HW):
        v = _read_opt(f"{base}/fan{fan}_input") if base else None
        if v:
            return v
    return None


def _fan_speed_pct(fan):
    v = _read_opt(f"{ASUS_HW}/pwm{fan}") if ASUS_HW else None
    return _raw_to_pct(v) if v is not None else None


def _sensors():
    return {
        "cpu_temp": _temp_c(CPU_HW, 1),
        "gpu_temp": _temp_c(GPU_HW, 1),
        "rpm": {str(f): _fan_rpm(f) for f in FANS},
        "speed_pct": {str(f): _fan_speed_pct(f) for f in FANS},
    }


def _sanitize_curve(points):
    pts = []
    for i in range(NUM_POINTS):
        if i < len(points) and points[i] is not None:
            t, p = points[i]
        else:
            t, p = DEFAULT_CURVES[1][i]
        pts.append([_clamp_temp(t), max(0, min(100, int(p)))])
    for i in range(1, NUM_POINTS):
        if pts[i][0] < pts[i - 1][0]:
            pts[i][0] = pts[i - 1][0]
    return pts


def _default_profile(name="Default"):
    return {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "curves": {str(f): [list(p) for p in DEFAULT_CURVES[f]] for f in FANS},
    }


def _fan_state_path():
    return os.path.join(_settings_dir(), "fan_state.json")


def _fan_default_state():
    prof = _default_profile()
    return {"armed": False, "active": prof["id"], "profiles": [prof]}


def _fan_normalize(st):
    base = _fan_default_state()
    if not isinstance(st, dict):
        return base
    profiles = st.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        return base
    clean = []
    for p in profiles:
        if not isinstance(p, dict):
            continue
        curves = p.get("curves", {})
        clean.append({
            "id": p.get("id") or uuid.uuid4().hex[:8],
            "name": str(p.get("name", "Profile"))[:40] or "Profile",
            "curves": {str(f): _sanitize_curve(curves.get(str(f), DEFAULT_CURVES[f])) for f in FANS},
        })
    if not clean:
        return base
    active = st.get("active")
    if active not in {p["id"] for p in clean}:
        active = clean[0]["id"]
    return {"armed": bool(st.get("armed", False)), "active": active, "profiles": clean}


def _fan_load():
    return _fan_normalize(_load_json(_fan_state_path(), None))


def _fan_save(state):
    _save_json(_fan_state_path(), state)


def _active_profile(state):
    for p in state["profiles"]:
        if p["id"] == state["active"]:
            return p
    return state["profiles"][0]


def _write_curve(fan, points):
    for n in range(1, NUM_POINTS + 1):
        t, pct = points[n - 1]
        _write(_p_temp(fan, n), _clamp_temp(t))
        _write(_p_pwm(fan, n), _pct_to_raw(pct))


def _arm(profile):
    for f in FANS:
        _write(_p_enable(f), 1)
        _write_curve(f, profile["curves"][str(f)])
        _write(_p_enable(f), 1)


def _disarm():
    for f in FANS:
        try:
            _write(_p_enable(f), 2)
        except OSError:
            decky.logger.exception("disarm fan %s failed", f)


def _public_profiles(state):
    return [{"id": p["id"], "name": p["name"]} for p in state["profiles"]]


def _fan_enforce_once():
    if HW is None:
        return
    try:
        state = _fan_load()
        if not state.get("armed"):
            return
        if any(_read_opt(_p_enable(f)) != 1 for f in FANS):
            _arm(_active_profile(state))
            decky.logger.info("Re-asserted custom fan curve")
    except Exception:  # noqa: BLE001
        decky.logger.exception("fan enforce failed")


# =====================================================================
# Controllers feature (ctl_*)
# =====================================================================
# The ROG Ally X built-in gamepad is an ASUS USB device (vendor 0b05). After a
# COLD boot it sometimes fails to initialize and only comes back on a warm
# reboot, which really just re-enumerates the USB device. "Force reconnect"
# reproduces that: toggle the USB `authorized` node (0 -> 1) on the ASUS HID
# device(s), which makes the kernel re-enumerate them without a reboot.
ASUS_USB_VENDOR = "0b05"
USB_DEVICES = "/sys/bus/usb/devices"
HID_CLASS = "03"  # bInterfaceClass for Human Interface Devices
# Auto-reconnect-at-boot tuning. Instead of blindly toggling on a timer (which
# spams connect/disconnect, drops LED plugins like HueSync, and re-runs on every
# Decky reload), we only act on a genuine boot and only when the pad is actually
# dead, stopping the moment it works.
CTL_INITIAL_WAIT = 10          # let SteamOS bring the pad up before the first check
CTL_WATCHDOG_SECONDS = 15      # how often to check the gamepad is alive
CTL_POST_RECONNECT_GRACE = 8   # wait after a reconnect before re-checking
CTL_MAX_FAILS = 5              # after this many failed reconnects in a row, back off
                               # until the pad recovers (avoids endless retry spam)


def _ctl_state_path():
    return os.path.join(_settings_dir(), "controller_state.json")


def _ctl_load():
    return _load_json(_ctl_state_path(), {})


def _ctl_save(state):
    _save_json(_ctl_state_path(), state)


# The Ally X gamepad enumerates in XInput mode as a "Microsoft X-Box 360 pad".
# That input node is what actually carries gamepad input and what Steam lists as
# a controller. The separate "ASUS ROG Ally X Gamepad" HID/N-KEY node is ALWAYS
# present (config/hotkeys) even when the pad is dead, so it can't be the signal.
# On a cold-boot dropout the X-Box 360 pad node is missing; when working it's there.
GAMEPAD_NAME_HINTS = ("x-box 360", "xbox 360")


def _controller_working():
    """True if the functional gamepad (XInput "X-Box 360 pad") input node exists."""
    for js in glob.glob("/sys/class/input/js*"):
        name = _read_str(os.path.join(js, "device", "name")).lower()
        if any(h in name for h in GAMEPAD_NAME_HINTS):
            return True
    return False


def _usb_dev_dirs():
    """Real USB device dirs (skip interfaces like '3-2:1.0' and usbN root hubs)."""
    for path in sorted(glob.glob(f"{USB_DEVICES}/*")):
        base = os.path.basename(path)
        if ":" in base or base.startswith("usb"):
            continue
        if os.path.exists(os.path.join(path, "idVendor")):
            yield path


def _usb_has_hid(dev_path):
    dev = os.path.basename(dev_path)
    for iface in glob.glob(f"{dev_path}/{dev}:*/bInterfaceClass"):
        if _read_str(iface) == HID_CLASS:
            return True
    return False


def _controller_candidates():
    """ASUS (0b05) USB devices that expose an HID interface — the gamepad(s)."""
    out = []
    for dev_path in _usb_dev_dirs():
        if _read_str(os.path.join(dev_path, "idVendor")).lower() != ASUS_USB_VENDOR:
            continue
        if not _usb_has_hid(dev_path):
            continue
        out.append({
            "dev": os.path.basename(dev_path),
            "path": dev_path,
            "product": _read_str(os.path.join(dev_path, "product")),
            "id": f"{_read_str(os.path.join(dev_path, 'idVendor'))}:"
                  f"{_read_str(os.path.join(dev_path, 'idProduct'))}",
        })
    return out


async def _reconnect_device(dev_path):
    """Re-enumerate one USB device via the authorized toggle. Returns True on success."""
    node = os.path.join(dev_path, "authorized")
    if not os.path.exists(node):
        return False
    _write(node, 0)
    await asyncio.sleep(1.0)
    _write(node, 1)
    await asyncio.sleep(0.3)
    return True


# =====================================================================
# Plugin
# =====================================================================
class Plugin:
    async def _main(self):
        decky.logger.info("ROGTools (SteamOS) backend started; fan hwmon=%s", HW)
        # Battery: apply desired limit immediately, then keep enforcing it.
        _bat_enforce_once()
        self._bat_task = asyncio.create_task(self._bat_watchdog())
        # Fan: re-assert the custom curve if armed.
        _fan_enforce_once()
        self._fan_task = asyncio.create_task(self._fan_watchdog())
        # Controllers: if enabled, watch the gamepad and reconnect whenever it's
        # dead — at boot, mid-session, or after resume — so the cold-boot (and
        # later) dropout self-heals without the (controller-driven) menu.
        self._ctl_fail_streak = 0
        self._ctl_task = asyncio.create_task(self._ctl_watchdog())

    async def _unload(self):
        for attr in ("_bat_task", "_fan_task", "_ctl_task"):
            task = getattr(self, attr, None)
            if task:
                task.cancel()
        decky.logger.info("ROGTools (SteamOS) backend stopped")

    async def _bat_watchdog(self):
        while True:
            await asyncio.sleep(BAT_WATCHDOG_SECONDS)
            _bat_enforce_once()

    async def _fan_watchdog(self):
        while True:
            await asyncio.sleep(FAN_WATCHDOG_SECONDS)
            _fan_enforce_once()

    async def _ctl_watchdog(self):
        """Keep the built-in gamepad alive: reconnect whenever it goes dead.

        Only ever acts while the pad is actually dead (no X-Box 360 pad node), so a
        working controller is never toggled — a Decky reload or normal boot with a
        live pad does nothing. After CTL_MAX_FAILS reconnects that don't take, it
        backs off until the pad recovers on its own, to avoid endless retry spam.
        """
        await asyncio.sleep(CTL_INITIAL_WAIT)  # let SteamOS bring it up first
        while True:
            try:
                if _controller_working():
                    self._ctl_fail_streak = 0
                elif _ctl_load().get("auto_reconnect"):
                    if self._ctl_fail_streak < CTL_MAX_FAILS:
                        decky.logger.info(
                            "Controller dead; auto-reconnect (streak %d)", self._ctl_fail_streak
                        )
                        try:
                            await self.ctl_reconnect()
                        except Exception:  # noqa: BLE001
                            decky.logger.exception("watchdog reconnect failed")
                        await asyncio.sleep(CTL_POST_RECONNECT_GRACE)
                        if _controller_working():
                            self._ctl_fail_streak = 0
                            decky.logger.info("Controller recovered")
                        else:
                            self._ctl_fail_streak += 1
                            if self._ctl_fail_streak >= CTL_MAX_FAILS:
                                decky.logger.warning(
                                    "Controller still dead after %d tries; backing off "
                                    "until it recovers", CTL_MAX_FAILS
                                )
            except Exception:  # noqa: BLE001
                decky.logger.exception("ctl watchdog error")
            await asyncio.sleep(CTL_WATCHDOG_SECONDS)

    # ---------------------------------------------------------------
    # Battery
    # ---------------------------------------------------------------
    async def bat_get_status(self):
        try:
            state = _bat_load()
            status = _read_str(STATUS_FILE)
            efull = _read_opt(ENERGY_FULL_FILE)
            edesign = _read_opt(ENERGY_FULL_DESIGN_FILE)
            enow = _read_opt(ENERGY_NOW_FILE)
            health = round(efull / edesign * 100) if efull and edesign else None
            power = _bat_power_watts(status)
            eta_min, eta_kind = _bat_eta_minutes(status, enow, efull)
            ac = _read_opt(AC_ONLINE_FILE)
            return {
                "ok": True,
                "capacity": _read_int(CAPACITY_FILE),
                "limit": _bat_get_limit(),
                "status": status,
                "bypass": bool(state.get("bypass", False)),
                "min": BAT_MIN_LIMIT,
                "max": BAT_MAX_LIMIT,
                "ac": None if ac is None else bool(ac),
                "health": health,
                "energy_full_wh": round(efull / 1_000_000, 1) if efull else None,
                "energy_full_design_wh": round(edesign / 1_000_000, 1) if edesign else None,
                "power_w": round(power, 1) if power is not None else None,
                "eta_min": eta_min,
                "eta_kind": eta_kind,
            }
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("bat_get_status failed")
            return {"ok": False, "error": str(e)}

    async def bat_set_limit(self, value: int):
        try:
            v = _bat_clamp(value)
            _bat_write_limit(v)
            state = _bat_load()
            if not state.get("bypass"):
                state["desired_limit"] = v
                _bat_save(state)
            return {"ok": True, "limit": v}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("bat_set_limit failed")
            return {"ok": False, "error": str(e)}

    async def bat_set_bypass(self, on: bool):
        try:
            state = _bat_load()
            if on:
                if not state.get("bypass"):
                    state["saved_limit"] = _bat_desired_limit(state) or _bat_get_limit()
                pin = _bat_clamp(_read_int(CAPACITY_FILE))
                _bat_write_limit(pin)
                state["bypass"] = True
                state["desired_limit"] = pin
                _bat_save(state)
                return {"ok": True, "bypass": True, "limit": pin}
            restore = _bat_clamp(state.get("saved_limit", BAT_MAX_LIMIT))
            _bat_write_limit(restore)
            state["bypass"] = False
            state["desired_limit"] = restore
            _bat_save(state)
            return {"ok": True, "bypass": False, "limit": restore}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("bat_set_bypass failed")
            return {"ok": False, "error": str(e)}

    # ---------------------------------------------------------------
    # Fan
    # ---------------------------------------------------------------
    async def fan_get_status(self):
        try:
            if HW is None:
                return {"ok": False, "error": "asus_custom_fan_curve hwmon not found on this kernel"}
            state = _fan_load()
            active = _active_profile(state)
            profile = "unknown"
            try:
                with open("/sys/firmware/acpi/platform_profile") as f:
                    profile = f.read().strip()
            except OSError:
                pass
            return {
                "ok": True,
                "armed": bool(state["armed"]),
                "num_points": NUM_POINTS,
                "profile": profile,
                "fan_labels": {str(k): v for k, v in FAN_LABELS.items()},
                "profiles": _public_profiles(state),
                "active": state["active"],
                "curves": active["curves"],
                "sensors": _sensors(),
            }
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_get_status failed")
            return {"ok": False, "error": str(e)}

    async def fan_set_curve(self, fan: int, points):
        try:
            if HW is None:
                return {"ok": False, "error": "hwmon not found"}
            if int(fan) not in FANS:
                return {"ok": False, "error": f"bad fan {fan}"}
            state = _fan_load()
            active = _active_profile(state)
            pts = _sanitize_curve(points)
            active["curves"][str(int(fan))] = pts
            _fan_save(state)
            if state["armed"]:
                _write(_p_enable(int(fan)), 1)
                _write_curve(int(fan), pts)
                _write(_p_enable(int(fan)), 1)
            return {"ok": True, "fan": int(fan), "curve": pts}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_set_curve failed")
            return {"ok": False, "error": str(e)}

    async def fan_sync(self, src_fan: int):
        try:
            state = _fan_load()
            active = _active_profile(state)
            src = str(int(src_fan))
            dst = str(2 if int(src_fan) == 1 else 1)
            active["curves"][dst] = [list(p) for p in active["curves"][src]]
            _fan_save(state)
            if state["armed"]:
                _arm(active)
            return {"ok": True, "curves": active["curves"]}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_sync failed")
            return {"ok": False, "error": str(e)}

    async def fan_reset_default(self):
        try:
            state = _fan_load()
            active = _active_profile(state)
            active["curves"] = {str(f): [list(p) for p in DEFAULT_CURVES[f]] for f in FANS}
            _fan_save(state)
            if state["armed"] and HW is not None:
                _arm(active)
            return {"ok": True, "curves": active["curves"]}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_reset_default failed")
            return {"ok": False, "error": str(e)}

    async def fan_set_armed(self, on: bool):
        try:
            if HW is None:
                return {"ok": False, "error": "hwmon not found"}
            state = _fan_load()
            if on:
                _arm(_active_profile(state))
            else:
                _disarm()
            state["armed"] = bool(on)
            _fan_save(state)
            return {"ok": True, "armed": bool(on)}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_set_armed failed")
            return {"ok": False, "error": str(e)}

    async def fan_select_profile(self, pid: str):
        try:
            state = _fan_load()
            if pid not in {p["id"] for p in state["profiles"]}:
                return {"ok": False, "error": "unknown profile"}
            state["active"] = pid
            _fan_save(state)
            if state["armed"] and HW is not None:
                _arm(_active_profile(state))
            return {"ok": True, "active": pid}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_select_profile failed")
            return {"ok": False, "error": str(e)}

    async def fan_add_profile(self, name: str = "New profile", copy_active: bool = True):
        try:
            state = _fan_load()
            prof = _default_profile(str(name)[:40] or "New profile")
            if copy_active:
                src = _active_profile(state)
                prof["curves"] = {f: [list(p) for p in src["curves"][f]] for f in src["curves"]}
            state["profiles"].append(prof)
            state["active"] = prof["id"]
            _fan_save(state)
            return {"ok": True, "active": prof["id"], "profiles": _public_profiles(state)}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_add_profile failed")
            return {"ok": False, "error": str(e)}

    async def fan_rename_profile(self, pid: str, name: str):
        try:
            state = _fan_load()
            for p in state["profiles"]:
                if p["id"] == pid:
                    p["name"] = str(name)[:40] or p["name"]
                    _fan_save(state)
                    return {"ok": True, "profiles": _public_profiles(state)}
            return {"ok": False, "error": "unknown profile"}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_rename_profile failed")
            return {"ok": False, "error": str(e)}

    async def fan_delete_profile(self, pid: str):
        try:
            state = _fan_load()
            if len(state["profiles"]) <= 1:
                return {"ok": False, "error": "can't delete the last profile"}
            state["profiles"] = [p for p in state["profiles"] if p["id"] != pid]
            if state["active"] == pid:
                state["active"] = state["profiles"][0]["id"]
            _fan_save(state)
            if state["armed"] and HW is not None:
                _arm(_active_profile(state))
            return {"ok": True, "active": state["active"], "profiles": _public_profiles(state)}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("fan_delete_profile failed")
            return {"ok": False, "error": str(e)}

    # ---------------------------------------------------------------
    # Controllers
    # ---------------------------------------------------------------
    async def ctl_get_status(self):
        try:
            devs = _controller_candidates()
            return {
                "ok": True,
                "count": len(devs),
                "devices": [{"dev": d["dev"], "product": d["product"], "id": d["id"]} for d in devs],
                "working": _controller_working(),
                "auto_reconnect": bool(_ctl_load().get("auto_reconnect", False)),
            }
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("ctl_get_status failed")
            return {"ok": False, "error": str(e)}

    async def ctl_set_auto(self, on: bool):
        """Toggle auto-reconnect at plugin startup (i.e. at boot)."""
        try:
            state = _ctl_load()
            state["auto_reconnect"] = bool(on)
            _ctl_save(state)
            return {"ok": True, "auto_reconnect": bool(on)}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("ctl_set_auto failed")
            return {"ok": False, "error": str(e)}

    async def ctl_reconnect(self):
        """Force-re-enumerate the ASUS HID (gamepad) USB devices — cold-boot fix."""
        try:
            devs = _controller_candidates()
            if not devs:
                return {"ok": False, "error": "No ASUS HID (0b05) USB device found"}
            done = 0
            for d in devs:
                try:
                    if await _reconnect_device(d["path"]):
                        done += 1
                        decky.logger.info("Reconnected controller %s (%s)", d["dev"], d["id"])
                except OSError:
                    decky.logger.exception("reconnect %s failed", d["dev"])
            if done == 0:
                return {"ok": False, "error": "Found controller(s) but couldn't toggle authorized"}
            return {"ok": True, "reconnected": done}
        except Exception as e:  # noqa: BLE001
            decky.logger.exception("ctl_reconnect failed")
            return {"ok": False, "error": str(e)}
