// The calibration population: EU characters whose best run in some Season dungeon, on some spec, is a +15 to +20, read
// off `worldData.encounter.characterRankings` (one entry per character, their best run in that dungeon, sorted by key
// level, then by WCL's own run score within a level, fast to slow), and the cells the collector balances them across.
//
// Every entry gets a percentile = its position inside its (dungeon, spec, level) band, 0 = the band's best run, 1 = its
// worst. The +15 band of a popular spec runs to dozens of pages, and what a page cap would cut off is exactly its slow
// end, the weak players the calibration exists to see. So the band's end is located by galloping + bisection, and pages
// are sampled across its whole depth instead of reading only its head.
//
// Specs: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md (the study),
// docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md (the weekly run).
import { HEALER_SPECS, TANK_SPECS } from "../roles.ts";

export const LEVELS = [15, 16, 17, 18, 19, 20] as const;
const LOWEST = LEVELS[0];

/** Every retail class:spec, WCL's spacing-free names (src/signals/kick-cooldowns.ts keeps the same set, unexported). */
export const SPECS = [
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
export const HEAD_PAGES = 8;
/** Extra pages sampled inside a +15 band that runs past the head, spread over its whole depth. */
const TAIL_SAMPLES = 4;
export const PAGE_SIZE = 100;

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

export interface Ranking { name: string; amount: number; bracketData: number; server?: { name: string } }

/** ~1 pt a page. `rateLimitData` rides along, so every page also feeds the budget governor. */
export const RANKINGS_QUERY = /* GraphQL */ `
  query($e: Int!, $c: String!, $s: String!, $p: Int!, $m: CharacterRankingMetricType) {
    rateLimitData { pointsSpentThisHour limitPerHour pointsResetIn }
    worldData { encounter(id: $e) { characterRankings(className: $c, specName: $s, serverRegion: "EU", page: $p, metric: $m) } }
  }`;

export const metricOf = (spec: string): "hps" | "dps" => (HEALER_SPECS.has(spec) ? "hps" : "dps");

/**
 * One (spec, dungeon) ladder's pool entries. `get(page)` returns that page's rankings (it may cache); the pages it asks
 * for are the head, then, when the +15 band runs past it, a gallop + bisection to the band's end and a few samples
 * across its depth.
 */
export async function discoverCombo(
  get: (page: number) => Promise<Ranking[]>, className: string, spec: string, encounterID: number,
): Promise<{ entries: PoolEntry[]; tailed: boolean }> {
  const read = new Map<number, Ranking[]>();
  const page = async (p: number): Promise<Ranking[]> => {
    if (!read.has(p)) read.set(p, await get(p));
    return read.get(p)!;
  };

  // Head: the top of the ladder, which holds +16..+20 whole and the start of +15.
  let headEnded = false;
  for (let p = 1; p <= HEAD_PAGES; p++) {
    const rows = await page(p);
    if (rows.length === 0 || rows[rows.length - 1]!.bracketData < LOWEST) { headEnded = true; break; }
  }

  // Tail: the +15 band runs past the head. Gallop to a page that has left +15, bisect for the band's last page, then
  // sample pages across the whole band.
  if (!headEnded) {
    let lo = HEAD_PAGES; // known to still be at +15
    let hi = HEAD_PAGES * 2;
    for (;;) {
      const rows = await page(hi);
      if (rows.length === 0 || rows[0]!.bracketData < LOWEST) break;
      lo = hi;
      hi *= 2;
      if (hi > 2000) break;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const rows = await page(mid);
      if (rows.length > 0 && rows[0]!.bracketData >= LOWEST) lo = mid; else hi = mid;
    }
    for (let k = 1; k <= TAIL_SAMPLES; k++) {
      const p = Math.round(HEAD_PAGES + ((lo - HEAD_PAGES) * k) / TAIL_SAMPLES);
      if (p > HEAD_PAGES) await page(p);
    }
  }

  // Band bounds per level over every page read, by global index (page - 1) * 100 + position, so the bounds survive the
  // gaps between sampled pages.
  const indexed: { idx: number; e: Ranking }[] = [];
  for (const [p, rows] of read) rows.forEach((e, i) => { indexed.push({ idx: (p - 1) * PAGE_SIZE + i, e }); });
  const entries: PoolEntry[] = [];
  for (const level of LEVELS) {
    const band = indexed.filter((x) => x.e.bracketData === level);
    if (band.length === 0) continue;
    const first = Math.min(...band.map((x) => x.idx));
    const last = Math.max(...band.map((x) => x.idx));
    for (const { idx, e } of band) {
      // Anonymised characters (no server) cannot be looked up; they still count for the band bounds.
      if (!e.server?.name) continue;
      entries.push({
        name: e.name, server: e.server.name, className, spec, role: roleOf(spec), encounterID, level, amount: e.amount,
        percentile: last > first ? (idx - first) / (last - first) : 0.5,
      });
    }
  }
  return { entries, tailed: !headEnded };
}

/** One character on one spec, placed in its cell: role × level (15..20) × performance quintile (0 = best). */
export interface Candidate {
  key: string;
  name: string;
  server: string;
  className: string;
  spec: string;
  role: Role;
  level: number;
  percentile: number;
  quintile: number;
}

export const fileKey = (name: string, server: string, spec: string): string =>
  `${name}-${server}-${spec}`.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "_");

export const cellOf = (c: { role: Role; level: number; quintile: number }): string => `${c.role}|${c.level}|${c.quintile}`;

/** One candidate per (character, spec): level = median of their bands, percentile = median position. */
export function candidates(pool: PoolEntry[]): Candidate[] {
  const byChar = new Map<string, PoolEntry[]>();
  for (const e of pool) {
    const k = `${e.name}|${e.server}|${e.spec}`;
    (byChar.get(k) ?? byChar.set(k, []).get(k)!).push(e);
  }
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
  const out: Candidate[] = [];
  for (const entries of byChar.values()) {
    const e0 = entries[0]!;
    const level = med(entries.map((e) => e.level));
    const percentile = med(entries.map((e) => e.percentile));
    out.push({
      key: fileKey(e0.name, e0.server, e0.spec), name: e0.name, server: e0.server, className: e0.className,
      spec: e0.spec, role: e0.role, level, percentile, quintile: Math.min(4, Math.floor(percentile * 5)),
    });
  }
  return out;
}

/** Deterministic shuffle (mulberry32), so a rerun walks the cells in the same order. */
export function shuffle<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

const seedOf = (s: string): number => [...s].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7);

/** Round-robin over role × level × quintile: round r takes the r-th candidate of every cell. */
export function schedule(cands: Candidate[]): Candidate[] {
  const cells = new Map<string, Candidate[]>();
  for (const c of cands) {
    const k = cellOf(c);
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(c);
  }
  const lists = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, l]) => shuffle(l, seedOf(k)));
  const order: Candidate[] = [];
  for (let r = 0; lists.some((l) => r < l.length); r++) for (const l of lists) if (r < l.length) order.push(l[r]!);
  return order;
}
