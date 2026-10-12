import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import type { LookupPayload, MPlusRun, RunDefensives } from "../../types.ts";
import { costText } from "../../lib/deepdive.ts";
import { dungeonAbbr } from "../../lib/runList.ts";
import { SHEET_TABS, isEditingField, sheetKey, sheetLayout, sheetRuns, sheetTabAfter, trapFocus } from "../../lib/runSheet.ts";
import type { SheetFocus, SheetTab } from "../../lib/runSheet.ts";
import { runDetail } from "../../lib/runView.ts";
import type { RunDetail, RunStat } from "../../lib/runView.ts";
import { timelineView } from "../../lib/timeline.ts";
import type { LayerKey } from "../../lib/timeline.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import type { DeepdiveActions } from "../Detail.tsx";
import { RunDeepDive } from "../RunDeepDive.tsx";
import { SpellLink, useWowheadRefresh } from "../SpellLink.tsx";
import { DefensivesUsed, Moments } from "./RunFacts.tsx";
import { Timeline } from "./Timeline.tsx";

export interface RunSheetProps {
  payload: LookupPayload;
  run: MPlusRun;
  analysis: RunDefensives | null;
  deepdive: DeepdiveActions;
  layers: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey) => void;
  event: string | null;
  onSelect: (id: string) => void;
  /** A row of the dimmed run list: show that run instead. */
  onRun: (key: string) => void;
  onClose: () => void;
  /** Opened from "Analyse détaillée": the deep-dive section starts open, scrolled to and focused. */
  focusDeepdive: boolean;
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

/** The dialog's own Tab order: what can take the focus and is shown. */
const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);

function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/**
 * The run sheet (spec decision 7, mockup F-Run): a modal dialog over the candidate page, the panel at the right
 * (`min(100vw, max(960px, 72vw))`), the run list dimmed at its left when 240 px remain. Focus is trapped inside;
 * Escape, the close button and the scrim close it. Opening it reads only; "Analyser · 3 pts" is a click.
 */
export function RunSheet(props: RunSheetProps) {
  const { payload, run, analysis, deepdive, onRun, onClose, focusDeepdive } = props;
  const { t, locale } = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ddRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const layout = sheetLayout(useViewportWidth());
  const runKey = `${run.reportCode}:${run.fightID}`;
  const list = useMemo(() => (layout.list ? sheetRuns(t, locale, payload, runKey) : []), [layout.list, t, locale, payload, runKey]);

  // The page behind does not scroll while the sheet is open.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const before = els.map((el) => el.style.overflow);
    for (const el of els) el.style.overflow = "hidden";
    return () => els.forEach((el, i) => { el.style.overflow = before[i]!; });
  }, []);
  // First focus: the deep-dive toggle when asked for, else the close button.
  useEffect(() => {
    const dd = focusDeepdive ? ddRef.current : null;
    if (dd) {
      dd.scrollIntoView({ block: "start" });
      dd.focus({ preventScroll: true });
    } else closeRef.current?.focus();
    // Only on open: switching run keeps the focus where the reader put it.
  }, []);

  // Escape and the focus trap listen on the document while the sheet is mounted, so they work wherever the focus is —
  // inside, or on the body after a click on plain text — but leave another dialog over the sheet (the palette) alone.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focus: SheetFocus = active && root.contains(active) ? "inside" : !active || active === document.body ? "none" : "outside";
      const action = sheetKey(e.key, focus, active !== null && isEditingField(active.tagName, active.getAttribute("type")));
      if (action === null) return;
      if (action === "trap") {
        const els = focusables(root);
        const next = trapFocus(focus === "inside" ? els.indexOf(active!) : -1, els.length, e.shiftKey);
        if (next === null) return;
        e.preventDefault();
        els[next]!.focus();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      // A table edit in progress: Escape leaves the field (to the panel, still inside the dialog), a second one closes.
      if (action === "leave-field") panelRef.current?.focus();
      else onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div ref={rootRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      {layout.list && (
        <nav className="sheet-list" aria-label={t("cand.sheet.list")}>
          <span className="sheet-list-title">{t("cand.sheet.list")}</span>
          <span className="sheet-list-hint">{t("cand.sheet.listHint")}</span>
          {list.map((r) => (
            <button
              key={r.key} type="button" className={"sheet-run" + (r.on ? " on" : "")} aria-pressed={r.on}
              onClick={() => { if (!r.on) onRun(r.key); }}
            >
              <span className="sheet-run-abbr" aria-hidden="true">{r.abbr}</span>
              <span className="sheet-run-main">
                <span className="sheet-run-name">{r.name}</span>
                <span className="sheet-run-sub">
                  <span className="mono sheet-run-key">{r.level}</span> · <span className={"sheet-deaths-" + r.deaths.tone}>{r.deaths.text}</span>
                </span>
              </span>
              <span className={"mono sheet-run-parse " + (r.parse.tier ? "tier-" + r.parse.tier : "faint")}>{r.parse.text}</span>
            </button>
          ))}
        </nav>
      )}
      {/* tabIndex -1: a click on plain text inside keeps the focus in the dialog instead of the page's body. */}
      <section ref={panelRef} tabIndex={-1} className={"sheet-panel" + (layout.full ? " full" : "")}>
        <SheetContent key={runKey} {...props} closeRef={closeRef} ddRef={ddRef} ddOpen={focusDeepdive} />
      </section>
    </div>,
    document.body,
  );
}

