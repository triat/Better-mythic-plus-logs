import { describe, expect, test } from "bun:test";
import { renderDeepdive, renderDeepdiveLine, renderEvaluation, renderRunSignals, renderSummaryLine } from "../src/format-mplus.ts";
import type { RunDefensives } from "../src/deepdive/types.ts";
import type { Evaluation } from "../src/evaluation/types.ts";
import type { SignalSummary } from "../src/signals/summary.ts";
import { parseRunSignals } from "../src/signals/wcl-run.ts";
import { formatDuration } from "../src/util.ts";
import { loadWclFixture } from "./fixtures.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const base: RunDefensives = {
  reportCode: "R", fightID: 1, character: "X", className: "Paladin", spec: "Holy", tableMissing: false, tableVersion: "t",
  defensives: [], deaths: [], majorUsage: 0.41, avoidableDeaths: 1, countedDeaths: 2,
  unlisted: [{ id: 5, name: "Mystery", casts: 5, uptimeS: 40 }], staleTable: false, truncated: false, fetchedAt: 0, pointsSpent: 3,
};

describe("formatDuration", () => {
  test("mm:ss", () => {
    expect(formatDuration(1751502)).toBe("29:11");
    expect(formatDuration(59_000)).toBe("0:59");
    expect(formatDuration(3_600_000)).toBe("60:00");
  });
});

describe("renderRunSignals", () => {
  test("tank line: deaths, dtps without peers, kicks with usage, dispels, no avoidable", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", { keyLevel: 18, affixes: [], encounterID: f.run.encounterID })!;
    const line = strip(renderRunSignals(s));
    expect(line).toContain("0 deaths");
    expect(line).toContain("dtps");
    expect(line).not.toContain("vs ");
    expect(line).toMatch(/kicks 23\/113 \(peer \d+%\)/);
    expect(line).toContain("dispels 0");
    expect(line).not.toContain("avoidable");
  });

  test("healer line: death in wipe, avoidable delta, no kick capacity", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", { keyLevel: 21, affixes: [], encounterID: f.run.encounterID })!;
    const line = strip(renderRunSignals(s));
    expect(line).toContain("1 death (1 in wipe)");
    expect(line).toMatch(/avoidable [\d.]+k\/min \(-?\d+%\)/);
    expect(line).toContain("kicks 1 (no kick on spec)");
    expect(line).toContain("dispels 9");
  });

  test("a kit without any dispel renders '(no dispel on spec)' instead of a bare 0", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", { keyLevel: 18, affixes: [], encounterID: f.run.encounterID })!;
    const line = strip(renderRunSignals({ ...s, dispels: { count: 0, available: false } }));
    expect(line).toContain("dispels 0 (no dispel on spec)");
  });

  test("kicks with a known cooldown but no capacity (e.g. 0-duration run) renders plain, not '(no kick on spec)'", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", { keyLevel: 18, affixes: [], encounterID: f.run.encounterID })!;
    expect(s.interrupts.kickCooldownS).not.toBeNull();
    const broken = { ...s, interrupts: { ...s.interrupts, capacity: null, usage: null } };
    const line = strip(renderRunSignals(broken));
    expect(line).toContain("kicks 23");
    expect(line).not.toContain("no kick on spec");
  });
});

describe("renderSummaryLine", () => {
  const baseSummary: SignalSummary = {
    runsWithSignals: 0,
    timedShown: null,
    avgDeaths: null,
    deathsInWipes: null,
    dtpsDeltaPct: null,
    kicksDeltaPts: null,
    avoidableDeltaPct: null,
    ilvl: null,
    recentTimed: null,
    recentTotal: null,
    prevSeason: null,
  };

  test("recentTotal 0 (profile fetched, zero recent runs) renders 0/0, not —", () => {
    const summary: SignalSummary = { ...baseSummary, recentTimed: 0, recentTotal: 0 };
    const line = strip(renderSummaryLine(summary));
    expect(line).toContain("RIO recent timed 0/0");
  });

  test("recentTotal null (no RIO data) renders —", () => {
    const summary: SignalSummary = { ...baseSummary, recentTimed: null, recentTotal: null };
    const line = strip(renderSummaryLine(summary));
    expect(line).toContain("RIO recent timed —");
  });
});

