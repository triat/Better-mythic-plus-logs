// Three to five profiles as a ranking (mockup F-Comparer-Multi): ranked mini-profiles, "Axis by axis" with the main
// figures and the others under a disclosure, "Best key per dungeon". Every grid is one DOM: under 900 px its rows
// restack and each cell shows its `.cmp-who` label (series square + name).
import type { CSSProperties } from "react";
import type { DungeonCell, FactRow, RankCard, RankingView } from "../../lib/compare.ts";
import { useT } from "../../locale.tsx";
import { CompareWarning, DungeonTile, TimedMark } from "./parts.tsx";

type Column = RankingView["columns"][number];
const vtOf = (cls: string): string => cls.replace(/^badge-/, "vt-");

export function CompareRanking({ view }: { view: RankingView }) {
  const { t } = useT();
  const grid = { "--n": view.columns.length } as CSSProperties;
  return (
    <div className="cmp-rank">
      {view.warning && <CompareWarning text={view.warning} />}
      <section className="cmp-cards">
        {view.cards.map((c) => <Card key={c.key} card={c} />)}
      </section>
      <p className="synth-note cmp-bars-note">{t("compare.multi.barsNote")}</p>

      <section className="card cmp-grid-card">
        <div className="synth-card-head">
          <h2 className="synth-h2">{t("compare.multi.axes")}</h2>
          <span className="synth-note">{t("compare.multi.bestNote")}</span>
        </div>
        <ColumnHeads columns={view.columns} style={grid} />
        {view.axes.map((row) => (
          <div key={row.key} className={"cmp-g5 cmp-g5-row" + (row.informational ? " is-info" : "")} style={grid}>
            <span className="cmp-g5-label">
              <strong>{row.name}</strong>
              <span className="cmp-g5-sub" title={row.subHint ?? undefined}>{row.sub}</span>
            </span>
            {row.cells.map((c, i) => (
              <span key={view.columns[i]!.key} className={`cmp-g5-cell band-${c.band}`}>
                <Who column={view.columns[i]!} />
                <span className="cmp-axis-cell">
                  <span className={"mono cmp-axis-value" + (c.best ? " best" : "")}>{c.text}</span>
                  <span className="cmp-bar"><span className="cmp-bar-fill" style={{ width: `${c.value ?? 0}%` }} /></span>
                </span>
              </span>
            ))}
          </div>
        ))}
        {view.main.map((f) => <Fact key={f.id} row={f} columns={view.columns} style={grid} />)}
        {view.more.length > 0 && (
          <details className="cmp-more">
            <summary>{t("compare.multi.allFacts", { count: view.more.length })}</summary>
            {view.more.map((f) => <Fact key={f.id} row={f} columns={view.columns} style={grid} />)}
          </details>
        )}
      </section>

      <section className="card cmp-grid-card">
        <div className="synth-card-head">
          <h2 className="synth-h2">{t("compare.dungeon.title")}</h2>
          <span className="synth-note">{t("compare.multi.dungeonNote")}</span>
        </div>
        <ColumnHeads columns={view.columns} style={grid} />
        {view.dungeons.map((d) => (
          <div key={d.id} className="cmp-g5 cmp-g5-row" style={grid}>
            <span className="cmp-g5-label"><DungeonTile abbr={d.abbr} name={d.name} /></span>
            {d.cells.map((c, i) => (
              <span key={view.columns[i]!.key} className="cmp-g5-cell">
                <Who column={view.columns[i]!} />
                <KeyBox cell={c} />
              </span>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

function Card({ card }: { card: RankCard }) {
  const { t } = useT();
  return (
    <div className={"card cmp-card " + vtOf(card.verdict.cls) + (card.top ? " is-top" : "")}>
      <div className="cmp-card-top">
        <span className="mono cmp-card-rank">#{card.rank}</span>
        <span className={`cmp-series series-${card.series}`} aria-hidden="true" />
        <span className="cmp-card-target">{t("compare.multi.target")} <span className="mono">{card.target}</span></span>
      </div>
      <div className="cmp-card-id">
        <a className="cmp-card-name" href={card.href} style={{ color: card.classColor }}>{card.name}</a>
        <span className="cmp-card-spec">{card.spec}</span>
      </div>
      <div className="cmp-card-score">
        {card.score !== null && <span className="mono">{card.score}</span>}
        <span className="cmp-card-verdict">{card.verdict.label}</span>
      </div>
      <div className="cmp-card-bars" role="img" aria-label={card.aria}>
        {card.bars.map((b) => (
          <span key={b.key} className={`cmp-card-bar band-${b.band}` + (b.informational ? " is-info" : "")} style={{ height: `${b.value ?? 0}%` }} />
        ))}
      </div>
      <div className="cmp-card-short" aria-hidden="true">
        {card.bars.map((b) => <span key={b.key}>{b.short}</span>)}
      </div>
      <span className="cmp-card-line">{card.line}</span>
    </div>
  );
}

function ColumnHeads({ columns, style }: { columns: Column[]; style: CSSProperties }) {
  return (
    <div className="cmp-g5 cmp-g5-head" style={style}>
      <span />
      {columns.map((c) => <span key={c.key} className="cmp-col"><Series n={c.series} /><span className="cmp-col-name">{c.name}</span></span>)}
    </div>
  );
}

/** The cell's column, shown only where the grid restacks (under 900 px). */
function Who({ column }: { column: Column }) {
  return <span className="cmp-who"><Series n={column.series} /><span className="cmp-col-name">{column.name}</span></span>;
}

const Series = ({ n }: { n: number }) => <span className={`cmp-series series-${n}`} aria-hidden="true" />;

function Fact({ row, columns, style }: { row: FactRow; columns: Column[]; style: CSSProperties }) {
  return (
    <div className="cmp-g5 cmp-g5-row cmp-g5-fact" style={style}>
      <span className="cmp-g5-label cmp-facts-label">{row.label}</span>
      {row.cells.map((c, i) => (
        <span key={columns[i]!.key} className="cmp-g5-cell">
          <Who column={columns[i]!} />
          <span className={"mono cmp-fact" + (c.best ? " best" : "") + (c.tier ? ` tier-${c.tier} has-tier` : "")}>{c.text}</span>
        </span>
      ))}
    </div>
  );
}

function KeyBox({ cell }: { cell: DungeonCell | null }) {
  if (!cell) return <span className="cmp-keybox empty">—</span>;
  return (
    <span className={"cmp-keybox" + (cell.top ? " is-top" : "")} title={cell.sub || undefined}>
      <span className="mono cmp-dkey">{cell.level}</span>
      <TimedMark timed={cell.timed} />
      <span className={"mono cmp-dparse" + (cell.parse.tier ? ` tier-${cell.parse.tier}` : "")}>{cell.parse.text}</span>
    </span>
  );
}
