// Dev-only, spends WCL points (~1 pt per ranking page, ~5 pts per sampled run). Collects the crowd-control
// reference of the self-review's Control pillar (docs/superpowers/specs/2026-10-10-self-review-control-design.md,
// decision 7): per Class:Spec, the median crowd-control uses per 10 minutes of ranked EU players at +15 to +20,
// the calibration study's scope (docs/superpowers/specs/2026-09-24-scoring-calibration-design.md).
//
// For each spec still under `--per-spec` samples, it walks the spec's ranking ladder of every dungeon
// (worldData.encounter.characterRankings, sorted by key level) down to the +15..+20 band, and fetches each new run's
// Summary table (the five players' specs and actor ids) and its crowd-control events. Every player of a run is a
// sample of their own spec, so one run feeds five specs. Runs already fetched are kept in a scratch SQLite and never
// paid for twice; the run stops at `--budget` points.
//
//   bun scripts/calibration/control.ts [--per-spec 20] [--budget 2500] [--cache .calibration/control.db]
//                                      [--out src/signals/control/reference-mn-2.json]
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getCurrentMplusZone } from "../../src/mplus.ts";
import { HEALER_SPECS } from "../../src/roles.ts";
import { parseRunControl } from "../../src/signals/control/parse.ts";
import type { ControlReference, ControlReferenceEntry } from "../../src/signals/control/reference.ts";
import { CC_TABLE } from "../../src/signals/control/table.ts";
import { fetchRunControl } from "../../src/signals/enrich.ts";
import type { RawRunControl } from "../../src/signals/types.ts";
import { gql as realGql, WclError } from "../../src/wcl/client.ts";
import { PING_QUERY } from "../../src/wcl/queries.ts";
import type { RateLimitData } from "../../src/wcl/types.ts";

const SPECS = [
  "DeathKnight:Blood", "DeathKnight:Frost", "DeathKnight:Unholy", "DemonHunter:Devourer", "DemonHunter:Havoc",
  "DemonHunter:Vengeance", "Druid:Balance", "Druid:Feral", "Druid:Guardian", "Druid:Restoration",
  "Evoker:Augmentation", "Evoker:Devastation", "Evoker:Preservation", "Hunter:BeastMastery", "Hunter:Marksmanship",
  "Hunter:Survival", "Mage:Arcane", "Mage:Fire", "Mage:Frost", "Monk:Brewmaster", "Monk:Mistweaver",
  "Monk:Windwalker", "Paladin:Holy", "Paladin:Protection", "Paladin:Retribution", "Priest:Discipline",
  "Priest:Holy", "Priest:Shadow", "Rogue:Assassination", "Rogue:Outlaw", "Rogue:Subtlety", "Shaman:Elemental",
  "Shaman:Enhancement", "Shaman:Restoration", "Warlock:Affliction", "Warlock:Demonology", "Warlock:Destruction",
  "Warrior:Arms", "Warrior:Fury", "Warrior:Protection",
] as const;
const LOW = 15;
const HIGH = 20;
/** Pages read per (spec, dungeon) ladder before giving up on reaching the band. */
const MAX_PAGES = 12;

const arg = (flag: string, dflt: string) => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt; };
const perSpec = Number(arg("--per-spec", "20"));
const budget = Number(arg("--budget", "2500"));
const cachePath = arg("--cache", ".calibration/control.db");
const out = arg("--out", "src/signals/control/reference-mn-2.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** WCL answers 429 to bursts whatever the point budget says: back off and retry. */
async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await realGql<T>(query, variables);
    } catch (err) {
      if (!(err instanceof WclError && /429/.test(err.message)) || attempt >= 7) throw err;
      await sleep(2000 * 2 ** attempt);
    }
  }
}
const spentNow = async () => (await gql<RateLimitData>(PING_QUERY)).rateLimitData.pointsSpentThisHour;

const RANKINGS_QUERY = /* GraphQL */ `
  query($e: Int!, $c: String!, $s: String!, $p: Int!, $m: CharacterRankingMetricType) {
    worldData { encounter(id: $e) { characterRankings(className: $c, specName: $s, serverRegion: "EU", page: $p, metric: $m) } }
  }`;
const SUMMARY_QUERY = /* GraphQL */ `
  query($code: String!, $fightID: Int!) {
    reportData { report(code: $code) { summary: table(fightIDs: [$fightID], dataType: Summary) } }
  }`;

interface Ranking { bracketData: number; report?: { code: string; fightID: number } }
interface Player { id: number; className: string; spec: string }
interface CachedRun { durationMs: number; players: Player[]; control: RawRunControl }

mkdirSync(dirname(cachePath), { recursive: true });
const db = new Database(cachePath, { create: true });
db.exec("CREATE TABLE IF NOT EXISTS runs (code TEXT NOT NULL, fight INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (code, fight))");
const getRun = db.query<{ json: string }, [string, number]>("SELECT json FROM runs WHERE code = ? AND fight = ?");
const putRun = db.query("INSERT OR REPLACE INTO runs (code, fight, json) VALUES (?, ?, ?)");

const start = await spentNow();
let spent = 0;
const overBudget = async (): Promise<boolean> => {
  const now = await spentNow();
  spent = now >= start ? now - start : spent + now; // a lower counter: WCL's hour turned
  return spent >= budget;
};

