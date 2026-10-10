#!/usr/bin/env bun
// Empirical audit of src/signals/control/cc-mn-2.json against what top players of each spec actually land in the
// current season (docs/superpowers/specs/2026-10-10-self-review-control-design.md, decision 2). For every
// Class:Spec, take the top N ranked runs of one dungeon (worldData.encounter.characterRankings), read every debuff the
// ranked player or their pets applied to enemies, their casts and their damage done, and report per spec:
//   - seen: table entries applied or cast, with counts
//   - neverSeen: table entries no sampled run shows (not talented, or a wrong id)
//   - candidates: enemy debuffs of the player or their pets missing from the table (alsoDamage: the ability also
//     dealt damage, so it is more likely a damage-over-time than a crowd control)
//   - knockCandidates: casts whose name looks like a knock, grip or pull, missing from the table
// Usage: bun scripts/audit-control.ts [--encounter 12923] [--runs 2] [--only Rogue:Outlaw,...] [--out file.json]
// Cost: ~1 pt per rankings call + ~5 pts per sampled run (measured and printed).
import { CC_TABLE, specCc } from "../src/signals/control/table.ts";
import { gql } from "../src/wcl/client.ts";
import { PING_QUERY } from "../src/wcl/queries.ts";
import type { RateLimitData } from "../src/wcl/types.ts";

const SPECS = [
  "DeathKnight:Blood", "DeathKnight:Frost", "DeathKnight:Unholy",
  "DemonHunter:Havoc", "DemonHunter:Vengeance", "DemonHunter:Devourer",
  "Druid:Balance", "Druid:Feral", "Druid:Guardian", "Druid:Restoration",
  "Evoker:Devastation", "Evoker:Preservation", "Evoker:Augmentation",
  "Hunter:BeastMastery", "Hunter:Marksmanship", "Hunter:Survival",
  "Mage:Arcane", "Mage:Fire", "Mage:Frost",
  "Monk:Brewmaster", "Monk:Windwalker", "Monk:Mistweaver",
  "Paladin:Protection", "Paladin:Retribution", "Paladin:Holy",
  "Priest:Shadow", "Priest:Holy", "Priest:Discipline",
  "Rogue:Assassination", "Rogue:Outlaw", "Rogue:Subtlety",
  "Shaman:Elemental", "Shaman:Enhancement", "Shaman:Restoration",
  "Warlock:Affliction", "Warlock:Demonology", "Warlock:Destruction",
  "Warrior:Arms", "Warrior:Fury", "Warrior:Protection",
];
const HEALERS = new Set(["Druid:Restoration", "Evoker:Preservation", "Monk:Mistweaver", "Paladin:Holy", "Priest:Holy", "Priest:Discipline", "Shaman:Restoration"]);
const KNOCK_NAME = /knock|grip|wing buffet|thunderstorm|typhoon|vortex|ring of peace|tail swipe|blast wave|supernova|bursting shot/i;
const MAX_PAGES = 5;

const arg = (flag: string, dflt: string) => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt; };
const encounterID = Number(arg("--encounter", "12923")); // Voidscar Arena (S2)
const runsPerSpec = Number(arg("--runs", "2"));
const only = arg("--only", "").split(",").map((s) => s.trim()).filter(Boolean);
const out = arg("--out", "");

