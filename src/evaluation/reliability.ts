// How far the verdict can be trusted for the key the member is vetting for (spec
// docs/superpowers/specs/2026-10-27-evaluation-validity-design.md, decisions 5 and 6; canvas "bmpl · Verdict à ton
// niveau", variant C): whether the player has played that level at all, and how much the score moves when one run is
// left out. Neither changes the score or the verdict; both are read by the Synthèse tab, the header, Récents, Live and
// Compare.
import { scoreAllAxes } from "./axes/index.ts";
import { median } from "./curve.ts";
import { finalGlobal } from "./global.ts";
import { collectInputs, type EvalPayload, type EvalRun, evalRuns } from "./inputs.ts";
import type { EvaluationConfig, LevelProof, ScoreRange } from "./types.ts";

/** A level is proven by a shown run at the target level minus this, or above. */
export const LEVEL_MARGIN = 2;

/** The highest key among the shown runs against the target: proven when it reaches `targetLevel − LEVEL_MARGIN`. */
export function levelProof(payload: EvalPayload): LevelProof {
  const levels = evalRuns(payload).map((r) => r.keyLevel);
  const best = levels.length > 0 ? Math.max(...levels) : null;
  const floor = payload.targetLevel - LEVEL_MARGIN;
  return {
    floor,
    best,
    atTarget: payload.perDungeon.runs.filter((r) => r.keyLevel >= payload.targetLevel).length,
    proven: best !== null && best >= floor,
  };
}

const runKey = (r: Pick<EvalRun, "reportCode" | "fightID">): string => `${r.reportCode}:${r.fightID}`;

/** The payload without one run: out of the dungeon list (its median parse recomputed) and out of the previous level. */
export function payloadWithout(payload: EvalPayload, run: Pick<EvalRun, "reportCode" | "fightID">): EvalPayload {
  const key = runKey(run);
  const runs = payload.perDungeon.runs.filter((r) => runKey(r) !== key);
  const ranked = runs.filter((r) => r.parsePercent > 0).map((r) => r.parsePercent);
  return {
    ...payload,
    perDungeon: { ...payload.perDungeon, runs, medianParse: median(ranked) ?? 0 },
    prevLevelBest: payload.prevLevelBest && runKey(payload.prevLevelBest.best) === key ? null : payload.prevLevelBest,
  };
}

/**
 * The global score with each shown run left out in turn; null when the verdict needs every run (fewer than
 * `verdict.minRuns + 1` runs with signals) or no score exists.
 */
export function scoreRange(payload: EvalPayload, cfg: EvaluationConfig, runsUsed: number, global: number | null): ScoreRange | null {
  if (global === null || runsUsed < cfg.verdict.minRuns + 1) return null;
  const without: ScoreRange["without"] = [];
  for (const run of evalRuns(payload)) {
    const inputs = collectInputs(payloadWithout(payload, run), cfg);
    const score = finalGlobal(scoreAllAxes(inputs, cfg), inputs.role, cfg);
    if (score !== null) without.push({ reportCode: run.reportCode, fightID: run.fightID, score });
  }
  if (without.length === 0) return null;
  const scores = without.map((w) => w.score);
  return { low: Math.min(...scores), high: Math.max(...scores), without };
}
