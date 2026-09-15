import { avoidableSpellIdsFor } from "./avoidable/index.ts";
import { kickCooldownFor } from "./kick-cooldowns.ts";
import { peerComparison } from "./peers.ts";
import type {
  DeathEvent,
  GroupRole,
  RawRunReport,
  RawTable,
  RunSignals,
} from "./types.ts";

export const WIPE_WINDOW_MS = 15_000;
export const WIPE_MIN_DEATHS = 3;

const DPS_ONLY: ReadonlySet<GroupRole> = new Set(["dps"]);
const NON_HEALERS: ReadonlySet<GroupRole> = new Set(["dps", "tank"]);
const EVERYONE: ReadonlySet<GroupRole> = new Set(["dps", "tank", "healer"]);

const normalizeRole = (raw: string | undefined): GroupRole => {
  const r = (raw ?? "").toLowerCase();
  return r === "dps" || r === "healer" || r === "tank" ? r : "unknown";
};

interface Player {
  name: string;
  className: string;
  spec: string;
  role: GroupRole;
}

const playersFromSummary = (summary: RawTable | null | undefined): Player[] =>
  (summary?.data?.composition ?? []).map((p) => ({
    name: p.name,
    className: p.type ?? "",
    spec: p.specs?.[0]?.spec ?? "",
    role: normalizeRole(p.specs?.[0]?.role),
  }));

const playerDetailFor = (summary: RawTable | null | undefined, name: string) => {
  const pd = summary?.data?.playerDetails;
  for (const group of [pd?.dps, pd?.healers, pd?.tanks]) {
    const hit = group?.find((p) => p.name === name);
    if (hit) return hit;
  }
  return null;
};

const itemLevelFor = (summary: RawTable | null | undefined, name: string): number | null => {
  const p = playerDetailFor(summary, name);
  if (p && typeof p.minItemLevel === "number") return p.minItemLevel;
  return null;
};

const consumablesFor = (summary: RawTable | null | undefined, name: string) => {
  const p = playerDetailFor(summary, name);
  if (!p) return null;
  return { potions: p.potionUse ?? 0, healthstones: p.healthstoneUse ?? 0 };
};

/** Per-player totals from a flat table (DamageTaken); absent players → 0. */
const totalsByName = (table: RawTable | null | undefined, players: Player[]): Map<string, number> => {
  const out = new Map<string, number>(players.map((p) => [p.name, 0]));
  for (const e of table?.data?.entries ?? []) {
    if (typeof e.total === "number") out.set(e.name, (out.get(e.name) ?? 0) + e.total);
  }
  return out;
};

/** Per-player counts from a nested spell→details table (Interrupts, Dispels); absent players → 0. */
const detailCountsByName = (table: RawTable | null | undefined, players: Player[]): Map<string, number> => {
  const out = new Map<string, number>(players.map((p) => [p.name, 0]));
  for (const outer of table?.data?.entries ?? []) {
    for (const spell of outer.entries ?? []) {
      for (const d of spell.details ?? []) {
        if (typeof d.total === "number") out.set(d.name, (out.get(d.name) ?? 0) + d.total);
      }
    }
  }
  return out;
};

const toValues = (m: Map<string, number | null>) =>
  [...m.entries()].map(([name, value]) => ({ name, value }));

