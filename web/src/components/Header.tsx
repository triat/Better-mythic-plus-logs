import { useState } from "react";
import type { FormEvent } from "react";
import { KeyStepper } from "./KeyStepper.tsx";
import type { UiControls } from "../lib/hostedMode.ts";
import type { MenuModel } from "../lib/session.ts";
import type { LookupPayload, Region } from "../types.ts";
import { OTHER_SPEC, localeMenu, regionChipLabel, regionMenu, specChipLabel, specMenu } from "../lib/header.ts";
import { LOCALE_LABELS, detectLocale } from "../lib/locale.ts";
import type { Locale } from "../lib/locale.ts";
import { useT } from "../locale.tsx";
import { ChipMenu } from "./ChipMenu.tsx";
import { UserMenu } from "./UserMenu.tsx";

export interface LookupForm { character: string; spec: string; metric: "" | "dps" | "hps" }
export const EMPTY_FORM: LookupForm = { character: "", spec: "", metric: "" };

interface Props {
  form: LookupForm;
  onChange: (f: LookupForm) => void;
  /** The region the next lookup uses (the setting, else the instance default). */
  region: Region;
  instanceRegion: Region;
  onRegionChange: (r: Region) => void;
  /** The shown tab's payload: its specs feed the spec picker. */
  payload: LookupPayload | null;
  yourKey: number | null;
  keyFallback: number | null;
  onKeyChange: (v: number | null) => void;
  onLookup: () => void;
  busy: string | null;              // "looking up X…" / "refreshing X…"
  watchActive: boolean;
  watchLabel: string | null;        // backend label or "looking up X…"
  onWatchToggle: (wanted: boolean) => void;
  sseConnected: boolean;
  onSetup: () => void;
  onQuit: () => void;
  /** Big centered variant for the empty state. */
  hero?: boolean;
  /** False on /admin: a lookup would have nowhere to land there. Default true. */
  search?: boolean;
  controls: UiControls;
  menu: MenuModel | null;
  pendingProposals: number | null;
  onMenuOpen: () => void;
  onSignOut: () => void;
}

export function Header(p: Props) {
  const { t, locale, setLocale } = useT();
  const [open, setOpen] = useState(false);
  const showSearch = p.search ?? true;
  const submit = (e: FormEvent) => { e.preventDefault(); if (p.form.character.trim()) p.onLookup(); };
  const set = (patch: Partial<LookupForm>) => p.onChange({ ...p.form, ...patch });
  const pickSpec = (v: string) => {
    if (v === OTHER_SPEC) { setOpen((o) => !o); return; }   // "Other…" toggles the free-text row
    set({ spec: v });
    setOpen(false);
  };
  const chips = (
    <span className="chips">
      <ChipMenu
        label={regionChipLabel(p.region)}
        className={"chip" + (p.region !== p.instanceRegion ? " chip-on" : "")}
        head="Region · remembered"
        items={regionMenu(p.region)}
        onPick={(v) => p.onRegionChange(v as Region)}
        title="Region"
      />
      <ChipMenu
        label={specChipLabel(p.form.spec)}
        className={"chip" + (p.form.spec ? " chip-on" : "")}
        head={p.payload ? `Spec · seen on ${p.payload.character.name} this season` : "Spec · load a character to pick from its specs"}
        items={specMenu(p.payload, p.form.spec)}
        onPick={pickSpec}
        title="Spec filter"
        separateLast
      />
      {p.form.metric && <span className="chip">{p.form.metric}</span>}
    </span>
  );
  const search = (
    <form className="search" onSubmit={submit}>
      <div className="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input
          value={p.form.character}
          onChange={(e) => set({ character: e.target.value })}
          placeholder="Name-Realm or Raider.IO URL"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        {chips}
      </div>
      <KeyStepper value={p.yourKey} fallback={p.keyFallback} onChange={p.onKeyChange} />
      <button type="submit" className="btn btn-primary btn-lg" disabled={!!p.busy}>
        {p.busy ? <span className="spinner" /> : null} Look up
      </button>
    </form>
  );
  const options = open && (
    <div className="options">
      <label>Spec filter
        <input value={p.form.spec} placeholder="e.g. Augmentation" onChange={(e) => set({ spec: e.target.value })} /></label>
      <label>Metric
        <select value={p.form.metric} onChange={(e) => set({ metric: e.target.value as LookupForm["metric"] })}>
          <option value="">auto</option><option value="dps">dps</option><option value="hps">hps</option>
        </select></label>
    </div>
  );
  return (
    <header className={"top" + (p.hero ? " top-hero" : "")}>
      <div className="top-row">
        <div className="brand">bmpl</div>
        {showSearch && !p.hero && search}
        <div className="grow" />
        {p.controls.watch && (
          // Local mode: the EN / FR chip (design: canvas "Locale", option A); hosted mode has the row in the user menu.
          <ChipMenu
            label={LOCALE_LABELS[locale]}
            className={"chip" + (locale !== detectLocale(navigator.language) ? " chip-on" : "")}
            head={t("common.locale.remembered")}
            items={localeMenu(t, locale)}
            onPick={(v) => setLocale(v as Locale)}
            title={t("common.locale.title")}
          />
        )}
        {p.controls.watch && (
          <label className={"watch" + (p.watchActive ? " on" : "")} title="Look up whatever Name-Realm you copy to the clipboard">
            <input type="checkbox" checked={p.watchActive} onChange={(e) => p.onWatchToggle(e.target.checked)} />
            <span className="switch" />
            <span>Clipboard watch <b>{p.watchActive ? "on" : "off"}</b></span>
            {p.watchLabel && <span className="muted">· {p.watchLabel}</span>}
          </label>
        )}
        {!p.sseConnected && <span className="muted" title="Reconnecting…">live updates disconnected</span>}
        <a className="muted" style={{ fontSize: 13 }} href="/help">Help</a>
        {p.controls.setup && <button className="btn" onClick={p.onSetup}>Re-configure</button>}
        {p.controls.quit && <button className="btn" onClick={p.onQuit}>Quit</button>}
        {p.controls.signOut && p.menu && (
          <>
            {p.menu.exhausted && <span className="mono quota-exhausted" title="Your share of the shared Warcraft Logs budget">{p.menu.exhausted}</span>}
            <UserMenu m={p.menu} pendingProposals={p.pendingProposals} onOpen={p.onMenuOpen} onSignOut={p.onSignOut} />
          </>
        )}
      </div>
      {showSearch && p.hero && <div className="hero-search">{search}</div>}
      {options}
      {p.busy && <div className="busy muted"><span className="spinner" /> {p.busy}</div>}
    </header>
  );
}
