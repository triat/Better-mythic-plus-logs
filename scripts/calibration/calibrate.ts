// Dev-only, 0 WCL points: builds a candidate rubric from the collected population and compares it to
// the current one on characters it was NOT fitted on.
//
//   bun scripts/calibration/calibrate.ts          → .calibration/candidate.json + .calibration/comparison.md
//
// The candidate is simulated entirely offline, without touching production code: per-role curves are
// applied by scoring each role with its own config, and the final percentile mapping of the global
// score is applied to evaluate()'s output. Shipping it would need the two small schema additions the
// report lists — which is the user's call, not this script's.
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import { writeFileSync } from "node:fs";
import defaultConfig from "../../src/evaluation/default-config.json" with { type: "json" };
import { curve } from "../../src/evaluation/curve.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import type { CurvePoints, EvaluationConfig, Role, Verdict } from "../../src/evaluation/types.ts";
import { curveInputs, loadSamples, quantile, type Sample } from "./analyze.ts";
import { DIR } from "./discover.ts";

const ROLES: Role[] = ["dps", "healer", "tank"];
/** Quantiles a sub-signal's curve is anchored on; ties collapse onto one point at their mid-rank. */
const ANCHOR_QS = [0.02, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.98];
/** Below this many observations for a role, a sub-signal falls back to the pooled population. */
const MIN_ROLE_N = 40;

// ---------- fit / test split: a character is in one half only, whatever its spec ----------
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
export const isFit = (s: Sample) => hash(`${s.study.name}|${s.study.server}`) % 2 === 0;

// ---------- percentile curves ----------
/** Higher x is better for this sub-signal when its current curve rises. */
const risesWith = (pts: CurvePoints) => pts[pts.length - 1]![1] > pts[0]![1];

/**
 * Curve points placing x on the population's own distribution: the score at x is the mid-rank
 * percentile of x (ties share their average rank), flipped when lower is better. Anchored on a fixed
 * set of quantiles so the curve stays short and readable in the Help page.
 */
