import { useMemo, useState } from "react";
import type { LookupPayload, MPlusRun } from "../../types.ts";
import { costText } from "../../lib/deepdive.ts";
import { dungeonGrid } from "../../lib/dungeonGrid.ts";
import { runKeyOf } from "../../lib/profile.ts";
import type { DungeonNote, DungeonRow, Tint } from "../../lib/dungeonGrid.ts";
import { useT } from "../../locale.tsx";
import type { DeepdiveActions } from "../Detail.tsx";
import { HelpLink } from "../HelpLink.tsx";

export interface CandDungeonsProps {
  payload: LookupPayload;
  deepdive: DeepdiveActions;
  /** "Voir le run →": the Runs tab with the run `key` selected. */
  onView: (key: string) => void;
}

/** The candidate's Donjons tab (mockup F-Donjons): the notes strip, then the best run per dungeon with its inline detail. */
export function CandDungeons({ payload, deepdive, onView }: CandDungeonsProps) {
  const { t, locale } = useT();
  const view = useMemo(() => dungeonGrid(t, locale, payload), [t, locale, payload]);
  const [open, setOpen] = useState<string | null>(null);
  const metric = payload.metric.toUpperCase();
  const cols = [
    t("cand.dungeons.col.key"), t("cand.dungeons.col.deaths"), view.utilLabel,
    t("cand.dungeons.col.avoidable"), t("cand.dungeons.col.dtps"), t("cand.dungeons.col.parse", { metric }),
  ];

  return (
    <div className="dg-tab">
      <section className="dg-notes">
        {view.notes.map((n) => <Note key={n.label} n={n} />)}
      </section>
      <section className="card dg">
        <div className="dg-top">
          <h2 className="synth-h2">{t("cand.dungeons.title")}<HelpLink anchor="runs" /></h2>
          <span className="dg-heat-legend">
            <span className="dg-swatch heat-5" />{t("cand.dungeons.heat.better")}
            <span className="dg-swatch heat-3" />{t("cand.dungeons.heat.same")}
            <span className="dg-swatch heat-1" />{t("cand.dungeons.heat.worse")}
          </span>
        </div>
        <div className="dg-grid dg-head" aria-hidden="true">
          <span className="dg-th dg-th-name">{t("cand.dungeons.col.dungeon")}</span>
          {cols.map((c) => <span key={c} className="dg-th">{c}</span>)}
          <span />
        </div>
        {view.rows.map((r) => (
          <Row
            key={r.key} r={r} run={payload.perDungeon.runs.find((x) => runKeyOf(x) === r.key) ?? null} cols={cols} open={open === r.key} deepdive={deepdive}
            onToggle={() => setOpen((o) => (o === r.key ? null : r.key))} onView={() => onView(r.key)}
          />
        ))}
      </section>
      {view.missing.length > 0 && <span className="faint rl-missing">{t("runs.missing", { list: view.missing.join(", ") })}</span>}
      <p className="dg-foot">{view.legend}</p>
    </div>
  );
}

function Note({ n }: { n: DungeonNote }) {
  return (
    <div className="card dg-note">
      <span className="synth-lbl">{n.label}</span>
      <span className={"dg-note-v mono " + (n.tone.startsWith("tier-") ? n.tone : `delta-${n.tone}`)}>{n.value}</span>
      {n.sub && <span className="dg-note-sub">{n.sub}</span>}
    </div>
  );
}

function Cell({ label, tint }: { label: string; tint: Tint | null }) {
  return (
    <span className={"dg-cell " + (tint?.cls || "heat-3")}>
      <span className="dg-k">{label}</span>
      <span>{tint?.text ?? "—"}</span>
    </span>
  );
}

interface RowProps {
  r: DungeonRow;
  run: MPlusRun | null;
  cols: string[];
  open: boolean;
  deepdive: DeepdiveActions;
  onToggle: () => void;
  onView: () => void;
}

function Row({ r, run, cols, open, deepdive, onToggle, onView }: RowProps) {
  const { t } = useT();
  const [colKey, colDeaths, colUtil, colAvoid, colDtps, colParse] = cols as [string, string, string, string, string, string];
  const afford = deepdive.canAfford(1);
  const busy = deepdive.analyzing === r.key;
  const detailId = `dg-detail-${r.key.replace(":", "-")}`;
  return (
    <div className={"dg-row" + (open ? " open" : "")}>
      <button type="button" className="dg-btn dg-grid" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={onToggle}>
        <span className="dg-name">
          <span className="dg-name-text">{r.name}</span>
          <span className="dg-sub">{r.sub}</span>
        </span>
        <span className="dg-key">
          <span className="dg-k">{colKey}</span>
          <span className="mono dg-level">
            {r.level}
            {r.upgrade && <span className={r.upgrade.timed ? "rl-timed" : "rl-depleted"}> {r.upgrade.text}</span>}
          </span>
          <span className="mono dg-time">{r.time}</span>
        </span>
        <Cell label={colDeaths} tint={r.deaths} />
        <span className="dg-cell heat-3">
          <span className="dg-k">{colUtil}</span>
          <span>{r.util?.text ?? "—"}</span>
          {r.util && <span className="dg-util-bar" style={{ width: `${Math.min(100, r.util.barPct)}%` }} />}
        </span>
        <Cell label={colAvoid} tint={r.avoidable} />
        <Cell label={colDtps} tint={r.dtps} />
        <span className="dg-cell heat-3">
          <span className="dg-k">{colParse}</span>
          <span className={r.parse.tier ? `tier-${r.parse.tier}` : ""}>{r.parse.text}</span>
          <span className="dg-cell-sub">{r.parse.amount}</span>
        </span>
        <svg className="dg-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
        </svg>
      </button>
      {open && (
        <div className="dg-detail" id={detailId}>
          <div className="dg-facts">
            {r.facts.map((f) => (
              <div key={f.label} className="dg-fact">
                <span className="dg-fact-k">{f.label}</span>
                <span className="mono dg-fact-v">{f.value}</span>
              </div>
            ))}
          </div>
          <div className="dg-actions">
            <span className="dg-note-text">{r.note}</span>
            {run && !r.analysed && r.hasSignals && (
              <button
                type="button" className="btn rl-btn" disabled={deepdive.analyzing !== null || !afford}
                title={afford ? undefined : deepdive.quotaTooltip}
                onClick={() => void deepdive.analyze(run)}
              >
                {busy && <span className="spinner" />}{t("runs.analyze", { cost: costText(t, 1) })}
              </button>
            )}
            <button type="button" className="btn rl-btn" onClick={onView}>{t("cand.dungeons.view")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
