import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import type { HistoryItem, LookupPayload, Region } from "../../types.ts";
import type { UiControls } from "../../lib/hostedMode.ts";
import type { MenuModel } from "../../lib/session.ts";
import { recentList, type AccountView, type NavItem, type RecentRow } from "../../lib/shell.ts";
import type { Suggestion } from "../../lib/suggest.ts";
import { OTHER_SPEC, regionChipLabel, regionMenu, specChipLabel, specMenu } from "../../lib/header.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import { ChipMenu } from "../ChipMenu.tsx";
import { Icon } from "../Icon.tsx";
import { KeyStepper } from "../KeyStepper.tsx";
import { SearchInput } from "../SearchInput.tsx";
import { UserMenu } from "../UserMenu.tsx";
import { LocalAccount } from "./LocalAccount.tsx";
import { WhatsNew } from "./WhatsNew.tsx";
import { Logo } from "../Logo.tsx";

export interface LookupForm { character: string; spec: string; metric: "" | "dps" | "hps" }
export const EMPTY_FORM: LookupForm = { character: "", spec: "", metric: "" };

export interface SidebarProps {
  // --- the search field (today's header form) ---
  form: LookupForm;
  onFormChange: (f: LookupForm) => void;
  onLookup: () => void;
  /** "looking up X…" / "refreshing X…" while a lookup runs. */
  busy: string | null;
  /** What the field may suggest (`suggestionsOf`), and what choosing a row does. */
  suggestions: Suggestion[];
  onSuggest: (s: Suggestion) => void;
  region: Region;
  instanceRegion: Region;
  onRegionChange: (r: Region) => void;
  /** The shown profile's payload: its specs feed the spec chip. */
  payload: LookupPayload | null;
  yourKey: number | null;
  keyFallback: number | null;
  onKeyChange: (v: number | null) => void;
  sseConnected: boolean;
  // --- navigation and Récents ---
  nav: NavItem[];
  /** Récents = the history, newest first; `recentActive` is the profile open in place (null off the candidate/Live pages). */
  recentItems: HistoryItem[];
  recentActive: string | null;
  /** Switch profiles in place (the candidate and Live pages); without it a Récents row is a plain link. */
  onRecent: ((key: string) => void) | null;
  onRemove: (key: string) => void;
  onClearAll: () => void;
  // --- the account block ---
  account: AccountView;
  controls: UiControls;
  menu: MenuModel | null;
  pendingProposals: number | null;
  onMenuOpen: () => void;
  onSignOut: () => void;
  watch: { active: boolean; label: string | null };
  onWatchToggle: (wanted: boolean) => void;
  onSetup: () => void;
  onQuit: () => void;
  /** The running version: the line under the account block that opens the changelog (null: no line). */
  version: string | null;
}

/**
 * The frame's left column (redesign spec decision 1, mockup F-Palette): logo, the 48 px search field with the region,
 * spec and key chips under it, the navigation, Récents (history) and the account block at the bottom.
 */
