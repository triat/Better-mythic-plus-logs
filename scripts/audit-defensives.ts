#!/usr/bin/env bun
// Empirical audit of src/deepdive/defensives.json against what top players of each spec
// actually cast in the current season. For every Class:Spec of the kick table, take the
// top N ranked runs of one dungeon (worldData.encounter.characterRankings), read the
// Casts + Buffs tables of the ranked player, and report per spec:
//   - table entries never cast by anyone sampled  → probably removed / not in the tree
//   - self-cast buffs not in the table and not denylisted → candidates
// Usage: bun scripts/audit-defensives.ts [--encounter 12923] [--runs 2] [--only Shaman:Elemental,...] [--out scratch/audit.json]
// Cost: ~1 pt per rankings call + 2 pts per sampled run (measured and printed).
import { SHIPPED, specDefensives } from "../src/deepdive/table.ts";
import { NON_DEFENSIVE_NAME } from "../src/deepdive/analyze.ts";
import { gql } from "../src/wcl/client.ts";
import { PING_QUERY } from "../src/wcl/queries.ts";
import type { RateLimitData } from "../src/wcl/types.ts";

const KICK_SPECS = [
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
const TABLES_QUERY = /* GraphQL */ `
  query Tables($code: String!, $fightID: Int!, $actorID: Int!) {
    reportData { report(code: $code) {
      casts: table(fightIDs: [$fightID], dataType: Casts, sourceID: $actorID)
      buffs: table(fightIDs: [$fightID], dataType: Buffs, targetID: $actorID)
    } }
  }
`;

const spent = async () => (await gql<RateLimitData>(PING_QUERY)).rateLimitData.pointsSpentThisHour;

interface SpecReport { key: string; sampled: number; neverCast: Array<{ id: number; name: string }>; candidates: Array<{ id: number; name: string; casts: number; runs: number; uptimeS: number }>; seen: Record<number, { name: string; casts: number; runs: number }>; }

const results: SpecReport[] = [];
const start = await spent();
for (const key of KICK_SPECS) {
  if (only.length > 0 && !only.includes(key)) continue;
  const [className, specName] = key.split(":") as [string, string];
  const metric = HEALERS.has(key) ? "hps" : "dps";
  let ranking: { rankings?: Array<{ name: string; report?: { code: string; fightID: number } }> } | null = null;
  try {
    const r = await gql<{ worldData: { encounter: { characterRankings: typeof ranking } } }>(RANKINGS_QUERY, { encounterID, className, specName, metric });
    ranking = r.worldData.encounter.characterRankings;
  } catch (e) {
    console.error(`${key}: rankings failed: ${e instanceof Error ? e.message : e}`);
    continue;
  }
  const top = (ranking?.rankings ?? []).filter((x) => x.report).slice(0, runsPerSpec);
  const table = specDefensives(SHIPPED, {}, className, specName);
  const seen: SpecReport["seen"] = {};
  const cand = new Map<number, { name: string; casts: number; runs: number; uptimeS: number }>();
  let sampled = 0;
  for (const t of top) {
    try {
      // Resolve the ranked player's actor id from the fight's Summary composition (~1 pt).
      const first = await gql<{ reportData: { report: { summary: { data?: { composition?: Array<{ name: string; id: number }> } } } } }>(SUMMARY_QUERY, { code: t.report!.code, fightID: t.report!.fightID });
      const actor = first.reportData.report.summary?.data?.composition?.find((c) => c.name === t.name);
      if (!actor) { console.error(`${key}: ${t.name} not in composition of ${t.report!.code}:${t.report!.fightID}`); continue; }
      const tables = await gql<{ reportData: { report: { casts: { data?: { entries?: Array<{ guid: number; name: string; total: number }> } }; buffs: { data?: { auras?: Array<{ guid: number; name: string; totalUses?: number; totalUptime?: number }> } } } } }>(TABLES_QUERY, { code: t.report!.code, fightID: t.report!.fightID, actorID: actor.id });
      sampled++;
      const casts = new Map((tables.reportData.report.casts.data?.entries ?? []).map((e) => [e.guid, e]));
      for (const e of casts.values()) {
        const s = (seen[e.guid] ??= { name: e.name, casts: 0, runs: 0 });
        s.casts += e.total; s.runs++;
      }
      for (const a of tables.reportData.report.buffs.data?.auras ?? []) {
        const c = casts.get(a.guid);
        if (!c || (a.totalUses ?? 0) < 1) continue;
        if (table.entries.some((x) => x.id === a.guid) || SHIPPED.denylist.includes(a.guid) || NON_DEFENSIVE_NAME.test(a.name)) continue;
        const x = cand.get(a.guid) ?? { name: a.name, casts: 0, runs: 0, uptimeS: 0 };
        x.casts += c.total; x.runs++; x.uptimeS += (a.totalUptime ?? 0) / 1000;
        cand.set(a.guid, x);
      }
    } catch (e) {
      console.error(`${key}: tables failed for ${t.report!.code}:${t.report!.fightID}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const neverCast = table.entries.filter((e) => !seen[e.id]).map((e) => ({ id: e.id, name: e.name }));
  const candidates = [...cand.entries()].map(([id, x]) => ({ id, ...x, uptimeS: Math.round(x.uptimeS) })).sort((a, b) => b.runs - a.runs || b.casts - a.casts);
  results.push({ key, sampled, neverCast, candidates, seen });
  console.log(`${key} (${sampled} runs${table.tableMissing ? ", NO TABLE" : ""})`);
  console.log(`  never cast: ${neverCast.map((e) => `${e.name}(${e.id})`).join(", ") || "—"}`);
  console.log(`  candidates: ${candidates.map((c) => `${c.name}(${c.id}) x${c.casts}/${c.runs}r ${c.uptimeS}s`).join(", ") || "—"}`);
}
const end = await spent();
console.log(`\npoints spent: ${(end - start).toFixed(1)}`);
if (out) await Bun.write(out, JSON.stringify({ encounterID, runsPerSpec, results }, null, 1));
