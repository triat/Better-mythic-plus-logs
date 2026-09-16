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
        return (
          <div
            key={r.key}
            className={"axis inset" + (na ? " axis-na" : "") + (expanded ? " axis-open" : "")}
            onClick={() => setOpen(expanded ? null : r.key)}
            role="button"
            aria-expanded={expanded}
            title={expanded ? undefined : "Click to see what is measured and every piece of evidence"}
          >
            <div className="axis-name">
              <span className={"chev" + (expanded ? " open" : "")}>›</span>
              <span className="conf" style={{ background: confidenceColor(r.confidence) }} />
              <span className="label-caps">{r.label}</span>
              {r.badge && <span className="chip" title="Deep-dive analyses feed this axis">{r.badge}</span>}
            </div>
            <div className="axis-score mono">{na ? "n/a" : Math.round(r.score!)}</div>
            <div className="axis-evidence">
              {expanded ? (
                <span className="muted">{r.confidence ? `${r.confidence} confidence` : "not applicable"}</span>
              ) : (
                <>
                  {r.top.map((e, i) => (
                    <span key={i}>
                      {i > 0 && <span className="faint"> · </span>}
                      <span className={e.tone === "good" ? "tone-good" : "tone-bad"}>{e.delta}</span> {e.label}
                    </span>
                  ))}
                  {r.top.length === 0 && <span className="faint">{r.note}</span>}
                  {r.all.length > 2 && <span className="faint"> · +{r.all.length - 2} more</span>}
                </>
              )}
            </div>
            {expanded && (
              <div className="axis-detail">
                <div className="axis-callout">
                  <div className="label-caps axis-callout-title">What's measured · {r.weight}</div>
                  <div>{r.description}</div>
                </div>
                {r.all.length > 0 ? (
                  <div className="axis-evidence-grid">
                    {r.all.map((e, i) => (
                      <span key={i} className="contents">
                        <span className={"mono " + (e.tone === "good" ? "tone-good" : "tone-bad")}>{e.delta}</span>
                        <span>{e.label}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="faint">{r.note}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
