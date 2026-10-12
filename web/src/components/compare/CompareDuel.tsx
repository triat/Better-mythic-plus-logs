// Two profiles side by side (mockup F-Comparer-Duel): the summary, the warning, two head cards, the mirrored axes,
// "Key figures" and "Best key per dungeon". Everything comes from `duelView`.
import type { DuelHead, DuelView, DungeonCell, MirrorRow, MirrorSide } from "../../lib/compare.ts";
import { useT } from "../../locale.tsx";
import { ClassIcon } from "../candidate/ProfileHeader.tsx";
import { CompareWarning, DungeonTile, TimedMark } from "./parts.tsx";

const vtOf = (cls: string): string => cls.replace(/^badge-/, "vt-");

export function CompareDuel({ view }: { view: DuelView }) {
  const { t } = useT();
  const names = view.heads.map((h) => h.name) as [string, string];
  return (
    <div className="cmp-duel">
      <section className="card cmp-summary">
        <span className="synth-lbl">{view.summary.title}</span>
        <strong className="cmp-summary-lead">{view.summary.lead}</strong>
        <span className="cmp-summary-detail">{view.summary.detail}</span>
      </section>
      {view.warning && <CompareWarning text={view.warning} />}
      <section className="cmp-heads">
        {view.heads.map((h) => <Head key={h.key} head={h} />)}
      </section>
      <section className="card cmp-mirror-card">
        <div className="cmp-mirror cmp-mirror-head">
          <span className="cmp-mirror-name left">{names[0]}</span>
          <span className="synth-lbl">{t("compare.duel.axesHead", { count: view.axes.length })}</span>
          <span className="cmp-mirror-name right">{names[1]}</span>
        </div>
        {view.axes.map((row) => <Mirror key={row.key} row={row} names={names} />)}
      </section>
      <section className="cmp-pair">
        <div className="card cmp-pair-card">
          <h2 className="synth-h2">{t("compare.facts.title")}</h2>
          <div className="cmp-facts cmp-facts-head">
            <span />
            <span>{names[0]}</span>
            <span>{names[1]}</span>
          </div>
          {view.facts.map((f) => (
            <div key={f.id} className="cmp-facts">
              <span className="cmp-facts-label">{f.label}</span>
              {f.cells.map((c, i) => (
                <span key={i} className={"mono cmp-fact" + (c.best ? " best" : "") + (c.tier ? ` tier-${c.tier} has-tier` : "")}>{c.text}</span>
              ))}
            </div>
          ))}
          <span className="synth-note cmp-foot">{t("compare.facts.note")}</span>
        </div>
        <div className="card cmp-pair-card">
          <h2 className="synth-h2">{t("compare.dungeon.title")}</h2>
          <div className="cmp-dgrid cmp-facts-head">
            <span />
            <span>{names[0]}</span>
            <span>{names[1]}</span>
          </div>
          {view.dungeons.map((d) => (
            <div key={d.id} className="cmp-dgrid">
              <DungeonTile abbr={d.abbr} name={d.name} />
              {d.cells.map((c, i) => <DuelDungeonCell key={i} cell={c} />)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Head({ head }: { head: DuelHead }) {
  const { t } = useT();
  return (
    <div className="card cmp-head">
      <div className="cmp-head-id">
        <ClassIcon view={head} />
        <div className="cmp-head-text">
          <strong className="cmp-head-name" style={{ color: head.classColor }}>{head.name}</strong>
          <span className="cmp-head-sub">{head.sub}</span>
        </div>
        <a className="btn cmp-btn" href={head.href}>{t("compare.duel.profile")}</a>
      </div>
      <div className={"cmp-verdict " + vtOf(head.verdict.cls)}>
        <span className="cmp-verdict-label">{head.verdict.label}</span>
        {head.verdict.score !== null && <span className="mono cmp-verdict-score">{head.verdict.score}</span>}
        <span className="cmp-verdict-runs">{head.runs}</span>
      </div>
      {head.notes.length > 0 && (
        <ul className="cmp-notes">
          {head.notes.map((n, i) => (
            <li key={i}><span className={"cmp-note-sign " + n.tone}>{n.sign}</span><span>{n.text}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Mirror({ row, names }: { row: MirrorRow; names: [string, string] }) {
  return (
    <div className={"cmp-mirror cmp-mirror-row" + (row.informational ? " is-info" : "")}>
      <Side side={row.left} name={names[0]} align="left" />
      <div className="cmp-mirror-axis">
        <strong>{row.name}</strong>
        <span className={"cmp-win" + (row.win.side ? " on" : "")}>{row.win.text}</span>
      </div>
      <Side side={row.right} name={names[1]} align="right" />
    </div>
  );
}

function Side({ side, name, align }: { side: MirrorSide; name: string; align: "left" | "right" }) {
  return (
    <div className={`cmp-side ${align} band-${side.band}`}>
      <span className="cmp-who-side">{name}</span>
      <span className="cmp-side-why">{side.why}</span>
      <span className={"mono cmp-side-score" + (side.wins ? " win" : "")}>{side.text}</span>
      <span className="cmp-bar"><span className="cmp-bar-fill" style={{ width: `${side.score ?? 0}%` }} /></span>
    </div>
  );
}

function DuelDungeonCell({ cell }: { cell: DungeonCell | null }) {
  if (!cell) return <span className="cmp-dcell faint">—</span>;
  return (
    <span className="cmp-dcell">
      <span className="cmp-dcell-line">
        <span className={"mono cmp-dkey" + (cell.top ? " is-top" : "")}>{cell.level}</span>
        <TimedMark timed={cell.timed} />
        <span className={"mono cmp-dparse" + (cell.parse.tier ? ` tier-${cell.parse.tier}` : "")}>{cell.parse.text}</span>
      </span>
      {cell.sub && <span className="cmp-dsub">{cell.sub}</span>}
    </span>
  );
}
