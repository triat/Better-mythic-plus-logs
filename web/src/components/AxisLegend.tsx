import type { AxisRowModel } from "../lib/axes.ts";
import { confidenceColor } from "../lib/verdict.ts";
import { useSettings } from "../settings.tsx";

/** "How the verdict is built": one line per axis with its weight; open by default, remembered per browser (local) or per account (hosted). */
export function AxisLegend({ rows }: { rows: AxisRowModel[] }) {
  const { settings, update } = useSettings();
  const open = settings.legendOpen;
  const toggle = () => update({ legendOpen: !open });
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
