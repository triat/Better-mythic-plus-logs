// The pull-request side of the weekly recalibration (.github/workflows/calibration-pr.yml, through
// scripts/calibration/apply-candidate.ts): decide whether the last fit is worth a pull request, and write its two
// blocks into default-config.json in the file's own layout, so the diff shows only the numbers that moved.
// Spec: docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md (decisions 8 and 9).
import { validateConfig } from "../evaluation/config.ts";
import type { EvaluationConfig } from "../evaluation/types.ts";
import { ROLES } from "./fit.ts";
import type { FitResult } from "./report.ts";

/** A fit older than this is stale: the Wednesday fit did not run. */
export const STALE_MS = 2 * 86_400_000;

export type Plan = { apply: true; reason: string } | { apply: false; fail: boolean; reason: string };

/** Whether to open a pull request from `fit`, against the config on main (`mainVersion`). */
export function planApply(fit: FitResult, mainVersion: string, now: number): Plan {
  if (now - fit.fittedAt > STALE_MS) return { apply: false, fail: true, reason: `the last fit is from ${new Date(fit.fittedAt).toISOString()}: the Wednesday fit did not run` };
  if (fit.baseVersion !== mainVersion) {
    return { apply: false, fail: false, reason: `the fit started from config ${fit.baseVersion}, main is at ${mainVersion}: the next fit after a release will start from it` };
  }
  if (!fit.thresholdMet) return { apply: false, fail: false, reason: fit.reason };
  return { apply: true, reason: fit.reason };
}

const pad = (role: string) => `"${role}":`.padEnd(9);

function globalCurveBlock(c: EvaluationConfig["globalCurve"]): string {
  const rows = ROLES.map((r) => `    ${pad(r)} [${c[r].map(([x, y]) => `[${x}, ${y}]`).join(", ")}]`);
  return `  "globalCurve": {\n${rows.join(",\n")}\n  },\n`;
}

function referenceBlock(ref: EvaluationConfig["reference"]): string {
  const rows = ROLES.map((r) => {
    const entries = Object.keys(ref[r]).sort().map((src) => `${JSON.stringify(src)}: { "x": ${ref[r][src]!.x}, "value": ${ref[r][src]!.value} }`);
    return `    "${r}": { ${entries.join(", ")} }`;
  });
  return `  "reference": {\n${rows.join(",\n")}\n  },\n`;
}

const GLOBAL_CURVE = /  "globalCurve": \{\n[\s\S]*?\n  \},\n/;
const REFERENCE = /  "reference": \{\n[\s\S]*?\n  \},\n/;
const VERSION = /"version": "(\d+)"/;

/** `text` (default-config.json) with the candidate's blocks and the next version; throws when the layout moved. */
export function applyCandidate(text: string, candidate: FitResult["candidate"]): { text: string; version: string } {
  const v = VERSION.exec(text);
  if (!v || !GLOBAL_CURVE.test(text) || !REFERENCE.test(text)) throw new Error("default-config.json: version, globalCurve or reference not where expected");
  const version = String(Number(v[1]) + 1);
  const out = text
    .replace(VERSION, `"version": "${version}"`)
    .replace(GLOBAL_CURVE, globalCurveBlock(candidate.globalCurve))
    .replace(REFERENCE, referenceBlock(candidate.reference));
  const parsed = validateConfig(JSON.parse(out));
  if (JSON.stringify(parsed.globalCurve) !== JSON.stringify(candidate.globalCurve)) throw new Error("default-config.json: the written globalCurve does not read back");
  return { text: out, version };
}
