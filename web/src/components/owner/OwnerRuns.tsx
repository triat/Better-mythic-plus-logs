import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LookupPayload, SeasonView } from "../../types.ts";
import {
  WEEKS_PAGE, canStep, filterLabels, filterMenus, filterOptions, keyPresets, ownerRunsView, pickMenu, revealRun, stepKey, weeksFor,
} from "../../lib/ownerRuns.ts";
import type { ExpandedRun, FilterMenu, OwnerRunRow, ResultFilter, RunFilters } from "../../lib/ownerRuns.ts";
import { runDetail as runFacts } from "../../lib/runView.ts";
import { shownEvent, timelineView } from "../../lib/timeline.ts";
import type { EventPick, LayerKey } from "../../lib/timeline.ts";
import type { MessageKey } from "../../i18n/t.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import { ChipMenu } from "../ChipMenu.tsx";
import type { DeepdiveActions } from "../Detail.tsx";
import { RunDeepDive } from "../RunDeepDive.tsx";
import { SpellLink, useWowheadRefresh } from "../SpellLink.tsx";
import { DefensivesUsed, Moments } from "../candidate/RunFacts.tsx";
import { Timeline } from "../candidate/Timeline.tsx";

export interface OwnerRunsProps {
  payload: LookupPayload;
  season: SeasonView;
  deepdive: DeepdiveActions;
  /** The expanded run (the URL's `run`); null: none. */
  run: string | null;
  onRun: (key: string | null) => void;
  /** null: the defaults (every run, the full key range). Held by the page so "The N runs" of Donjons can set it. */
  filters: RunFilters | null;
  onFilters: (f: RunFilters) => void;
  layers: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey) => void;
  pick: EventPick | null;
  onPick: (pick: EventPick) => void;
}

const MENUS: readonly FilterMenu[] = ["dungeon", "spec", "weeks"];
type Col = "key" | "dungeon" | "time" | "deaths" | "dtps" | "avoidable" | "util" | "consumables" | "parse";
const COLS: readonly Col[] = ["key", "dungeon", "time", "deaths", "dtps", "avoidable", "util", "consumables", "parse"];

