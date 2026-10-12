import { useMemo } from "react";
import type { LookupPayload } from "../../types.ts";
import { anchorOf } from "../../lib/help.ts";
import { synthesisDocs, synthesisView } from "../../lib/synthesis.ts";
import type { AxisLine, ForceRow, VerdictBlock } from "../../lib/synthesis.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { HelpLink } from "../HelpLink.tsx";
import { Icon } from "../Icon.tsx";
import { RioSection } from "../RioSection.tsx";

/** The Synthèse tab (mockup F-Synthese): verdict and what would flip it, strengths and weaknesses, the axes, Raider.IO. */
export function SynthesisTab({ payload }: { payload: LookupPayload }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const view = useMemo(
    () => (docs ? synthesisView(t, locale, payload.evaluation, synthesisDocs(docs), payload.runsIndexed) : null),
    [docs, t, locale, payload],
  );
  if (!view) return <div className="muted"><span className="spinner" /> {t("common.loading")}</div>;
  return (
    <div className="synth">
      <div className="synth-top">
        <VerdictCard verdict={view.verdict} flip={view.flip} />
        <div className="synth-side">
          <section className="card synth-card">
            <div className="synth-card-head">
              <h2 className="synth-h2">{t("cand.synth.forces")}</h2>
              <span className="synth-note">{t("cand.synth.forcesSub")}</span>
            </div>
            <div className="synth-forces">
              <ForceList title={t("cand.synth.pros")} tone="better" rows={view.pros} empty={t("cand.synth.nonePros")} />
              <ForceList title={t("cand.synth.cons")} tone="worse" rows={view.cons} empty={t("cand.synth.noneCons")} />
            </div>
            {view.informational.map((i) => (
              <div key={i.name} className="synth-info">
                <span className="chip-info">{t("cand.synth.infoChip")}</span>
                <span><b>{i.name}</b> · {i.text}</span>
              </div>
            ))}
          </section>
          <section className="card synth-axes" aria-label={t("cand.synth.axes")}>
            {view.axes.map((a) => <AxisRow key={a.key} a={a} />)}
          </section>
          <span className="synth-foot">{t("cand.synth.axesFoot")}</span>
        </div>
      </div>
      <RioSection payload={payload} />
    </div>
  );
}

function VerdictCard({ verdict: v, flip }: { verdict: VerdictBlock; flip: ReturnType<typeof synthesisView>["flip"] }) {
  const { t } = useT();
  return (
    <section className={"card synth-verdict " + v.cls.replace("badge-", "vt-")}>
      <div className="synth-verdict-head">
        <span className="synth-lbl">{v.title}<HelpLink anchor="verdict" /></span>
        <div className="synth-verdict-score">
          <span className="synth-verdict-label">{v.label}</span>
          {v.score !== null && <span className="mono">{v.score}</span>}
        </div>
      </div>
      {v.barPct !== null && (
        <div className="synth-bar-wrap">
          <div className="synth-bar">
            <div className="synth-bar-fill" style={{ width: `${v.barPct}%` }} />
            {v.thresholds.map((th) => <div key={th.at} className="synth-bar-tick" style={{ left: `${th.at}%` }} />)}
          </div>
          <div className="synth-bar-labels">
            {v.thresholds.map((th) => <span key={th.at} style={{ left: `${th.at}%` }}>{th.label}</span>)}
          </div>
        </div>
      )}
      <p className="synth-summary">{v.summary}</p>
      {flip && (
        <div className="synth-flip">
          <span className="synth-lbl">{flip.title}<HelpLink anchor="drivers" /></span>
          {flip.rows.map((r) => (
            <div key={r.name} className="synth-flip-row">
              <div className="synth-flip-name"><strong>{r.name}</strong><span className="mono">{r.gain}</span></div>
              <span className="synth-flip-gap">{r.gap}</span>
            </div>
          ))}
          {flip.note && <span className="synth-flip-gap">{flip.note}</span>}
          <span className="synth-note">{t("cand.synth.flipFoot")}</span>
        </div>
      )}
      {v.confidence && (
        <div className="synth-confidence">
          <Icon name="info" size={16} />
          <span>{v.confidence}</span>
        </div>
      )}
    </section>
  );
}

function ForceList({ title, tone, rows, empty }: { title: string; tone: "better" | "worse"; rows: ForceRow[]; empty: string }) {
  return (
    <div className={"synth-force synth-" + tone}>
      <span className="synth-lbl synth-force-title">{title}</span>
      {rows.length === 0 && <span className="synth-note">{empty}</span>}
      {rows.map((r) => (
        <div key={r.name + r.axis} className="synth-force-row">
          <div className="synth-force-name"><span>{r.name}</span><span className="mono">{r.pts}</span></div>
          <div className="synth-force-bar"><div style={{ width: `${r.widthPct}%` }} /></div>
          <span className="synth-note">{r.axis} · {r.detail}</span>
        </div>
      ))}
    </div>
  );
}

function AxisRow({ a }: { a: AxisLine }) {
  const { t } = useT();
  return (
    <div className={"synth-axis band-" + a.band + (a.informational ? " is-info" : "")}>
      <span className="synth-axis-name">
        <span>{a.name}<HelpLink anchor={anchorOf(a.key)} /></span>
        {a.informational && <span className="synth-axis-info">{t("cand.synth.weightInfo")}</span>}
      </span>
      <span className="synth-axis-score mono">{a.score ?? "—"}</span>
      <div className="scorebar">
        {a.score !== null && <div className="scorebar-fill" style={{ width: `${a.score}%` }} />}
        <div className="scorebar-tick" />
      </div>
      <span className="synth-axis-why">{a.why}</span>
    </div>
  );
}
