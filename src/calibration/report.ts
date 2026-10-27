// `bmpl calibrate --fit`: the weekly fit on the window's samples, and its comparison with today's config on the half
// it was not fitted on. Writes two aggregates next to calibration.db (no character name in either): `candidate.json`,
// what GET /api/ops/calibration serves and the pull-request workflow applies, and `comparison.md`, the pull request's
// body. Spec: docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md (decisions 8 and 9).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateConfig } from "../evaluation/config.ts";
import { scoreOnly } from "../evaluation/evaluate.ts";
import type { EvaluationConfig, Role } from "../evaluation/types.ts";
import { fitGlobal, isFit, MIN_N, quantile, ROLES, type Sample } from "./fit.ts";

/** A pull request only when, on the test half, this share of the characters changes verdict… */
export const VERDICT_SHARE = 0.02;
/** …or a role's median global moves by this many points (decision 9). */
export const MEDIAN_POINTS = 2;

export interface RoleComparison { fit: number; test: number; verdictChanges: number; medianCurrent: number | null; medianCandidate: number | null; refitted: boolean }

export interface FitResult {
  fittedAt: number;
  /** The config version the fit started from: the workflow only applies it on top of the same one. */
  baseVersion: string;
  candidate: Pick<EvaluationConfig, "globalCurve" | "reference">;
  roles: Record<Role, RoleComparison>;
  test: number;
  verdictChanges: number;
  thresholdMet: boolean;
  /** Why the threshold is met or not, one line for the workflow summary. */
  reason: string;
}

const median = (xs: number[]): number | null => (xs.length ? Math.round(quantile(xs, 0.5) * 10) / 10 : null);

export function fitAndCompare(samples: Sample[], base: EvaluationConfig, now: number): FitResult {
  const fit = samples.filter(isFit);
  const test = samples.filter((s) => !isFit(s));
  const g = fitGlobal(fit, base);
  // Validated here, so a candidate the shipped config would refuse never reaches the pull request.
  const cand: EvaluationConfig = validateConfig({ ...base, globalCurve: g.globalCurve, reference: g.reference });
  const roles = {} as Record<Role, RoleComparison>;
  let changes = 0;
  for (const role of ROLES) {
    const own = test.filter((s) => s.study.role === role);
    const cur = own.map((s) => scoreOnly(s.payload, base));
    const next = own.map((s) => scoreOnly(s.payload, cand));
    const verdictChanges = cur.filter((e, i) => e.verdict !== next[i]!.verdict).length;
    changes += verdictChanges;
    roles[role] = {
      fit: g.n[role], test: own.length, verdictChanges, refitted: g.n[role] >= MIN_N,
      medianCurrent: median(cur.map((e) => e.global).filter((x): x is number => x !== null)),
      medianCandidate: median(next.map((e) => e.global).filter((x): x is number => x !== null)),
    };
  }
  const refitted = ROLES.filter((r) => roles[r].refitted);
  const moved = refitted.filter((r) => {
    const { medianCurrent: a, medianCandidate: b } = roles[r];
    return a !== null && b !== null && Math.abs(b - a) >= MEDIAN_POINTS;
  });
  const share = test.length ? changes / test.length : 0;
  let thresholdMet = false;
  let reason: string;
  if (refitted.length === 0) reason = `not enough samples: every role needs ${MIN_N} in the fit half (${ROLES.map((r) => `${r} ${g.n[r]}`).join(", ")})`;
  else if (share >= VERDICT_SHARE || moved.length > 0) {
    thresholdMet = true;
    reason = `${(100 * share).toFixed(1)} % of ${test.length} held-out characters change verdict` + (moved.length ? `; median moved for ${moved.join(", ")}` : "");
  } else reason = `below the threshold: ${(100 * share).toFixed(1)} % change verdict (< ${100 * VERDICT_SHARE} %), no role median moves ${MEDIAN_POINTS} points`;
  return {
    fittedAt: now, baseVersion: base.version, candidate: { globalCurve: g.globalCurve, reference: g.reference },
    roles, test: test.length, verdictChanges: changes, thresholdMet, reason,
  };
}

/** The pull request's body: aggregates only. */
export function comparisonMarkdown(r: FitResult): string {
  const fmt = (v: number | null) => (v === null ? "—" : String(v));
  const lines = [
    `# Weekly recalibration, ${new Date(r.fittedAt).toISOString().slice(0, 10)}`,
    "",
    `Fitted on config ${r.baseVersion}: \`globalCurve\` and \`reference\` per role, from the rolling 4 weeks of samples (EU, +15 to +20). Compared with today's config on the held-out half (a character is in one half only).`,
    "",
    `**${r.thresholdMet ? "Above" : "Below"} the threshold.** ${r.reason}.`,
    "",
    "| Role | fit | held out | refitted | verdict changes | median global today | median global candidate |",
    "|---|---|---|---|---|---|---|",
    ...ROLES.map((role) => {
      const x = r.roles[role];
      return `| ${role} | ${x.fit} | ${x.test} | ${x.refitted ? "yes" : `no (< ${MIN_N})`} | ${x.verdictChanges} | ${fmt(x.medianCurrent)} | ${fmt(x.medianCandidate)} |`;
    }),
    "",
    "Spec: `docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md`.",
  ];
  return `${lines.join("\n")}\n`;
}

export const fitFiles = (dbPath: string) => ({ candidate: join(dirname(dbPath), "candidate.json"), comparison: join(dirname(dbPath), "comparison.md") });

/** Both files, each written whole (temp file + rename) so the ops route never reads half of one. */
export function writeFit(dbPath: string, r: FitResult): void {
  const f = fitFiles(dbPath);
  for (const [path, text] of [[f.candidate, `${JSON.stringify(r, null, 2)}\n`], [f.comparison, comparisonMarkdown(r)]] as const) {
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
  }
}

export function readFit(dbPath: string): { result: FitResult; comparison: string } | null {
  const f = fitFiles(dbPath);
  if (!existsSync(f.candidate) || !existsSync(f.comparison)) return null;
  return { result: JSON.parse(readFileSync(f.candidate, "utf8")) as FitResult, comparison: readFileSync(f.comparison, "utf8") };
}
