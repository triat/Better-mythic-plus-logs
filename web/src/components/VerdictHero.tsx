import { classHex, className } from "@shared/wow/classes.ts";
import type { LookupPayload } from "../types.ts";
import { axisRows, heroStats, radarPoints } from "../lib/axes.ts";
import { realmName } from "../lib/format.ts";
import { verdictView } from "../lib/verdict.ts";
import { useDocs } from "../docs.tsx";
import { useT } from "../locale.tsx";
import type { ReevalHint } from "../lib/keyLevel.ts";
import { AxisLegend } from "./AxisLegend.tsx";
import { AxisRows } from "./AxisRows.tsx";
import { HelpLink } from "./HelpLink.tsx";
import { Radar } from "./Radar.tsx";

export function VerdictHero({ payload, hint, onReevaluate }: { payload: LookupPayload; hint: ReevalHint | null; onReevaluate: () => void }) {
  const { t, locale } = useT();
  const c = payload.character;
  const v = verdictView(t, payload.evaluation, payload.targetAutoDetected);
  const color = classHex(c.classID);
  const other = payload.metric === "hps" ? "dps" : "hps";
  const rows = axisRows(t, locale, payload.evaluation, useDocs().axes);
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
            <HelpLink anchor="verdict" />
          </div>
          {hint && (
            <div className="reeval">
              {hint.label} — <a href="#" onClick={(e) => { e.preventDefault(); onReevaluate(); }}>{hint.action}</a>
              <span className="faint">{t("verdict.replaces")}</span>
            </div>
          )}
        </div>
        <div className="stats muted">
          {heroStats(t, payload).map((s) => (
            <span key={s.label}><b>{s.value}</b> {s.label}{s.sub && <span className="faint"> {s.sub}</span>}</span>
          ))}
        </div>
        <div className="metaline faint">
          {payload.zone.name} · {t("verdict.runsIndexed")} <b>{payload.runsIndexed}</b>
          {payload.metricAutoSelected && payload.alternateMetricHasData && t("verdict.metricAuto", { other })}
          {payload.specFilter && <> · <span className="tone-warn">{t("verdict.filter", { spec: payload.specFilter })}</span></>}
        </div>
        <AxisRows rows={rows} />
      </div>
      <div className="radar-wrap">
        <Radar series={[{ points: radarPoints(payload.evaluation), color, label: c.name }]} showScores />
        <div className="faint" style={{ fontSize: 11 }}>{t("verdict.rings")}</div>
      </div>
      <AxisLegend rows={rows} />
    </section>
  );
}
