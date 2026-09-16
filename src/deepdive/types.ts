import type { RawTable } from "../signals/types.ts";

export type DefensiveKind = "major" | "immunity" | "minor";

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
}
export type Override = Record<string, OverrideEntry[]>;

export interface ShippedTable {
  version: string;
  /** Self-cast buffs that are never defensives (potions, offensive cooldowns); hidden from the audit. */
  denylist: number[];
  specs: Record<string, DefensiveSpell[]>;
}

export interface EffectiveEntry extends DefensiveSpell {
  origin: "shipped" | "override";
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
  overridePath: string;
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
  origin: "shipped" | "override";
}

export type DeathVerdict = "immunity available" | "defensive available" | "covered" | "nothing available";

export interface DeathAnalysis {
  atMs: number;
  inWipe: boolean;
  killingHits: { name: string; amount: number; share: number }[];
  killingBlow: string | null;
  available: string[];
  active: string[];
  onCooldown: { name: string; readyInS: number }[];
  verdict: DeathVerdict;
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
