import type { CcCategory } from "./control/table.ts";

export type GroupRole = "dps" | "healer" | "tank" | "unknown";

export interface PeerComparison {
  median: number;
  count: number;
}

/** One of the last hits of a death (the Deaths entry's `events[]`, up to three, newest first). */
export interface KillingHit {
  ability: string | null;
  abilityId: number | null;
  amount: number;
  overkill: number;
  /** Dealt by the player or an ally (a self-damage trinket, a friendly debuff). */
  friendly: boolean;
  instakill: boolean;
}

/** An avoidable ability that hit the player: WCL lists the top five by damage, the rest is `other`. */
export interface AbilityDamage { id: number; name: string; total: number }

/** An enemy spell the group interrupted at least once (the Interrupts table lists no other). */
export interface EnemyCast {
  id: number;
  name: string;
  /** max(spellsBegun, spellsCompleted + spellsInterrupted): channels report 0 begun. */
  attempts: number;
  completed: number;
  interrupted: number;
  /** Interrupts by this player on that spell. */
  mine: number;
}

export interface DeathEvent {
  atMs: number;          // ms since fight start
  cause: string | null;  // top ability in the death window
  source: string | null; // top damage source (NPC name)
  overkill: number;
  inWipe: boolean;       // >= 3 group deaths within ±15 s of this one (self included)
  killingHits?: KillingHit[]; // newest first; absent on payloads saved before 2026-10
}

/** One crowd-control spell of a run: `uses` grouped within 1 s, `enemies` the debuff applications (0 for a knock). */
export interface ControlSpell { id: number; name: string; category: CcCategory; uses: number; enemies: number }

export interface RunControl {
  uses: number;
  enemies: number;
  /** Uses per 10 minutes of key. */
  perTenMin: number;
  /** The spec's reference median per 10 minutes; null without a usable reference (src/signals/control/reference.ts). */
  reference: number | null;
  /** (perTenMin − reference) / reference × 100; null without a reference. */
  vsReference: number | null;
  /** Fetched with an older table version than the shipped one. */
  stale: boolean;
  /** Most uses first. */
  spells: ControlSpell[];
}

export interface RunSignals {
  role: GroupRole;
  keystone: {
    level: number;
    chests: number;
    timed: boolean;
    timeMs: number;
    affixes: number[];
  };
  itemLevel: number | null;
  consumables: { potions: number; healthstones: number } | null;
  deaths: { count: number; groupTotal: number; events: DeathEvent[] };
  damageTaken: { total: number; dtps: number; peer: PeerComparison | null };
  interrupts: {
    count: number;
    kickCooldownS: number | null; // null = spec has no kick (or unknown spec)
    capacity: number | null;      // fightDuration / kickCooldownS
    usage: number | null;         // count / capacity
    peer: PeerComparison | null;  // peers compared on usage
    enemyCasts?: EnemyCast[];     // absent without an Interrupts table, and on payloads saved before 2026-10
  };
  dispels: { count: number; available: boolean }; // available=false: the kit has no dispel/purge at all
  avoidableDamage: {
    total: number;
    perMinute: number;
    peer: PeerComparison | null;  // on perMinute
    spellCount: number;
    abilities?: AbilityDamage[];  // the player's top five avoidable abilities
    other?: number;               // total − Σ abilities (WCL's top-five cap)
  } | null;                       // null = no list for this dungeon
  control?: RunControl;           // absent when the run's crowd control was never fetched
  fightDurationMs: number;
  partial?: boolean;              // fights[0] missing: keystone came from ranking data
}

export interface RioRun {
  dungeon: string;
  shortName: string;
  level: number;
  completedAt: number; // epoch ms
  clearMs: number;
  parMs: number;
  chests: number;
  score: number;
  affixes: string[];
  url: string;
}

export interface RioSeasonScore {
  slug: string;
  all: number;
  dps: number;
  healer: number;
  tank: number;
}

export interface RioProfile {
  fetchedAt: number;
  lastCrawledAt: number;
  profileUrl: string;
  itemLevel: number | null;
  activeSpec: string | null;
  activeRole: string | null;
  seasons: RioSeasonScore[]; // in the order Raider.IO returns them (current first)
  recentRuns: RioRun[];
  bestRuns: RioRun[];
  weeklyBest: RioRun[];
  derived: {
    recentTimed: number;
    recentTotal: number;
    runsLast7d: number;
    lastRunAt: number | null;
  };
}

// ---- Raw WCL shapes (only the fields we read) ----

export interface RawFight {
  id: number;
  encounterID?: number;
  keystoneLevel?: number | null;
  keystoneBonus?: number | null;
  keystoneTime?: number | null;
  keystoneAffixes?: number[] | null;
  startTime?: number;
  endTime?: number;
}

export interface RawDeathEvent {
  timestamp?: number;
  type?: string;
  ability?: { name?: string; guid?: number };
  amount?: number;
  mitigated?: number;
  unmitigatedAmount?: number;
  absorbed?: number;
  overkill?: number;
  sourceID?: number;
  sourceIsFriendly?: boolean;
}

export interface RawTableEntry {
  name: string;
  guid?: number;      // Casts / Buffs-like tables: the spell id
  total?: number;
  timestamp?: number;
  overkill?: number;
  // Deaths table only.
  deathWindow?: number;
  killingBlow?: { name?: string; guid?: number } | null;
  events?: RawDeathEvent[];
  damage?: {
    abilities?: Array<{ name: string; guid?: number; total?: number; totalReduced?: number }>;
    sources?: Array<{ name: string; total?: number }>;
  };
  // Interrupts/Dispels tables: one entry per spell, with per-player details.
  entries?: RawTableEntry[];
  details?: Array<{ name: string; total?: number }>;
  // DamageTaken entries: per-ability breakdown (top five).
  abilities?: Array<{ name: string; guid?: number; total?: number }>;
  // Interrupts table, per enemy spell.
  spellsBegun?: number;
  spellsCompleted?: number;
  spellsInterrupted?: number;
}

export interface RawTable {
  data?: {
    totalTime?: number;
    entries?: RawTableEntry[];
    composition?: Array<{
      name: string;
      id?: number;
      type?: string; // class name, e.g. "Druid"
      specs?: Array<{ spec?: string; role?: string }>;
    }>;
    playerDetails?: {
      dps?: Array<{ name: string; minItemLevel?: number; potionUse?: number; healthstoneUse?: number }>;
      healers?: Array<{ name: string; minItemLevel?: number; potionUse?: number; healthstoneUse?: number }>;
      tanks?: Array<{ name: string; minItemLevel?: number; potionUse?: number; healthstoneUse?: number }>;
    };
  };
}

export interface RawRunReport {
  code: string;
  fights?: RawFight[];
  summary?: RawTable | null;
  damageTaken?: RawTable | null;
  deaths?: RawTable | null;
  interrupts?: RawTable | null;
  dispels?: RawTable | null;
  avoidable?: RawTable | null;
}

/** One event of REPORT_RUN_CONTROL_QUERY (only the fields we read). */
export interface RawControlEvent {
  timestamp: number;
  type: string; // "applydebuff" | "cast"
  sourceID?: number;
  targetID?: number;
  targetInstance?: number;
  abilityGameID?: number;
}

/** A run's crowd-control events as fetched, cached forever in `wcl_run_control`. */
export interface RawRunControl {
  /** `CC_TABLE.version` the filter was built from: an older one marks the row stale. */
  tableVersion: string;
  pets: Array<{ id: number; petOwner: number }>;
  events: RawControlEvent[];
}
