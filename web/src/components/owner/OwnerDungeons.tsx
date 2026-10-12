import { useMemo, useState } from "react";
import type { SeasonView } from "../../types.ts";
import { ownerDungeons } from "../../lib/ownerDungeons.ts";
import type { HeatCell, OwnerDungeonDetail } from "../../lib/ownerDungeons.ts";
import { useT } from "../../locale.tsx";
import { SpellLink, useWowheadRefresh } from "../SpellLink.tsx";

/** Donjons (mockup F-Moi-Donjons): the pillar heatmap across the full width, the selected dungeon's detail below. */
export function OwnerDungeons({ season, onRuns }: { season: SeasonView; onRuns: (encounterID: number) => void }) {
  const { t, locale } = useT();
  const [selected, setSelected] = useState<number | null>(null);
  const v = useMemo(() => ownerDungeons(t, locale, season, selected), [t, locale, season, selected]);
  if (v.rows.length === 0) return <p className="muted">{t("owner.dungeons.empty")}</p>;
  return (
    <div className="odg">
      <section className="card odg-card">
        <div className="form-card-head">
          <h2 className="synth-h2">{t("owner.dungeons.title")}</h2>
          <span className="dg-heat-legend">
            <span className="dg-swatch heat-1" aria-hidden="true" />{t("owner.dungeons.legend.weak")}
            <span className="dg-swatch heat-3" aria-hidden="true" />{t("owner.dungeons.legend.mid")}
            <span className="dg-swatch heat-5" aria-hidden="true" />{t("owner.dungeons.legend.strong")}
            <span>· {t("owner.dungeons.legend.hint")}</span>
          </span>
        </div>
        <div className="odg-row odg-head" aria-hidden="true">
          <span className="odg-th odg-th-name">{t("owner.dungeons.col.dungeon")}</span>
          {v.columns.map((c) => <span key={c.key} className="odg-th">{c.label}</span>)}
          <span className="odg-th">{t("owner.dungeons.col.overall")}</span>
          <span className="odg-th">{t("owner.dungeons.col.runs")}</span>
        </div>
        <div className="odg-row odg-season">
          <span className="odg-name"><span className="odg-name-text">{t("owner.dungeons.season")}</span></span>
          {v.season.cells.map((c, i) => <Cell key={c.key} c={c} label={v.columns[i]!.label} />)}
          <span className="odg-overall mono">{v.season.overall}</span>
          <span className="odg-runs mono">{v.season.runs}</span>
        </div>
        <div className="odg-rows">
          {v.rows.map((r) => (
            <button
              key={r.encounterID} type="button" className={"odg-row odg-btn" + (r.selected ? " on" : "")} aria-pressed={r.selected}
              onClick={() => setSelected(r.encounterID)}
            >
              <span className="odg-name">
                <span className="rl-abbr odg-abbr" aria-hidden="true">{r.abbr}</span>
                <span className="odg-name-text">{r.name}</span>
              </span>
              {r.cells.map((c, i) => <Cell key={c.key} c={c} label={v.columns[i]!.label} />)}
              <span className="odg-overall mono"><span className="odg-k">{t("owner.dungeons.col.overall")} </span>{r.overall}</span>
              <span className="odg-runs mono"><span className="odg-k">{t("owner.dungeons.col.runs")} </span>{r.runs}</span>
            </button>
          ))}
        </div>
        <p className="odg-foot">{t("owner.dungeons.foot")}</p>
      </section>
      {v.detail && <Detail d={v.detail} onRuns={onRuns} />}
    </div>
  );
}

function Cell({ c, label }: { c: HeatCell; label: string }) {
  return (
    <span className={"odg-cell mono " + c.heat + (c.weakest ? " weakest" : "")} title={label}>
      <span className="sr-only">{label} </span>{c.text}
    </span>
  );
}

