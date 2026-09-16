import { classHex, className } from "@shared/wow/classes.ts";
import type { LookupPayload } from "../types.ts";
import { axisRows, heroStats, radarPoints } from "../lib/axes.ts";
import { realmName } from "../lib/format.ts";
import { verdictView } from "../lib/verdict.ts";
import type { ReevalHint } from "../lib/keyLevel.ts";
import { AxisRows } from "./AxisRows.tsx";
import { Radar } from "./Radar.tsx";

export function VerdictHero({ payload, hint, onReevaluate }: { payload: LookupPayload; hint: ReevalHint | null; onReevaluate: () => void }) {
  const c = payload.character;
  const v = verdictView(payload.evaluation, payload.targetAutoDetected);
  const color = classHex(c.classID);
  const other = payload.metric === "hps" ? "dps" : "hps";
  return (
    <section className="card hero">
      <div className="hero-left">
        <div className="identity">
          <span className="name" style={{ color }}>{c.name}</span>
          <span style={{ color }}>{c.spec ? `${c.spec} ` : ""}{className(c.classID)}</span>
          <span className="muted">{realmName(c.realmSlug)} · {c.region.toUpperCase()}</span>
        </div>
        <div className="verdict-row">
          <div className={"badge " + v.cls}>
            <span className="badge-label">{v.label}</span>
            {v.score !== null && <span className="badge-score mono">{v.score}</span>}
            <span className="badge-sub">{v.sub}</span>
          </div>
          {hint && (
            <div className="reeval">
              {hint.label} — <a href="#" onClick={(e) => { e.preventDefault(); onReevaluate(); }}>{hint.action}</a>
              <span className="faint"> (replaces this tab · cached data)</span>
            </div>
          )}
        </div>
        <div className="stats muted">
          {heroStats(payload).map((s) => (
            <span key={s.label}><b>{s.value}</b> {s.label}{s.sub && <span className="faint"> {s.sub}</span>}</span>
          ))}
        </div>
        <div className="metaline faint">
          {payload.zone.name} · runs indexed <b>{payload.runsIndexed}</b>
          {payload.metricAutoSelected && payload.alternateMetricHasData && <> · metric auto-selected; {other} data exists too</>}
          {payload.specFilter && <> · <span className="tone-warn">filter: {payload.specFilter}</span></>}
        </div>
        <AxisRows rows={axisRows(payload.evaluation)} />
      </div>
      <div className="radar-wrap">
        <Radar series={[{ points: radarPoints(payload.evaluation), color, label: c.name }]} showScores />
        <div className="faint" style={{ fontSize: 11 }}>rings = 25 / 50 / 75 / 100 · hollow point = not applicable</div>
      </div>
    </section>
  );
}
