import type { LookupPayload, MPlusRun, RunSignals } from "../types.ts";
import type { T } from "../i18n/t.ts";
import { STALE_DAYS, ageDays, deathsTone, fmtAge, fmtAmount, fmtDuration, higherTone, lowerTone, parseTier, signed, toneClass, wclUrl } from "./format.ts";

export interface Part { text: string; cls: string }

const pctDelta = (mine: number, median: number) => ((mine - median) / median) * 100;

export function signalParts(t: T, s: RunSignals): Part[] {
  const parts: Part[] = [];
  const wipes = s.deaths.events.filter((e) => e.inWipe).length;
  parts.push({
    text: t("runs.deaths", { count: s.deaths.count }) + (wipes ? t("runs.wipes", { n: wipes }) : ""),
    cls: toneClass(deathsTone(s.deaths.count)),
  });
  const peer = s.damageTaken.peer;
  const dtps = fmtAmount(s.damageTaken.dtps);
  if (peer && peer.median > 0) {
    const d = pctDelta(s.damageTaken.dtps, peer.median);
    parts.push({ text: t("runs.dtpsVs", { dtps, delta: signed(d, 0, "%"), n: peer.count }), cls: toneClass(lowerTone(d)) });
  } else {
    parts.push({ text: t("runs.dtps", { dtps }), cls: "" });
  }
  if (s.avoidableDamage) {
    const a = s.avoidableDamage;
    const perMin = fmtAmount(a.perMinute);
    if (a.peer && a.peer.median > 0) {
      const d = pctDelta(a.perMinute, a.peer.median);
      parts.push({ text: t("runs.avoidableVs", { perMin, delta: signed(d, 0, "%") }), cls: toneClass(lowerTone(d)) });
    } else {
      parts.push({ text: t("runs.avoidable", { perMin }), cls: "" });
    }
  }
  const i = s.interrupts;
  if (i.kickCooldownS === null) parts.push({ text: t("runs.kicksNoSpec", { n: i.count }), cls: "faint" });
  else if (i.capacity === null || i.usage === null) parts.push({ text: t("runs.kicks", { n: i.count }), cls: "" });
  else if (i.peer) {
    const d = (i.usage - i.peer.median) * 100;
    parts.push({ text: t("runs.kicksCap", { n: i.count, cap: Math.round(i.capacity), peer: Math.round(i.peer.median * 100) }), cls: toneClass(higherTone(d)) });
  } else {
    parts.push({ text: t("runs.kicksCapNoPeer", { n: i.count, cap: Math.round(i.capacity) }), cls: "" });
  }
  parts.push(s.dispels.available
    ? { text: t("runs.dispels", { n: s.dispels.count }), cls: "" }
    : { text: t("runs.dispelsNoSpec", { n: s.dispels.count }), cls: "faint" });
  if (s.consumables) parts.push({ text: t("runs.consumables", { pots: s.consumables.potions, hs: s.consumables.healthstones }), cls: "" });
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

const rowOf = (t: T, r: MPlusRun, metric: string, now: number): RunRowModel => {
  const s = r.signals;
  const keystone = s && !s.partial
    ? s.keystone.timed
      ? { timed: true, text: t("runs.timed", { chests: s.keystone.chests, time: fmtDuration(s.keystone.timeMs) }) }
      : { timed: false, text: t("runs.depleted", { time: fmtDuration(s.keystone.timeMs) }) }
    : null;
  return {
    key: `${r.reportCode}:${r.fightID}`,
    level: r.keyLevel,
    keystone,
    dungeon: r.encounterName,
    parts: s ? signalParts(t, s) : [],
    amount: fmtAmount(r.amount),
    metric,
    // 0% = WCL has not ranked this log; never show it as a real percentile.
    parse: r.parsePercent > 0 ? r.parsePercent.toFixed(1) + "%" : t("runs.unranked"),
    parseCls: r.parsePercent > 0 ? `tier-${parseTier(r.parsePercent)}` : "faint",
    spec: r.spec,
    age: fmtAge(t, r.startTime, now),
    stale: ageDays(r.startTime, now) >= STALE_DAYS,
    url: wclUrl(r.reportCode, r.fightID),
  };
};

export const runRows = (t: T, p: LookupPayload, now = Date.now()): RunRowModel[] =>
  p.perDungeon.runs.map((r) => rowOf(t, r, p.metric, now));

export function missingDungeons(p: LookupPayload): string[] {
  const covered = new Set(p.perDungeon.runs.map((r) => r.encounterID));
  return p.seasonDungeons.filter((d) => !covered.has(d.id)).map((d) => d.name);
}

export function runsHeadline(t: T, p: LookupPayload): string {
  const pd = p.perDungeon;
  let s = t("runs.headline", {
    covered: pd.dungeonsCovered, total: pd.totalDungeonsInSeason, level: pd.medianLevel,
    amount: fmtAmount(pd.medianAmount), metric: p.metric, parse: pd.medianParse.toFixed(1),
  });
  if (pd.dungeonsAtOrAboveTarget > 0) s += t("runs.atTarget", { n: pd.dungeonsAtOrAboveTarget, total: pd.totalDungeonsInSeason, level: p.targetLevel });
  return s;
}
