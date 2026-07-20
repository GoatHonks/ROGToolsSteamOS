import {
  definePlugin,
  ButtonItem,
  DialogButton,
  Dropdown,
  Focusable,
  PanelSection,
  PanelSectionRow,
  SliderField,
  TextField,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import { callable, toaster } from "@decky/api";
import { useEffect, useState, type ReactNode } from "react";
import {
  FaBatteryHalf,
  FaFan,
  FaGamepad,
  FaChevronDown,
  FaChevronRight,
  FaToolbox,
} from "react-icons/fa";

// ============================================================
// Backend bindings (main.py), grouped by feature prefix.
// ============================================================
// Battery
const batGetStatus = callable<[], any>("bat_get_status");
const batSetLimit = callable<[value: number], any>("bat_set_limit");
const batSetBypass = callable<[on: boolean], any>("bat_set_bypass");
// Fan
const fanGetStatus = callable<[], any>("fan_get_status");
const fanSetCurve = callable<[fan: number, points: number[][]], any>("fan_set_curve");
const fanSetArmed = callable<[on: boolean], any>("fan_set_armed");
const fanResetDefault = callable<[], any>("fan_reset_default");
const fanSync = callable<[srcFan: number], any>("fan_sync");
const fanSelectProfile = callable<[pid: string], any>("fan_select_profile");
const fanAddProfile = callable<[name: string, copyActive: boolean], any>("fan_add_profile");
const fanRenameProfile = callable<[pid: string, name: string], any>("fan_rename_profile");
const fanDeleteProfile = callable<[pid: string], any>("fan_delete_profile");
// Controllers
const ctlGetStatus = callable<[], any>("ctl_get_status");
const ctlReconnect = callable<[], any>("ctl_reconnect");
const ctlSetAuto = callable<[on: boolean], any>("ctl_set_auto");
// Lighting
const ledGetStatus = callable<[], any>("led_get_status");
const ledSet = callable<[patch: any], any>("led_set");

const toast = (title: string, body: string) => toaster.toast({ title, body });
const failToast = (title: string, r: any) => {
  if (!r?.ok) toast(title, r?.error ?? "Failed");
  return !!r?.ok;
};

// Compact button style so 2-3 buttons fit on one row without clipping the label.
const btn = {
  flex: "1 1 30%",
  minWidth: "72px",
  padding: "8px 6px",
  fontSize: "0.8em",
  whiteSpace: "nowrap" as const,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// Row that holds a group of compact buttons: wraps instead of clipping, and keeps
// clear vertical space from the control above it (e.g. the preset dropdown).
const btnRow = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "8px",
  width: "100%",
  marginTop: "10px",
};

// ============================================================
// Reusable bits
// ============================================================
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <PanelSectionRow>
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
        <span style={{ opacity: 0.8 }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{value}</span>
      </div>
    </PanelSectionRow>
  );
}

// A group heading inside a category. A top divider + spacing makes each
// subcategory read as its own clean block rather than one long list.
function SubHeader({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <PanelSectionRow>
      <div
        style={{
          width: "100%",
          fontWeight: 700,
          fontSize: "1.05em",
          letterSpacing: "0.4px",
          textTransform: "uppercase",
          opacity: 0.95,
          marginTop: first ? "2px" : "18px",
          paddingTop: first ? "2px" : "14px",
          borderTop: first ? "none" : "1px solid rgba(255,255,255,0.13)",
        }}
      >
        {children}
      </div>
    </PanelSectionRow>
  );
}

