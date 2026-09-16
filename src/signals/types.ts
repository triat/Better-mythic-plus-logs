export type GroupRole = "dps" | "healer" | "tank" | "unknown";

export interface PeerComparison {
  median: number;
  count: number;
}

export interface DeathEvent {
  atMs: number;          // ms since fight start
  cause: string | null;  // top ability in the death window
  source: string | null; // top damage source (NPC name)
  overkill: number;
  inWipe: boolean;       // >= 3 group deaths within ±15 s of this one (self included)
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
  };
  dispels: { count: number; available: boolean }; // available=false: the kit has no dispel/purge at all
  avoidableDamage: {
    total: number;
    perMinute: number;
    peer: PeerComparison | null;  // on perMinute
    spellCount: number;
  } | null;                       // null = no list for this dungeon
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
