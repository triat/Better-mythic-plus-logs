import type { LookupPayload, MPlusRun, RunSignals } from "../types.ts";
import { STALE_DAYS, ageDays, deathsTone, fmtAge, fmtAmount, fmtDuration, higherTone, lowerTone, parseTier, signed, toneClass, wclUrl } from "./format.ts";

export interface Part { text: string; cls: string }

const pctDelta = (mine: number, median: number) => ((mine - median) / median) * 100;

export function signalParts(s: RunSignals): Part[] {
  const parts: Part[] = [];
  const wipes = s.deaths.events.filter((e) => e.inWipe).length;
  parts.push({
    text: `${s.deaths.count} death${s.deaths.count === 1 ? "" : "s"}${wipes ? ` (${wipes} in wipe)` : ""}`,
    cls: toneClass(deathsTone(s.deaths.count)),
  });
  const peer = s.damageTaken.peer;
  if (peer && peer.median > 0) {
    const d = pctDelta(s.damageTaken.dtps, peer.median);
    parts.push({ text: `${fmtAmount(s.damageTaken.dtps)} dtps ${signed(d, 0, "%")} vs ${peer.count} dps`, cls: toneClass(lowerTone(d)) });
  } else {
    parts.push({ text: `${fmtAmount(s.damageTaken.dtps)} dtps`, cls: "" });
  }
  if (s.avoidableDamage) {
    const a = s.avoidableDamage;
    if (a.peer && a.peer.median > 0) {
      const d = pctDelta(a.perMinute, a.peer.median);
      parts.push({ text: `avoidable ${fmtAmount(a.perMinute)}/min (${signed(d, 0, "%")})`, cls: toneClass(lowerTone(d)) });
    } else {
      parts.push({ text: `avoidable ${fmtAmount(a.perMinute)}/min`, cls: "" });
    }
  }
  const i = s.interrupts;
  if (i.kickCooldownS === null) parts.push({ text: `kicks ${i.count} (no kick on spec)`, cls: "faint" });
  else if (i.capacity === null || i.usage === null) parts.push({ text: `kicks ${i.count}`, cls: "" });
  else if (i.peer) {
    const d = (i.usage - i.peer.median) * 100;
    parts.push({ text: `kicks ${i.count}/${Math.round(i.capacity)} (peer ${Math.round(i.peer.median * 100)}%)`, cls: toneClass(higherTone(d)) });
  } else {
    parts.push({ text: `kicks ${i.count}/${Math.round(i.capacity)}`, cls: "" });
  }
  parts.push({ text: `dispels ${s.dispels.count}`, cls: "" });
  if (s.consumables) parts.push({ text: `${s.consumables.potions} pots · ${s.consumables.healthstones} hs`, cls: "" });
  return parts;
}

export interface RunRowModel {
  key: string;
  level: number;
  keystone: { timed: boolean; text: string } | null;
  dungeon: string;
  parts: Part[];
  amount: string;
  metric: string;
  parse: string;
  parseCls: string;
  spec: string;
  age: string;
  stale: boolean;
  url: string;
}

const rowOf = (r: MPlusRun, metric: string, now: number): RunRowModel => {
  const s = r.signals;
  const keystone = s && !s.partial
    ? s.keystone.timed
      ? { timed: true, text: `✓+${s.keystone.chests} ${fmtDuration(s.keystone.timeMs)}` }
      : { timed: false, text: `✗ depleted ${fmtDuration(s.keystone.timeMs)}` }
    : null;
  return {
    key: `${r.reportCode}:${r.fightID}`,
    level: r.keyLevel,
    keystone,
    dungeon: r.encounterName,
    parts: s ? signalParts(s) : [],
    amount: fmtAmount(r.amount),
    metric,
    parse: r.parsePercent.toFixed(1) + "%",
    parseCls: `tier-${parseTier(r.parsePercent)}`,
    spec: r.spec,
    age: fmtAge(r.startTime, now),
    stale: ageDays(r.startTime, now) >= STALE_DAYS,
    url: wclUrl(r.reportCode, r.fightID),
  };
};

export const runRows = (p: LookupPayload, now = Date.now()): RunRowModel[] =>
  p.perDungeon.runs.map((r) => rowOf(r, p.metric, now));

export function missingDungeons(p: LookupPayload): string[] {
  const covered = new Set(p.perDungeon.runs.map((r) => r.encounterID));
  return p.seasonDungeons.filter((d) => !covered.has(d.id)).map((d) => d.name);
}

export function runsHeadline(p: LookupPayload): string {
  const pd = p.perDungeon;
  let s = `${pd.dungeonsCovered}/${pd.totalDungeonsInSeason} dungeons · median +${pd.medianLevel}, ${fmtAmount(pd.medianAmount)} ${p.metric}, ${pd.medianParse.toFixed(1)}%`;
  if (pd.dungeonsAtOrAboveTarget > 0) s += ` · ${pd.dungeonsAtOrAboveTarget}/${pd.totalDungeonsInSeason} at or above +${p.targetLevel}`;
  return s;
}
