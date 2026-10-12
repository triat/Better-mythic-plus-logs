import type { FormChart } from "../../lib/form.ts";

const DOT = { timed: "form-dot-timed", depleted: "form-dot-depleted", none: "form-dot-none" } as const;

/**
 * "My season · key level per run" (mockup F-Moi-Forme): one dot per run, the target level dashed. Inline SVG, tokens.
 * The viewBox is the chart's box (`chartBox` of the measured width), so its labels keep their CSS size on a phone.
 */
export function KeyChart({ chart }: { chart: FormChart }) {
  const b = chart.box;
  return (
    <svg
      className={"form-chart" + (b.narrow ? " form-chart-narrow" : "")}
      viewBox={`0 0 ${b.width} ${b.height}`} role="img" aria-label={chart.aria}
    >
      <g className="form-chart-grid">
        {chart.levels.map((l) => <line key={l.label} x1={b.left} y1={l.y} x2={b.right} y2={l.y} />)}
      </g>
      {chart.target && (
        <line className="form-chart-target" x1={b.left} y1={chart.target.y} x2={b.right} y2={chart.target.y} />
      )}
      <g className="form-chart-text">
        {chart.levels.map((l) => <text key={l.label} x={b.left - 10} y={l.y + 4} textAnchor="end">{l.label}</text>)}
        {chart.weeks.map((w) => <text key={w.x} x={w.x} y={b.height - (b.narrow ? 12 : 15)} textAnchor="middle">{w.label}</text>)}
      </g>
      {chart.dots.map((d, i) => (
        <circle key={i} className={"form-dot " + DOT[d.timed === true ? "timed" : d.timed === false ? "depleted" : "none"]} cx={d.x} cy={d.y} r={b.narrow ? 7 : 9}>
          <title>{d.title}</title>
        </circle>
      ))}
    </svg>
  );
}