// ---- color math for the HSV spectrum picker + hex field ----
function hsvToRgb(h: number, s: number, v: number) {
  s /= 100;
  v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: mx ? (d / mx) * 100 : 0, v: mx * 100 };
}
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const rgbToHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
function hexToRgb(h: string) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((h || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const HUE_GRADIENT =
  "linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)";

// Collapsible category: a clickable header with a chevron, revealing its body.
function Category({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <PanelSection>
      <PanelSectionRow>
        <Focusable
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "8px 10px",
            marginBottom: "8px",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 700,
            // Visible highlight when this header has controller/mouse focus so you
            // can tell which category you're about to open.
            background: focused ? "rgba(255,255,255,0.16)" : "transparent",
            outline: focused ? "2px solid rgba(120,180,255,0.9)" : "2px solid transparent",
            transition: "background 0.1s ease",
          }}
          onActivate={onToggle}
          onClick={onToggle}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              paddingRight: "12px",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {icon}
            {title}
          </span>
          {open ? <FaChevronDown /> : <FaChevronRight />}
        </Focusable>
      </PanelSectionRow>
      {open && children}
    </PanelSection>
  );
}

function fmtEta(m: number | null | undefined): string | null {
  if (m == null) return null;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// ============================================================
// Battery category
// ============================================================
const BAT_PRESETS = [80, 85, 90, 100];

function BatteryBody({ active }: { active: boolean }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<any>({});
  const [pendingLimit, setPendingLimit] = useState(-1);

  const refresh = async () => {
    const r = await batGetStatus();
    if (!r?.ok) {
      setError(r?.error ?? "Failed to read battery");
      setReady(true);
      return;
    }
    setError(null);
    setS(r);
    setPendingLimit((p) => (p < 0 ? r.limit : p));
    setReady(true);
  };

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [active]);

  const onApply = async () => {
    const r = await batSetLimit(pendingLimit);
    if (!failToast("ROG Battery", r)) return;
    setPendingLimit(r.limit);
    setS((prev: any) => ({ ...prev, limit: r.limit }));
    toast("ROG Battery", `Charge limit set to ${r.limit}%`);
  };

  const applyPreset = async (p: number) => {
    const r = await batSetLimit(p);
    if (!failToast("ROG Battery", r)) return;
    setPendingLimit(r.limit);
    setS((prev: any) => ({ ...prev, limit: r.limit }));
    toast("ROG Battery", `Charge limit set to ${r.limit}%`);
  };

  const onBypassChange = async (on: boolean) => {
    const r = await batSetBypass(on);
    if (!failToast("ROG Battery", r)) return;
    toast("ROG Battery", on ? `Bypass on — pinned at ${r.limit}%` : `Bypass off — limit ${r.limit}%`);
    setPendingLimit(r.limit);
    refresh();
  };

  if (!ready) return <PanelSectionRow>Loading…</PanelSectionRow>;
  if (error) return <PanelSectionRow>Error: {error}</PanelSectionRow>;

  const powerText = s.power_w == null ? "—" : `${s.power_w > 0 ? "+" : ""}${s.power_w.toFixed(1)} W`;
  const healthText = s.health == null ? "—" : `${s.health}%`;
  const fullText =
    s.energy_full_wh == null || s.energy_full_design_wh == null
      ? "—"
      : `${s.energy_full_wh} / ${s.energy_full_design_wh} Wh`;
  const sourceText = s.ac == null ? "—" : s.ac ? "AC" : "Battery";
  const eta = fmtEta(s.eta_min);
  const etaLabel =
    s.eta_kind === "full" ? "Time to full" : s.eta_kind === "empty" ? "Time to empty" : null;

  return (
    <>
      <PanelSectionRow>
        {s.capacity}% · {s.status} · limit {s.limit}%
      </PanelSectionRow>
      <PanelSectionRow>
        <SliderField
          label="Charge limit"
          value={pendingLimit}
          min={s.min}
          max={s.max}
          step={1}
          notchTicksVisible={true}
          showValue={true}
          disabled={s.bypass}
          onChange={setPendingLimit}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", width: "100%" }}>
          {BAT_PRESETS.map((p) => (
            <DialogButton
              key={p}
              disabled={s.bypass}
              onClick={() => applyPreset(p)}
              style={{ flex: 1, minWidth: 0, padding: "8px 0", fontWeight: s.limit === p ? 700 : 400 }}
            >
              {p}%
            </DialogButton>
          ))}
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={s.bypass || pendingLimit === s.limit} onClick={onApply}>
          Apply
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Bypass charging"
          description="Pin limit to current % so it runs off AC (held even after sleep)"
          checked={s.bypass}
          onChange={onBypassChange}
        />
      </PanelSectionRow>

      <SubHeader>Battery health</SubHeader>
      <Stat label="Power source" value={sourceText} />
      <Stat label="Power" value={powerText} />
      {eta && etaLabel && <Stat label={etaLabel} value={eta} />}
      <Stat label="Health" value={healthText} />
      <Stat label="Full charge" value={fullText} />
    </>
  );
}

