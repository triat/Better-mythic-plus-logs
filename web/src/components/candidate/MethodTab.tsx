import { useMemo } from "react";
import type { Evaluation } from "../../types.ts";
import { curveGeometry, methodView } from "../../lib/method.ts";
import type { AxisCard, MethodView } from "../../lib/method.ts";
import { fixed1 } from "../../lib/runList.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { Around } from "../Around.tsx";
import { HelpLink } from "../HelpLink.tsx";
import { anchorOf } from "../../lib/help.ts";

/** The candidate's Méthode tab (mockup F-Methode): how the verdict is built, from the runs to the curve. */
export function MethodTab({ evaluation }: { evaluation: Evaluation }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const view = useMemo(() => methodView(t, locale, evaluation, docs), [t, locale, evaluation, docs]);
  if (!view) return <div className="muted"><span className="spinner" /> {t("common.loading")}</div>;
  const vt = evaluation.verdict === "insufficient" || evaluation.global === null ? "vt-insufficient" : `vt-${evaluation.verdict}`;
  const last = view.path.length - 1;

  return (
    <div className="mt">
      <section className="mt-section">
        <h2 className="synth-h2">{view.title}<HelpLink anchor="verdict" /></h2>
        <ol className="mt-path">
          {view.path.map((s, i) => (
            <li key={s.label} className={"mt-step" + (i === last ? " mt-step-last " + vt : "")}>
              <span className="synth-lbl">{s.label}</span>
              <span className="mono mt-step-v">{s.value}</span>
              <span className="mt-step-sub">{s.sub}</span>
            </li>
          ))}
        </ol>
        {view.waterfall.length > 0 && (
          <div className="card mt-wf">
            <div className="mt-wf-head">
              <span>{view.waterfallCaption}</span>
              <span className={"mono mt-wf-total " + vt}>
                = {t("cand.method.curveMark", { raw: view.raw, score: view.final })}
              </span>
            </div>
            <div className="mt-wf-bar" aria-hidden="true">
              {view.waterfall.map((w, i) => (
                <span key={w.key} className={"mono mt-wf-seg mt-wf-" + i} style={{ width: `${w.pct}%` }}>
                  {t("cand.method.part", { axis: w.label, pct: fixed1(locale, w.pct) })}
                </span>
              ))}
            </div>
            <ul className="mt-wf-legend">
              {view.waterfall.map((w, i) => (
                <li key={w.key}>
                  <span className={"mt-wf-dot mt-wf-" + i} />
                  {t("cand.method.part", { axis: w.label, pct: fixed1(locale, w.pct) })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mt-section">
        <div className="synth-card-head">
          <h2 className="synth-h2">{t("cand.method.axesTitle")}</h2>
          <span className="synth-note">{view.axesLegend}</span>
        </div>
        <div className="mt-axes">
          {view.axes.map((a) => <Axis key={a.key} a={a} />)}
        </div>
      </section>

      <section className="mt-bottom">
        <div className="card mt-curve-card">
          <div className="synth-card-head">
            <h2 className="synth-h2">{t("cand.method.curveTitle")}</h2>
            <span className="synth-note">{view.curveSub}</span>
          </div>
          <MethodCurve view={view} />
        </div>
        <div className="card mt-rules">
          <h2 className="synth-h2">{t("cand.method.rulesTitle")}</h2>
          <ul>
            <li>
              <Around
                message={t("cand.method.rules.thresholds")}
                params={{
                  invite: <strong className="vt-invite mt-vt">{t("verdict.words.invite")}</strong>,
                  maybe: <strong className="vt-maybe mt-vt">{t("verdict.words.maybe")}</strong>,
                  pass: <strong className="vt-pass mt-vt">{t("verdict.words.pass")}</strong>,
                  inviteAt: <span className="mono">{view.rules.invite}</span>,
                  maybeAt: <span className="mono">{view.rules.maybe}</span>,
                  maybeTo: <span className="mono">{view.rules.invite - 1}</span>,
                }}
              />
            </li>
            {view.ruleLines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Axis({ a }: { a: AxisCard }) {
  const { t } = useT();
  return (
    <article className={"card mt-axis band-" + a.band + (a.informational ? " is-info" : "")}>
      <div className="mt-axis-head">
        <strong className="mt-axis-name">{a.name}<HelpLink anchor={anchorOf(a.key)} /></strong>
        <span className={a.informational ? "chip-info" : "chip-info mt-chip"}>{a.weightLabel}</span>
        {a.confidence !== "—" && <span className="chip-info mt-chip">{a.confidence}</span>}
        <span className="mono mt-axis-score">{a.score}</span>
      </div>
      <div className="scorebar">
        {a.score !== "—" && <div className="scorebar-fill" style={{ width: `${a.score}%` }} />}
        <div className="scorebar-tick" />
      </div>
      {a.signals.length > 0 && (
        <div className="mt-sig-table" role="table" aria-label={a.name}>
          <div className="mt-sig mt-sig-head" role="row">
            <span role="columnheader">{t("cand.method.col.signal")}</span>
            <span role="columnheader">{t("cand.method.col.value")}</span>
            <span role="columnheader">{t("cand.method.col.ref")}</span>
            <span role="columnheader">{t("cand.method.col.weight")}</span>
            <span role="columnheader">{t("cand.method.col.effect")}</span>
          </div>
          {a.signals.map((s) => (
            <div key={s.name} className={"mt-sig" + (s.imputed ? " is-imputed" : "")} role="row">
              <span role="cell" className="mt-sig-name">
                {s.name}{s.hint && <span className="signal-hint">{s.hint}</span>}{s.imputed && <span className="signal-hint">{s.imputed}</span>}
              </span>
              <span role="cell" className="mono">{s.imputed ? <span className="mt-chip">{s.value}</span> : s.value}</span>
              <span role="cell" className="mono mt-sig-ref">{s.ref}</span>
              <span role="cell" className="mono mt-sig-w">{s.weight}</span>
              <span role="cell" className={"mono mt-sig-eff delta-" + s.tone}>{s.effect}</span>
            </div>
          ))}
        </div>
      )}
      {a.imputedNote && <span className="mt-axis-note">{a.imputedNote}</span>}
      {a.note && <span className="mt-axis-note">{a.note}</span>}
    </article>
  );
}

/** The role's raw → verdict curve with the verdict zones and the player (mockup F-Methode, 620 × 258). */
function MethodCurve({ view }: { view: MethodView }) {
  const { t } = useT();
  const g = curveGeometry(view.curve);
  return (
    <svg className="mt-curve" viewBox="0 0 620 258" role="img" aria-label={view.curveLabel}>
      <g transform="translate(44,12)">
        {g.zones.map((z) => <rect key={z.verdict} className={"mt-zone mt-zone-" + z.verdict} x={0} y={z.y} width={g.w} height={z.height} />)}
        {g.zones.map((z) => (
          <text key={z.verdict} className={"mt-zone-label mt-zone-label-" + z.verdict} x={g.w - 8} y={z.y + 18} textAnchor="end">
            {z.at > 0 ? t("cand.method.zone", { verdict: t(`verdict.words.${z.verdict}`), at: z.at }) : t(`verdict.words.${z.verdict}`)}
          </text>
        ))}
        <path className="mt-curve-line" d={g.path} />
        {g.marker && (
          <>
            <line className="mt-curve-guide" x1={g.marker.x} y1={g.marker.y} x2={g.marker.x} y2={g.h} />
            <line className="mt-curve-guide" x1={0} y1={g.marker.y} x2={g.marker.x} y2={g.marker.y} />
            <circle className={"mt-curve-dot mt-zone-label-" + g.marker.verdict} cx={g.marker.x} cy={g.marker.y} r={7} />
            <text className="mt-curve-mark" x={g.marker.x + (g.marker.anchor === "start" ? 8 : -8)} y={g.marker.y - 6} textAnchor={g.marker.anchor}>
              {t("cand.method.curveMark", { raw: view.raw, score: view.final })}
            </text>
          </>
        )}
        {g.yTicks.map((y) => <text key={y.value} className="mt-curve-tick" x={-8} y={y.y + 4} textAnchor="end">{y.value}</text>)}
        {g.xTicks.map((x) => <text key={x.value} className="mt-curve-tick" x={x.x} y={g.h + 22} textAnchor="middle">{x.value}</text>)}
        <text className="mt-curve-axis" x={g.w / 2} y={g.h + 40} textAnchor="middle">{t("cand.method.curveAxis")}</text>
      </g>
    </svg>
  );
}