function Detail({ d, onRuns }: { d: OwnerDungeonDetail; onRuns: (encounterID: number) => void }) {
  const { t } = useT();
  const p = d.panel;
  useWowheadRefresh(d);
  return (
    <section className="card odg-detail" aria-label={d.title}>
      <div className="odg-detail-head">
        <span className="odg-detail-abbr" aria-hidden="true">{d.abbr}</span>
        <div className="odg-detail-title">
          <h2 className="synth-h2">{d.title}</h2>
          <span className="synth-note">{d.sub}</span>
        </div>
        {d.weak && <span className={"odg-weak " + d.weak.heat}>{d.weak.text}</span>}
        <button type="button" className="btn" onClick={() => onRuns(d.runs.encounterID)}>{d.runs.label}</button>
      </div>
      {d.compare && (
        <p className="odg-compare"><strong>{d.compare.lead}</strong>{d.compare.rest}</p>
      )}
      {d.empty && <p className="muted">{d.empty}</p>}
      {!d.empty && (
        <>
          <div className="odg-cols">
            <div className="odg-block">
              <span className="synth-lbl">{t("owner.dungeons.hits")}</span>
              {p.avoidable.map((a) => (
                <div key={a.id} className="odg-hit">
                  <div className="odg-hit-top"><SpellLink id={a.id} name={a.name} /><span className="mono">{a.pct}</span></div>
                  <span className="odg-bar"><span style={{ width: `${a.width}%` }} /></span>
                </div>
              ))}
              {p.other && (
                <div className="odg-hit odg-hit-other">
                  <div className="odg-hit-top"><span>{t("self.panel.other")}</span><span className="mono">{p.other.pct}</span></div>
                  <span className="odg-bar"><span style={{ width: `${p.other.width}%` }} /></span>
                </div>
              )}
            </div>
            <div className="odg-block">
              <span className="synth-lbl">{t("owner.dungeons.killers")}</span>
              {p.killers.map((k) => (
                <div key={k.ability} className="odg-killer">
                  <span className="odg-killer-dot" aria-hidden="true" />
                  {k.id !== null ? <SpellLink id={k.id} name={k.ability} /> : <span>{k.ability}</span>}
                  <span className="mono odg-killer-n">{k.deaths}</span>
                </div>
              ))}
            </div>
          </div>
          {d.casts.length > 0 && (
            <div className="odg-block">
              <div className="form-card-head odg-casts-head">
                <span className="synth-lbl">{t("owner.dungeons.casts")}</span>
                <span className="synth-note">{t("owner.dungeons.castsNote")}</span>
              </div>
              <div className="odg-casts" role="table" aria-label={t("owner.dungeons.casts")}>
                <div className="odg-cast odg-cast-head" role="row">
                  <span role="columnheader">{t("owner.dungeons.castCol.spell")}</span>
                  <span role="columnheader">{t("owner.dungeons.castCol.bar")}</span>
                  <span role="columnheader">{t("owner.dungeons.castCol.passed")}</span>
                  <span role="columnheader">{t("owner.dungeons.castCol.mine")}</span>
                </div>
                {d.casts.map((c) => (
                  <div key={c.id} className="odg-cast" role="row">
                    <span role="cell" className="odg-cast-name"><SpellLink id={c.id} name={c.name} /></span>
                    <span role="cell" className="odg-bar"><span style={{ width: `${c.width}%` }} /></span>
                    <span role="cell" className="mono odg-cast-n">{c.passed}</span>
                    <span role="cell" className="mono odg-cast-mine">{c.mine}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="odg-controls">
            {p.control.map((c) => (
              <div key={c.id} className="odg-control">
                <span className="synth-lbl">{t("owner.dungeons.control", { name: c.name })}</span>
                <span>{c.uses}{c.enemies && <> · {c.enemies}</>}</span>
              </div>
            ))}
            <span className="synth-note odg-control-note">{p.controlNote}</span>
          </div>
        </>
      )}
    </section>
  );
}