interface ContentProps extends RunSheetProps {
  closeRef: RefObject<HTMLButtonElement | null>;
  ddRef: RefObject<HTMLButtonElement | null>;
  ddOpen: boolean;
}

function SheetContent({ payload, run, analysis, deepdive, layers, onToggle, event, onSelect, onClose, closeRef, ddRef, ddOpen }: ContentProps) {
  const { t, locale } = useT();
  const d = useMemo(() => runDetail(t, locale, payload, run, analysis), [t, locale, payload, run, analysis]);
  const view = useMemo(() => timelineView(t, locale, run, analysis, false, layers, event), [t, locale, run, analysis, layers, event]);
  useWowheadRefresh(d);
  const [tab, setTab] = useState<SheetTab>("spells");
  const [dd, setDd] = useState(ddOpen);
  const tabRefs = useRef(new Map<SheetTab, HTMLButtonElement>());
  const busy = deepdive.analyzing === `${run.reportCode}:${run.fightID}`;
  const afford = deepdive.canAfford(1);
  const analyseDisabled = deepdive.analyzing !== null || !afford;
  const analyseTitle = afford ? undefined : deepdive.quotaTooltip;
  const analyse = () => void deepdive.analyze(run);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = sheetTabAfter(tab, e.key);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <>
      <header className="sheet-head">
        <div className="sheet-head-row">
          <span className="sheet-abbr" aria-hidden="true">{dungeonAbbr(run.encounterName)}</span>
          <div className="rp-title">
            <h2 id="sheet-title" className="sheet-name">
              {d.title} <span className="mono">{d.key}</span>
              {d.upgrade && <span className={"sheet-upgrade " + (d.upgrade.timed ? "rl-timed" : "rl-depleted")}> {d.upgrade.text}</span>}
            </h2>
            <span className="rp-sub">
              <span className="mono">{d.time}</span>{" · "}{d.when}
              {d.spec && <> · {d.spec}</>}
            </span>
          </div>
          <div className="sheet-actions">
            <a className="btn sheet-btn" href={d.wcl} target="_blank" rel="noopener" onClick={() => track("external_log")}>
              {t("cand.header.wclLink")}
            </a>
            <button ref={closeRef} type="button" className="btn sheet-btn sheet-close" aria-label={t("cand.sheet.close")} title={t("cand.sheet.close")} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
        {run.signals && (
          <div className="sheet-stats">
            {d.stats.map((s) => (
              <span key={s.key} className="sheet-stat">{s.label} <strong className={"mono " + statCls(s)}>{s.value}</strong></span>
            ))}
          </div>
        )}
      </header>

      <div className="sheet-body">
        {view === null && <p className="muted rp-none">{t("cand.run.noStats")}</p>}

        {view !== null && analysis === null && (
          <div className="rp-pending">
            <div className="rp-pending-text">
              <strong>{t("cand.run.notAnalysed")}</strong>
              {d.notAnalysed && <span>{d.notAnalysed}</span>}
              <span>{t("cand.run.notAnalysedText")}</span>
            </div>
            <button type="button" className="btn btn-primary sheet-btn" disabled={analyseDisabled} title={analyseTitle} onClick={analyse}>
              {busy && <span className="spinner" />}{t("runs.analyze", { cost: costText(t, 1) })}
            </button>
          </div>
        )}

        {view !== null && (
          <>
            {view.summary && <p className="sheet-summary">{view.summary}</p>}
            <Timeline
              view={view} onToggle={onToggle} onSelect={onSelect} onAnalyse={analyse}
              analyseDisabled={analyseDisabled} analyseTitle={analyseTitle}
            />
            {(view.moments.length > 0 || d.defensives.length > 0 || d.killers.length > 0) && (
              <div className="rp-foot">
                {view.moments.length > 0 && <Moments moments={view.moments} event={event} onSelect={onSelect} />}
                {(d.defensives.length > 0 || d.killers.length > 0) && (
                  <div className="rp-defs">
                    {d.defensives.length > 0 && <DefensivesUsed rows={d.defensives} />}
                    {d.killers.length > 0 && <Killers killers={d.killers} />}
                  </div>
                )}
              </div>
            )}
            <div className="sheet-tabs-wrap">
              <div className="sheet-tabs" role="tablist" aria-label={t("cand.sheet.tabs.label")}>
                {SHEET_TABS.map((k) => (
                  <button
                    key={k} id={`sheet-tab-${k}`} type="button" role="tab" aria-selected={tab === k} aria-controls="sheet-tabpanel"
                    tabIndex={tab === k ? 0 : -1} className={"sheet-tab" + (tab === k ? " on" : "")}
                    ref={(el) => { if (el) tabRefs.current.set(k, el); else tabRefs.current.delete(k); }}
                    onClick={() => setTab(k)} onKeyDown={onTabKey}
                  >
                    {t(`cand.sheet.tabs.${k}`)}
                  </button>
                ))}
              </div>
              <div id="sheet-tabpanel" role="tabpanel" aria-labelledby={`sheet-tab-${tab}`} className="sheet-tabpanel">
                {tab === "spells" ? <EnemySpells d={d} /> : <Avoidable d={d} />}
              </div>
            </div>
          </>
        )}

        {analysis !== null && (
          <section className="sheet-dd">
            <button
              ref={ddRef} type="button" className="sheet-dd-toggle" aria-expanded={dd} aria-controls="sheet-dd-body"
              onClick={() => setDd((o) => !o)}
            >
              <span className="sheet-dd-chev" aria-hidden="true">{dd ? "▾" : "▸"}</span>
              {t("cand.sheet.deepdive")}
            </button>
            {dd && (
              <div id="sheet-dd-body">
                <RunDeepDive
                  d={analysis} tableWarning={payload.deepdiveSummary.tableWarning} busy={deepdive.analyzing !== null}
                  canAfford={afford} quotaTooltip={deepdive.quotaTooltip} mode={deepdive.mode}
                  onReanalyze={() => void deepdive.analyze(run, true)}
                  onPatch={(patch) => deepdive.patch(analysis.className, analysis.spec, patch)}
                />
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}

const statCls = (s: RunStat): string =>
  s.tone.startsWith("tier-") ? s.tone : s.tone === "pass" ? "sheet-stat-pass" : "delta-" + s.tone;

function Killers({ killers }: { killers: RunDetail["killers"] }) {
  const { t } = useT();
  return (
    <>
      <span className="tl-lbl sheet-killers-lbl">{t("cand.sheet.killers")}</span>
      <div className="sheet-chips">
        {killers.map((k) => (
          <span key={k.name} className="sheet-chip"><SpellLink id={k.id} name={k.name} /> <span className="mono">{k.share}</span></span>
        ))}
      </div>
    </>
  );
}

function EnemySpells({ d }: { d: RunDetail }) {
  const { t } = useT();
  return (
    <>
      {d.enemySpells === null
        ? <p className="muted sheet-note">{t("cand.sheet.spellsNone")}</p>
        : (
          <ul className="sheet-rows">
            {d.enemySpells.map((s) => (
              <li key={s.id}><span className="sheet-row-name"><SpellLink id={s.id} name={s.name} /></span><span className="sheet-row-v">{s.text}</span></li>
            ))}
          </ul>
        )}
      <p className="faint sheet-note">{t("cand.sheet.control")}</p>
    </>
  );
}

function Avoidable({ d }: { d: RunDetail }) {
  const { t } = useT();
  if (d.avoidable === null) return <p className="muted sheet-note">{t("cand.sheet.avoidableNone")}</p>;
  if (d.avoidable.length === 0) return <p className="muted sheet-note">{t("cand.sheet.avoidableEmpty")}</p>;
  return (
    <ul className="sheet-rows">
      {d.avoidable.map((a) => (
        <li key={a.name}><span className="sheet-row-name"><SpellLink id={a.id} name={a.name} /></span><span className="mono sheet-row-v">{a.amount}</span></li>
      ))}
    </ul>
  );
}
