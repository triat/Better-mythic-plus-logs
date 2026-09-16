import { useState } from "react";
import type { AxisRowModel } from "../lib/axes.ts";
import { confidenceColor } from "../lib/verdict.ts";

const STORAGE_KEY = "bmpl.legendOpen";
const readOpen = (): boolean => { try { return localStorage.getItem(STORAGE_KEY) !== "0"; } catch { return true; } };
const writeOpen = (v: boolean): void => { try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* private mode */ } };

/** "How the verdict is built": one line per axis with its weight; open by default, remembered per browser. */
export function AxisLegend({ rows }: { rows: AxisRowModel[] }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => { setOpen((o) => { writeOpen(!o); return !o; }); };
  return (
    <div className="legend">
      <button type="button" className="section-head" onClick={toggle} aria-expanded={open}>
        <span className={"chev" + (open ? " open" : "")}>›</span>
        <span className="legend-title">How the verdict is built</span>
        <span className="muted">six axes scored 0–100, weighted by role · the dot is the axis confidence</span>
      </button>
      {open && (
        <div className="legend-grid">
          {rows.map((r) => (
            <div key={r.key} className="legend-item">
              <div className="label-caps legend-item-title">
                <span className="conf" style={{ background: confidenceColor(r.confidence) }} />
                {r.label} <span className="faint legend-weight">· {r.weight}</span>
              </div>
              <div className="muted">{r.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
