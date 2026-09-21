import type { AxisKey, CurvePoints, DocsResponse, EvaluationDocs, FaqEntry } from "../types.ts";
import { fmtPts } from "./format.ts";
import { AXIS_ORDER } from "./verdict.ts";

// View models of the /help page: anchors, the table of contents, curve tables and paths, weights and
// threshold wording. Every number shown on the page comes from GET /api/docs' `config`, never from here.

export type Anchor = string;

/** "survival.individualDeaths" → "survival.individualDeaths"; an axis key → "axis-survival"; "experience.prevSeasonBonus" stays as is. */
export function anchorOf(source: string): Anchor {
  return source.includes(".") ? source : `axis-${source}`;
}

export interface TocEntry { anchor: Anchor; label: string; sub?: boolean }

/** what, verdict, axes (+ six sub entries), level-scale, expected-ilvl, runs, peers, deep-dive, (hosted: wcl-client), reading, faq. */
export function toc(docs: EvaluationDocs, hosted: boolean): TocEntry[] {
  return [
    { anchor: "what", label: "What bmpl looks at" },
    { anchor: "verdict", label: "The verdict" },
    { anchor: "axes", label: "The six axes" },
    ...AXIS_ORDER.map((key) => ({ anchor: anchorOf(key), label: docs.axes[key].title, sub: true })),
    { anchor: "level-scale", label: "Key-level scaling" },
    { anchor: "expected-ilvl", label: "Expected item level" },
    { anchor: "runs", label: "Per-run signals" },
    { anchor: "peers", label: "Peers" },
    { anchor: "deep-dive", label: "Deep-dive" },
    ...(hosted ? [{ anchor: "wcl-client", label: "Your own WCL client" }] : []),
    { anchor: "reading", label: "Reading the page" },
    { anchor: "faq", label: "FAQ" },
  ];
}

export interface CurveRow { x: string; y: number }

const fmtNumber = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
/** Unicode minus, an explicit plus: "−40", "+50", "0". */
const signed = (n: number): string => (n < 0 ? `−${fmtNumber(-n)}` : n > 0 ? `+${fmtNumber(n)}` : "0");

/**
 * x formatted: integers as is, otherwise up to 2 decimals. Comparisons ("… vs peers", "… vs target", "percentage
 * points vs peers") and key levels get a sign; "% vs peers" also gets its %. Spreads ("± …") are magnitudes, unsigned.
 */
export function curveTable(points: CurvePoints, unit: string): CurveRow[] {
  const vs = !unit.startsWith("±") && unit.includes(" vs ");
  const pct = vs && unit.startsWith("%");
  const sign = vs || unit === "key level";
  return points.map(([x, y]) => ({ x: sign ? `${signed(x)}${pct ? "%" : ""}` : fmtNumber(x), y }));
}

/** Polyline path for a w×h box with a 4 px padding, x spanning the points, y from 0 to yMax (100 for scores; the max point for factors). */
export function curvePath(points: CurvePoints, w: number, h: number, yMax = 100): { path: string; dots: Array<{ cx: number; cy: number }>; midY: number } {
  const x0 = points[0]?.[0] ?? 0;
  const x1 = points[points.length - 1]?.[0] ?? x0;
  const span = x1 - x0 || 1;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const X = (x: number) => r1(4 + ((x - x0) / span) * (w - 8));
  const Y = (y: number) => r1(h - 4 - (y / yMax) * (h - 8));
  const dots = points.map(([x, y]) => ({ cx: X(x), cy: Y(y) }));
  const path = dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.cx},${d.cy}`).join(" ");
  return { path, dots, midY: Y(yMax / 2) };
}

export interface RoleWeight { role: "dps" | "healer" | "tank"; weight: number }

export function roleWeights(w: Record<"dps" | "healer" | "tank", number>): RoleWeight[] {
  return [{ role: "dps", weight: w.dps }, { role: "healer", weight: w.healer }, { role: "tank", weight: w.tank }];
}

/** Weight 0 for every role: the axis is shown, never counted. */
export function axisIsInformational(axisWeights: DocsResponse["config"]["axisWeights"], key: AxisKey): boolean {
  return (["dps", "healer", "tank"] as const).every((role) => (axisWeights[role]?.[key] ?? 0) === 0);
}

export function fmtThresholds(v: { invite: number; maybe: number; minRuns: number }, c: { high: number; medium: number }): { invite: string; maybe: string; minRuns: string; high: string; medium: string } {
  const runs = (n: number) => `${n} run${n === 1 ? "" : "s"}`;
  return { invite: String(v.invite), maybe: String(v.maybe), minRuns: `${v.minRuns} enriched run${v.minRuns === 1 ? "" : "s"}`, high: runs(c.high), medium: runs(c.medium) };
}

/** hostedOnly entries only on a hosted instance. */
export function faqEntries(docs: EvaluationDocs, hosted: boolean): FaqEntry[] {
  return docs.faq.filter((f) => !f.hostedOnly || hosted);
}

/** The axis-level minimum printed under the axis intro: deep-dive runs for Survival, the consistency minimum; null for the others. */
export function axisNote(key: AxisKey, c: DocsResponse["config"]["confidence"]): string | null {
  if (key === "survival") return `The two deep-dive sub-signals appear once at least ${c.deepdiveMinRuns} shown run${c.deepdiveMinRuns === 1 ? " has" : "s have"} been analyzed.`;
  if (key === "consistency") return `Every sub-signal needs at least ${c.consistencyMinRuns} run${c.consistencyMinRuns === 1 ? "" : "s"}; below that the axis is n/a.`;
  return null;
}

export type TextSegment = { text: string; href?: string; code?: true };

/** Splits registry prose on `[label](href)` links and `` `code` `` spans: "Open [Settings](/settings), type `bmpl`" → text / link / text / code. Plain text stays one segment. */
export function linkSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push(m[3] !== undefined ? { text: m[3], code: true } : { text: m[1]!, href: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length || out.length === 0) out.push({ text: text.slice(last) });
  return out;
}

export interface BudgetPill { pts: string; lookups: string }

/** "100 pts / h" + "about 10 uncached lookups", at roughly 10 pts per lookup (the rankings query); null when the instance has no per-member quota. */
export function budgetPill(pointsPerHour: number | null): BudgetPill | null {
  if (pointsPerHour === null) return null;
  const n = Math.max(1, Math.round(pointsPerHour / 10));
  return { pts: `${fmtPts(pointsPerHour)} pts / h`, lookups: `about ${n} uncached lookup${n === 1 ? "" : "s"}` };
}
