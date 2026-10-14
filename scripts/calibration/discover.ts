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
import { type PoolEntry, type Ranking, RANKINGS_QUERY, SPECS, discoverCombo, metricOf } from "../../src/calibration/discover.ts";

export { LEVELS, type PoolEntry, type Role, roleOf } from "../../src/calibration/discover.ts";

/** Concurrent (spec, dungeon) combos. WCL answers 429 to bursts, whatever the point budget says. */
const CONCURRENCY = 3;
export const DIR = ".calibration";

let spent = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One ranking page's entries, retried with backoff on WCL's burst limiter (HTTP 429). */
async function page(e: number, c: string, s: string, p: number, m: string): Promise<Ranking[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await gql<{ rateLimitData: { pointsSpentThisHour: number }; worldData: { encounter: { characterRankings: { rankings?: Ranking[] } } } }>(
        RANKINGS_QUERY, { e, c, s, p, m });
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
    const r = await discoverCombo((p) => page(encID, className, spec, p, metricOf(spec)), className, spec, encID);
    if (r.tailed) tailed++;
    pool.push(...r.entries);
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
