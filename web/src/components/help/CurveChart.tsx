import type { CurvePoints } from "../../types.ts";
import { curvePath } from "../../lib/help.ts";

const W = 200;
const H = 52;

/** Inline 200×52 polyline of a config curve: x spans the points, y from 0 to `yMax` (100 for scores). Canvas "HelpA". */
export function CurveChart({ points, yMax = 100 }: { points: CurvePoints; yMax?: number }) {
  const { path, dots, midY } = curvePath(points, W, H, yMax);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1={4} y1={midY} x2={W - 4} y2={midY} stroke="var(--border-soft)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="var(--link)" strokeWidth={1.5} />
      {dots.map((d, i) => <circle key={i} cx={d.cx} cy={d.cy} r={2} fill="var(--link)" />)}
    </svg>
  );
}
