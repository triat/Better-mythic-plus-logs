import { classHex, className } from "@shared/wow/classes.ts";
import type { HistoryItem, LookupPayload } from "../types.ts";
import { radarPoints } from "../lib/axes.ts";
import { compareSections } from "../lib/compare.ts";
import { verdictView } from "../lib/verdict.ts";
import { Radar } from "./Radar.tsx";

export interface CompareEntry { item: HistoryItem; payload: LookupPayload }

export function Compare({ entries, onJump }: { entries: CompareEntry[]; onJump: (key: string) => void }) {
  const series = entries.map((e) => ({ points: radarPoints(e.payload.evaluation), color: classHex(e.payload.character.classID), label: e.payload.character.name }));
  const sections = compareSections(entries.map((e) => e.payload));
  return (
    <section className="card compare">
      <div className="radar-wrap">
        <Radar series={series} size={380} />
        <div className="radar-legend">
          {series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      </div>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th />
              {entries.map((e) => {
                const v = verdictView(e.payload.evaluation);
                return (
                  <th key={e.item.key}>
                    <a href="#" onClick={(ev) => { ev.preventDefault(); onJump(e.item.key); }} style={{ color: classHex(e.payload.character.classID) }}>{e.payload.character.name}</a>
                    <div className="muted" style={{ fontWeight: 400 }}>{e.payload.character.spec ? `${e.payload.character.spec} ` : ""}{className(e.payload.character.classID)}</div>
                    <div>
                      <span className={"badge badge-sm " + v.cls}>
                        <span className="badge-label">{v.label}</span>
                        {v.score !== null && <span className="badge-score mono">{v.score}</span>}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              s.rows.length === 0 ? null : [
                <tr key={s.title} className="section-row"><td colSpan={entries.length + 1}>{s.title}</td></tr>,
                ...s.rows.map((r) => (
                  <tr key={s.title + r.label}>
                    <td className="row-label">{r.label}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className={(c.best ? "cell-best " : "") + c.cls}>
                        {c.text}
                      </td>
                    ))}
                  </tr>
                )),
              ]
            ))}
          </tbody>
        </table>
        <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>Avg deaths and median Δ DTPS are computed across displayed runs. Highlight = best on that row.</p>
      </div>
    </section>
  );
}
