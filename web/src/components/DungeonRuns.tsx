import { useState } from "react";
import type { LookupPayload, MPlusRun } from "../types.ts";
import { STALE_DAYS } from "../lib/format.ts";
import { analysisFor, costText, tableWarningText, unanalyzedRuns } from "../lib/deepdive.ts";
import { missingDungeons, runRows, runsHeadline } from "../lib/runs.ts";
import type { RunRowModel } from "../lib/runs.ts";
import type { DeepdiveActions } from "./Detail.tsx";
import { RunDeepDive } from "./RunDeepDive.tsx";

export function DungeonRuns({ payload, deepdive }: { payload: LookupPayload; deepdive: DeepdiveActions }) {
  const [open, setOpen] = useState(true);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const rows = runRows(payload);
  const missing = missingDungeons(payload);
  const pending = unanalyzedRuns(payload).length;
  const tableWarning = tableWarningText(payload.deepdiveSummary.tableWarning);
  if (rows.length === 0) return <section className="card muted">No M+ runs indexed this season.</section>;
  return (
    <section className="card section">
      <div className="section-row">
        <button type="button" className="section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={"chev" + (open ? " open" : "")}>›</span>
          <span className="section-title">Best run per dungeon</span>
          <span className="muted">{runsHeadline(payload)}</span>
        </button>
        <div className="grow" />
        {pending > 0 && (
          <button
            type="button" className="btn btn-sm"
            disabled={deepdive.analyzing !== null || !deepdive.canAfford(pending)}
            title={deepdive.canAfford(pending) ? undefined : "Hourly quota reached"}
            onClick={() => void deepdive.analyzeAll()}
          >
            {deepdive.progress ?? `Analyze all shown (${costText(pending)})`}
          </button>
        )}
      </div>
      {open && (
        <div className="runs">
          {tableWarning && <div className="dd-notice tone-warn" style={{ padding: "0 10px" }}>{tableWarning}</div>}
          {rows.map((r) => (
            <RunRow
              key={r.key} r={r} payload={payload} deepdive={deepdive}
              expanded={openRow === r.key} onToggle={() => setOpenRow(openRow === r.key ? null : r.key)}
            />
          ))}
          {missing.length > 0 && <div className="faint" style={{ fontSize: 12, padding: "4px 10px" }}>no run in: {missing.join(", ")}</div>}
        </div>
      )}
    </section>
  );
}

function RunRow({ r, payload, deepdive, expanded, onToggle }: {
  r: RunRowModel;
  payload: LookupPayload;
  deepdive: DeepdiveActions;
  expanded: boolean;
  onToggle: () => void;
}) {
  // runRows maps perDungeon.runs 1:1, so the run behind a row always exists.
  const run: MPlusRun = payload.perDungeon.runs.find((x) => `${x.reportCode}:${x.fightID}` === r.key)!;
  const a = analysisFor(payload, run);
  const busy = deepdive.analyzing === r.key;
  const anyBusy = deepdive.analyzing !== null;
  return (
    <>
      <div className="run inset">
        <div>
          <span className="mono level">+{r.level}</span>{" "}
          {r.keystone && <span className={r.keystone.timed ? "tone-good" : "tone-bad"} style={{ fontSize: 12 }}>{r.keystone.text}</span>}
        </div>
        <div className="run-main">
          {r.dungeon}
          {r.parts.length > 0 && (
            <span className="run-signals">
              {r.parts.map((p, i) => <span key={i}> · <span className={p.cls}>{p.text}</span></span>)}
            </span>
          )}
        </div>
        <div className="mono">{r.amount} <span className="muted" style={{ fontSize: 11 }}>{r.metric}</span></div>
        <div className={"mono " + r.parseCls} style={{ fontWeight: 600 }}>{r.parse}</div>
        <div className="muted">{r.spec}</div>
        <div className={r.stale ? "tone-warn" : "muted"} title={r.stale ? `older than ${STALE_DAYS} days` : undefined}>{r.age}{r.stale ? " · stale" : ""}</div>
        {!run.signals && <span className="faint" title="No WCL stats for this run">—</span>}
        {run.signals && !a && (
          <button
            type="button" className="btn btn-sm"
            disabled={anyBusy || !deepdive.canAfford(1)}
            title={deepdive.canAfford(1) ? undefined : "Hourly quota reached"}
            onClick={() => void deepdive.analyze(run)}
          >
            {busy ? <span className="spinner" /> : null} Analyze · {costText(1)}
          </button>
        )}
        {run.signals && a && (
          <button type="button" className={"btn btn-sm" + (expanded ? " active" : "")} onClick={onToggle} aria-expanded={expanded}>
            Analyzed ✓ <span className={"chev" + (expanded ? " open" : "")}>›</span>
          </button>
        )}
        <a href={r.url} target="_blank" rel="noopener" title="Open log">↗</a>
      </div>
      {expanded && a && (
        <RunDeepDive
          d={a} tableWarning={payload.deepdiveSummary.tableWarning} busy={anyBusy} canAfford={deepdive.canAfford(1)}
          onReanalyze={() => void deepdive.analyze(run, true)} onPatch={(patch) => deepdive.patch(a.className, a.spec, patch)}
        />
      )}
    </>
  );
}
