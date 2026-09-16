import type { AxisKey } from "../types.ts";
import { ANGLES_DEG, RADAR_VIEWBOX, axisLabelPos, axisPoint, polygonPoints, ringPoints } from "../lib/radar.ts";
import { AXIS_DESCRIPTIONS, AXIS_LABELS, AXIS_ORDER } from "../lib/verdict.ts";

export interface RadarSeries {
  /** Six scores in AXIS_ORDER; null = not applicable. */
  points: readonly (number | null)[];
  color: string;
  label: string;
  id?: string;
}

interface Props {
  series: RadarSeries[];
  /** Rendered width in px; height follows the viewBox ratio. */
  size?: number;
  /** Append the score to each axis label (single-series detail view). */
  showScores?: boolean;
}

export function Radar({ series, size = 420, showScores = false }: Props) {
  const height = Math.round((size * 310) / 440);
  const first = series[0];
  return (
    <svg width={size} height={height} viewBox={RADAR_VIEWBOX} role="img" aria-label="Six-axis radar">
      {[100, 75, 50, 25].map((ring) => (
        <polygon key={ring} points={ringPoints(ring)} fill="none" stroke={ring === 100 ? "#30363d" : "#21262d"} strokeWidth="1" />
      ))}
      <path
        d={ANGLES_DEG.map((_, i) => `M150 150 L${axisPoint(i, 100).join(" ")}`).join(" ")}
        stroke="#21262d"
        strokeWidth="1"
      />
      {series.map((s, i) => (
        <g key={s.id ?? `${i}:${s.label}`}>
          <polygon points={polygonPoints(s.points)} fill={s.color} fillOpacity="0.14" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
          {s.points.map((p, i) => {
            const [cx, cy] = axisPoint(i, p);
            return p === null ? (
              <circle key={i} cx={cx} cy={cy} r="4" fill="#161b22" stroke={s.color} strokeWidth="1.5" strokeDasharray="2 2" />
            ) : (
              <circle key={i} cx={cx} cy={cy} r="3.5" fill={s.color} />
            );
          })}
        </g>
      ))}
      {AXIS_ORDER.map((key: AxisKey, i) => {
        const { x, y, anchor } = axisLabelPos(i);
        const score = showScores && first ? first.points[i] : undefined;
        const na = score === null;
        const text = AXIS_LABELS[key].toUpperCase() + (score === undefined ? "" : na ? " n/a" : ` ${Math.round(score)}`);
        return (
          <text key={key} x={x} y={y} textAnchor={anchor} fontSize="10" fontWeight="600" letterSpacing="0.6" fill={na ? "#6e7681" : "#8b949e"}>
            <title>{AXIS_DESCRIPTIONS[key]}</title>
            {text}
          </text>
        );
      })}
    </svg>
  );
}
