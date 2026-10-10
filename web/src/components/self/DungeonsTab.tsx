import { Fragment, useState } from "react";
import type { AxisKey, LookupPayload, SeasonView } from "../../types.ts";
import { PILLAR_ORDER, dungeonPanel, dungeonRows, seasonHeader, workOnRows } from "../../lib/self.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { DungeonPanel } from "./DungeonPanel.tsx";

/** Canvas SelfDungeonFirst (variant C) inside variant A's tab: the grid, its season header row, the panel. */
export function DungeonsTab({ payload, season, loading, onRuns }: { payload: LookupPayload; season: SeasonView | null; loading: boolean; onRuns: (encounterID: number) => void }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const [sel, setSel] = useState<number | null>(null);
  if (loading) return <section className="card muted">{t("self.loading")}</section>;
  if (!season || season.dungeons.length === 0) return <section className="card muted">{t("self.sync.nothing")}</section>;
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const head = seasonHeader(t, season);
  const rows = dungeonRows(t, season);
  const selected = season.dungeons.find((d) => d.encounterID === sel) ?? season.dungeons[0]!;
  const work = workOnRows(t, locale, payload.evaluation, season, titleOf);
  return (
    <div className="side">
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="grid5">
          <span className="label-caps">{t("self.grid.season")}</span>
          {head.cells.map((c, i) => (
            <span key={i} className={"cell cell-big cell-" + c.band}>{c.text}{c.trend && <div className="pillar-trend">{c.trend}</div>}</span>
          ))}
          <span className={"cell cell-big cell-" + head.overall.band}>{head.overall.text}</span>
          <span className="muted mono">{head.runs}</span>
        </div>
        <div className="grid5">
          <span className="label-caps">{t("self.grid.dungeon")}</span>
          {PILLAR_ORDER.map((k) => <span key={k} className="label-caps" style={{ textAlign: "center" }}>{t(`self.pillars.${k}`)}</span>)}
          <span className="label-caps" style={{ textAlign: "center" }}>{t("self.grid.overall")}</span>
          <span className="label-caps">{t("self.grid.runs")}</span>
          {rows.map((r) => (
            <Fragment key={r.encounterID}>
              <button type="button" className={"grid5-name" + (r.encounterID === selected.encounterID ? " on" : "")} onClick={() => setSel(r.encounterID)}>{r.name}</button>
              {r.cells.map((c, i) => <span key={i} className={"cell cell-" + c.band}>{c.text}</span>)}
              <span className={"cell cell-" + r.overall.band}>{r.overall.text}</span>
              <span className="muted mono">{r.runs}</span>
            </Fragment>
          ))}
        </div>
        {work.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t("self.workOn.line", { list: work.map((w) => w.title).join(" · ") })}</div>}
      </section>
      <DungeonPanel v={dungeonPanel(t, locale, selected)} onRuns={() => onRuns(selected.encounterID)} />
    </div>
  );
}
