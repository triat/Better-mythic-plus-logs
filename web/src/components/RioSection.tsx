import { useState } from "react";
import type { LookupPayload } from "../types.ts";
import { fmtAge, fmtDuration, rioHref } from "../lib/format.ts";

export function RioSection({ payload }: { payload: LookupPayload }) {
  const [open, setOpen] = useState(false);
  const rio = payload.rio;
  if (!rio) return <section className="card muted">Raider.IO: {payload.rioError ?? "no data"}</section>;
  const profile = rioHref(rio.profileUrl);
  const recent = rio.recentRuns.slice(0, 10);
  const last = rio.derived.lastRunAt;
  const current = rio.seasons[0];
  return (
    <section className="card section">
      <div className="section-head">
        <button type="button" className="section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={"chev" + (open ? " open" : "")}>›</span>
          <span className="section-title">Recent runs (Raider.IO)</span>
          <span className="muted">
            {rio.derived.recentTotal} runs · {rio.derived.recentTimed} timed{last ? ` · last ${fmtAge(last)}` : ""}
            {current && current.all > 0 ? ` · score ${current.all.toFixed(0)}` : ""}
          </span>
        </button>
        <div className="grow" />
        {profile ? <a href={profile} target="_blank" rel="noopener" style={{ fontSize: 12 }}>profile ↗</a> : <span className="faint">profile</span>}
      </div>
      {open && (
        <div className="runs">
          {recent.length === 0 && <div className="faint">(no recent runs)</div>}
          {recent.map((r) => {
            const href = rioHref(r.url);
            return (
              <div key={r.url + r.completedAt} className="run run-rio inset">
                <span className="mono level">+{r.level}</span>
                <span>{r.dungeon}</span>
                <span className={r.chests > 0 ? "tone-good" : "tone-bad"}>{r.chests > 0 ? `✓+${r.chests}` : "✗ depleted"}</span>
                <span className="muted mono">{fmtDuration(r.clearMs)} / {fmtDuration(r.parMs)}</span>
                <span className="muted">{fmtAge(r.completedAt)}</span>
                {href ? <a href={href} target="_blank" rel="noopener" title="Open on Raider.IO">↗</a> : <span />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
