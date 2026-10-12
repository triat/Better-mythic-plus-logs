import { useMemo } from "react";
import type { Ref } from "react";
import type { LookupPayload, MPlusRun, RunDefensives } from "../../types.ts";
import { costText } from "../../lib/deepdive.ts";
import { dungeonAbbr } from "../../lib/runList.ts";
import { runDetail } from "../../lib/runView.ts";
import { timelineView } from "../../lib/timeline.ts";
import type { LayerKey } from "../../lib/timeline.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import type { DeepdiveActions } from "../Detail.tsx";
import { useWowheadRefresh } from "../SpellLink.tsx";
import { DefensivesUsed, Moments } from "./RunFacts.tsx";
import { Timeline } from "./Timeline.tsx";

export interface RunPanelProps {
  payload: LookupPayload;
  run: MPlusRun;
  analysis: RunDefensives | null;
  deepdive: DeepdiveActions;
  layers: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey) => void;
  event: string | null;
  onSelect: (id: string) => void;
  /** "Ouvrir en grand": opens the run sheet. */
  onOpen: () => void;
  /** "Analyse détaillée": opens the run sheet on its deep-dive section (re-analyse, audit, table editing). */
  onDeepdive: () => void;
  /** The "Ouvrir en grand" button: the sheet gives the focus back to it when it closes. */
  openRef: Ref<HTMLButtonElement>;
}

/** The selected run under the list (mockup F-Runs): header, the layered timeline, key moments, defensives used. */
export function RunPanel({ payload, run, analysis, deepdive, layers, onToggle, event, onSelect, onOpen, onDeepdive, openRef }: RunPanelProps) {
  const { t, locale } = useT();
  const d = useMemo(() => runDetail(t, locale, payload, run, analysis), [t, locale, payload, run, analysis]);
  const view = useMemo(
    () => timelineView(t, locale, run, analysis, false, layers, event),
    [t, locale, run, analysis, layers, event],
  );
  useWowheadRefresh(d);
  const key = `${run.reportCode}:${run.fightID}`;
  const busy = deepdive.analyzing === key;
  const afford = deepdive.canAfford(1);
  const analyseDisabled = deepdive.analyzing !== null || !afford;
  const analyseTitle = afford ? undefined : deepdive.quotaTooltip;
  const analyse = () => void deepdive.analyze(run);

  return (
    <section className="card rp" aria-label={d.title}>
      <div className="rp-head">
        <span className="rl-abbr" aria-hidden="true">{dungeonAbbr(run.encounterName)}</span>
        <div className="rp-title">
          <h2 className="rp-name">{d.title}</h2>
          <span className="rp-sub">
            <span className="mono rp-key">{d.key}</span>
            {d.upgrade && <span className={d.upgrade.timed ? "rl-timed" : "rl-depleted"}> {d.upgrade.text}</span>}
            {" · "}<span className="mono">{d.time}</span>{" · "}{d.when}
            {d.spec && <> · {d.spec}</>}
          </span>
        </div>
        <div className="rp-actions">
          <button type="button" ref={openRef} className="btn btn-primary rp-btn" onClick={onOpen}>
            {t("cand.run.open")}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-8 8M10 20H4v-6" />
            </svg>
          </button>
          {analysis !== null && (
            <button type="button" className="link-btn rp-dd-link" onClick={onDeepdive}>{t("cand.run.deepdiveLink")}</button>
          )}
          <a className="btn rp-btn" href={d.wcl} target="_blank" rel="noopener" onClick={() => track("external_log")}>
            {t("cand.header.wclLink")}
          </a>
        </div>
      </div>

      {view === null && <p className="muted rp-none">{t("cand.run.noStats")}</p>}

      {view !== null && (
        <Timeline
          view={view} onToggle={onToggle} onSelect={onSelect} onAnalyse={analyse}
          analyseDisabled={analyseDisabled} analyseTitle={analyseTitle}
        />
      )}

      {view !== null && analysis === null && (
        <div className="rp-pending">
          <div className="rp-pending-text">
            <strong>{t("cand.run.notAnalysed")}</strong>
            <span>{t("cand.run.notAnalysedText")}</span>
          </div>
          <button type="button" className="btn btn-primary rp-btn" disabled={analyseDisabled} title={analyseTitle} onClick={analyse}>
            {busy && <span className="spinner" />}{t("runs.analyze", { cost: costText(t, 1) })}
          </button>
        </div>
      )}

      {view !== null && (view.moments.length > 0 || d.defensives.length > 0 || d.also) && (
        <div className="rp-foot">
          {view.moments.length > 0 && <Moments moments={view.moments} event={event} onSelect={onSelect} />}
          {(d.defensives.length > 0 || d.also) && (
            <div className="rp-defs">
              {d.defensives.length > 0 && <DefensivesUsed rows={d.defensives} />}
              {d.also && <span className="rp-also">{d.also}</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
