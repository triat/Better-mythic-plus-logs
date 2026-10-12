import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Evaluation, SeasonView } from "../../types.ts";
import { CHART, formView } from "../../lib/form.ts";
import type { ChefCard, FormView, RunResult } from "../../lib/form.ts";
import { synthesisDocs } from "../../lib/synthesis.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { KeyChart } from "./KeyChart.tsx";

const GLYPH: Record<RunResult, string> = { timed: "✓", depleted: "✗", none: "—" };

/** Ma forme (mockup F-Moi-Forme): last week and pillars side by side, the key chart, the checklist, the group leader's card. */
export function FormTab({ evaluation, season, historyKey, onVetting }: {
  evaluation: Evaluation;
  /** null: no season stored yet (the checklist and the chef card come from the lookup). */
  season: SeasonView | null;
  /** The owner page's history key (the chef card's vetting link); "" on the Live page. */
  historyKey: string;
  onVetting: () => void;
}) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  // The chart's drawn width (px): its viewBox follows it so the labels keep their size on a phone (`chartBox`).
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(CHART.width);
  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => { const w = Math.round(el.clientWidth); if (w > 0) setChartWidth(w); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docs]);
  const v = useMemo(
    () => (docs ? formView(t, locale, evaluation, season, synthesisDocs(t, docs), historyKey, chartWidth) : null),
    [t, locale, evaluation, season, docs, historyKey, chartWidth],
  );
  if (!v) return <p className="muted">{t("self.loading")}</p>;
  return (
    <div className="form">
      <div className="form-top">
        <Week v={v} />
        <Pillars v={v} />
      </div>
      <section className="card form-card">
        <div className="form-card-head">
          <h2 className="synth-h2">{t("owner.form.chart.title")}</h2>
          <span className="form-legend">
            <span><i className="form-sw form-dot-timed" aria-hidden="true" />{t("owner.form.chart.timed")}</span>
            <span><i className="form-sw form-dot-depleted" aria-hidden="true" />{t("owner.form.chart.depleted")}</span>
            <span><i className="form-sw form-dot-none" aria-hidden="true" />{t("owner.form.chart.none")}</span>
            {season !== null && season.targetLevel > 0 && (
              <span><i className="form-sw-target" aria-hidden="true" />{t("owner.form.chart.target", { level: season.targetLevel })}</span>
            )}
          </span>
        </div>
        <div ref={chartRef}>
          {v.chart ? <KeyChart chart={v.chart} /> : <p className="muted form-none">{t("owner.form.chart.empty")}</p>}
        </div>
      </section>
      <section className="card form-card">
        <div className="form-card-head">
          <span className="synth-lbl">{t("owner.form.check.title")}</span>
          <span className="synth-note">{v.checklistNote}</span>
        </div>
        {v.checklist.length === 0 && <p className="muted form-none">{t("owner.form.check.none")}</p>}
        {v.checklist.map((c, i) => (
          <div key={c.title} className="form-check">
            {/* A rank, not a checkbox: nothing here is ticked off (the mockup's square read as an action). */}
            <span className="form-check-n mono" aria-hidden="true">{i + 1}</span>
            <div className="form-check-main">
              <div className="form-check-title"><strong>{c.title}</strong><span>{c.goal}</span></div>
              {c.hint && <span className="signal-hint">{c.hint}</span>}
              <div className="form-check-values mono">
                {c.before && (
                  <>
                    <span className="form-check-before">{c.before}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </>
                )}
                <span className={"form-check-now delta-" + c.nowTone}>{c.now}</span>
              </div>
            </div>
            <span className="form-check-cost mono">{c.cost}</span>
          </div>
        ))}
      </section>
      <Chef c={v.chef} onVetting={onVetting} />
    </div>
  );
}

function Week({ v }: { v: FormView }) {
  const { t } = useT();
  const w = v.week;
  return (
    <section className="card form-card form-week">
      <span className="synth-lbl">{w ? w.label : t("owner.form.week.last")}</span>
      {!w && <p className="muted form-none">{t("owner.form.week.none")}</p>}
      {w && (
        <>
          <div className="form-week-stats">
            <div><span className="mono">{w.runs}</span><span>{t("owner.form.week.runs")}</span></div>
            <div><span className="mono">{w.bestTimed ?? "—"}</span><span>{t("owner.form.week.bestTimed")}</span></div>
            <div><span className="mono">{w.timed}</span><span>{t("owner.form.week.timed")}</span></div>
          </div>
          <div className="form-week-chips">
            {w.chips.map((c, i) => (
              <span key={i} className="form-chip" title={c.title}>
                <span aria-hidden="true" className="form-chip-in">
                  <span className="mono">{c.level}</span>{c.abbr}<span className={"form-chip-" + c.result}>{GLYPH[c.result]}</span>
                </span>
                <span className="sr-only">{c.title}</span>
              </span>
            ))}
          </div>
          {w.note && <span className="form-week-note">{w.note}</span>}
        </>
      )}
    </section>
  );
}

function Pillars({ v }: { v: FormView }) {
  const { t } = useT();
  return (
    <section className="card form-card form-pillars">
      <div className="form-card-head">
        <span className="synth-lbl">{t("owner.form.pillars.title")}</span>
        {v.pillars.global && <span className="mono form-global">{v.pillars.global}</span>}
      </div>
      {v.pillars.rows.map((p) => (
        <div key={p.key} className={"form-pillar band-" + p.band}>
          <span className="form-pillar-name">{p.name}</span>
          <span className="scorebar" aria-hidden="true">
            {p.score !== null && <span className="scorebar-fill" style={{ width: `${Math.max(0, Math.min(100, p.score))}%` }} />}
            <span className="scorebar-tick" />
          </span>
          <span className="form-pillar-score mono">{p.score ?? "—"}</span>
          {p.trend && <span className="form-pillar-trend">{p.trend}</span>}
        </div>
      ))}
      <span className="synth-note">{v.pillars.note}</span>
    </section>
  );
}

function Chef({ c, onVetting }: { c: ChefCard; onVetting: () => void }) {
  const { t } = useT();
  const score = c.verdict.score === null ? null : Number(c.verdict.score);
  return (
    <section className={"card form-chef " + c.verdict.cls}>
      {score !== null && (
        <svg className="form-gauge" width="96" height="54" viewBox="0 0 200 112" aria-hidden="true">
          <path className="form-gauge-track" d="M16,100 A84,84 0 0 1 184,100" pathLength={100} />
          <path className="form-gauge-fill" d="M16,100 A84,84 0 0 1 184,100" pathLength={100} strokeDasharray={`${score} 100`} />
        </svg>
      )}
      <div className="form-chef-text">
        <span className="form-chef-title">{c.title}</span>
        <span className="form-chef-line">
          <span className="form-chef-verdict">{c.verdict.label}{c.verdict.score !== null && <span className="mono"> {c.verdict.score}</span>}</span>
          {c.path && <> — {c.path}</>}
        </span>
      </div>
      <button type="button" className="btn" onClick={onVetting}>{t("owner.form.chef.vetting")}</button>
    </section>
  );
}
