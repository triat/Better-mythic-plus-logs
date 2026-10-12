import { useMemo, useState } from "react";
import type { Ref } from "react";
import type { LookupPayload } from "../../types.ts";
import { analysisFor, tableWarningText } from "../../lib/deepdive.ts";
import { STALE_DAYS } from "../../lib/format.ts";
import { pickRun, runListView } from "../../lib/runList.ts";
import type { RunFilter, RunListRow, RunSort } from "../../lib/runList.ts";
import { shownEvent } from "../../lib/timeline.ts";
import type { EventPick, LayerKey } from "../../lib/timeline.ts";
import type { MessageKey } from "../../i18n/t.ts";
import { useT } from "../../locale.tsx";
import type { DeepdiveActions } from "../Detail.tsx";
import { HelpLink } from "../HelpLink.tsx";
import { RunPanel } from "./RunPanel.tsx";

export interface RunsTabProps {
  payload: LookupPayload;
  deepdive: DeepdiveActions;
  /** The profile's `run` (URL state); null: the list's first row. */
  run: string | null;
  onRun: (key: string) => void;
  /** "Ouvrir en grand" on the run `key`: opens the run sheet; `deepdive`: on its deep-dive section. */
  onSheet: (key: string, deepdive?: boolean) => void;
  /** The timeline's ticked layers and picked death, shared with the run sheet (per page view, not in the URL). */
  layers: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey) => void;
  pick: EventPick | null;
  onPick: (pick: EventPick) => void;
  openRef: Ref<HTMLButtonElement>;
}

const FILTERS: readonly RunFilter[] = ["best", "deaths"];
type Col = "dungeon" | "key" | "time" | "deaths" | "dtps" | "avoidable" | "util" | "parse" | "when";
const COLS: readonly Col[] = ["dungeon", "key", "time", "deaths", "dtps", "avoidable", "util", "parse", "when"];
const SORT_OF: Partial<Record<Col, RunSort>> = { key: "key", deaths: "deaths", parse: "parse", when: "when" };

/** The Runs tab (mockup F-Runs): the filters and the batch analysis, the run grid, the selected run with its timeline. */
export function RunsTab({ payload, deepdive, run: runKey, onRun, onSheet, layers, onToggle, pick, onPick, openRef }: RunsTabProps) {
  const { t, locale } = useT();
  const [filter, setFilter] = useState<RunFilter>("best");
  const [sort, setSort] = useState<RunSort>("parse");
  const view = useMemo(() => runListView(t, locale, payload, filter, sort), [t, locale, payload, filter, sort]);
  const run = pickRun(payload, view.rows, runKey);
  const analysis = run ? analysisFor(payload, run) : null;
  const selKey = run ? `${run.reportCode}:${run.fightID}` : null;
  // The picked death belongs to one run: another run opens on its own default.
  const event = run && selKey ? shownEvent(pick, selKey, run, analysis) : null;
  const tableWarning = tableWarningText(t, payload.deepdiveSummary.tableWarning);
  const colLabel = (c: Col) => t(`cand.runs.col.${c === "util" ? view.util : c}` as MessageKey);

  return (
    <div className="runs-tab">
      <div className="rl-bar">
        <div className="rl-filters" role="group" aria-label={t("cand.runs.filters")}>
          {FILTERS.map((f) => (
            <button key={f} type="button" className={"rl-tog" + (filter === f ? " on" : "")} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`cand.runs.filter.${f}`)}
            </button>
          ))}
          <HelpLink anchor="runs" />
        </div>
        <span className="rl-analysed">{view.analysedLine}</span>
        {view.batchLabel !== null && (
          <button
            type="button" className="btn rl-btn"
            disabled={deepdive.analyzing !== null || !deepdive.canAfford(view.pending)}
            title={deepdive.canAfford(view.pending) ? undefined : deepdive.quotaTooltip}
            onClick={() => void deepdive.analyzeAll()}
          >
            {deepdive.progress ?? view.batchLabel}
          </button>
        )}
      </div>
      {tableWarning && <div className="dd-notice tone-warn">{tableWarning}</div>}

      <section className="card rl" role="table" aria-label={t("cand.runs.list")}>
        <div className="rl-row rl-head" role="row">
          <span className="rl-abbr-sp" aria-hidden="true" />
          {COLS.map((c) => {
            const s = SORT_OF[c];
            const label = colLabel(c);
            if (!s) return <span key={c} role="columnheader" className={"rl-th rl-c-" + c}>{label}</span>;
            return (
              <span key={c} role="columnheader" className={"rl-th rl-sortable rl-c-" + c} aria-sort={sort === s ? "descending" : "none"}>
                <button type="button" className={sort === s ? "on" : ""} title={t("cand.runs.sortBy", { column: label })} onClick={() => setSort(s)}>
                  {label}{sort === s ? " ↓" : ""}
                </button>
              </span>
            );
          })}
        </div>
        {view.rows.length === 0 && <p className="muted rl-empty">{t("cand.runs.empty")}</p>}
        {view.rows.map((r) => (
          <Row key={r.key} r={r} on={r.key === selKey} util={colLabel("util")} onPick={() => onRun(r.key)} />
        ))}
      </section>
      {view.missing.length > 0 && <span className="faint rl-missing">{t("runs.missing", { list: view.missing.join(", ") })}</span>}

      {run && (
        <RunPanel
          key={selKey} payload={payload} run={run} analysis={analysis} deepdive={deepdive}
          layers={layers} onToggle={onToggle} event={event} onSelect={(id) => onPick({ run: selKey!, id })}
          onOpen={() => onSheet(selKey!)} onDeepdive={() => onSheet(selKey!, true)} openRef={openRef}
        />
      )}
    </div>
  );
}

