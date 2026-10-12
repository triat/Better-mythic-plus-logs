import type { LookupPayload, MPlusRun, PeerComparison, RunSignals } from "../types.ts";
import type { T } from "../i18n/t.ts";
import { STALE_DAYS, ageDays, deathsTone, fmtAge, fmtAmount, fmtDuration, higherTone, lowerTone, parseTier, signed, toneClass, wclUrl } from "./format.ts";

export interface Part { text: string; cls: string }

const pctDelta = (mine: number, median: number) => ((mine - median) / median) * 100;

/** Percent delta against the peers' median (lower is better for DTPS and avoidable damage); null without a usable median. */
export const vsPeers = (mine: number, peer: PeerComparison | null): number | null =>
  peer && peer.median > 0 ? pctDelta(mine, peer.median) : null;

/** Kicks as the run rows count them: capacity rounded, the usage gap vs peers in points (higher is better). */
export function kickFigures(i: RunSignals["interrupts"]): { count: number; noKick: boolean; cap: number | null; peerPct: number | null; deltaPts: number | null } {
  const cap = i.kickCooldownS !== null && i.capacity !== null && i.usage !== null ? Math.round(i.capacity) : null;
  const peer = cap !== null && i.peer ? i.peer.median : null;
  return {
    count: i.count, noKick: i.kickCooldownS === null, cap,
    peerPct: peer === null ? null : Math.round(peer * 100),
    deltaPts: peer === null ? null : (i.usage! - peer) * 100,
  };
}

/** The kicks part of a run row ("kicks 8/20 (peer 30%)"). */
export function kicksPart(t: T, i: RunSignals["interrupts"]): Part {
  const k = kickFigures(i);
  if (k.noKick) return { text: t("runs.kicksNoSpec", { n: k.count }), cls: "faint" };
  if (k.cap === null) return { text: t("runs.kicks", { n: k.count }), cls: "" };
  if (k.peerPct !== null) return { text: t("runs.kicksCap", { n: k.count, cap: k.cap, peer: k.peerPct }), cls: toneClass(higherTone(k.deltaPts!)) };
  return { text: t("runs.kicksCapNoPeer", { n: k.count, cap: k.cap }), cls: "" };
}

/** The dispels part of a run row ("dispels 9"). */
export const dispelsPart = (t: T, d: RunSignals["dispels"]): Part =>
  d.available ? { text: t("runs.dispels", { n: d.count }), cls: "" } : { text: t("runs.dispelsNoSpec", { n: d.count }), cls: "faint" };

export function signalParts(t: T, s: RunSignals): Part[] {
  const parts: Part[] = [];
  const wipes = s.deaths.events.filter((e) => e.inWipe).length;
  parts.push({
    text: t("runs.deaths", { count: s.deaths.count }) + (wipes ? t("runs.wipes", { n: wipes }) : ""),
    cls: toneClass(deathsTone(s.deaths.count)),
  });
  const dtps = fmtAmount(s.damageTaken.dtps);
  const dd = vsPeers(s.damageTaken.dtps, s.damageTaken.peer);
  if (dd !== null) {
    parts.push({ text: t("runs.dtpsVs", { dtps, delta: signed(dd, 0, "%"), n: s.damageTaken.peer!.count }), cls: toneClass(lowerTone(dd)) });
  } else {
    parts.push({ text: t("runs.dtps", { dtps }), cls: "" });
  }
  if (s.avoidableDamage) {
    const a = s.avoidableDamage;
    const perMin = fmtAmount(a.perMinute);
    const ad = vsPeers(a.perMinute, a.peer);
    if (ad !== null) {
      parts.push({ text: t("runs.avoidableVs", { perMin, delta: signed(ad, 0, "%") }), cls: toneClass(lowerTone(ad)) });
    } else {
      parts.push({ text: t("runs.avoidable", { perMin }), cls: "" });
    }
  }
  parts.push(kicksPart(t, s.interrupts));
  parts.push(dispelsPart(t, s.dispels));
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

export const rowOf = (t: T, r: MPlusRun, metric: string, now: number): RunRowModel => {
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
