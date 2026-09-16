import { useState } from "react";
import type { LookupPayload } from "../types.ts";
import { missingDungeons, runRows, runsHeadline } from "../lib/runs.ts";

export function DungeonRuns({ payload }: { payload: LookupPayload }) {
  const [open, setOpen] = useState(true);
  const rows = runRows(payload);
  const missing = missingDungeons(payload);
  if (rows.length === 0) return <section className="card muted">No M+ runs indexed this season.</section>;
  return (
    <section className="card section">
      <button type="button" className="section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={"chev" + (open ? " open" : "")}>›</span>
        <span className="section-title">Best run per dungeon</span>
        <span className="muted">{runsHeadline(payload)}</span>
      </button>
      {open && (
        <div className="runs">
          {rows.map((r) => (
            <div key={r.key} className="run inset">
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
              <div className={r.stale ? "tone-warn" : "muted"} title={r.stale ? `older than ${14} days` : undefined}>{r.age}{r.stale ? " · stale" : ""}</div>
              <a href={r.url} target="_blank" rel="noopener" title="Open log">↗</a>
            </div>
          ))}
          {missing.length > 0 && <div className="faint" style={{ fontSize: 12, padding: "4px 10px" }}>no run in: {missing.join(", ")}</div>}
        </div>
      )}
    </section>
  );
}
