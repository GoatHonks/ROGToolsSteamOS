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

// A lightweight sub-heading inside a category (avoids nesting PanelSections).
function SubHeader({ children }: { children: ReactNode }) {
  return (
    <PanelSectionRow>
      <div style={{ fontWeight: 700, opacity: 0.9, paddingTop: "4px" }}>{children}</div>
    </PanelSectionRow>
  );
}

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
  return (
    <PanelSection>
      <PanelSectionRow>
        <Focusable
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "6px 4px",
            cursor: "pointer",
            fontWeight: 700,
          }}
          onActivate={onToggle}
          onClick={onToggle}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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

  return (
    <>
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
          label="Auto-reconnect on startup"
          description="Runs the reconnect once at boot, so a dead-on-cold-boot gamepad fixes itself before you need the menu"
          checked={!!s?.auto_reconnect}
          onChange={onAutoChange}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ fontSize: "0.75em", opacity: 0.6 }}>
          Re-enumerates the built-in gamepad without a reboot. Use the button if the controller is
          dead after a cold boot; enable the toggle once you've confirmed it works, so you never have
          to open this menu with a dead controller.
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

function Content() {
  // Start collapsed so the panel isn't cluttered; each arrow toggles its own
  // category independently (open several at once if you want).
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

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
