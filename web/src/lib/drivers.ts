// The "What makes this score" block (canvas variant B, docs/design/canvas/ScoreDriversBars.dc.html): the view model
// behind components/ScoreDrivers.tsx. Spec: docs/superpowers/specs/2026-09-24-score-drivers-design.md.
import type { Evaluation } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { formatEvidenceValue } from "./axes.ts";

export const BAR_PX_PER_POINT = 6;
export const BAR_MAX_PX = 150;
const MAX_COSTS = 3;
const MAX_EARNS = 2;

type Unit = "perRun" | "vsPeers" | "pct" | "plain";
/** How each source reads with its unit; the reference drops "/ run" and "vs peers" to stay short. */
const UNIT: Record<string, Unit> = {
  "survival.individualDeaths": "perRun", "survival.wipeDeaths": "perRun", "survival.groupDeaths": "perRun",
  "survival.avoidableVsPeers": "vsPeers", "survival.dtpsVsPeers": "vsPeers", "utility.kicksVsPeers": "vsPeers",
  "utility.kicksAbsolute": "pct", "utility.dispels": "perRun",
  "preparation.potions": "perRun", "preparation.healthstones": "perRun",
  "experience.coverage": "pct", "experience.atTarget": "pct",
};
const REF_UNIT: Record<Unit, Unit> = { perRun: "plain", vsPeers: "pct", pct: "pct", plain: "plain" };

export interface DriverRow { source: string; title: string; impact: string; tone: "good" | "bad"; barPx: number; value: string; reference: string }
export interface DriversPath { message: string; verdict: string; verdictCls: "badge-maybe" | "badge-invite"; threshold: string; list: string; score: string }
export interface DriversView { rows: DriverRow[]; path: DriversPath | null }

const signedPoints = (n: number): string => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

export function driversView(t: T, locale: Locale, ev: Evaluation, titleOf: (source: string) => string): DriversView | null {
  const ds = ev.drivers ?? [];
  const costs = ds.filter((d) => d.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, MAX_COSTS);
  const earns = ds.filter((d) => d.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, MAX_EARNS);
  if (costs.length + earns.length === 0) return null;
  const fmt = (unit: Unit, source: string, v: number) => t(`drivers.unit.${unit}`, { value: formatEvidenceValue(locale, source, v) });
  const rows = [...costs, ...earns].map((d): DriverRow => {
    const unit = UNIT[d.source] ?? "plain";
    return {
      source: d.source,
      title: titleOf(d.source),
      impact: signedPoints(d.impact),
      tone: d.impact < 0 ? "bad" : "good",
      barPx: Math.min(BAR_MAX_PX, Math.abs(d.impact) * BAR_PX_PER_POINT),
      value: fmt(unit, d.source, d.value),
      reference: t("drivers.avg", { value: fmt(REF_UNIT[unit], d.source, d.reference) }),
    };
  });
  const nv = ev.nextVerdict;
  const path: DriversPath | null = nv ? {
    message: nv.reachable ? t("drivers.path.reach") : t("drivers.path.out", { count: nv.sources.length }),
    verdict: t(`verdict.words.${nv.verdict}`),
    verdictCls: nv.verdict === "invite" ? "badge-invite" : "badge-maybe",
    threshold: String(nv.threshold),
    list: new Intl.ListFormat(locale, { type: "conjunction" }).format(nv.sources.map((s) => titleOf(s).toLocaleLowerCase(locale))),
    score: String(nv.score),
  } : null;
  return { rows, path };
}
