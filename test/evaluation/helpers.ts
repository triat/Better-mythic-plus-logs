import { analyzeLookup, type MPlusRun } from "../../src/mplus.ts";
import type { EvalPayload, EvalRun } from "../../src/evaluation/inputs.ts";
import { parseRioProfile } from "../../src/signals/rio-profile.ts";
import { signalSummary } from "../../src/signals/summary.ts";
import type { GroupRole, RunSignals } from "../../src/signals/types.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadRioFixture, loadWclFixture } from "../fixtures.ts";

let seq = 0;

export const neutralSignals = (over: Partial<RunSignals> = {}): RunSignals => ({
  role: "dps",
  keystone: { level: 15, chests: 1, timed: true, timeMs: 1_500_000, affixes: [] },
  itemLevel: null,
  consumables: null,
  deaths: { count: 0, groupTotal: 0, events: [] },
  damageTaken: { total: 0, dtps: 0, peer: null },
  interrupts: { count: 0, kickCooldownS: null, capacity: null, usage: null, peer: null },
  dispels: { count: 0 },
  avoidableDamage: null,
  fightDurationMs: 1_500_000,
  ...over,
});

export const deaths = (individual: number, inWipe = 0, groupTotal?: number): RunSignals["deaths"] => ({
  count: individual + inWipe,
  groupTotal: groupTotal ?? individual + inWipe,
  events: [
    ...Array.from({ length: individual }, (_, i) => ({ atMs: 1000 * (i + 1), cause: null, source: null, overkill: 0, inWipe: false })),
    ...Array.from({ length: inWipe }, (_, i) => ({ atMs: 100_000 * (i + 1), cause: null, source: null, overkill: 0, inWipe: true })),
  ],
});

export const runWith = (signals: Partial<RunSignals> | null, extra: Partial<EvalRun> = {}): EvalRun => {
  seq++;
  return {
    keyLevel: 15,
    parsePercent: 70,
    reportCode: `R${seq}`,
    fightID: 1,
    ...(signals === null ? {} : { signals: neutralSignals(signals) }),
    ...extra,
  };
};

export const payloadWith = (runs: EvalRun[], extra: Partial<EvalPayload> = {}): EvalPayload => {
  const targetLevel = extra.targetLevel ?? 15;
  const levels = runs.map((r) => r.keyLevel).sort((a, b) => a - b);
  const parses = runs.map((r) => r.parsePercent).sort((a, b) => a - b);
  const mid = (xs: number[]) => (xs.length === 0 ? 0 : xs.length % 2 ? xs[(xs.length - 1) / 2]! : (xs[xs.length / 2 - 1]! + xs[xs.length / 2]!) / 2);
  const base: EvalPayload = {
    metric: "dps",
    targetLevel,
    perDungeon: {
      runs,
      dungeonsCovered: runs.length,
      totalDungeonsInSeason: 8,
      dungeonsAtOrAboveTarget: runs.filter((r) => r.keyLevel >= targetLevel).length,
      medianLevel: mid(levels),
      medianParse: mid(parses),
    },
    prevLevelBest: null,
    rio: null,
    summary: signalSummary(runs as MPlusRun[], extra.rio ?? null),
  };
  return { ...base, ...extra, perDungeon: { ...base.perDungeon, ...(extra.perDungeon ?? {}) } };
};

export async function fixturePayload(name: "s1-tank" | "s2-healer", withRio: boolean): Promise<EvalPayload> {
  const f = await loadWclFixture(name);
  const run: MPlusRun = { ...f.run };
  run.signals = parseRunSignals(f.report, f.character, { keyLevel: run.keyLevel, affixes: run.affixes, encounterID: run.encounterID })!;
  const result = analyzeLookup([run], run.keyLevel, [{ id: run.encounterID, name: run.encounterName }], true);
  const rio = withRio ? parseRioProfile(await loadRioFixture(), Date.parse("2026-09-15T12:00:00Z")) : null;
  return {
    metric: name === "s2-healer" ? "hps" : "dps",
    targetLevel: result.targetLevel,
    perDungeon: result.perDungeon,
    prevLevelBest: result.prevLevelBest,
    rio,
    summary: signalSummary([run], rio),
  };
}

export type { GroupRole };
