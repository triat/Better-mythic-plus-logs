import { useRef } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { costText } from "../../lib/deepdive.ts";
import { stepEvent } from "../../lib/timeline.ts";
import type { LayerChip, LayerKey, Marker, TimelineView } from "../../lib/timeline.ts";
import { useT } from "../../locale.tsx";

export interface TimelineProps {
  view: TimelineView;
  onToggle: (key: LayerKey) => void;
  onSelect: (id: string) => void;
  onAnalyse: () => void;
  analyseDisabled: boolean;
  analyseTitle?: string;
}

const pos = (leftPct: number): CSSProperties => ({ "--x": `${leftPct}%` } as CSSProperties);

/**
 * The run timeline (spec "The run timeline", mockups F-Runs and F-Run), shared by the run panel and the run sheet: the
 * layer checklist, one lane per ticked layer over a track as wide as its container, the ticks, the selected death's
 * callout. Only death markers take the focus; ← → (Home / End) walk the deaths.
 */
export function Timeline({ view, onToggle, onSelect, onAnalyse, analyseDisabled, analyseTitle }: TimelineProps) {
  const { t } = useT();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const selected = view.callout?.id ?? null;
  const focusable = selected ?? view.events[0] ?? null;
  // One "Analyser · 3 pts" in the checklist, on the first layer that needs the analysis.
  const analyseOn = view.chips.find((c) => c.analyse)?.key ?? null;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const next = stepEvent(view.events, id, e.key);
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    refs.current.get(next)?.focus();
  };

  return (
    <div className="tl" role="group" aria-label={t("cand.timeline.label")}>
      <div className="tl-layers">
        <span className="tl-lbl">{t("cand.timeline.show")}</span>
        {view.chips.map((c) => (
          <Layer
            key={c.key} c={c} onToggle={onToggle}
            analyse={c.key === analyseOn
              ? <button type="button" className="btn tl-analyse" disabled={analyseDisabled} title={analyseTitle} onClick={onAnalyse}>
                  {t("runs.analyze", { cost: costText(t, 1) })}
                </button>
              : null}
          />
        ))}
      </div>
      <div className="tl-main">
        <div className="tl-row">
          <span />
          <div className="tl-ticks" aria-hidden="true">
            {view.ticks.map((k) => <span key={k.label} className="mono" style={pos(k.leftPct)}>{k.label}</span>)}
          </div>
        </div>
        {view.lanes.map((l) => (
          <div key={l.key} className="tl-row">
            <span className="tl-lane-label">{l.label}</span>
            <div className={"tl-track tl-track-" + l.key}>
              {view.ticks.map((k) => <span key={k.label} className="tl-grid" style={pos(k.leftPct)} />)}
              {l.bars.map((b, i) => (
                <span key={i} className="tl-bar" title={b.title} style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} />
              ))}
              {l.markers.map((m) => l.key === "deaths"
                ? (
                  <button
                    key={m.id} type="button" className={markerCls(m, selected)} style={pos(m.leftPct)}
                    aria-label={m.title} title={m.title} aria-pressed={m.id === selected}
                    tabIndex={m.id === focusable ? 0 : -1}
                    ref={(el) => { if (el) refs.current.set(m.id, el); else refs.current.delete(m.id); }}
                    onClick={() => onSelect(m.id)} onKeyDown={(e) => onKey(e, m.id)}
                  />
                )
                : <span key={m.id} className={markerCls(m, selected)} style={pos(m.leftPct)} title={m.title} />)}
            </div>
          </div>
        ))}
        {view.callout && (
          <div className={"tl-callout" + (view.callout.bad ? " bad" : "")} aria-live="polite">
            <span className="mono tl-callout-time">{view.callout.time}</span>
            <div className="tl-callout-body">
              <strong>{view.callout.title}</strong>
              {view.callout.hits && <span className="tl-callout-hits">{view.callout.hits}</span>}
              <span className="tl-callout-state">{view.callout.state}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const markerCls = (m: Marker, selected: string | null): string =>
  `tl-mark tl-mark-${m.kind}` + (m.kind !== "cast" && m.id === selected ? " on" : "");

function Layer({ c, onToggle, analyse }: { c: LayerChip; onToggle: (key: LayerKey) => void; analyse: ReactNode }) {
  const disabled = c.disabled !== null;
  return (
    <div className="tl-layer-wrap">
      <button
        type="button" className={"tl-layer" + (c.on ? " on" : "")} aria-pressed={c.on} aria-disabled={disabled || undefined}
        title={c.disabled ?? undefined} onClick={() => { if (!disabled) onToggle(c.key); }}
      >
        <span className="tl-box" aria-hidden="true">{c.on ? "✓" : ""}</span>
        <span className={"tl-sw tl-sw-" + c.key} aria-hidden="true" />
        <span className="tl-layer-label">{c.label}</span>
        <span className="mono tl-layer-count">{c.count}</span>
      </button>
      {analyse}
    </div>
  );
}
