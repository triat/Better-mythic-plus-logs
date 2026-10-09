import { Fragment, useState } from "react";
import type { LookupPayload, SeasonView } from "../../types.ts";
import { costText } from "../../lib/deepdive.ts";
import { rowOf } from "../../lib/runs.ts";
import { runDetail, runOf } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import type { DeepdiveActions } from "../Detail.tsx";
import { DungeonRuns } from "../DungeonRuns.tsx";
import { RunDeepDive } from "../RunDeepDive.tsx";
import { RunDetailExtra } from "./RunDetailExtra.tsx";

/** Today's list (best run per dungeon) until the season store has runs; then every run of the season, newest first. */
export function RunsTab({ payload, season, deepdive, encounterID, onClearFilter }: {
  payload: LookupPayload; season: SeasonView | null; deepdive: DeepdiveActions; encounterID: number | null; onClearFilter: () => void;
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (!season || season.runs.length === 0) return <DungeonRuns payload={payload} deepdive={deepdive} />;
  const now = Date.now();
  const runs = season.runs.filter((r) => encounterID === null || r.encounterID === encounterID);
  const filterName = encounterID === null ? null : season.dungeons.find((d) => d.encounterID === encounterID)?.name ?? null;
  return (
    <section className="card section">
      <div className="section-row">
        <span className="section-title">{t("self.runs.title")}</span>
        {filterName && <button type="button" className="chip chip-on" onClick={onClearFilter}>{t("self.runs.filter", { name: filterName })}</button>}
        <span className="muted">{t("self.runs.count", { count: runs.length })}</span>
      </div>
      <div className="runs">
        {runs.map((v) => {
          const r = rowOf(t, runOf(v), v.metric, now);
          const expanded = open === v.key;
          const d = expanded ? runDetail(t, locale, v) : null;
          const a = v.analysis;
          return (
            <Fragment key={v.key}>
              <div className="run inset">
                <div>
                  <span className="mono level">+{r.level}</span>{" "}
                  {r.keystone && <span className={r.keystone.timed ? "tone-good" : "tone-bad"} style={{ fontSize: 12 }}>{r.keystone.text}</span>}
                </div>
                <div className="run-main">
                  {r.dungeon}
                  {r.parts.length > 0 && <span className="run-signals">{r.parts.map((p, i) => <span key={i}> · <span className={p.cls}>{p.text}</span></span>)}</span>}
                </div>
                <div className="mono">{r.amount} <span className="muted" style={{ fontSize: 11 }}>{r.metric}</span></div>
                <div className={"mono " + r.parseCls} style={{ fontWeight: 600 }}>{r.parse}</div>
                <div className="muted">{r.spec}</div>
                <div className={r.stale ? "tone-warn" : "muted"}>{r.age}</div>
                {v.signals ? (
                  <button type="button" className={"btn btn-sm" + (expanded ? " active" : "")} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : v.key)}>
                    {expanded ? t("self.runs.hide") : t("self.runs.details")}
                  </button>
                ) : (
                  <span className="faint" title={v.failed ? t("self.runs.failed") : undefined}>{t("self.runs.notAnalysed")}</span>
                )}
                <a href={r.url} target="_blank" rel="noopener" title={t("runs.openLog")} onClick={() => track("external_log")}>↗</a>
              </div>
              {expanded && d && <RunDetailExtra d={d} />}
              {expanded && v.signals && a && (
                <RunDeepDive
                  d={a} tableWarning={payload.deepdiveSummary.tableWarning} busy={deepdive.analyzing !== null} canAfford={deepdive.canAfford(1)}
                  quotaTooltip={deepdive.quotaTooltip} mode={deepdive.mode}
                  onReanalyze={() => void deepdive.analyze(v, true)} onPatch={(patch) => deepdive.patch(a.className, a.spec, patch)}
                />
              )}
              {expanded && v.signals && !a && (
                <div style={{ padding: "0 10px 8px" }}>
                  <button
                    type="button" className="btn btn-sm" disabled={deepdive.analyzing !== null || !deepdive.canAfford(1)}
                    title={deepdive.canAfford(1) ? undefined : deepdive.quotaTooltip} onClick={() => void deepdive.analyze(v)}
                  >
                    {deepdive.analyzing === v.key ? <span className="spinner" /> : null} {t("runs.analyze", { cost: costText(t, 1) })}
                  </button>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