// ============================================================
// Fan Control category
// ============================================================
type Curve = number[][];

function FanBody({ active }: { active: boolean }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<any>({});
  const [fan, setFan] = useState<1 | 2>(1);
  const [curves, setCurves] = useState<Record<string, Curve>>({});
  const [dirty, setDirty] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const refresh = async () => {
    const r = await fanGetStatus();
    if (!r?.ok) {
      setError(r?.error ?? "Failed to read fan controller");
      setReady(true);
      return;
    }
    setError(null);
    setS(r);
    if (!dirty) setCurves(r.curves);
    setReady(true);
  };

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [active, dirty]);

  const fanLabel = (f: 1 | 2) => s.fan_labels?.[String(f)] ?? `Fan ${f}`;
  const curve: Curve = curves[String(fan)] ?? [];

  const setPointPct = (idx: number, pct: number) => {
    setCurves((prev) => {
      const next = { ...prev };
      const c = (next[String(fan)] ?? []).map((p) => [...p]);
      if (c[idx]) c[idx][1] = pct;
      next[String(fan)] = c;
      return next;
    });
    setDirty(true);
  };

  const applyBoth = async () => {
    if (curves["1"]) await fanSetCurve(1, curves["1"]);
    if (curves["2"]) await fanSetCurve(2, curves["2"]);
    setDirty(false);
  };

  const onApply = async () => {
    await applyBoth();
    refresh();
  };

  const onArmChange = async (on: boolean) => {
    if (dirty) await applyBoth();
    if (failToast("ROG Fan", await fanSetArmed(on))) refresh();
  };

  const onSync = async () => {
    if (dirty) await applyBoth();
    const r = await fanSync(fan);
    if (failToast("ROG Fan", r)) {
      setCurves(r.curves);
      setDirty(false);
      refresh();
    }
  };

  const onReset = async () => {
    const r = await fanResetDefault();
    if (failToast("ROG Fan", r)) {
      setCurves(r.curves);
      setDirty(false);
    }
  };

  const onSelectProfile = async (pid: string) => {
    if (dirty) await applyBoth();
    setRenaming(false);
    if (failToast("ROG Fan", await fanSelectProfile(pid))) {
      setDirty(false);
      refresh();
    }
  };

  const onAddProfile = async () => {
    if (failToast("ROG Fan", await fanAddProfile("New profile", true))) {
      setDirty(false);
      refresh();
    }
  };

  const onDeleteProfile = async () => {
    if (failToast("ROG Fan", await fanDeleteProfile(s.active))) {
      setDirty(false);
      refresh();
    }
  };

  const startRename = () => {
    const p = (s.profiles ?? []).find((p: any) => p.id === s.active);
    setNameDraft(p?.name ?? "");
    setRenaming(true);
  };

  const saveRename = async () => {
    if (failToast("ROG Fan", await fanRenameProfile(s.active, nameDraft || "Profile"))) {
      setRenaming(false);
      refresh();
    }
  };

  if (!ready) return <PanelSectionRow>Loading…</PanelSectionRow>;
  if (error) return <PanelSectionRow>Error: {error}</PanelSectionRow>;

  const sensors = s.sensors ?? {};
  const t = (v: any) => (v == null ? "—" : `${v}°C`);
  const rpm = (f: number) => {
    const v = sensors.rpm?.[String(f)];
    return v == null ? "—" : `${v} rpm`;
  };
  const duty = (f: number) => {
    const v = sensors.speed_pct?.[String(f)];
    return v == null ? null : `${v}%`;
  };
  const profileItems = (s.profiles ?? []).map((p: any) => ({ label: p.name, data: p.id }));

  return (
    <>
      <PanelSectionRow>
        Steam profile: {s.profile} · {s.armed ? "Custom ON" : "Factory auto"}
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Custom fan curve"
          description="Overrides the fan curve on top of the active performance profile"
          checked={s.armed}
          onChange={onArmChange}
        />
      </PanelSectionRow>

      <SubHeader>Preset</SubHeader>
      <PanelSectionRow>
        <Dropdown
          rgOptions={profileItems}
          selectedOption={s.active}
          onChange={(o) => onSelectProfile(o.data)}
        />
      </PanelSectionRow>
      {renaming ? (
        <>
          <PanelSectionRow>
            <TextField label="Name" value={nameDraft} onChange={(e: any) => setNameDraft(e.target.value)} />
          </PanelSectionRow>
          <PanelSectionRow>
            <div style={btnRow}>
              <DialogButton style={{ flex: 1, minWidth: "72px" }} onClick={saveRename}>Save</DialogButton>
              <DialogButton style={{ flex: 1, minWidth: "72px" }} onClick={() => setRenaming(false)}>Cancel</DialogButton>
            </div>
          </PanelSectionRow>
        </>
      ) : (
        <PanelSectionRow>
          <div style={btnRow}>
            <DialogButton style={btn} onClick={startRename}>Rename</DialogButton>
            <DialogButton style={btn} onClick={onAddProfile}>New</DialogButton>
            <DialogButton style={btn} disabled={(s.profiles ?? []).length <= 1} onClick={onDeleteProfile}>
              Delete
            </DialogButton>
          </div>
        </PanelSectionRow>
      )}

      <SubHeader>Fan</SubHeader>
      <PanelSectionRow>
        <div style={btnRow}>
          {([1, 2] as const).map((f) => (
            <DialogButton
              key={f}
              onClick={() => setFan(f)}
              style={{ ...btn, flex: "1 1 45%", fontWeight: fan === f ? 700 : 400 }}
            >
              {fanLabel(f)}
            </DialogButton>
          ))}
        </div>
      </PanelSectionRow>

      <SubHeader>{fanLabel(fan)} curve</SubHeader>
      {curve.map((pt, idx) => (
        <PanelSectionRow key={idx}>
          <SliderField
            label={`${pt[0]}°C`}
            value={pt[1]}
            min={0}
            max={100}
            step={5}
            showValue={true}
            onChange={(v) => setPointPct(idx, v)}
          />
        </PanelSectionRow>
      ))}
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={!dirty} onClick={onApply}>Apply</ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onSync}>
          Copy {fanLabel(fan)} → {fanLabel(fan === 1 ? 2 : 1)}
        </ButtonItem>
      </PanelSectionRow>

      <SubHeader>Info</SubHeader>
      <Stat label="CPU temp" value={t(sensors.cpu_temp)} />
      <Stat label="GPU temp" value={t(sensors.gpu_temp)} />
      <Stat label={fanLabel(1)} value={duty(1) ? `${rpm(1)} · ${duty(1)}` : rpm(1)} />
      <Stat label={fanLabel(2)} value={duty(2) ? `${rpm(2)} · ${duty(2)}` : rpm(2)} />

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onReset}>Reset to default</ButtonItem>
      </PanelSectionRow>
    </>
  );
}

