import { useState } from "react";
import type { AxisRowModel } from "../lib/axes.ts";
import { confidenceColor } from "../lib/verdict.ts";

export function AxisRows({ rows }: { rows: AxisRowModel[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="axes">
      {rows.map((r) => {
        const na = r.score === null;
        const expanded = open === r.key;
        const shown = expanded ? r.all : r.top;
        return (
          <div key={r.key} className={"axis inset" + (na ? " axis-na" : "")} onClick={() => setOpen(expanded ? null : r.key)} title={r.confidence ? `${r.confidence} confidence` : "not applicable"}>
            <div className="axis-name">
              <span className="conf" style={{ background: confidenceColor(r.confidence) }} />
              <span className="label-caps">{r.label}</span>
              {r.badge && <span className="chip" title="Deep-dive analyses feed this axis">{r.badge}</span>}
            </div>
            <div className="axis-score mono">{na ? "n/a" : Math.round(r.score!)}</div>
            <div className="axis-evidence">
              {shown.map((e, i) => (
                <span key={i}>
                  {i > 0 && <span className="faint"> · </span>}
                  <span className={e.tone === "good" ? "tone-good" : "tone-bad"}>{e.delta}</span> {e.label}
                </span>
              ))}
              {shown.length === 0 && <span className="faint">{r.note}</span>}
              {!expanded && r.all.length > 2 && <span className="faint"> · +{r.all.length - 2} more</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