function Row({ r, on, util, onPick }: { r: RunListRow; on: boolean; util: string; onPick: () => void }) {
  const { t } = useT();
  return (
    <div role="row" className={"rl-row rl-run" + (on ? " on" : "")} onClick={onPick}>
      <span className="rl-abbr" aria-hidden="true">{r.abbr}</span>
      <span role="cell" className="rl-c-dungeon">
        <button type="button" className="rl-name" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onPick(); }}>
          <span className="rl-name-text">{r.dungeon}</span>
          {r.analysed && <span className="rl-tag">{t("cand.runs.analysedTag")}</span>}
        </button>
      </span>
      <span role="cell" className="rl-c-key mono">
        {r.level}{r.upgrade && <span className={r.upgrade.timed ? "rl-timed" : "rl-depleted"}> {r.upgrade.text}</span>}
      </span>
      <span role="cell" className="rl-c-parse mono"><span className={r.parse.tier ? "tier-" + r.parse.tier : "faint"}>{r.parse.text}</span></span>
      <span className="rl-stats">
        <span role="cell" className="rl-c-time mono muted">{r.time}</span>
        <span role="cell" className={"rl-c-deaths rl-deaths-" + r.deaths.tone}>{r.deaths.text}</span>
        <Stat cls="dtps" label={t("cand.runs.col.dtps")} v={r.dtps} />
        <Stat cls="avoidable" label={t("cand.runs.col.avoidable")} v={r.avoidable} />
        <span role="cell" className="rl-c-util mono">
          {r.util ? <><span className="rl-k">{util} </span>{r.util.text}</> : <span className="faint">—</span>}
        </span>
        <span role="cell" className={"rl-c-when" + (r.stale ? " tone-warn" : "")} title={r.stale ? t("cand.runs.stale", { days: STALE_DAYS }) : undefined}>
          {r.when}
        </span>
      </span>
    </div>
  );
}

function Stat({ cls, label, v }: { cls: string; label: string; v: { text: string; tone: string } | null }) {
  return (
    <span role="cell" className={"mono rl-c-" + cls}>
      {v ? <><span className="rl-k">{label} </span><span className={"delta-" + v.tone}>{v.text}</span></> : <span className="faint">—</span>}
    </span>
  );
}
