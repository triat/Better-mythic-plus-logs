import type { FormChart } from "../../lib/form.ts";
import { CHART } from "../../lib/form.ts";

const DOT = { timed: "form-dot-timed", depleted: "form-dot-depleted", none: "form-dot-none" } as const;

/** "My season · key level per run" (mockup F-Moi-Forme): one dot per run, the target level dashed. Inline SVG, tokens. */
export function KeyChart({ chart }: { chart: FormChart }) {
  return (
    <svg className="form-chart" viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={chart.aria}>
      <g className="form-chart-grid">
        {chart.levels.map((l) => <line key={l.label} x1={CHART.left} y1={l.y} x2={CHART.right} y2={l.y} />)}
      </g>
      {chart.target && (
        <line className="form-chart-target" x1={CHART.left} y1={chart.target.y} x2={CHART.right} y2={chart.target.y} />
      )}
      <g className="form-chart-text">
        {chart.levels.map((l) => <text key={l.label} x={CHART.left - 10} y={l.y + 5} textAnchor="end">{l.label}</text>)}
        {chart.weeks.map((w) => <text key={w.x} x={w.x} y={CHART.height - 15} textAnchor="middle">{w.label}</text>)}
      </g>
      {chart.dots.map((d, i) => (
        <circle key={i} className={"form-dot " + DOT[d.timed === true ? "timed" : d.timed === false ? "depleted" : "none"]} cx={d.x} cy={d.y} r={9}>
          <title>{d.title}</title>
        </circle>
      ))}
    </svg>
  );
}