/** Runs (mockup F-Moi-Runs): the season's tiles, the filters, the runs grouped by game week, the expanded run. */
export function OwnerRuns(props: OwnerRunsProps) {
  const { payload, season, run, onRun, onFilters } = props;
  const { t, locale } = useT();
  const opts = useMemo(() => filterOptions(t, season), [t, season]);
  const f = props.filters ?? opts.defaults;
  const [loaded, setLoaded] = useState(WEEKS_PAGE);
  // A run named by the URL (a reload, a tile) is in a week the list may not have loaded yet.
  useEffect(() => {
    const need = run === null ? null : weeksFor(season, f, run);
    if (need !== null && need > loaded) setLoaded(need);
  }, [run, season, f, loaded]);
  const v = useMemo(() => ownerRunsView(t, locale, season, f, run, loaded), [t, locale, season, f, run, loaded]);
  const labels = filterLabels(t, f, opts);
  const menus = filterMenus(f, opts);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    if (scrollTo.current === null) return;
    rowRefs.current.get(scrollTo.current)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    scrollTo.current = null;
  });
  const colLabel = (c: Col) => t(`owner.runs.col.${c === "util" ? v.util : c}` as MessageKey);

  const onTile = (key: string) => {
    if (key === run) { onRun(null); return; }
    const r = revealRun(season, f, opts, key, loaded);
    if (r.filters !== f) onFilters(r.filters);
    setLoaded(r.loaded);
    scrollTo.current = key;
    onRun(key);
  };
  const setFilters = (next: RunFilters) => { onFilters(next); setLoaded(WEEKS_PAGE); };
  // A render helper, not a component: a component declared here would remount (and drop focus) on every render.
  const step = (label: string, text: string, bound: "min" | "max", by: 1 | -1) => (
    <button
      type="button" className="oruns-step" aria-label={label} title={label} disabled={!canStep(f, bound, by, opts.keys)}
      onClick={() => setFilters(stepKey(f, bound, by, opts.keys))}
    >
      {text}
    </button>
  );

  return (
    <div className="oruns">
      <section className="card oruns-season">
        <div className="form-card-head">
          <h2 className="synth-h2">{t("owner.runs.title")}</h2>
          <span className="oruns-legend">
            <span><i className="oruns-sw timed" aria-hidden="true" />{v.legend.timed}</span>
            <span><i className="oruns-sw depleted" aria-hidden="true" />{v.legend.depleted}</span>
            <span><i className="oruns-sw none" aria-hidden="true" />{v.legend.none}</span>
            {v.legend.otherSpec && <span><i className="oruns-sw other" aria-hidden="true" />{v.legend.otherSpec}</span>}
            <span>{v.legend.dimmed}</span>
          </span>
        </div>
        <div className="oruns-strip">
          <div className="oruns-sum">
            <span className="mono oruns-sum-big">{v.summary.timed}<span className="oruns-sum-of">/{v.summary.count}</span></span>
            <span>{v.summary.label}</span>
            <span>{v.summary.rest}</span>
          </div>
          {v.tiles.map((w) => (
            <div key={w.week} className="oruns-tweek" style={{ flexGrow: w.tiles.length }}>
              <div className="oruns-tiles">
                {w.tiles.map((x) => (
                  <button
                    key={x.key} type="button" aria-label={x.title} title={x.title} aria-pressed={x.open}
                    className={"oruns-tile mono " + x.result + (x.otherSpec ? " other" : "") + (x.shown ? "" : " dim") + (x.open ? " open" : "")}
                    onClick={() => onTile(x.key)}
                  >
                    {x.level}
                  </button>
                ))}
              </div>
              <span className="oruns-tweek-label">{w.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="oruns-filters" aria-label={t("owner.runs.filters")}>
        {opts.keys && (
          <div className="oruns-keys">
            <span>{t("owner.runs.filter.key")}</span>
            {step(t("owner.runs.filter.keyMinDown"), "−", "min", -1)}
            <span className="mono oruns-key">+{f.keyMin ?? opts.keys.min}</span>
            {step(t("owner.runs.filter.keyMinUp"), "+", "min", 1)}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            {step(t("owner.runs.filter.keyMaxDown"), "−", "max", -1)}
            <span className="mono oruns-key">+{f.keyMax ?? opts.keys.max}</span>
            {step(t("owner.runs.filter.keyMaxUp"), "+", "max", 1)}
          </div>
        )}
        {opts.keys && keyPresets(t, f, opts).map((p) => (
          <button key={p.label} type="button" className={"rl-tog" + (p.on ? " on" : "")} aria-pressed={p.on} onClick={() => setFilters(p.filters)}>
            {p.label}
          </button>
        ))}
        <div className="oruns-seg" role="group" aria-label={t("owner.runs.filter.resultGroup")}>
          {opts.results.map((r) => (
            <button
              key={r.value} type="button" className={"oruns-seg-btn" + (f.result === r.value ? " on" : "")} aria-pressed={f.result === r.value}
              onClick={() => setFilters({ ...f, result: r.value as ResultFilter })}
            >
              {r.label}
            </button>
          ))}
        </div>
        {MENUS.map((m) => (
          <ChipMenu
            key={m} label={labels[m]} head={labels[m]} items={menus[m]} className={"oruns-sel" + (menus[m].some((x) => x.value === "" && x.on) ? "" : " on")}
            onPick={(value) => setFilters(pickMenu(f, m, value))}
          />
        ))}
      </section>

      <section className="card oruns-list" aria-label={t("owner.runs.list")}>
        <div className="oruns-row oruns-head" aria-hidden="true">
          {COLS.map((c) => <span key={c} className={"oruns-th oruns-c-" + c}>{colLabel(c)}</span>)}
          <span />
        </div>
        {v.weeks.map((w) => (
          <Fragment key={w.week}>
            <div className="oruns-week">
              <strong>{w.label}</strong>
              <span>{w.line}</span>
            </div>
            {w.rows.map((r) => (
              <div key={r.key} className={"oruns-run" + (r.open ? " open" : "")} ref={(el) => { if (el) rowRefs.current.set(r.key, el); else rowRefs.current.delete(r.key); }}>
                <Row r={r} colLabel={colLabel} onClick={() => onRun(r.open ? null : r.key)} />
                {r.open && v.expanded && <Expanded {...props} ex={v.expanded} />}
              </div>
            ))}
            {w.empty && <p className="oruns-empty">{w.empty}</p>}
          </Fragment>
        ))}
        <div className="oruns-foot">
          <span>{v.footer}</span>
          {v.more && (
            <button type="button" className="btn oruns-btn" onClick={() => setLoaded(loaded + v.more!.weeks)}>{v.more.label}</button>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ r, colLabel, onClick }: { r: OwnerRunRow; colLabel: (c: Col) => string; onClick: () => void }) {
  const { t } = useT();
  const k = (c: Col) => <span className="oruns-k">{colLabel(c)} </span>;
  return (
    <button type="button" className="oruns-row oruns-rowbtn" aria-expanded={r.open} onClick={onClick}>
      <span className="oruns-c-key mono">
        <span className="oruns-level">{r.level}</span>
        <span className={"oruns-sub oruns-res-" + r.result}>{r.upgrade?.text ?? t(`owner.runs.result.${r.result}`)}</span>
      </span>
      <span className="oruns-c-dungeon">
        <span className="rl-abbr oruns-abbr" aria-hidden="true">{r.abbr}</span>
        <span className="oruns-name">
          <span className="oruns-name-text">
            {r.dungeon}{r.analysed && <span className="rl-tag"> {t("cand.runs.analysedTag")}</span>}
            {r.failed && <span className="oruns-failed" title={r.failed}> {t("owner.runs.failedTag")}</span>}
          </span>
          <span className="oruns-sub">{r.specLine}</span>
        </span>
      </span>
      <span className={"oruns-c-time mono" + (r.result === "depleted" ? " oruns-res-depleted" : "")}>{k("time")}{r.time}</span>
      <span className={"oruns-c-deaths rl-deaths-" + r.deaths.tone}>
        {k("deaths")}<span className="mono">{r.deaths.text}</span>{r.wipe && <span className="oruns-sub">{r.wipe}</span>}
      </span>
      <Stat k={k("dtps")} cls="dtps" v={r.dtps} abs={r.dtpsAbs} />
      <Stat k={k("avoidable")} cls="avoidable" v={r.avoidable} abs={r.avoidableAbs} />
      <span className="oruns-c-util mono">
        {k("util")}{r.util ? r.util.text : <span className="faint">—</span>}{r.kicksPeers && <span className="oruns-sub">{r.kicksPeers}</span>}
      </span>
      <span className="oruns-c-consumables mono">{k("consumables")}{r.consumables ?? <span className="faint">—</span>}</span>
      <span className="oruns-c-parse mono">{k("parse")}<span className={r.parse.tier ? "tier-" + r.parse.tier : "faint"}>{r.parse.text}</span></span>
      <svg className="oruns-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d={r.open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

function Stat({ k, cls, v, abs }: { k: ReactNode; cls: string; v: { text: string; tone: string } | null; abs: string | null }) {
  return (
    <span className={"mono oruns-c-" + cls}>
      {k}{v ? <span className={"delta-" + v.tone}>{v.text}</span> : <span className="faint">—</span>}
      {abs && <span className="oruns-sub">{abs}</span>}
    </span>
  );
}

function Expanded({ payload, deepdive, layers, onToggle, pick, onPick, ex }: OwnerRunsProps & { ex: ExpandedRun }) {
  const { t, locale } = useT();
  const event = shownEvent(pick, ex.key, ex.run, ex.analysis);
  const tl = useMemo(() => timelineView(t, locale, ex.run, ex.analysis, true, layers, event), [t, locale, ex, layers, event]);
  const facts = useMemo(() => runFacts(t, locale, payload, ex.run, ex.analysis), [t, locale, payload, ex]);
  const [dd, setDd] = useState(false);
  useWowheadRefresh(ex);
  const afford = deepdive.canAfford(1);
  const disabled = deepdive.analyzing !== null || !afford;
  const title = afford ? undefined : deepdive.quotaTooltip;
  const analyse = () => void deepdive.analyze(ex.run);
  const d = ex.detail;
  return (
    <div className="oruns-ex">
      {tl && (
        <Timeline view={tl} onToggle={onToggle} onSelect={(id) => onPick({ run: ex.key, id })} onAnalyse={analyse} analyseDisabled={disabled} analyseTitle={title} />
      )}
      {ex.note && <p className="muted oruns-note">{ex.note}</p>}
      {tl && (tl.moments.length > 0 || facts.defensives.length > 0) && (
        <div className="rp-foot">
          {tl.moments.length > 0 && <Moments moments={tl.moments} event={event} onSelect={(id) => onPick({ run: ex.key, id })} />}
          {facts.defensives.length > 0 && <div className="rp-defs"><DefensivesUsed rows={facts.defensives} /></div>}
        </div>
      )}
      {d && (
        <div className="oruns-blocks">
          <div className="oruns-block">
            <span className="synth-lbl">{t("owner.runs.deaths")}</span>
            {d.deaths.length === 0 && <span className="oruns-block-note">{t("owner.runs.noDeath")}</span>}
            {d.deaths.map((death, i) => (
              <div key={i} className="oruns-death">
                <span className="oruns-death-title">{death.title}</span>
                {death.hits.length === 0 && <span className="faint">—</span>}
                {death.hits.map((h, j) => (
                  <div key={j} className="oruns-line"><span><SpellLink id={h.id} name={h.ability} /></span><span className="mono">{h.share}</span></div>
                ))}
              </div>
            ))}
          </div>
          <div className="oruns-block">
            <span className="synth-lbl">{t("owner.runs.avoidable")}</span>
            {d.avoidable.length === 0 && <span className="oruns-block-note">{t("owner.runs.noAvoidable")}</span>}
            {d.avoidable.map((a) => (
              <div key={a.key} className="oruns-line"><span><SpellLink id={a.id} name={a.name} /></span><span className="mono">{a.amount}</span></div>
            ))}
          </div>
          <div className="oruns-block">
            <span className="synth-lbl">{t("self.detail.casts")}</span>
            {d.casts.length === 0 && <span className="faint">—</span>}
            {d.casts.map((c) => (
              <div key={c.id} className="oruns-line"><SpellLink id={c.id} name={c.name} /><span className="mono">{c.ofText}</span></div>
            ))}
            {d.kicked && <span className="oruns-block-note">{d.kicked}</span>}
          </div>
          <div className="oruns-block">
            <span className="synth-lbl">{t("self.control.title")}</span>
            {d.control.rate !== null && (
              <div className="oruns-rate">
                <span className="mono oruns-rate-v">{d.control.rate}</span>
                <span>{d.control.line.text} {d.control.line.delta && <span className={d.control.line.cls}>{d.control.line.delta}</span>}</span>
              </div>
            )}
            {d.control.groups.map((g) => g.rows.map((r) => (
              <div key={g.label + r.id} className="oruns-line">
                <span><span className="faint">{g.label} · </span><SpellLink id={r.id} name={r.name} />{r.pet && <span className="faint"> {r.pet}</span>}</span>
                <span className="mono">{r.uses}{r.enemies && ` · ${r.enemies}`}</span>
              </div>
            )))}
            {d.control.note && <span className="oruns-block-note">{d.control.note}</span>}
          </div>
        </div>
      )}
      <div className="oruns-actions">
        {ex.analyse && (
          <button type="button" className="btn oruns-btn" disabled={disabled} title={title} onClick={analyse}>
            {deepdive.analyzing === ex.key && <span className="spinner" />}{ex.analyse}
          </button>
        )}
        <a className="btn oruns-btn" href={ex.wcl.href} target="_blank" rel="noopener" onClick={() => track("external_log")}>{ex.wcl.label}</a>
        <span className="oruns-facts">{ex.facts}</span>
      </div>
      {ex.analysis && (
        <div className="sheet-dd">
          <button type="button" className="sheet-dd-toggle" aria-expanded={dd} onClick={() => setDd((o) => !o)}>
            <span className="sheet-dd-chev" aria-hidden="true">{dd ? "▾" : "▸"}</span>{t("cand.sheet.deepdive")}
          </button>
          {dd && (
            <RunDeepDive
              d={ex.analysis} tableWarning={payload.deepdiveSummary.tableWarning} busy={deepdive.analyzing !== null} canAfford={afford}
              quotaTooltip={deepdive.quotaTooltip} mode={deepdive.mode}
              onReanalyze={() => void deepdive.analyze(ex.run, true)}
              onPatch={(patch) => deepdive.patch(ex.analysis!.className, ex.analysis!.spec, patch)}
            />
          )}
        </div>
      )}
    </div>
  );
}