export function Sidebar(p: SidebarProps & { onOpenPalette: () => void }) {
  const { t } = useT();
  const [options, setOptions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const recent = recentList(p.recentItems, p.recentActive, expanded);
  const set = (patch: Partial<LookupForm>) => p.onFormChange({ ...p.form, ...patch });
  const submit = (e: FormEvent) => { e.preventDefault(); if (p.form.character.trim() && !p.busy) p.onLookup(); };
  const pickSpec = (v: string) => {
    if (v === OTHER_SPEC) { setOptions((o) => !o); return; }   // "Other…" toggles the free-text row
    track("spec_pick");
    set({ spec: v });
    setOptions(false);
  };
  const typed = p.form.character.trim() !== "";
  return (
    <aside className="sidebar">
      <Logo className="side-logo" />
      <div className="side-search-wrap">
        <form className="side-search" role="search" aria-label={t("shell.search.label")} onSubmit={submit}>
          <div className="search-box">
            <Icon name="search" size={18} />
            <SearchInput
              value={p.form.character}
              onChange={(v) => set({ character: v })}
              placeholder={t("header.searchPlaceholder")}
              suggestions={p.suggestions}
              onPick={p.onSuggest}
            />
            {typed ? (
              <button type="submit" className="side-go" disabled={!!p.busy} aria-label={t("shell.search.submit")} title={t("shell.search.submit")}>
                {p.busy ? <span className="spinner" /> : <Icon name="arrow" size={16} />}
              </button>
            ) : (
              <button type="button" className="kbd side-kbd" onClick={p.onOpenPalette} title={t("shell.paletteOpen")} aria-label={t("shell.paletteOpen")}>
                {t("shell.paletteKey")}
              </button>
            )}
          </div>
        </form>
        <div className="side-chips">
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
          {p.form.metric && <span className="chip">{p.form.metric === "dps" ? t("header.metric.dps") : t("header.metric.hps")}</span>}
        </div>
        <KeyStepper value={p.yourKey} fallback={p.keyFallback} onChange={p.onKeyChange} />
        {options && (
          <div className="options">
            <label>{t("header.spec.title")}
              <input value={p.form.spec} placeholder={t("header.specPlaceholder")} onChange={(e) => set({ spec: e.target.value })} /></label>
            <label>{t("header.metric.title")}
              <select value={p.form.metric} onChange={(e) => { track("metric_pick"); set({ metric: e.target.value as LookupForm["metric"] }); }}>
                <option value="">{t("header.metric.auto")}</option><option value="dps">{t("header.metric.dps")}</option><option value="hps">{t("header.metric.hps")}</option>
              </select></label>
          </div>
        )}
        {p.busy && <div className="side-note muted"><span className="spinner" /> {p.busy}</div>}
        {!p.sseConnected && <div className="side-note faint" title={t("header.reconnecting")}>{t("header.liveDisconnected")}</div>}
      </div>

      <nav className="side-nav" aria-label={t("shell.navLabel")}>
        {p.nav.map((n) => (
          <a key={n.key} href={n.href} className={"nav-a" + (n.active ? " on" : "")} aria-current={n.active ? "page" : undefined}>
            <Icon name={n.icon} size={18} />
            <span>{n.label}</span>
            {n.count !== undefined && <span className="nav-count mono">{n.count}</span>}
            {n.dot && <span className={"nav-dot " + n.dot} aria-hidden="true" />}
          </a>
        ))}
      </nav>

      {recent.rows.length > 0 && (
        <section className="side-recent" aria-labelledby="side-recent-title">
          <h2 className="side-label" id="side-recent-title">{t("shell.recent.title")}</h2>
          <ul>
            {recent.rows.map((r) => <Recent key={r.key} row={r} onRecent={p.onRecent} onRemove={p.onRemove} />)}
          </ul>
          {recent.toggle && (
            <button type="button" className="side-clear" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? t("shell.recent.showLess") : t("shell.recent.showMore", { count: recent.hidden })}
            </button>
          )}
          <button type="button" className="side-clear" onClick={p.onClearAll}>{t("shell.recent.clearAll")}</button>
        </section>
      )}

      <div className="side-account">
        {p.controls.signOut && p.menu ? (
          <UserMenu m={p.menu} lines={p.account.lines} links={p.account.links.menu} pendingProposals={p.pendingProposals} onOpen={p.onMenuOpen} onSignOut={p.onSignOut} />
        ) : (
          <LocalAccount title={p.account.title} controls={p.controls} watch={p.watch} onWatchToggle={p.onWatchToggle} onSetup={p.onSetup} onQuit={p.onQuit} />
        )}
        {p.version && <WhatsNew version={p.version} />}
        {p.account.links.side.length > 0 && (
          <div className="side-links">
            {p.account.links.side.map((l, i) => (
              <span key={l.key}>
                {i > 0 && <span className="side-links-sep" aria-hidden="true">·</span>}
                <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
              </span>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** A Récents row: verdict dot, name, score; its "⋯" menu holds Remove. */
function Recent({ row, onRecent, onRemove }: { row: RecentRow; onRecent: ((key: string) => void) | null; onRemove: (key: string) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const click = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    // Modified clicks keep the link's own behaviour (new tab, new window).
    if (!onRecent || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onRecent(row.key);
  };
  const tone = row.verdict ?? "none";
  return (
    <li className={"recent" + (row.active ? " on" : "")} ref={ref}>
      <a href={row.href} className="recent-a" onClick={click} aria-current={row.active ? "page" : undefined}>
        <span className={"recent-dot " + tone} aria-hidden="true" />
        <span className="recent-name">{row.name}</span>
        <span className={"recent-score mono " + tone}>{row.score}</span>
        {row.spread && <span className="rel-spread mono">{row.spread}</span>}
        {row.unproven && <span className="rel-mark" role="img" aria-label={t("cand.rel.unprovenMark")} title={t("cand.rel.unprovenMark")}><Icon name="warn" size={12} /></span>}
      </a>
      <button type="button" className="recent-more" aria-label={t("shell.recent.more", { name: row.name })} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div className="menu card recent-menu" role="menu">
          <button type="button" className="menu-item" role="menuitem" onClick={() => { setOpen(false); onRemove(row.key); }}>{t("shell.recent.remove")}</button>
        </div>
      )}
    </li>
  );
}