// ============================================================
// Controllers category
// ============================================================
// RGB joystick-ring lighting. Driven via the ASUS HID protocol (accurate color +
// hardware effects), re-applied by the backend after a controller reconnect.
const LED_MODE_LABELS: Record<string, string> = {
  solid: "Solid",
  breathing: "Breathing",
  duality: "Duality (2 colors)",
  rainbow: "Rainbow",
  spiral: "Spiral",
  battery: "Battery level",
  temp: "Temperature",
};
const LED_SPEED_LABELS: Record<string, string> = { low: "Slow", medium: "Medium", high: "Fast" };
// Which modes expose which controls.
const LED_COLOR_MODES = ["solid", "breathing", "duality"]; // show the color picker
const LED_SPEED_MODES = ["breathing", "duality", "rainbow", "spiral"]; // show speed
const LED_DUAL_MODES = ["duality"]; // show the secondary color
const LED_REACTIVE_HINTS: Record<string, string> = {
  battery: "Rings track battery level: red (low) → yellow → green (full).",
  temp: "Rings track CPU/GPU temperature: blue (cool) → green → red (hot).",
};
const LED_GAMMA_DEFAULTS = { gamma_r: 1.0, gamma_g: 2.0, gamma_b: 1.2 };

const LED_PRESETS: [string, number, number, number][] = [
  ["Red", 255, 0, 0],
  ["Green", 0, 255, 0],
  ["Blue", 0, 0, 255],
  ["White", 255, 255, 255],
  ["Cyan", 0, 255, 255],
  ["Magenta", 255, 0, 255],
  ["Orange", 255, 90, 0],
];

