import { useState } from "react";
import type { AxisKey, LookupPayload, SeasonView } from "../../types.ts";
import type { ReevalHint } from "../../lib/keyLevel.ts";
import { axisIsInformational } from "../../lib/help.ts";
import { basisText, pillarCards, verdictLine, workOnRows } from "../../lib/self.ts";
import type { PillarCard } from "../../lib/self.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { RioSection } from "../RioSection.tsx";
import { SignalTiles } from "../SignalTiles.tsx";
import { VerdictHero } from "../VerdictHero.tsx";

/** Canvas SelfTabs "Overview": work on first, the five pillars, the verdict line; today's verdict block below. */
export function Overview({ payload, season, hint, onReevaluate }: { payload: LookupPayload; season: SeasonView | null; hint: ReevalHint | null; onReevaluate: () => void }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const ev = payload.evaluation;
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const work = workOnRows(t, locale, ev, season, titleOf);
  const line = verdictLine(t, ev, (k) => (docs ? axisIsInformational(docs.config.axisWeights, k) : false));
  return (
    <>
      <section className="card work-on">
        <div className="section-row">
          <span className="section-title">{t("self.workOn.title")}</span>
          <span className="muted" style={{ fontSize: 12 }}>{t("self.workOn.sub", { basis: basisText(t, ev, season) })}</span>
        </div>
        {work.length === 0 ? <div className="muted">{t("self.workOn.none")}</div> : (
          <>
            <div className="work-on-row label-caps" style={{ padding: "2px 10px" }}>
              <span /><span>{t("self.workOn.point")}</span><span>{t("self.workOn.vsAvg")}</span><span>{t("self.workOn.vsPast")}</span>
            </div>
            {work.map((w) => (
              <div key={w.n} className="work-on-row inset">
                <span className="work-on-num">{w.n}</span>
                <span><b>{w.title}</b> <span className="faint">{w.pillar && <>· {w.pillar} </>}· {w.detail}</span></span>
                <span className="tone-bad">{w.impact}</span>
                <span className={w.past.cls}>{w.past.text}</span>
              </div>
            ))}
          </>
        )}
      </section>
      <div className="pillars">{pillarCards(t, locale, ev, season).map((c) => <Pillar key={c.key} c={c} />)}</div>
      <div className="muted verdict-line">
        {t("self.verdictLine")}
        <span className={"badge badge-sm " + line.badge.cls}>
          <span className="badge-label">{line.badge.label}</span>
          {line.badge.score !== null && <span className="badge-score mono">{line.badge.score}</span>}
        </span>
        {line.context && <span>· {line.context}</span>}
      </div>
      <VerdictHero payload={payload} hint={hint} onReevaluate={onReevaluate} />
      <div className="overview-rest">
        <SignalTiles payload={payload} />
        <RioSection payload={payload} />
      </div>
    </>
  );
}

function Pillar({ c }: { c: PillarCard }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="card pillar">
      <span className="label-caps">{c.title}</span>
      <span className={"pillar-score band-" + c.band}>{c.score}</span>
      <span className={"pillar-trend " + c.trend.cls}>{c.trend.text}</span>
      {c.bars.length > 0 && (
        <span className="wk">{c.bars.map((b, i) => <i key={i} className={(b.last ? "last" : "") + (b.empty ? " empty" : "")} style={{ height: b.px }} />)}</span>
      )}
      <span className="pillar-text">{c.sentence}</span>
      {c.lines.length > 2 && (
        <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}>{open ? t("self.pillar.hide") : t("self.pillar.details")}</button>
      )}
      {open && c.lines.slice(2).map((l, i) => <span key={i} className="pillar-text">{l}</span>)}
    </div>
  );
}