const zone = await getCurrentMplusZone();
const z = await gql<{ worldData: { zone: { encounters: { id: number; name: string }[] } } }>(
  `query($id: Int!) { worldData { zone(id: $id) { encounters { id name } } } }`, { id: zone.id });
const encounters = z.worldData.zone.encounters;
console.log(`${zone.name}: ${encounters.length} dungeons, ${SPECS.length} specs, table ${CC_TABLE.version}, budget ${budget} pts`);

const samples = new Map<string, number[]>(SPECS.map((s) => [s, []]));
const seenRuns = new Set<string>();
const addRun = (run: CachedRun): void => {
  for (const p of run.players) {
    const key = `${p.className}:${p.spec}`;
    const rate = parseRunControl(run.control, { actorID: p.id, className: p.className, spec: p.spec }, run.durationMs).perTenMin;
    (samples.get(key) ?? samples.set(key, []).get(key)!).push(rate);
  }
};
// Runs fetched by an earlier session count first, at 0 pts.
for (const r of db.query<{ code: string; fight: number; json: string }, []>("SELECT code, fight, json FROM runs").all()) {
  seenRuns.add(`${r.code}:${r.fight}`);
  addRun(JSON.parse(r.json) as CachedRun);
}

async function fetchRun(code: string, fightID: number): Promise<CachedRun | null> {
  const cached = getRun.get(code, fightID);
  if (cached) return JSON.parse(cached.json) as CachedRun;
  type Summary = { data?: { totalTime?: number; composition?: Array<{ id?: number; type?: string; specs?: Array<{ spec?: string }> }> } };
  const s = await gql<{ reportData: { report: { summary: Summary } | null } }>(SUMMARY_QUERY, { code, fightID });
  const summary = s.reportData.report?.summary;
  if (!summary?.data?.totalTime) return null;
  const control = await fetchRunControl({ reportCode: code, fightID }, gql);
  if (!control) return null;
  const players = (summary.data.composition ?? [])
    .filter((p) => typeof p.id === "number" && p.type && p.specs?.[0]?.spec)
    .map((p) => ({ id: p.id!, className: p.type!, spec: p.specs![0]!.spec! }));
  const run: CachedRun = { durationMs: summary.data.totalTime, players, control };
  putRun.run(code, fightID, JSON.stringify(run));
  return run;
}

let stopped = false;
outer: for (const key of [...SPECS].sort((a, b) => samples.get(a)!.length - samples.get(b)!.length)) {
  const [className, specName] = key.split(":") as [string, string];
  const metric = HEALER_SPECS.has(specName) ? "hps" : "dps";
  for (const enc of encounters) {
    if (samples.get(key)!.length >= perSpec) break;
    for (let page = 1; page <= MAX_PAGES && samples.get(key)!.length < perSpec; page++) {
      if (await overBudget()) { stopped = true; break outer; }
      const r = await gql<{ worldData: { encounter: { characterRankings: { rankings?: Ranking[] } } } }>(
        RANKINGS_QUERY, { e: enc.id, c: className, s: specName, p: page, m: metric });
      const rows = r.worldData.encounter.characterRankings.rankings ?? [];
      if (rows.length === 0) break;
      for (const row of rows) {
        if (row.bracketData > HIGH || row.bracketData < LOW || !row.report) continue;
        const id = `${row.report.code}:${row.report.fightID}`;
        if (seenRuns.has(id)) continue;
        seenRuns.add(id);
        if (await overBudget()) { stopped = true; break outer; }
        try {
          const run = await fetchRun(row.report.code, row.report.fightID);
          if (run) addRun(run);
        } catch (e) {
          console.error(`${id}: ${e instanceof Error ? e.message : e}`);
        }
        if (samples.get(key)!.length >= perSpec) break;
      }
      // Sorted by key level: once a page ends under the band, the ladder has nothing more for us.
      if (rows[rows.length - 1]!.bracketData < LOW) break;
    }
  }
  console.log(`${key}: ${samples.get(key)!.length} samples · ${spent.toFixed(0)} pts so far`);
}

const quantile = (sorted: number[], q: number): number => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
};
const round = (x: number) => Math.round(x * 100) / 100;
const specs: Record<string, ControlReferenceEntry> = {};
for (const key of [...samples.keys()].sort()) {
  const xs = [...samples.get(key)!].sort((a, b) => a - b);
  if (xs.length === 0) continue;
  specs[key] = { median: round(quantile(xs, 0.5)), p25: round(quantile(xs, 0.25)), p75: round(quantile(xs, 0.75)), samples: xs.length };
}
const date = new Date().toISOString().slice(0, 10);
const reference: ControlReference = {
  version: "mn-2.0",
  tableVersion: CC_TABLE.version,
  source: `scripts/calibration/control.ts, ${date}, ${seenRuns.size} runs, ${Math.round(spent)} pts this session`,
  scope: "EU, +15 to +20",
  specs,
};
await Bun.write(out, JSON.stringify(reference, null, 1) + "\n");
const short = SPECS.filter((k) => (specs[k]?.samples ?? 0) < perSpec);
console.log(`\n${stopped ? "stopped at the budget · " : ""}${Math.round(spent)} pts · wrote ${out}`);
console.log(`under ${perSpec} samples: ${short.map((k) => `${k} (${specs[k]?.samples ?? 0})`).join(", ") || "none"}`);
db.close();