// Self-contained color editor: swatch + hex + hue + saturation. Used for both the
// primary and (Duality) secondary color so each has its own saturation.
function ColorPicker({
  label,
  r,
  g,
  b,
  onColor,
}: {
  label?: string;
  r: number;
  g: number;
  b: number;
  onColor: (r: number, g: number, b: number) => void;
}) {
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  useEffect(() => setHexDraft(null), [r, g, b]); // resync when color changes externally
  const hsv = rgbToHsv(r, g, b);
  return (
    <>
      {label && (
        <PanelSectionRow>
          <div style={{ fontSize: "0.8em", opacity: 0.75, fontWeight: 600, marginTop: "4px" }}>
            {label}
          </div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
          <div
            style={{
              width: "30px",
              height: "30px",
              flex: "0 0 auto",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.3)",
              background: `rgb(${r},${g},${b})`,
            }}
          />
          <div style={{ flex: 1 }}>
            <TextField
              label="Hex"
              value={hexDraft ?? rgbToHex(r, g, b)}
              onChange={(e: any) => {
                const v = e.target.value;
                setHexDraft(v);
                const rgb = hexToRgb(v);
                if (rgb) onColor(rgb.r, rgb.g, rgb.b);
              }}
            />
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ width: "100%" }}>
          <div
            style={{
              height: "12px",
              borderRadius: "6px",
              background: HUE_GRADIENT,
              border: "1px solid rgba(255,255,255,0.2)",
              marginBottom: "-6px",
            }}
          />
          <SliderField
            label="Hue"
            value={Math.round(hsv.h)}
            min={0}
            max={360}
            step={1}
            onChange={(v) => {
              const c = hsvToRgb(v, hsv.s || 100, 100);
              onColor(c.r, c.g, c.b);
            }}
          />
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <SliderField
          label="Saturation"
          value={Math.round(hsv.s)}
          min={0}
          max={100}
          step={1}
          showValue
          onChange={(v) => {
            const c = hsvToRgb(hsv.h, v, 100);
            onColor(c.r, c.g, c.b);
          }}
        />
      </PanelSectionRow>
    </>
  );
}

