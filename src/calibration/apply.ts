// The pull-request side of the weekly recalibration (.github/workflows/calibration-pr.yml, through
// scripts/calibration/apply-candidate.ts): decide whether the last fit is worth a pull request, and write its blocks
// into default-config.json in the file's own layout, so the diff shows only the numbers that moved.
// Spec: docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md (decisions 8 and 9). Also the whole file
// from the evaluation study's proposal (`applyProposal`, validity spec 2026-10-27, phase 3).
import { validateConfig } from "../evaluation/config.ts";
import { AXIS_KEYS, type CurvePoints, type EvaluationConfig } from "../evaluation/types.ts";
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

function expectedIlvlBlock(e: EvaluationConfig["expectedIlvl"]): string {
  const rows = Object.entries(e).map(([slug, c]) => `    ${JSON.stringify(slug)}: [${c.map(([x, y]) => `[${x}, ${y}]`).join(", ")}]`);
  return `  "expectedIlvl": {\n${rows.join(",\n")}\n  },\n`;
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
const EXPECTED_ILVL = / {2}"expectedIlvl": \{\n[\s\S]*?\n {2}\},\n/;
const VERSION = /"version": "(\d+)"/;

/**
 * `text` (default-config.json) with the candidate's blocks (`expectedIlvl` too when the fit has one) and the next
 * version; throws when the layout moved.
 */
export function applyCandidate(text: string, candidate: FitResult["candidate"]): { text: string; version: string } {
  const v = VERSION.exec(text);
  if (!v || !GLOBAL_CURVE.test(text) || !REFERENCE.test(text) || !EXPECTED_ILVL.test(text)) {
    throw new Error("default-config.json: version, expectedIlvl, globalCurve or reference not where expected");
  }
  const version = String(Number(v[1]) + 1);
  let out = text
    .replace(VERSION, `"version": "${version}"`)
    .replace(GLOBAL_CURVE, globalCurveBlock(candidate.globalCurve))
    .replace(REFERENCE, referenceBlock(candidate.reference));
  if (candidate.expectedIlvl) out = out.replace(EXPECTED_ILVL, expectedIlvlBlock(candidate.expectedIlvl));
  const parsed = validateConfig(JSON.parse(out));
  if (JSON.stringify(parsed.globalCurve) !== JSON.stringify(candidate.globalCurve)) throw new Error("default-config.json: the written globalCurve does not read back");
  if (candidate.expectedIlvl && JSON.stringify(parsed.expectedIlvl) !== JSON.stringify(candidate.expectedIlvl)) {
    throw new Error("default-config.json: the written expectedIlvl does not read back");
  }
  return { text: out, version };
}

const pts = (c: CurvePoints): string => `[${c.map(([x, y]) => `[${x}, ${y}]`).join(", ")}]`;
const roleMap = <T>(m: Partial<Record<string, T>>, f: (v: T) => string): string =>
  `{ ${ROLES.filter((r) => m[r] !== undefined).map((r) => `"${r}": ${f(m[r]!)}`).join(", ")} }`;

function axesBlock(axes: EvaluationConfig["axes"]): string {
  const axisRows = AXIS_KEYS.map((axis) => {
    const subs = Object.entries(axes[axis].subSignals);
    const width = Math.max(...subs.map(([id]) => id.length)) + 3;
    const rows = subs.map(([id, sc]) => {
      const head = `        ${`${JSON.stringify(id)}:`.padEnd(width)} { "curve": ${pts(sc.curve)}, "weights": ${roleMap(sc.weights, String)}`;
      const tail = `${sc.pillarOnly ? `, "pillarOnly": true` : ""} }`;
      // Per-role curves go on their own line: three of them would not fit beside the shared one.
      return sc.curves ? `${head},\n          "curves": ${roleMap(sc.curves, pts)}${tail}` : `${head}${tail}`;
    });
    return `    "${axis}": {\n      "subSignals": {\n${rows.join(",\n")}\n      }\n    }`;
  });
  return `  "axes": {\n${axisRows.join(",\n")}\n  },\n`;
}

function shrinkageBlock(s: NonNullable<EvaluationConfig["shrinkage"]>): string {
  const rows = ROLES.filter((r) => s[r]).map((r) => {
    const entries = Object.keys(s[r]!).sort().map((src) => `${JSON.stringify(src)}: ${s[r]![src]}`);
    return `    "${r}": { ${entries.join(", ")} }`;
  });
  return `  "shrinkage": {\n${rows.join(",\n")}\n  },\n`;
}

/** JSON with every object's keys sorted: the same config whatever order its maps were built in. */
const canonical = (v: unknown): string => JSON.stringify(v, (_, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/** The whole default-config.json for `cfg`, in the file's own layout. */
export function configText(cfg: EvaluationConfig): string {
  const flat = (v: unknown) => JSON.stringify(v).replace(/,/g, ", ").replace(/:/g, ": ").replace(/\{/g, "{ ").replace(/\}/g, " }");
  return [
    "{\n",
    `  "version": "${cfg.version}",\n`,
    `  "levelScale": ${pts(cfg.levelScale)},\n`,
    expectedIlvlBlock(cfg.expectedIlvl),
    axesBlock(cfg.axes),
    `  "axisWeights": {\n${ROLES.map((r) => `    ${pad(r)} ${flat(cfg.axisWeights[r])}`).join(",\n")}\n  },\n`,
    globalCurveBlock(cfg.globalCurve),
    referenceBlock(cfg.reference),
    cfg.shrinkage ? shrinkageBlock(cfg.shrinkage) : "",
    `  "verdict": ${flat(cfg.verdict)},\n`,
    `  "confidence": ${flat(cfg.confidence)}\n`,
    "}\n",
  ].join("");
}

/**
 * default-config.json rewritten from the study's proposal (`StudyResult.proposal.config`, user 2026-10-28) with the
 * next version after `text`'s; throws when the written file does not read back as the proposal.
 */
export function applyProposal(text: string, proposal: EvaluationConfig): { text: string; version: string } {
  const v = VERSION.exec(text);
  if (!v) throw new Error("default-config.json: no version");
  const version = String(Number(v[1]) + 1);
  const next = { ...proposal, version };
  const out = configText(next);
  if (canonical(validateConfig(JSON.parse(out))) !== canonical(validateConfig(next))) {
    throw new Error("default-config.json: the written proposal does not read back");
  }
  return { text: out, version };
}
