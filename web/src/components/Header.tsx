import { useState } from "react";
import type { FormEvent } from "react";
import { KeyStepper } from "./KeyStepper.tsx";
import type { UiControls } from "../lib/hostedMode.ts";
import type { LiveState } from "../lib/live/useWowCapture.ts";
import type { MenuModel } from "../lib/session.ts";
import type { LookupPayload, Region } from "../types.ts";
import { OTHER_SPEC, localeMenu, regionChipLabel, regionMenu, specChipLabel, specMenu } from "../lib/header.ts";
import { LOCALE_LABELS, detectLocale } from "../lib/locale.ts";
import type { Locale } from "../lib/locale.ts";
import { useT } from "../locale.tsx";
import { ChipMenu } from "./ChipMenu.tsx";
import { LiveChip } from "./LiveChip.tsx";
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
  /** Screen-capture state, lifted to `Main` so the Live panel shares it (see `LiveChip.tsx`). */
  live: { state: LiveState; connect: () => Promise<void> };
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
  const metricLabel = (m: "" | "dps" | "hps"): string => (m === "dps" ? t("header.metric.dps") : m === "hps" ? t("header.metric.hps") : t("header.metric.auto"));
  const chips = (
    <span className="chips">
      <ChipMenu
        label={regionChipLabel(p.region)}
        className={"chip" + (p.region !== p.instanceRegion ? " chip-on" : "")}
        head={t("header.region.remembered")}
        items={regionMenu(t, p.region)}
        onPick={(v) => p.onRegionChange(v as Region)}
        title={t("header.region.title")}
      />
      <ChipMenu
        label={specChipLabel(t, p.form.spec)}
        className={"chip" + (p.form.spec ? " chip-on" : "")}
        head={p.payload ? t("header.spec.seenOn", { name: p.payload.character.name }) : t("header.spec.loadFirst")}
        items={specMenu(t, p.payload, p.form.spec)}
        onPick={pickSpec}
        title={t("header.spec.title")}
        separateLast
      />
      {p.form.metric && <span className="chip">{metricLabel(p.form.metric)}</span>}
    </span>
  );
  const search = (
    <form className="search" onSubmit={submit}>
      <div className="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input
          value={p.form.character}
          onChange={(e) => set({ character: e.target.value })}
          placeholder={t("header.searchPlaceholder")}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        {chips}
      </div>
      <KeyStepper value={p.yourKey} fallback={p.keyFallback} onChange={p.onKeyChange} />
      <button type="submit" className="btn btn-primary btn-lg" disabled={!!p.busy}>
        {p.busy ? <span className="spinner" /> : null} {t("header.lookup")}
      </button>
    </form>
  );
  const options = open && (
    <div className="options">
      <label>{t("header.spec.title")}
        <input value={p.form.spec} placeholder={t("header.specPlaceholder")} onChange={(e) => set({ spec: e.target.value })} /></label>
      <label>{t("header.metric.title")}
        <select value={p.form.metric} onChange={(e) => set({ metric: e.target.value as LookupForm["metric"] })}>
          <option value="">{t("header.metric.auto")}</option><option value="dps">{t("header.metric.dps")}</option><option value="hps">{t("header.metric.hps")}</option>
        </select></label>
    </div>
  );
  return (
    <header className={"top" + (p.hero ? " top-hero" : "")}>
      <div className="top-row">
        <a className="brand" href="/">bmpl</a>
        {showSearch && !p.hero && search}
        <div className="grow" />
        <LiveChip state={p.live.state} connect={p.live.connect} />
        {p.controls.watch && (
          // Local mode: the EN / FR chip (design: canvas "Locale", option A); hosted mode has the row in the user menu.
          <ChipMenu
            label={LOCALE_LABELS[locale]}
            className={"chip" + (locale !== detectLocale(navigator.language) ? " chip-on" : "")}
            head={t("common.locale.remembered")}
            items={localeMenu(locale)}
            onPick={(v) => setLocale(v as Locale)}
            title={t("common.locale.title")}
          />
        )}
        {p.controls.watch && (
          <label className={"watch" + (p.watchActive ? " on" : "")} title={t("header.watch.title")}>
            <input type="checkbox" checked={p.watchActive} onChange={(e) => p.onWatchToggle(e.target.checked)} />
            <span className="switch" />
            <span>{t("header.watch.label")} <b>{p.watchActive ? t("header.watch.on") : t("header.watch.off")}</b></span>
            {p.watchLabel && <span className="muted">· {p.watchLabel}</span>}
          </label>
        )}
        {!p.sseConnected && <span className="muted" title={t("header.reconnecting")}>{t("header.liveDisconnected")}</span>}
        <a className="muted" style={{ fontSize: 13 }} href="/help">{t("common.help")}</a>
        {p.controls.setup && <button className="btn" onClick={p.onSetup}>{t("header.reconfigure")}</button>}
        {p.controls.quit && <button className="btn" onClick={p.onQuit}>{t("header.quit")}</button>}
        {p.controls.signOut && p.menu && (
          <>
            {p.menu.exhausted && <span className="mono quota-exhausted" title={t("header.quotaShare")}>{p.menu.exhausted}</span>}
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
