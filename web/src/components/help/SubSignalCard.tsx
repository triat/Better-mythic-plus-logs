import type { AxisKey, DocsResponse, SubSignalDoc } from "../../types.ts";
import { curveTable, roleWeights } from "../../lib/help.ts";
import { CurveChart } from "./CurveChart.tsx";

export type SubSignalConfig = DocsResponse["config"]["axes"][AxisKey]["subSignals"][string];

interface Props { axis: AxisKey; id: string; doc: SubSignalDoc; cfg: SubSignalConfig }

/** One sub-signal: the what / source / how / why / n/a rows on the left, its curve, table and role weights on the right. */
export function SubSignalCard({ axis, id, doc, cfg }: Props) {
  const rows = curveTable(cfg.curve, doc.unit);
  return (
    <div className="inset sub-card" id={`${axis}.${id}`}>
      <div>
        <div className="sub-head">
          <h3>{doc.title}</h3>
          <span className="faint mono" style={{ fontSize: 11 }}>{axis}.{id}</span>
          {doc.scaledByLevel && <a href="#level-scale" className="chip chip-warn">scaled by key level</a>}
        </div>
        <div className="kv">
          <span className="k">what</span><span>{doc.what}</span>
          <span className="k">source</span><span>{doc.source}</span>
          <span className="k">how</span><span>{doc.how}</span>
          <span className="k">why</span><span>{doc.why}</span>
          <span className="k">n/a</span><span>{doc.naWhen}</span>
        </div>
      </div>
      <div className="curve">
        <div className="label-caps">curve · {doc.unit} → score</div>
        <CurveChart points={cfg.curve} />
        <table>
          <tbody>
            {rows.map((r) => <tr key={r.x}><td className="k">{r.x}</td><td>→ {r.y}</td></tr>)}
          </tbody>
        </table>
        <div className="weights">
          {roleWeights(cfg.weights).map((w) => <span key={w.role} className="chip">{w.role} {w.weight}</span>)}
        </div>
      </div>
    </div>
  );
}