export function percentileCurve(xs: number[], higherIsBetter: boolean): CurvePoints {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const midRank = (v: number) => {
    let below = 0;
    let equal = 0;
    for (const x of s) { if (x < v) below++; else if (x === v) equal++; }
    return (below + equal / 2) / n;
  };
  const anchors = [...new Set(ANCHOR_QS.map((q) => quantile(s, q)))].sort((a, b) => a - b);
  const pts: CurvePoints = anchors.map((v) => {
    const p = 100 * midRank(v);
    return [round(v, 4), round(higherIsBetter ? p : 100 - p, 1)];
  });
  // A curve needs at least two points; a signal that is constant across the population carries no
  // information and is scored neutral.
  if (pts.length === 1) return [[pts[0]![0], 50], [pts[0]![0] + 1, 50]];
  return pts;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- the candidate ----------
export interface Candidate {
  /** One full config per role: identical but for the sub-signal curves, fitted on that role. */
  configs: Record<Role, EvaluationConfig>;
  /** Raw global → percentile among the role's fit population. */
  globalCurves: Record<Role, CurvePoints>;
  thresholds: { invite: number; maybe: number };
  /** Disqualifiers: a curve input worse than `limit` caps the verdict at `max`. */
  caps: { source: string; limit: number; higherIsBetter: boolean; max: Verdict }[];
}

export function buildCandidate(fit: Sample[], base: EvaluationConfig): Candidate {
  const xsByRole = new Map<string, number[]>(); // `${role}|${source}` and `all|${source}`
  for (const s of fit) {
    for (const [src, x] of Object.entries(curveInputs(s.payload, base))) {
      for (const k of [`${s.study.role}|${src}`, `all|${src}`]) (xsByRole.get(k) ?? xsByRole.set(k, []).get(k)!).push(x);
    }
  }
  const configs = {} as Record<Role, EvaluationConfig>;
  for (const role of ROLES) {
    const cfg = structuredClone(base) as EvaluationConfig;
    cfg.version = `${base.version}-cal-${role}`;
    for (const [axis, ac] of Object.entries(cfg.axes)) {
      for (const [id, sc] of Object.entries(ac.subSignals)) {
        const src = `${axis}.${id}`;
        const own = xsByRole.get(`${role}|${src}`) ?? [];
        const xs = own.length >= MIN_ROLE_N ? own : (xsByRole.get(`all|${src}`) ?? []);
        if (xs.length < MIN_ROLE_N) continue; // not enough data (e.g. deep-dive signals): keep today's curve
        sc.curve = percentileCurve(xs, risesWith(sc.curve));
      }
    }
    configs[role] = cfg;
  }

  const globalCurves = {} as Record<Role, CurvePoints>;
  for (const role of ROLES) {
    const raw = fit.filter((s) => s.study.role === role).map((s) => evaluate(s.payload, configs[role]).global).filter((g): g is number => g !== null);
    globalCurves[role] = raw.length >= MIN_ROLE_N ? percentileCurve(raw, true) : [[0, 0], [100, 100]];
  }

  // Disqualifiers on the two signals that are unambiguously the player's own fault: dying, and standing
  // in what the dungeon telegraphs. Worse than 95 % of the population on either → no INVITE.
  const caps: Candidate["caps"] = [];
  for (const src of ["survival.individualDeaths", "survival.avoidableVsPeers"]) {
    const xs = xsByRole.get(`all|${src}`) ?? [];
    if (xs.length >= MIN_ROLE_N) caps.push({ source: src, limit: round(quantile(xs, 0.95), 3), higherIsBetter: false, max: "maybe" });
  }
  return { configs, globalCurves, thresholds: { invite: 70, maybe: 30 }, caps };
}

// ---------- scoring a sample under either rubric ----------
export interface Scored { global: number | null; verdict: Verdict; capped: boolean }

export function scoreCurrent(s: Sample, base: EvaluationConfig): Scored {
  const ev = evaluate(s.payload, base);
  return { global: ev.global, verdict: ev.verdict, capped: false };
}

export function scoreCandidate(s: Sample, c: Candidate): Scored {
  const role = s.study.role;
  const ev = evaluate(s.payload, c.configs[role]);
  if (ev.verdict === "insufficient" || ev.global === null) return { global: ev.global, verdict: "insufficient", capped: false };
  const global = Math.round(curve(ev.global, c.globalCurves[role]));
  let verdict: Verdict = global >= c.thresholds.invite ? "invite" : global >= c.thresholds.maybe ? "maybe" : "pass";
  let capped = false;
  const xs = c.caps.length ? curveInputs(s.payload, c.configs[role]) : {};
  for (const cap of c.caps) {
    const x = xs[cap.source];
    if (x === undefined) continue;
    const worse = cap.higherIsBetter ? x < cap.limit : x > cap.limit;
    if (worse && verdict === "invite") { verdict = cap.max; capped = true; }
  }
  return { global, verdict, capped };
}

// ---------- validity ----------
/** Spearman rank correlation. */
export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i]! - ma) * (rb[i]! - mb); da += (ra[i]! - ma) ** 2; db += (rb[i]! - mb) ** 2; }
  return num / Math.sqrt(da * db);
}


// ---------- predictive validity: score the older runs, predict the newer ones ----------
interface Run {
  startTime: number;
  parsePercent: number;
  signals?: {
    deaths?: { count: number; events?: { inWipe: boolean }[] };
    avoidableDamage?: { perMinute: number; peer?: { median: number } | null } | null;
  };
}

/**
 * The payload as it would have looked with only the older half of the runs: `perDungeon.runs` cut,
 * and `perDungeon.medianParse` recomputed from them (it is precomputed over every run, so leaving it
 * would leak the newer runs into the score meant to predict them). Raider.IO's recent-runs block is
 * left as is; it only feeds Experience's activity count, not the outcomes measured here.
 */
