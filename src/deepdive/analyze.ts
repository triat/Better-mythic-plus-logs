import type { RawRunReport, RawTableEntry, RunSignals } from "../signals/types.ts";
import { judgeHeals } from "./heals.ts";
import type { DeathAnalysis, DeathVerdict, DefensiveUse, HealRules, RawDeepDive, RunDefensives, SpecDefensives } from "./types.ts";

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
  /** Health potions, healthstone and the reaction rule; without it heals are not judged. */
  heals?: HealRules;
}

/** Self-buffs that are consumables, forms/stances or mobility — never defensives (audit noise). */
export const NON_DEFENSIVE_NAME =
  /potion|flask|phial|food|well fed|\brune\b|vantus|drums|healthstone|augment|\bform\b|\bstance\b|prowl|stealth|shimmer|sprint|\bdash\b|teleport|hover|ghost wolf|spirit walk|wraith walk|death's advance|burning rush|tiger's lust|camouflage|shroud of concealment|mount/i;
const CD_MISMATCH_RATIO = 0.9;
/** The verdicts that count as "a death with something at hand". */
export const AVOIDABLE: ReadonlySet<DeathVerdict> = new Set(["immunity available", "defensive available", "heal available"]);

const round1 = (x: number) => Math.round(x * 10) / 10;

function usageOf(raw: RawDeepDive, fightS: number, table: SpecDefensives, fightStart: number): DefensiveUse[] {
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
      castsAtMs: times.map((t) => t - fightStart),
    };
  });
}

interface DeathCtx { raw: RawDeepDive; table: SpecDefensives; fightStart: number; heals?: HealRules; groupClasses: string[] }

function deathOf(entry: RawTableEntry, atMs: number, inWipe: boolean, ctx: DeathCtx): DeathAnalysis {
  const { raw, table, fightStart } = ctx;
  const abilities = (entry.damage?.abilities ?? []).filter((a) => typeof a.total === "number");
  const sum = abilities.reduce((s, a) => s + (a.total ?? 0), 0);
  const killingHits = [...abilities].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 3)
    .map((a) => ({ id: a.guid ?? null, name: a.name, amount: a.total ?? 0, share: sum > 0 ? (a.total ?? 0) / sum : 0 }));
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
  // The killing hit: WCL lists the last hits newest first; `amount` excludes the overkill, so it is the health left.
  const last = entry.events?.[0];
  const instakill = last?.type === "instakill";
  const overkill = entry.overkill ?? last?.overkill ?? 0;
  const dh = raw.deathHealth?.find((h) => h.deathTs === deathTs);
  let health: DeathAnalysis["health"];
  let heals: DeathAnalysis["heals"];
  if (dh && dh.maxHp !== null && last) {
    const hpBefore = last.amount ?? 0;
    const killingHit = hpBefore + (last.overkill ?? 0);
    const judged = ctx.heals
      ? judgeHeals({ rules: ctx.heals, raw, health: { ...dh, maxHp: dh.maxHp }, overkill, groupClasses: ctx.groupClasses })
      : { dangerMs: null, heals: [] };
    health = { maxHp: dh.maxHp, hpBefore, killingHit, overkill, dangerMs: judged.dangerMs, oneShot: killingHit >= dh.maxHp };
    if (ctx.heals) heals = judged.heals;
  }
  let verdict: DeathVerdict;
  if (instakill || health?.oneShot) verdict = "unpreventable";
  else if (immunityAvail) verdict = "immunity available";
  else if (majorAvail && !anyActive) verdict = "defensive available";
  else if (heals?.some((h) => h.status === "saves")) verdict = "heal available";
  else if (anyActive) verdict = "covered";
  else verdict = "nothing available";
  return {
    atMs, inWipe, killingHits, killingBlow: entry.killingBlow?.name ?? null, available, active, onCooldown, verdict,
    ...(health ? { health } : {}), ...(instakill ? { instakill } : {}), ...(heals ? { heals } : {}),
  };
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
  const fightStart = i.report.fights?.[0]?.startTime ?? i.raw.fightStart;
  const defensives = usageOf(i.raw, fightS, i.table, fightStart);
  const groupClasses = (i.report.summary?.data?.composition ?? []).map((c) => c.type ?? "").filter(Boolean);
  const ctx: DeathCtx = { raw: i.raw, table: i.table, fightStart, heals: i.heals, groupClasses };
  const myEntries = (i.report.deaths?.data?.entries ?? []).filter((e) => e.name === i.character && typeof e.timestamp === "number");
  // signals.deaths.events carries inWipe for the same deaths, in timestamp order; match on atMs.
  const deaths = myEntries.map((e) => {
    const atMs = (e.timestamp as number) - fightStart;
    const ev = i.signals.deaths.events.find((d) => d.atMs === atMs);
    return deathOf(e, atMs, ev?.inWipe ?? false, ctx);
  }).sort((a, b) => a.atMs - b.atMs);
  const majors = defensives.filter((d) => d.kind !== "minor");
  // Unpreventable deaths (one-shots, instakills) leave both counts.
  const counted = deaths.filter((d) => !d.inWipe && d.verdict !== "unpreventable");
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
    avoidableDeaths: counted.filter((d) => AVOIDABLE.has(d.verdict)).length,
    countedDeaths: counted.length,
    unlisted: unlistedOf(i.raw, i.table, i.denylist),
    staleTable: !i.table.entries.every((e) => i.raw.tableIds.includes(e.id)),
    // A row fetched before the health data, or whose health request failed: heals and one-shots not judged.
    ...(deaths.some((d) => d.health === undefined && !d.instakill) ? { healthMissing: true } : {}),
    truncated: i.raw.truncated,
    fetchedAt: i.raw.fetchedAt,
    pointsSpent: i.raw.pointsSpent,
  };
}