export function parseRunSignals(
  report: RawRunReport | null | undefined,
  characterName: string,
  fallback: { keyLevel: number; affixes: number[]; encounterID: number },
): RunSignals | null {
  if (!report) return null;

  const players = playersFromSummary(report.summary);
  const roleByName = new Map<string, GroupRole>(players.map((p) => [p.name, p.role]));
  const me = players.find((p) => p.name === characterName);
  const role: GroupRole = me?.role ?? "unknown";

  const fight = report.fights?.[0];
  const durationMs =
    report.damageTaken?.data?.totalTime ??
    report.summary?.data?.totalTime ??
    (fight?.endTime !== undefined && fight?.startTime !== undefined ? fight.endTime - fight.startTime : 0);
  const seconds = durationMs / 1000;
  const minutes = durationMs / 60_000;

  // --- keystone ---
  let partial = false;
  let keystone: RunSignals["keystone"];
  if (fight && typeof fight.keystoneLevel === "number") {
    const chests = fight.keystoneBonus ?? 0;
    keystone = {
      level: fight.keystoneLevel,
      chests,
      timed: chests > 0,
      timeMs: fight.keystoneTime ?? 0,
      affixes: fight.keystoneAffixes ?? fallback.affixes,
    };
  } else {
    partial = true;
    keystone = { level: fallback.keyLevel, chests: 0, timed: false, timeMs: 0, affixes: fallback.affixes };
  }

  // --- damage taken ---
  const dtTotals = totalsByName(report.damageTaken, players);
  const dtps = new Map<string, number | null>(
    [...dtTotals].map(([n, t]): [string, number | null] => [n, seconds > 0 ? t / seconds : null]),
  );
  const myDt = dtTotals.get(characterName) ?? 0;
  const damageTaken = {
    total: myDt,
    dtps: seconds > 0 ? myDt / seconds : 0,
    peer: role === "tank" ? null : peerComparison(toValues(dtps), characterName, roleByName, DPS_ONLY),
  };

  // --- interrupts (normalized by kick cooldown) ---
  const kickCounts = detailCountsByName(report.interrupts, players);
  const usageByName = new Map<string, number | null>();
  for (const p of players) {
    const cd = kickCooldownFor(p.className, p.spec);
    const cap = cd !== null && seconds > 0 ? seconds / cd : null;
    usageByName.set(p.name, cap !== null && cap > 0 ? (kickCounts.get(p.name) ?? 0) / cap : null);
  }
  const myCd = me ? kickCooldownFor(me.className, me.spec) : null;
  const myCap = myCd !== null && seconds > 0 ? seconds / myCd : null;
  const myKicks = kickCounts.get(characterName) ?? 0;
  const interrupts = {
    count: myKicks,
    kickCooldownS: myCd,
    capacity: myCap,
    usage: myCap !== null && myCap > 0 ? myKicks / myCap : null,
    // Without a table at all, every player's count is unknown (not a real
    // zero), so a peer comparison would be meaningless — force null.
    peer: report.interrupts
      ? peerComparison(toValues(usageByName), characterName, roleByName, NON_HEALERS)
      : null,
  };

  // --- dispels ---
  const dispels = { count: detailCountsByName(report.dispels, players).get(characterName) ?? 0 };

  // --- avoidable damage ---
  let avoidableDamage: RunSignals["avoidableDamage"] = null;
  const list = avoidableSpellIdsFor(fight?.encounterID ?? fallback.encounterID);
  if (report.avoidable && list) {
    const totals = totalsByName(report.avoidable, players);
    const perMin = new Map<string, number | null>(
      [...totals].map(([n, t]): [string, number | null] => [n, minutes > 0 ? t / minutes : null]),
    );
    const mine = totals.get(characterName) ?? 0;
    avoidableDamage = {
      total: mine,
      perMinute: minutes > 0 ? mine / minutes : 0,
      peer: peerComparison(toValues(perMin), characterName, roleByName, EVERYONE),
      spellCount: list.length,
    };
  }

  // --- deaths ---
  const fightStart = fight?.startTime ?? 0;
  const allDeaths = (report.deaths?.data?.entries ?? [])
    .filter((e) => typeof e.timestamp === "number")
    .map((e) => ({ name: e.name, at: (e.timestamp as number) - fightStart, raw: e }));
  const events: DeathEvent[] = allDeaths
    .filter((d) => d.name === characterName)
    .map((d) => {
      const near = allDeaths.filter((o) => Math.abs(o.at - d.at) <= WIPE_WINDOW_MS).length;
      return {
        atMs: d.at,
        cause: d.raw.damage?.abilities?.[0]?.name ?? null,
        source: d.raw.damage?.sources?.[0]?.name ?? null,
        overkill: d.raw.overkill ?? 0,
        inWipe: near >= WIPE_MIN_DEATHS,
      };
    });

  return {
    role,
    keystone,
    itemLevel: itemLevelFor(report.summary, characterName),
    consumables: consumablesFor(report.summary, characterName),
    deaths: { count: events.length, groupTotal: allDeaths.length, events },
    damageTaken,
    interrupts,
    dispels,
    avoidableDamage,
    fightDurationMs: durationMs,
    ...(partial ? { partial: true } : {}),
  };
}
