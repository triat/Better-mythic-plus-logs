import type { AxisDoc, AxisKey, DocsResponse } from "../../types.ts";
import { anchorOf, axisIsInformational, axisNote } from "../../lib/help.ts";
import { SubSignalCard } from "./SubSignalCard.tsx";

interface Props {
  axisKey: AxisKey;
  doc: AxisDoc;
  config: DocsResponse["config"];
}

/** One axis card: title, summary, why, the per-axis minimum, then one SubSignalCard per sub-signal (config order) and the extras. */
export function AxisSection({ axisKey, doc, config }: Props) {
  const subIds = Object.keys(config.axes[axisKey].subSignals);
  const extras = Object.entries(doc.extras ?? {});
  const note = axisNote(axisKey, config.confidence);
  return (
    <section className="card help-card" id={anchorOf(axisKey)}>
      <div className="help-head">
        <h2>{doc.title}</h2>
        <span className="muted" style={{ fontSize: 12 }}>{subIds.length} sub-signal{subIds.length === 1 ? "" : "s"}{extras.length > 0 && ` · ${extras.length} bonus`}</span>
      </div>
      <p className="help-p">{doc.summary}</p>
      <p className="help-p"><span className="muted">why · </span>{doc.why}</p>
      {axisIsInformational(config.axisWeights, axisKey) && (
        <p className="help-p"><span className="chip chip-warn" style={{ marginLeft: 0, marginRight: 6 }}>informational</span>Weight 0 for every role on this instance: the axis is shown, never counted in the global score.</p>
      )}
      {note && <p className="help-p faint">{note}</p>}
      {subIds.map((id) => {
        const sub = doc.subSignals[id];
        return sub ? <SubSignalCard key={id} axis={axisKey} id={id} doc={sub} cfg={config.axes[axisKey].subSignals[id]!} /> : null;
      })}
      {extras.map(([id, extra]) => (
        <div key={id} className="inset extra-card" id={`${axisKey}.${id}`}>
          <div className="sub-head">
            <h3>{extra.title}</h3>
            <span className="faint mono" style={{ fontSize: 11 }}>{axisKey}.{id}</span>
          </div>
          <div className="kv">
            <span className="k">what</span><span>{extra.what}</span>
            <span className="k">how</span><span>{extra.how}</span>
            <span className="k">why</span><span>{extra.why}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