function olderHalf(s: Sample): { payload: Sample["payload"]; newer: Run[] } | null {
  const runs = [...((s.payload as unknown as { perDungeon: { runs: Run[] } }).perDungeon.runs)].filter((r) => r.signals).sort((a, b) => a.startTime - b.startTime);
  if (runs.length < 6) return null;
  const cut = Math.floor(runs.length / 2);
  const older = runs.slice(0, cut);
  const payload = structuredClone(s.payload) as unknown as { perDungeon: { runs: Run[]; medianParse: number | null } };
  payload.perDungeon.runs = older;
  const parses = older.map((r) => r.parsePercent).filter((p) => p > 0);
  payload.perDungeon.medianParse = parses.length ? quantile(parses, 0.5) : null;
  return { payload: payload as unknown as Sample["payload"], newer: runs.slice(cut) };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function predictive(test: Sample[], base: EvaluationConfig, c: Candidate): string[] {
  const lines: string[] = [];
  const rows: { cur: number; cand: number; deathsA: number; deathsB: number; avoidA: number; avoidB: number }[] = [];
  for (const s of test) {
    const split = olderHalf(s);
    if (!split) continue;
    const sub: Sample = { study: s.study, payload: split.payload };
    const cur = scoreCurrent(sub, base).global;
    const cand = scoreCandidate(sub, c).global;
    if (cur === null || cand === null) continue;
    const older = (split.payload as unknown as { perDungeon: { runs: Run[] } }).perDungeon.runs;
    // Individual deaths, as the rubric counts them: a death inside a full wipe is not the player's own.
    const deaths = (rs: Run[]) => mean(rs.map((r) => r.signals?.deaths?.events ? r.signals.deaths.events.filter((e) => !e.inWipe).length : NaN).filter(Number.isFinite));
    // Avoidable damage per minute relative to the run's peers, in % (the rubric's avoidableVsPeers).
    const avoid = (rs: Run[]) => mean(rs.map((r) => {
      const a = r.signals?.avoidableDamage;
      return a && a.peer && a.peer.median > 0 ? (100 * (a.perMinute - a.peer.median)) / a.peer.median : NaN;
    }).filter(Number.isFinite));
    rows.push({ cur, cand, deathsA: deaths(older), deathsB: deaths(split.newer), avoidA: avoid(older), avoidB: avoid(split.newer) });
  }
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
  // Disqualifiers, validated the same way: flagged on the older runs, judged on the newer ones.
  const flagged: { hit: boolean; d: number }[] = [];
  for (const s of test) {
    const split = olderHalf(s);
    if (!split) continue;
    const xs = curveInputs(split.payload, c.configs[s.study.role]);
    const hit = c.caps.some((cap) => { const x = xs[cap.source]; return x !== undefined && (cap.higherIsBetter ? x < cap.limit : x > cap.limit); });
    const d = mean(split.newer.map((r) => (r.signals?.deaths?.events ? r.signals.deaths.events.filter((e) => !e.inWipe).length : NaN)).filter(Number.isFinite));
    if (Number.isFinite(d)) flagged.push({ hit, d });
  }
  const hitD = flagged.filter((x) => x.hit).map((x) => x.d);
  const okD = flagged.filter((x) => !x.hit).map((x) => x.d);
  lines.push("", "## Do the disqualifiers catch the right people? (held-out)", "", `Flagged on the older runs (${c.caps.map((cap) => `${cap.source} worse than ${cap.limit}`).join("; ")}), then individual deaths per run measured on the newer runs.`, "", "| Group | n | deaths per run in the newer runs (mean) | median |", "|---|---|---|---|", `| flagged by a disqualifier | ${hitD.length} | ${fmt(mean(hitD))} | ${fmt(quantile(hitD, 0.5))} |`, `| everyone else | ${okD.length} | ${fmt(mean(okD))} | ${fmt(quantile(okD, 0.5))} |`);
  lines.push("", "## Does the score predict the next runs? (held-out, split by date)", "", "Each character's runs are split by date. The score is computed from the older half only; the outcomes are measured on the newer half, which the score never saw. Spearman correlation, sign flipped so that higher = the score correctly expected fewer deaths / less avoidable damage. The last column is the naive baseline: the older half's own value of that outcome.", "", "| Outcome in the newer runs | current | candidate | older-half value alone | n |", "|---|---|---|---|---|");
  for (const [label, a, b] of [["deaths per run", "deathsA", "deathsB"], ["avoidable damage vs peers", "avoidA", "avoidB"]] as const) {
    const r = rows.filter((x) => Number.isFinite(x[b]) && Number.isFinite(x[a]));
    if (r.length < 10) continue;
    const outcome = r.map((x) => -x[b]);
    lines.push(`| ${label} | ${fmt(spearman(r.map((x) => x.cur), outcome))} | ${fmt(spearman(r.map((x) => x.cand), outcome))} | ${fmt(spearman(r.map((x) => -x[a]), outcome))} | ${r.length} |`);
  }
  return lines;
}

function compare(test: Sample[], base: EvaluationConfig, c: Candidate): string {
  const lines: string[] = [];
  const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const rows = test.map((s) => ({ s, cur: scoreCurrent(s, base), cand: scoreCandidate(s, c) }));
  lines.push(`# Current vs candidate — ${test.length} held-out characters`, "");
  lines.push("## Spread and verdicts", "", "| Role | Rubric | p5 | p10 | p25 | median | p75 | p90 | p95 | INVITE | MAYBE | PASS | capped |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const role of [...ROLES, "all"] as (Role | "all")[]) {
    const r = rows.filter((x) => role === "all" || x.s.study.role === role);
    if (!r.length) continue;
    for (const [name, pick] of [["current", (x: typeof r[0]) => x.cur], ["candidate", (x: typeof r[0]) => x.cand]] as const) {
      const g = r.map((x) => pick(x).global).filter((v): v is number => v !== null);
      const share = (v: Verdict) => `${Math.round((100 * r.filter((x) => pick(x).verdict === v).length) / r.length)} %`;
      const capped = r.filter((x) => pick(x).capped).length;
      lines.push(`| ${role} | ${name} | ${[0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95].map((q) => fmt(quantile(g, q))).join(" | ")} | ${share("invite")} | ${share("maybe")} | ${share("pass")} | ${capped} |`);
    }
  }

  lines.push("", "## Does it still rank players? (held-out)", "", "Spearman correlation between the score and the character's position in WCL's own ranking of their level band (inverted, so higher = better player). WCL's position never enters the score — it is an independent yardstick. A candidate that spreads scores but ranks worse than today is rejected.", "", "| Role | current | candidate | n |", "|---|---|---|---|");
  for (const role of [...ROLES, "all"] as (Role | "all")[]) {
    const r = rows.filter((x) => (role === "all" || x.s.study.role === role) && x.cur.global !== null && x.cand.global !== null);
    if (r.length < 10) continue;
    const truth = r.map((x) => 1 - x.s.study.percentile);
    lines.push(`| ${role} | ${fmt(spearman(r.map((x) => x.cur.global!), truth), 2)} | ${fmt(spearman(r.map((x) => x.cand.global!), truth), 2)} | ${r.length} |`);
  }

  lines.push("", "## Median score by performance quintile (held-out)", "", "| Role | Rubric | q0 (best) | q1 | q2 | q3 | q4 (worst) |", "|---|---|---|---|---|---|---|");
  for (const role of ROLES) {
    for (const [name, pick] of [["current", (x: typeof rows[0]) => x.cur], ["candidate", (x: typeof rows[0]) => x.cand]] as const) {
      const cells = [0, 1, 2, 3, 4].map((q) => {
        const g = rows.filter((x) => x.s.study.role === role && x.s.study.quintile === q).map((x) => pick(x).global).filter((v): v is number => v !== null);
        return g.length ? `${fmt(quantile(g, 0.5))} (${g.length})` : "—";
      });
      lines.push(`| ${role} | ${name} | ${cells.join(" | ")} |`);
    }
  }
  lines.push(...predictive(test, base, c));
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const base = defaultConfig as unknown as EvaluationConfig;
  const samples = loadSamples();
  const fit = samples.filter(isFit);
  const test = samples.filter((s) => !isFit(s));
  const c = buildCandidate(fit, base);
  writeFileSync(`${DIR}/candidate.json`, JSON.stringify(c, null, 2));
  const md = compare(test, base, c);
  writeFileSync(`${DIR}/comparison.md`, md);
  console.log(`fit ${fit.length}, test ${test.length}\n`);
  console.log(md);
}

if (import.meta.main) await main();