const RANKINGS_QUERY = /* GraphQL */ `
  query TopRuns($encounterID: Int!, $className: String!, $specName: String!, $metric: CharacterRankingMetricType!) {
    worldData { encounter(id: $encounterID) { characterRankings(className: $className, specName: $specName, metric: $metric, page: 1) } }
  }
`;
const SUMMARY_QUERY = /* GraphQL */ `
  query Summary($code: String!, $fightID: Int!) {
    reportData { report(code: $code) { summary: table(fightIDs: [$fightID], dataType: Summary) } }
  }
`;
// The player's casts and damage done, and the pets' owners.
const TABLES_QUERY = /* GraphQL */ `
  query Tables($code: String!, $fightID: Int!, $actorID: Int!) {
    reportData { report(code: $code) {
      masterData { actors(type: "Pet") { id petOwner } }
      casts: table(fightIDs: [$fightID], dataType: Casts, sourceID: $actorID)
      damage: table(fightIDs: [$fightID], dataType: DamageDone, sourceID: $actorID)
    } }
  }
`;
// Every debuff application on enemies by anyone (pets included), paged.
const DEBUFFS_QUERY = /* GraphQL */ `
  query Debuffs($code: String!, $fightID: Int!, $startTime: Float) {
    reportData { report(code: $code) {
      debuffs: events(fightIDs: [$fightID], dataType: Debuffs, hostilityType: Enemies, filterExpression: "type = \\"applydebuff\\"", limit: 10000, startTime: $startTime) { data nextPageTimestamp }
    } }
  }
`;

interface DebuffEvent { sourceID?: number; abilityGameID?: number }
type Count = { name: string; count: number; runs: number };
interface SpecReport {
  key: string;
  sampled: number;
  seen: Record<number, Count>;
  neverSeen: Array<{ id: number; name: string }>;
  candidates: Array<{ id: number; name: string; count: number; runs: number; alsoDamage: boolean }>;
  knockCandidates: Array<{ id: number; name: string; count: number; runs: number }>;
}

const spent = async () => (await gql<RateLimitData>(PING_QUERY)).rateLimitData.pointsSpentThisHour;

async function debuffsOf(code: string, fightID: number): Promise<DebuffEvent[]> {
  const all: DebuffEvent[] = [];
  let startTime: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await gql<{ reportData: { report: { debuffs: { data?: DebuffEvent[]; nextPageTimestamp?: number | null } } } }>(
      DEBUFFS_QUERY, { code, fightID, ...(startTime === undefined ? {} : { startTime }) });
    all.push(...(r.reportData.report.debuffs.data ?? []));
    const next = r.reportData.report.debuffs.nextPageTimestamp;
    if (typeof next !== "number") break;
    startTime = next;
  }
  return all;
}

const bump = (m: Map<number, Count & { seenIn?: Set<string> }>, id: number, name: string, n: number, run: string) => {
  const c = m.get(id) ?? { name, count: 0, runs: 0, seenIn: new Set<string>() };
  c.count += n;
  if (!c.seenIn!.has(run)) { c.seenIn!.add(run); c.runs++; }
  m.set(id, c);
};
const strip = ({ seenIn: _s, ...c }: Count & { seenIn?: Set<string> }): Count => c;