const evalFixture = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 16, runsUsed: 9, analyzedRuns: 0, global: 78.4, verdict: "invite", configVersion: "deadbeef",
  axes: [
    { key: "survival", score: 82, confidence: "high", evidence: [{ label: "0.2 individual deaths/run", delta: 18, source: "survival.individualDeaths" }, { label: "avoidable +12% vs peers", delta: -6, source: "survival.avoidableVsPeers" }, { label: "x", delta: 1, source: "survival.wipeDeaths" }] },
    { key: "utility", score: 61, confidence: "high", evidence: [] },
    { key: "throughput", score: 88, confidence: "high", evidence: [] },
    { key: "consistency", score: null, confidence: "low", evidence: [] },
    { key: "preparation", score: 55, confidence: "medium", evidence: [] },
    { key: "experience", score: 74, confidence: "high", evidence: [] },
  ],
  ...over,
});

describe("renderEvaluation", () => {
  test("verdict line, axis scores, n/a, two evidences, min confidence", () => {
    const out = strip(renderEvaluation(evalFixture()));
    expect(out).toContain("Verdict: INVITE 78");
    expect(out).toContain("Survival 82");
    expect(out).toContain("Consistency n/a");
    expect(out).toContain("(medium confidence, 9 runs)");
    expect(out).toMatch(/Survival\s+\+18 0\.2 individual deaths\/run\s+·\s+-6 avoidable \+12% vs peers/);
    expect(out).not.toContain("+1 x");
  });
  test("insufficient data", () => {
    const out = strip(renderEvaluation(evalFixture({ verdict: "insufficient", runsUsed: 2, global: 81 })));
    expect(out).toContain("INSUFFICIENT DATA (2 runs, 81)");
    const out2 = strip(renderEvaluation(evalFixture({ verdict: "insufficient", runsUsed: 0, global: null })));
    expect(out2).toContain("INSUFFICIENT DATA (0 runs)");
  });
});

describe("renderDeepdiveLine", () => {
  test("majors, deaths, unlisted", () => {
    const line = strip(renderDeepdiveLine(base));
    expect(line).toContain("defensives: majors 41%");
    expect(line).toContain("1/2 deaths with a defensive available");
    expect(line).toContain("unlisted: Mystery (5x)");
  });
  test("no table, no deaths", () => {
    const line = strip(renderDeepdiveLine({ ...base, tableMissing: true, majorUsage: null, countedDeaths: 0, avoidableDeaths: 0, unlisted: [] }));
    expect(line).toContain("no defensives table for Holy Paladin");
    expect(line).toContain("no deaths");
  });
});

describe("renderDeepdive", () => {
  test("usage table, deaths with verdicts, audit", () => {
    const d: RunDefensives = {
      ...base,
      defensives: [
        { id: 498, name: "Divine Protection", cooldownS: 60, durationS: 8, kind: "major", origin: "shipped", casts: 27, capacity: 30, usage: 0.9, observedMinIntervalS: 38, cdMismatch: true },
        { id: 642, name: "Divine Shield", cooldownS: 300, durationS: 8, kind: "immunity", origin: "override", casts: 5, capacity: 6, usage: 5 / 6, observedMinIntervalS: 310, cdMismatch: false },
      ],
      deaths: [
        { atMs: 1_764_223, inWipe: false, killingHits: [{ id: 1300372, name: "Cosmic Crash", amount: 559197, share: 0.55 }, { id: 1264188, name: "Unstable Singularity", amount: 458887, share: 0.45 }], killingBlow: "Unstable Singularity", available: ["Divine Shield"], active: [], onCooldown: [{ name: "Divine Protection", readyInS: 12 }], verdict: "immunity available" },
        { atMs: 100_000, inWipe: true, killingHits: [], killingBlow: null, available: [], active: ["Divine Protection"], onCooldown: [], verdict: "covered" },
      ],
    };
    const out = strip(renderDeepdive(d));
    expect(out).toContain("Divine Protection");
    expect(out).toContain("27/30");
    expect(out).toContain("90%");
    expect(out).toContain("cd 60s · seen 38s ?"); // cdMismatch marker
    expect(out).toContain("(override)");
    expect(out).toContain("29:24");                // 1_764_223 ms
    expect(out).toContain("Cosmic Crash 55%");
    expect(out).toContain("immunity available");
    expect(out).toContain("Divine Protection on cd (12s)");
    expect(out).toContain("wipe");
    expect(out).toContain("Not in table: Mystery (5x, 40s up)");
  });
});
