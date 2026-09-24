// Dev-only, spends WCL points (~1 pt per ranking page). Builds the calibration study's candidate pool:
// EU characters whose best run in some Season dungeon, on some spec, is a +15 to +20 — read off
// `worldData.encounter.characterRankings`, which lists one entry per character (their best run in that
// dungeon) sorted by key level, then by WCL's own run score within a level (fast to slow).
//
// Every entry gets a percentile = its position inside its (dungeon, spec, level) band, 0 = the band's
// best run, 1 = its worst. The +15 band of a popular spec runs to dozens of pages, and what a page cap
// would cut off is exactly its slow end — the weak players this study exists to find. So the band's end
// is located by galloping + bisection, and pages are sampled across its whole depth instead of reading
// only its head.
//
//   bun scripts/calibration/discover.ts            → .calibration/pool.json
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import { mkdirSync, writeFileSync } from "node:fs";
import { gql, WclError } from "../../src/wcl/client.ts";
import { getCurrentMplusZone } from "../../src/mplus.ts";
import { HEALER_SPECS, TANK_SPECS } from "../../src/roles.ts";

export const LEVELS = [15, 16, 17, 18, 19, 20] as const;
const LOWEST = LEVELS[0];

/** Every retail class:spec, WCL's spacing-free names (src/signals/kick-cooldowns.ts keeps the same set,
 * unexported). A dev script listing them is cheaper than widening a production module's surface. */
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

/** Pages read from the top of every ladder: enough to hold +16 to +20 entirely for every spec. */
const HEAD_PAGES = 8;
/** Extra pages sampled inside a +15 band that runs past the head, spread over its whole depth. */
const TAIL_SAMPLES = 4;
/** Concurrent (spec, dungeon) combos. WCL answers 429 to bursts, whatever the point budget says. */
const CONCURRENCY = 3;
const PAGE_SIZE = 100;
export const DIR = ".calibration";

export type Role = "dps" | "healer" | "tank";
export const roleOf = (spec: string): Role => (HEALER_SPECS.has(spec) ? "healer" : TANK_SPECS.has(spec) ? "tank" : "dps");

export interface PoolEntry {
  name: string;
  server: string;
  className: string;
  spec: string;
  role: Role;
  encounterID: number;
  level: number;
  amount: number;
  /** Position in this (dungeon, spec, level) band in WCL's order, 0 = best run, 1 = worst. */
  percentile: number;
}

interface Ranking { name: string; amount: number; bracketData: number; server?: { name: string } }

const QUERY = /* GraphQL */ `
  query($e: Int!, $c: String!, $s: String!, $p: Int!, $m: CharacterRankingMetricType) {
    rateLimitData { pointsSpentThisHour limitPerHour pointsResetIn }
    worldData { encounter(id: $e) { characterRankings(className: $c, specName: $s, serverRegion: "EU", page: $p, metric: $m) } }
  }`;

let spent = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One ranking page's entries, retried with backoff on WCL's burst limiter (HTTP 429). */
async function page(e: number, c: string, s: string, p: number, m: string): Promise<Ranking[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await gql<{ rateLimitData: { pointsSpentThisHour: number }; worldData: { encounter: { characterRankings: { rankings?: Ranking[] } } } }>(
        QUERY, { e, c, s, p, m });
      spent = Math.max(spent, r.rateLimitData.pointsSpentThisHour);
      return r.worldData.encounter.characterRankings.rankings ?? [];
    } catch (err) {
      const throttled = err instanceof WclError && /429/.test(err.message);
      if (!throttled || attempt >= 7) throw err;
      await sleep(2000 * 2 ** attempt);
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const zone = await getCurrentMplusZone();
  const z = await gql<{ worldData: { zone: { encounters: { id: number; name: string }[] } } }>(
    `query($id: Int!) { worldData { zone(id: $id) { encounters { id name } } } }`, { id: zone.id });
  const encounters = z.worldData.zone.encounters;
  const specs = SPECS.map((k) => k.split(":") as [string, string]);
  console.log(`${zone.name}: ${encounters.length} dungeons × ${specs.length} specs`);

  const pool: PoolEntry[] = [];
  let tailed = 0;
  const combos = specs.flatMap(([className, spec]) => encounters.map((enc) => ({ className, spec, enc })));
  let next = 0;
  let done = 0;

  async function combo(className: string, spec: string, encID: number): Promise<void> {
    const metric = HEALER_SPECS.has(spec) ? "hps" : "dps";
    const read = new Map<number, Ranking[]>();
    const get = async (p: number): Promise<Ranking[]> => {
      if (!read.has(p)) read.set(p, await page(encID, className, spec, p, metric));
      return read.get(p)!;
    };

    // Head: the top of the ladder, which holds +16..+20 whole and the start of +15.
    let headEnded = false;
    for (let p = 1; p <= HEAD_PAGES; p++) {
      const rows = await get(p);
      if (rows.length === 0 || rows[rows.length - 1]!.bracketData < LOWEST) { headEnded = true; break; }
    }

    // Tail: the +15 band runs past the head. Gallop to a page that has left +15, bisect for the band's
    // last page, then sample pages across the whole band.
    if (!headEnded) {
      tailed++;
      let lo = HEAD_PAGES; // known to still be at +15
      let hi = HEAD_PAGES * 2;
      for (;;) {
        const rows = await get(hi);
        if (rows.length === 0 || rows[0]!.bracketData < LOWEST) break;
        lo = hi;
        hi *= 2;
        if (hi > 2000) break;
      }
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const rows = await get(mid);
        if (rows.length > 0 && rows[0]!.bracketData >= LOWEST) lo = mid; else hi = mid;
      }
      for (let k = 1; k <= TAIL_SAMPLES; k++) {
        const p = Math.round(HEAD_PAGES + ((lo - HEAD_PAGES) * k) / TAIL_SAMPLES);
        if (p > HEAD_PAGES) await get(p);
      }
    }

    // Band bounds per level over every page read, by global index (page - 1) * 100 + position, so the
    // bounds survive the gaps between sampled pages.
    const indexed: { idx: number; e: Ranking }[] = [];
    for (const [p, rows] of read) rows.forEach((e, i) => indexed.push({ idx: (p - 1) * PAGE_SIZE + i, e }));
    for (const level of LEVELS) {
      const band = indexed.filter((x) => x.e.bracketData === level);
      if (band.length === 0) continue;
      const first = Math.min(...band.map((x) => x.idx));
      const last = Math.max(...band.map((x) => x.idx));
      for (const { idx, e } of band) {
        // Anonymised characters (no server) cannot be looked up; they still count for the band bounds.
        if (!e.server?.name) continue;
        pool.push({
          name: e.name, server: e.server.name, className, spec, role: roleOf(spec), encounterID: encID,
          level, amount: e.amount, percentile: last > first ? (idx - first) / (last - first) : 0.5,
        });
      }
    }
  }

  async function worker(): Promise<void> {
    while (next < combos.length) {
      const { className, spec, enc } = combos[next++]!;
      await combo(className, spec, enc.id);
      if (++done % 20 === 0) {
        console.log(`${done}/${combos.length} combos — pool ${pool.length}, ${tailed} +15 bands sampled in depth, ${spent.toFixed(0)} pts this hour`);
        writeFileSync(`${DIR}/pool.json`, JSON.stringify(pool));
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  writeFileSync(`${DIR}/pool.json`, JSON.stringify(pool));
  console.log(`wrote ${DIR}/pool.json: ${pool.length} entries (${tailed} +15 bands sampled in depth)`);
}

if (import.meta.main) await main();
