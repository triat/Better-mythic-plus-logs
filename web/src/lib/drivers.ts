// A score driver's value and reference with their units (spec docs/superpowers/specs/2026-09-24-score-drivers-design.md):
// read by the synthesis, the method tab and Ma forme.
import type { Driver } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { formatEvidenceValue } from "./axes.ts";

type Unit = "perRun" | "vsPeers" | "pct" | "plain" | "ptsVsPeers" | "pts";
/** How each source reads with its unit; the reference drops "/ run" and "vs peers" to stay short.
 * `utility.kicksVsPeers` is percentage *points* vs peers, not a percentage, so it gets its own unit
 * rather than `vsPeers` (which is a true percentage, for `survival.avoidableVsPeers`/`dtpsVsPeers`). */
const UNIT: Record<string, Unit> = {
  "survival.individualDeaths": "perRun", "survival.wipeDeaths": "perRun", "survival.groupDeaths": "perRun",
  "survival.avoidableVsPeers": "vsPeers", "survival.dtpsVsPeers": "vsPeers", "utility.kicksVsPeers": "ptsVsPeers",
  "utility.kicksAbsolute": "pct", "utility.dispels": "perRun",
  "preparation.potions": "perRun", "preparation.healthstones": "perRun",
};
const REF_UNIT: Record<Unit, Unit> = { perRun: "plain", vsPeers: "pct", pct: "pct", plain: "plain", ptsVsPeers: "pts", pts: "pts" };

/** A source's value with its short unit, as the reference reads: "0.7", "−40%", "+4 pts" (the Méthode tab's table). */
export function shortValue(t: T, locale: Locale, source: string, v: number): string {
  return t(`drivers.unit.${REF_UNIT[UNIT[source] ?? "plain"]}`, { value: formatEvidenceValue(locale, source, v) });
}

/** A driver's value with its unit ("1.6 / run") and the average player's ("avg 0.7"). */
export function driverValues(t: T, locale: Locale, d: Pick<Driver, "source" | "value" | "reference">): { value: string; reference: string } {
  const unit = UNIT[d.source] ?? "plain";
  const fmt = (u: Unit, v: number) => t(`drivers.unit.${u}`, { value: formatEvidenceValue(locale, d.source, v) });
  return { value: fmt(unit, d.value), reference: t("drivers.avg", { value: fmt(REF_UNIT[unit], d.reference) }) };
}