function LightingControls({ active }: { active: boolean }) {
  const [s, setS] = useState<any>(null);

  useEffect(() => {
    if (active) ledGetStatus().then(setS);
  }, [active]);

  if (!s) return null;
  if (!s.ok || !s.available) {
    return (
      <>
        <SubHeader first>Lighting</SubHeader>
        <PanelSectionRow>
          <div style={{ fontSize: "0.8em", opacity: 0.7 }}>No RGB LED found on this device.</div>
        </PanelSectionRow>
      </>
    );
  }

  // Optimistically update local state, then persist+apply via the backend.
  const patch = async (p: any) => {
    setS((prev: any) => ({ ...prev, ...p }));
    const r = await ledSet(p);
    if (r?.ok) setS((prev: any) => ({ ...prev, ...r }));
  };
  const setColor = (r: number, g: number, b: number) => patch({ r, g, b, enabled: true });

  const briPct = Math.round(((s.brightness ?? 128) * 100) / 255);
  const mode = s.mode ?? "solid";
  const usesColor = LED_COLOR_MODES.includes(mode); // rainbow/spiral self-color
  const modeItems = (s.modes ?? ["solid"]).map((m: string) => ({
    label: LED_MODE_LABELS[m] ?? m,
    data: m,
  }));
  const speedItems = (s.speeds ?? ["medium"]).map((sp: string) => ({
    label: LED_SPEED_LABELS[sp] ?? sp,
    data: sp,
  }));
  const presetItems = LED_PRESETS.map(([name]) => ({ label: name, data: name }));

  return (
    <>
      <SubHeader first>Lighting</SubHeader>
      <PanelSectionRow>
        <ToggleField
          label="RGB lighting"
          description="Joystick-ring lighting — kept applied even after a controller reconnect"
          checked={!!s.enabled}
          onChange={(on) => patch({ enabled: on })}
        />
      </PanelSectionRow>
      {s.effects && (
        <PanelSectionRow>
          <div style={{ width: "100%", marginBottom: "10px" }}>
            <div style={{ fontSize: "0.8em", opacity: 0.7, marginBottom: "4px" }}>Effect</div>
            <Dropdown
              rgOptions={modeItems}
              selectedOption={mode}
              onChange={(o) => patch({ mode: o.data, enabled: true })}
            />
          </div>
        </PanelSectionRow>
      )}
      {s.effects && LED_SPEED_MODES.includes(mode) && (
        <PanelSectionRow>
          <div style={{ width: "100%", marginBottom: "10px" }}>
            <div style={{ fontSize: "0.8em", opacity: 0.7, marginBottom: "4px" }}>Speed</div>
            <Dropdown
              rgOptions={speedItems}
              selectedOption={s.speed ?? "medium"}
              onChange={(o) => patch({ speed: o.data, enabled: true })}
            />
          </div>
        </PanelSectionRow>
      )}
      {LED_REACTIVE_HINTS[mode] && (
        <PanelSectionRow>
          <div style={{ fontSize: "0.78em", opacity: 0.7 }}>{LED_REACTIVE_HINTS[mode]}</div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <SliderField
          label="Brightness"
          value={briPct}
          min={0}
          max={100}
          step={5}
          showValue
          onChange={(v) => patch({ brightness: Math.round((v * 255) / 100), enabled: true })}
        />
      </PanelSectionRow>
      {usesColor && (
        <>
          <ColorPicker r={s.r} g={s.g} b={s.b} onColor={setColor} />
          <PanelSectionRow>
            <Dropdown
              rgOptions={presetItems}
              selectedOption={undefined as any}
              strDefaultLabel="Preset colors…"
              onChange={(o) => {
                const p = LED_PRESETS.find((x) => x[0] === o.data);
                if (p) setColor(p[1], p[2], p[3]);
              }}
            />
          </PanelSectionRow>

          {LED_DUAL_MODES.includes(mode) && (
            <ColorPicker
              label="Second color"
              r={s.r2}
              g={s.g2}
              b={s.b2}
              onColor={(r, g, b) => patch({ r2: r, g2: g, b2: b, enabled: true })}
            />
          )}

          <SubHeader>Color calibration</SubHeader>
          <PanelSectionRow>
            <div style={{ fontSize: "0.75em", opacity: 0.6 }}>
              The rings' green/blue diodes run bright at mid levels. Higher = tamer channel.
              Tune until your mixes match the swatch.
            </div>
          </PanelSectionRow>
          {(["gamma_g", "gamma_b"] as const).map((k) => (
            <PanelSectionRow key={k}>
              <SliderField
                label={k === "gamma_g" ? "Green balance" : "Blue balance"}
                value={s[k] ?? LED_GAMMA_DEFAULTS[k]}
                min={0.3}
                max={3}
                step={0.05}
                showValue
                onChange={(v) => patch({ [k]: v })}
              />
            </PanelSectionRow>
          ))}
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => patch({ ...LED_GAMMA_DEFAULTS })}>
              Reset calibration
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
    </>
  );
}

function ControllerBody({ active }: { active: boolean }) {
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setS(await ctlGetStatus());
  };

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [active]);

  const onReconnect = async () => {
    setBusy(true);
    const r = await ctlReconnect();
    setBusy(false);
    if (failToast("ROG Controllers", r)) {
      toast("ROG Controllers", `Reconnected ${r.reconnected} device${r.reconnected === 1 ? "" : "s"}`);
      refresh();
    }
  };

  const onAutoChange = async (on: boolean) => {
    if (failToast("ROG Controllers", await ctlSetAuto(on))) refresh();
  };

  const detected =
    s == null ? "…" : !s.ok ? `Error: ${s.error}` : s.count === 0 ? "None detected" : `${s.count} detected`;
  const inputState = s == null || !s.ok ? "…" : s.working ? "Working" : "Not detected";

  return (
    <>
      <LightingControls active={active} />

      <SubHeader>Controller Status</SubHeader>
      <Stat label="Gamepad input" value={inputState} />
      <Stat label="ASUS controllers" value={detected} />
      {s?.ok &&
        (s.devices ?? []).map((d: any) => (
          <Stat key={d.dev} label={d.product || d.dev} value={d.id} />
        ))}
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={onReconnect}>
          {busy ? "Reconnecting…" : "Force reconnect controllers"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Auto-reconnect when dead"
          description="Watchdog revives the gamepad whenever it drops — at boot, mid-session or after resume — so you never need this menu with a dead controller"
          checked={!!s?.auto_reconnect}
          onChange={onAutoChange}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ fontSize: "0.75em", opacity: 0.6 }}>
          Re-enumerates the built-in gamepad without a reboot. Use the button if the controller is
          dead after a cold boot; leave the toggle on so drops fix themselves.
        </div>
      </PanelSectionRow>
    </>
  );
}

