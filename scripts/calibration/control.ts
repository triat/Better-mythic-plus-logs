// Dev-only, spends WCL points (~1 pt per ranking page, ~5 pts per sampled run). Collects the crowd-control
// reference of the self-review's Control pillar (docs/superpowers/specs/2026-10-10-self-review-control-design.md,
// decision 7): per Class:Spec, the median crowd-control uses per 10 minutes of ranked EU players at +15 to +20,
// the calibration study's scope (docs/superpowers/specs/2026-09-24-scoring-calibration-design.md).
//
// For every dungeon, and every spec with fewer than `--per-dungeon` samples there, it walks that spec's ranking ladder
// of the dungeon (worldData.encounter.characterRankings, sorted by key level) down to the +15..+20 band, and fetches
// each new run's Summary table (the five players' specs and actor ids) and its crowd-control events. Every player of a
// run is a sample of their own spec in that dungeon, so one run feeds five specs. The quantiles weigh every dungeon the
// same (`summariseByDungeon`): a first collection that took all its runs from one dungeon is why. Runs already
// fetched are kept in a scratch SQLite (with their dungeon) and never paid for twice; the run stops at `--budget`.
//
//   bun scripts/calibration/control.ts [--per-dungeon 3] [--budget 2500] [--cache .calibration/control.db]
//                                      [--out src/signals/control/reference-mn-2.json]
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getCurrentMplusZone } from "../../src/mplus.ts";
import { HEALER_SPECS } from "../../src/roles.ts";
import { parseRunControl } from "../../src/signals/control/parse.ts";
import { MIN_REFERENCE_DUNGEONS, MIN_REFERENCE_SAMPLES, summariseByDungeon, type ControlReference, type ControlReferenceEntry } from "../../src/signals/control/reference.ts";
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
const perDungeon = Number(arg("--per-dungeon", "3"));
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
interface CachedRun { encounterID: number; durationMs: number; players: Player[]; control: RawRunControl }

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

/** spec → dungeon → uses per 10 minutes, one per player sample. */
const samples = new Map<string, Map<number, number[]>>(SPECS.map((s) => [s, new Map()]));
const count = (spec: string, encounterID: number) => samples.get(spec)?.get(encounterID)?.length ?? 0;
const seenRuns = new Set<string>();
const addRun = (run: CachedRun): void => {
  for (const p of run.players) {
    const key = `${p.className}:${p.spec}`;
    const rate = parseRunControl(run.control, { actorID: p.id, className: p.className, spec: p.spec }, run.durationMs).perTenMin;
    const byDungeon = samples.get(key) ?? samples.set(key, new Map()).get(key)!;
    (byDungeon.get(run.encounterID) ?? byDungeon.set(run.encounterID, []).get(run.encounterID)!).push(rate);
  }
};
// Runs fetched by an earlier session count first, at 0 pts; one without its dungeon cannot be placed.
let unplaced = 0;
for (const r of db.query<{ code: string; fight: number; json: string }, []>("SELECT code, fight, json FROM runs").all()) {
  seenRuns.add(`${r.code}:${r.fight}`);
  const run = JSON.parse(r.json) as CachedRun;
  if (typeof run.encounterID === "number") addRun(run); else unplaced++;
}
if (unplaced > 0) console.log(`${unplaced} cached runs have no dungeon and are left out`);

async function fetchRun(code: string, fightID: number, encounterID: number): Promise<CachedRun | null> {
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
  const run: CachedRun = { encounterID, durationMs: summary.data.totalTime, players, control };
  putRun.run(code, fightID, JSON.stringify(run));
  return run;
}

let stopped = false;
outer: for (const enc of encounters) {
  for (const key of [...SPECS].sort((a, b) => count(a, enc.id) - count(b, enc.id))) {
    if (count(key, enc.id) >= perDungeon) continue;
    const [className, specName] = key.split(":") as [string, string];
    const metric = HEALER_SPECS.has(specName) ? "hps" : "dps";
    for (let page = 1; page <= MAX_PAGES && count(key, enc.id) < perDungeon; page++) {
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
          const run = await fetchRun(row.report.code, row.report.fightID, enc.id);
          if (run) addRun(run);
        } catch (e) {
          console.error(`${id}: ${e instanceof Error ? e.message : e}`);
        }
        if (count(key, enc.id) >= perDungeon) break;
      }
      // Sorted by key level: once a page ends under the band, the ladder has nothing more for us.
      if (rows[rows.length - 1]!.bracketData < LOW) break;
    }
  }
  console.log(`${enc.name}: ${SPECS.filter((k) => count(k, enc.id) >= perDungeon).length} of ${SPECS.length} specs at ${perDungeon}+ · ${spent.toFixed(0)} pts so far`);
}

const specs: Record<string, ControlReferenceEntry> = {};
for (const key of [...samples.keys()].sort()) {
  const e = summariseByDungeon(samples.get(key)!);
  if (e) specs[key] = e;
}
const date = new Date().toISOString().slice(0, 10);
const reference: ControlReference = {
  version: "mn-2.0",
  tableVersion: CC_TABLE.version,
  source: `scripts/calibration/control.ts, ${date}, ${seenRuns.size} runs, ${Math.round(spent)} pts this session`,
  scope: "EU, +15 to +20, every dungeon weighs the same",
  specs,
};
await Bun.write(out, JSON.stringify(reference, null, 1) + "\n");
const short = SPECS.filter((k) => (specs[k]?.samples ?? 0) < MIN_REFERENCE_SAMPLES || (specs[k]?.dungeons ?? 0) < MIN_REFERENCE_DUNGEONS);
const partial = SPECS.filter((k) => (specs[k]?.dungeons ?? 0) < encounters.length);
console.log(`\n${stopped ? "stopped at the budget · " : ""}${Math.round(spent)} pts · wrote ${out}`);
console.log(`n/a (under ${MIN_REFERENCE_SAMPLES} samples or ${MIN_REFERENCE_DUNGEONS} dungeons): ${short.map((k) => `${k} (${specs[k]?.samples ?? 0} in ${specs[k]?.dungeons ?? 0})`).join(", ") || "none"}`);
console.log(`not in every dungeon: ${partial.map((k) => `${k} (${specs[k]?.dungeons ?? 0})`).join(", ") || "none"}`);
db.close();
