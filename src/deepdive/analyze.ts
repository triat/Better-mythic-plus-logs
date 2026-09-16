import type { RawRunReport, RawTableEntry, RunSignals } from "../signals/types.ts";
import type { DeathAnalysis, DeathVerdict, DefensiveUse, RawDeepDive, RunDefensives, SpecDefensives } from "./types.ts";

export interface AnalyzeInput {
  raw: RawDeepDive;
  report: RawRunReport;
  signals: RunSignals;
  character: string;
  className: string;
  spec: string;
  table: SpecDefensives;
  tableVersion: string;
  denylist: number[];
}

/** Self-buffs that are consumables, forms/stances or mobility — never defensives (audit noise). */
export const NON_DEFENSIVE_NAME =
  /potion|flask|phial|food|well fed|\brune\b|vantus|drums|healthstone|augment|\bform\b|\bstance\b|prowl|stealth|shimmer|sprint|\bdash\b|teleport|hover|ghost wolf|spirit walk|wraith walk|death's advance|burning rush|tiger's lust|camouflage|shroud of concealment|mount/i;
const CD_MISMATCH_RATIO = 0.9;

const round1 = (x: number) => Math.round(x * 10) / 10;

function usageOf(raw: RawDeepDive, fightS: number, table: SpecDefensives): DefensiveUse[] {
  const tableCounts = new Map<number, number>();
  for (const e of raw.casts?.data?.entries ?? []) if (typeof e.guid === "number") tableCounts.set(e.guid, e.total ?? 0);
  return table.entries.map((d) => {
    const times = raw.castEvents.filter((e) => e.abilityGameID === d.id).map((e) => e.timestamp).sort((a, b) => a - b);
    // Exact timestamps when the events were filtered on this id; otherwise the Casts table total (ids added after the fetch).
    const casts = Math.max(times.length, tableCounts.get(d.id) ?? 0);
    let minGap: number | null = null;
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i]! - times[i - 1]!) / 1000;
      minGap = minGap === null ? gap : Math.min(minGap, gap);
    }
    const capacity = Math.max(1, Math.ceil(fightS / d.cooldownS));
    return {
      ...d,
      casts,
      capacity,
      usage: Math.min(1, casts / capacity),
      observedMinIntervalS: minGap === null ? null : round1(minGap),
      cdMismatch: minGap !== null && minGap < CD_MISMATCH_RATIO * d.cooldownS,
    };
  });
}

function deathOf(entry: RawTableEntry, atMs: number, inWipe: boolean, raw: RawDeepDive, table: SpecDefensives, fightStart: number): DeathAnalysis {
  const abilities = (entry.damage?.abilities ?? []).filter((a) => typeof a.total === "number");
  const sum = abilities.reduce((s, a) => s + (a.total ?? 0), 0);
  const killingHits = [...abilities].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 3)
    .map((a) => ({ name: a.name, amount: a.total ?? 0, share: sum > 0 ? (a.total ?? 0) / sum : 0 }));
  const deathTs = fightStart + atMs;
  const available: string[] = [];
  const active: string[] = [];
  const onCooldown: { name: string; readyInS: number }[] = [];
  let immunityAvail = false;
  let majorAvail = false;
  let anyActive = false;
  // Only ids the events were filtered on can be judged: an entry added after the fetch has no
  // events by construction and would always read as "available" (the row is stale — re-analyze).
  for (const d of table.entries) {
    if (!raw.tableIds.includes(d.id)) continue;
    const before = raw.castEvents.filter((e) => e.abilityGameID === d.id && e.timestamp <= deathTs).map((e) => e.timestamp);
    const last = before.length > 0 ? Math.max(...before) : null;
    const isActive = last !== null && d.durationS > 0 && deathTs - last <= d.durationS * 1000;
    const onCd = last !== null && deathTs - last < d.cooldownS * 1000;
    if (isActive) { active.push(d.name); if (d.kind !== "minor") anyActive = true; }
    else if (onCd) onCooldown.push({ name: d.name, readyInS: Math.round(d.cooldownS - (deathTs - last!) / 1000) });
    else { available.push(d.name); if (d.kind === "immunity") immunityAvail = true; if (d.kind === "major") majorAvail = true; }
  }
  let verdict: DeathVerdict;
  if (immunityAvail) verdict = "immunity available";
  else if (majorAvail && !anyActive) verdict = "defensive available";
  else if (anyActive) verdict = "covered";
  else verdict = "nothing available";
  return { atMs, inWipe, killingHits, killingBlow: entry.killingBlow?.name ?? null, available, active, onCooldown, verdict };
}

function unlistedOf(raw: RawDeepDive, table: SpecDefensives, denylist: number[]): RunDefensives["unlisted"] {
  const selfCast = new Map<number, number>();
  for (const e of raw.casts?.data?.entries ?? []) if (typeof e.guid === "number") selfCast.set(e.guid, e.total ?? 0);
  const listed = new Set(table.entries.map((e) => e.id));
  const skip = new Set([...table.ignored, ...denylist]);
  return (raw.buffs?.data?.auras ?? [])
    .filter((a) => (a.totalUses ?? 0) >= 1 && selfCast.has(a.guid) && !listed.has(a.guid) && !skip.has(a.guid) && !NON_DEFENSIVE_NAME.test(a.name))
    .map((a) => ({ id: a.guid, name: a.name, casts: selfCast.get(a.guid) ?? 0, uptimeS: round1((a.totalUptime ?? 0) / 1000) }))
    .sort((a, b) => b.casts - a.casts);
}

/** Pure: same raw + report + table → same analysis. */
export function analyzeRun(i: AnalyzeInput): RunDefensives {
  const fightS = i.signals.fightDurationMs / 1000;
  const defensives = usageOf(i.raw, fightS, i.table);
  const fightStart = i.report.fights?.[0]?.startTime ?? i.raw.fightStart;
  const myEntries = (i.report.deaths?.data?.entries ?? []).filter((e) => e.name === i.character && typeof e.timestamp === "number");
  // signals.deaths.events carries inWipe for the same deaths, in timestamp order; match on atMs.
  const deaths = myEntries.map((e) => {
    const atMs = (e.timestamp as number) - fightStart;
    const ev = i.signals.deaths.events.find((d) => d.atMs === atMs);
    return deathOf(e, atMs, ev?.inWipe ?? false, i.raw, i.table, fightStart);
  }).sort((a, b) => a.atMs - b.atMs);
  const majors = defensives.filter((d) => d.kind !== "minor");
  const counted = deaths.filter((d) => !d.inWipe);
  return {
    reportCode: i.raw.code,
    fightID: i.raw.fightID,
    character: i.character,
    className: i.className,
    spec: i.spec,
    tableMissing: i.table.tableMissing,
    tableVersion: i.tableVersion,
    defensives,
    deaths,
    majorUsage: majors.length > 0 ? majors.reduce((s, d) => s + d.usage, 0) / majors.length : null,
    avoidableDeaths: counted.filter((d) => d.verdict === "immunity available" || d.verdict === "defensive available").length,
    countedDeaths: counted.length,
    unlisted: unlistedOf(i.raw, i.table, i.denylist),
    staleTable: !i.table.entries.every((e) => i.raw.tableIds.includes(e.id)),
    truncated: i.raw.truncated,
    fetchedAt: i.raw.fetchedAt,
    pointsSpent: i.raw.pointsSpent,
  };
}