// ============================================================
// Category registry — add a new entry here to add a category later.
// ============================================================
const CATEGORIES: {
  key: string;
  title: string;
  icon: ReactNode;
  body: (p: { active: boolean }) => ReactNode;
}[] = [
  { key: "battery", title: "Battery", icon: <FaBatteryHalf />, body: BatteryBody },
  { key: "fan", title: "Fan Control", icon: <FaFan />, body: FanBody },
  { key: "controllers", title: "Controllers", icon: <FaGamepad />, body: ControllerBody },
];

// Remembered open/closed state, kept at module scope so it survives the panel
// unmounting when the user closes and reopens Quick Access.
let persistedOpen: Record<string, boolean> = {};

function Content() {
  // Start from whatever was open last time; each arrow toggles its own category
  // independently (open several at once if you want) and stays that way until
  // you close it again.
  const [open, setOpen] = useState<Record<string, boolean>>(persistedOpen);
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = { ...o, [key]: !o[key] };
      persistedOpen = next;
      return next;
    });

  return (
    <>
      {CATEGORIES.map((c) => {
        const isOpen = !!open[c.key];
        const Body = c.body;
        return (
          <Category
            key={c.key}
            title={c.title}
            icon={c.icon}
            open={isOpen}
            onToggle={() => toggle(c.key)}
          >
            <Body active={isOpen} />
          </Category>
        );
      })}
    </>
  );
}

export default definePlugin(() => ({
  name: "ROGTools (SteamOS)",
  titleView: <div className={staticClasses.Title}>ROGTools</div>,
  content: <Content />,
  icon: <FaToolbox />,
}));