const results: SpecReport[] = [];
const start = await spent();
for (const key of SPECS) {
  if (only.length > 0 && !only.includes(key)) continue;
  const [className, specName] = key.split(":") as [string, string];
  const metric = HEALERS.has(key) ? "hps" : "dps";
  type Ranking = { rankings?: Array<{ name: string; report?: { code: string; fightID: number } }> } | null;
  let ranking: Ranking;
  try {
    const r = await gql<{ worldData: { encounter: { characterRankings: Ranking } } }>(RANKINGS_QUERY, { encounterID, className, specName, metric });
    ranking = r.worldData.encounter.characterRankings;
  } catch (e) {
    console.error(`${key}: rankings failed: ${e instanceof Error ? e.message : e}`);
    continue;
  }
  const top = (ranking?.rankings ?? []).filter((x) => x.report).slice(0, runsPerSpec);
  const table = specCc(className, specName);
  const debuffIds = new Set(table.filter((e) => e.kind === "debuff").map((e) => e.id));
  const castIds = new Set(table.filter((e) => e.kind === "cast").map((e) => e.id));
  const seen = new Map<number, Count & { seenIn?: Set<string> }>();
  const cand = new Map<number, Count & { seenIn?: Set<string>; alsoDamage?: boolean }>();
  const knocks = new Map<number, Count & { seenIn?: Set<string> }>();
  let sampled = 0;
  for (const t of top) {
    const { code, fightID } = t.report!;
    const runKey = `${code}:${fightID}`;
    try {
      const first = await gql<{ reportData: { report: { summary: { data?: { composition?: Array<{ name: string; id: number }> } } } } }>(SUMMARY_QUERY, { code, fightID });
      const actor = first.reportData.report.summary?.data?.composition?.find((c) => c.name === t.name);
      if (!actor) { console.error(`${key}: ${t.name} not in composition of ${runKey}`); continue; }
      type Entry = { guid: number; name: string; total: number };
      const tables = await gql<{ reportData: { report: {
        masterData: { actors: Array<{ id: number; petOwner?: number | null }> };
        casts: { data?: { entries?: Entry[] } }; damage: { data?: { entries?: Entry[] } };
      } } }>(TABLES_QUERY, { code, fightID, actorID: actor.id });
      const report = tables.reportData.report;
      const mine = new Set([actor.id, ...report.masterData.actors.filter((a) => a.petOwner === actor.id).map((a) => a.id)]);
      const damageIds = new Set((report.damage.data?.entries ?? []).map((e) => e.guid));
      const casts = report.casts.data?.entries ?? [];
      const names = new Map(casts.map((e) => [e.guid, e.name]));
      for (const e of casts) {
        if (castIds.has(e.guid)) bump(seen, e.guid, e.name, e.total, runKey);
        else if (KNOCK_NAME.test(e.name)) bump(knocks, e.guid, e.name, e.total, runKey);
      }
      const applied = new Map<number, number>();
      for (const ev of await debuffsOf(code, fightID)) {
        if (typeof ev.sourceID !== "number" || !mine.has(ev.sourceID) || typeof ev.abilityGameID !== "number") continue;
        applied.set(ev.abilityGameID, (applied.get(ev.abilityGameID) ?? 0) + 1);
      }
      for (const [id, n] of applied) {
        const name = table.find((e) => e.id === id)?.name ?? names.get(id) ?? `#${id}`;
        if (debuffIds.has(id)) bump(seen, id, name, n, runKey);
        else {
          bump(cand, id, name, n, runKey);
          cand.get(id)!.alsoDamage = damageIds.has(id);
        }
      }
      sampled++;
    } catch (e) {
      console.error(`${key}: failed for ${runKey}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const report: SpecReport = {
    key,
    sampled,
    seen: Object.fromEntries([...seen].map(([id, c]) => [id, strip(c)])),
    neverSeen: table.filter((e) => !seen.has(e.id)).map((e) => ({ id: e.id, name: e.name })),
    candidates: [...cand].map(([id, c]) => ({ id, ...strip(c), alsoDamage: c.alsoDamage === true })).sort((a, b) => b.runs - a.runs || b.count - a.count),
    knockCandidates: [...knocks].map(([id, c]) => ({ id, ...strip(c) })).sort((a, b) => b.runs - a.runs || b.count - a.count),
  };
  results.push(report);
  console.log(`${key} (${sampled} runs)`);
  console.log(`  seen:       ${Object.entries(report.seen).map(([id, c]) => `${c.name}(${id}) x${c.count}/${c.runs}r`).join(", ") || "—"}`);
  console.log(`  never seen: ${report.neverSeen.map((e) => `${e.name}(${e.id})`).join(", ") || "—"}`);
  console.log(`  candidates: ${report.candidates.filter((c) => !c.alsoDamage).map((c) => `${c.name}(${c.id}) x${c.count}/${c.runs}r`).join(", ") || "—"}`);
  console.log(`  knocks:     ${report.knockCandidates.map((c) => `${c.name}(${c.id}) x${c.count}/${c.runs}r`).join(", ") || "—"}`);
}
const end = await spent();
console.log(`\ntable ${CC_TABLE.version} · points spent: ${(end - start).toFixed(1)}`);
if (out) await Bun.write(out, JSON.stringify({ tableVersion: CC_TABLE.version, encounterID, runsPerSpec, results }, null, 1));
