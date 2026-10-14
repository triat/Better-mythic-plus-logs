import type { RawTable } from "../signals/types.ts";

export type DefensiveKind = "major" | "immunity" | "minor";

/** Where an effective entry comes from: the shipped table, the local override file, the hosted shared layer or the caller's own pending proposal. */
export type EntryOrigin = "shipped" | "override" | "shared" | "pending";

export interface DefensiveSpell {
  id: number;
  name: string;
  cooldownS: number;
  durationS: number; // 0 = instant (heal), never "active"
  kind: DefensiveKind;
}

/** One entry of the user override file, per "Class:Spec" / "Class:*" key. */
export interface OverrideEntry {
  id: number;
  name?: string;
  cooldownS?: number;
  durationS?: number;
  kind?: DefensiveKind;
  /** Drop this id from the effective table and from the audit's unlisted list. */
  ignore?: boolean;
  /** Set by the hosted loaders (never read from the file): the layer this entry came from. */
  origin?: Exclude<EntryOrigin, "shipped">;
}
export type Override = Record<string, OverrideEntry[]>;

/** A death-prevention heal (health potions, healthstone): no damage reduction, only health added. */
export interface HealTool {
  name: string;
  /** Every spell id that counts as a use (a cast of any of them starts the shared cooldown). */
  ids: number[];
  cooldownS: number;
  /** Health restored: a flat amount, or a share of maximum health. */
  flat?: number;
  maxHpShare?: number;
  /** Only offered when a player of this class was in the group (the Warlock's soulwell). */
  groupClass?: string;
}

export interface HealRules {
  /** In danger at or below this share of maximum health. */
  dangerHpShare: number;
  /** From the danger to the heal landing. */
  reactionMs: number;
  tools: HealTool[];
}

export interface ShippedTable {
  version: string;
  heals: HealRules;
  /** Self-cast buffs that are never defensives (potions, offensive cooldowns); hidden from the audit. */
  denylist: number[];
  specs: Record<string, DefensiveSpell[]>;
}

export interface EffectiveEntry extends DefensiveSpell {
  origin: EntryOrigin;
}

export interface SpecDefensives {
  key: string;               // "Paladin:Holy"
  entries: EffectiveEntry[]; // Class:* then Class:Spec, spec wins on same id; ignored ids removed
  ignored: number[];         // ids the override marked ignore (both keys)
  tableMissing: boolean;     // no shipped key and no override key for this class/spec
}

export interface LoadedTables {
  shipped: ShippedTable;
  override: Override;
  /** "file": the local defensives.json next to .env; "shared": the hosted DB layer (+ the caller's pending proposals). */
  source: "file" | "shared";
  overridePath: string | null; // a path iff source === "file"
  warning?: string;          // override unreadable/invalid → shipped only
}

/** Raw WCL answer for one (report, fight, character); cached forever. */
export interface RawDeepDive {
  code: string;
  fightID: number;
  character: string;
  actorID: number;
  fightStart: number;        // report-relative ms
  fightEnd: number;
  casts: RawTable | null;    // table(dataType: Casts, sourceID)
  buffs: { data?: { auras?: Array<{ guid: number; name: string; totalUptime?: number; totalUses?: number }> } } | null;
  castEvents: Array<{ timestamp: number; abilityGameID: number; sourceID?: number; targetID?: number }>;
  tableIds: number[];        // ids the events were filtered on
  /** The player's health before each of their deaths (damage and healing events with unit resources); absent on rows
   *  fetched before 2026-10-14, null entries when WCL returned no resources. */
  deathHealth?: DeathHealth[];
  truncated: boolean;        // > 5 event pages
  fetchedAt: number;
  pointsSpent: number | null;
}

export interface DefensiveUse extends DefensiveSpell {
  casts: number;
  capacity: number;
  usage: number;
  observedMinIntervalS: number | null;
  cdMismatch: boolean;
  origin: EntryOrigin;
  /** Fight-relative ms of each cast with an event (empty for an id added after the fetch: table total only). */
  castsAtMs: number[];
}

/** Health over the seconds before one death. Report-relative timestamps, health after each event. */
export interface DeathHealth {
  deathTs: number;
  maxHp: number | null;
  curve: Array<{ ts: number; hp: number }>;
}

export type DeathVerdict =
  | "unpreventable" | "immunity available" | "defensive available" | "heal available" | "covered" | "nothing available";

/** A heal tool at one death: `saves` = ready in time and enough; the other states say why not. */
export interface HealAtDeath {
  name: string;
  status: "saves" | "no time" | "not enough" | "on cooldown" | "not in group";
  /** Health it would have restored (capped by the room under max health); null when not judged. */
  heal: number | null;
  readyInS?: number;
}

export interface DeathAnalysis {
  atMs: number;
  inWipe: boolean;
  killingHits: { id: number | null; name: string; amount: number; share: number }[]; // id = WCL spell guid (Wowhead link)
  killingBlow: string | null;
  available: string[];
  active: string[];
  onCooldown: { name: string; readyInS: number }[];
  verdict: DeathVerdict;
  /** Absent on analyses without health data (rows fetched before 2026-10-14): heals and one-shots not judged. */
  health?: {
    maxHp: number;
    /** Health just before the killing hit. */
    hpBefore: number;
    /** The killing hit, overkill included. */
    killingHit: number;
    overkill: number;
    /** ms between the danger line crossing and the death; null when the player was never in danger before the hit. */
    dangerMs: number | null;
    oneShot: boolean;
  };
  instakill?: boolean;
  heals?: HealAtDeath[];
}

export interface RunDefensives {
  reportCode: string;
  fightID: number;
  character: string;
  className: string;
  spec: string;
  tableMissing: boolean;
  tableVersion: string;
  defensives: DefensiveUse[];
  deaths: DeathAnalysis[];
  majorUsage: number | null;
  avoidableDeaths: number;
  countedDeaths: number;
  unlisted: { id: number; name: string; casts: number; uptimeS: number }[];
  /** The effective table now has ids the raw row was not filtered on — re-analyze to see them. */
  staleTable: boolean;
  /** A death has no health data (a row fetched before 2026-10-14, or a failed health request): heals and one-shots are
   *  not judged for it — re-analyze to see them. */
  healthMissing?: boolean;
  truncated: boolean;
  fetchedAt: number;
  pointsSpent: number | null;
}

export interface DeepdiveSummary {
  /** The user's defensives.json was ignored (unreadable/invalid): the message names the file and the error. */
  tableWarning: string | null;
  analyzedRuns: number;
  majorUsage: number | null;
  avoidableDeathShare: number | null;
  avoidableDeaths: number;
  countedDeaths: number;
}
