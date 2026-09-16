# Run Deep-Dive (Defensive Cooldowns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On demand, per run, measure how a player used their personal defensive cooldowns (usage vs capacity) and whether each death happened with a defensive available — cached forever, explainable, correctable from the UI, and feeding two new Survival sub-signals.

**Architecture:** A curated per-spec defensives table (`src/deepdive/defensives.json`) plus a user override file is the source of truth. One WCL GraphQL request per run (Casts table + Buffs table + filtered cast events, ~3 pts) is stored raw in a new SQLite table; a pure analyzer turns raw + the already-cached run report into `RunDefensives` (usage, deaths with availability verdicts, audit of unlisted self-buffs). The lookup payload carries the analyses of displayed runs (0 pts) and the evaluation gains `defensiveUsage` / `avoidableDeaths`. Server routes, CLI commands and a Detail-panel UI expose it.

**Tech Stack:** Bun 1.3.4 (`bun test`, `bun:sqlite`), TypeScript strict, Vite 8 + React 19 in `web/`, `just` recipes.

**Spec:** `docs/superpowers/specs/2026-09-16-run-deep-dive-design.md`

## Global Constraints

- Never automatic: no lookup ever spends deep-dive points; only `POST /api/deepdive` and `bmpl analyze` fetch.
- One GraphQL request per analyzed run: `Casts` table (sourceID) + `Buffs` table (targetID) + `events(dataType: Casts, filterExpression: "ability.id in (…)", limit: 500)` — never a per-death query.
- Raw results cached forever in SQLite table `wcl_deepdive` with `DEEPDIVE_QUERY_VERSION = 1`; analysis is always recomputed from raw (never cached).
- Budget guard: refuse with 402 when `limitPerHour − pointsSpentThisHour < 20`.
- Table keys are `Class:Spec` / `Class:*` with WCL's spacing-free class names (`DeathKnight`, `DemonHunter`), exactly like `src/signals/kick-cooldowns.ts`.
- `kind`: `major` and `immunity` count toward usage; `minor` never drives usage or the verdict. `durationS: 0` = instant, never *active*.
- Capacity = `max(1, ceil(fightDurationS / cooldownS))`; usage = `min(1, casts / capacity)`; `cdMismatch` = `observedMinIntervalS < 0.9 × cooldownS`.
- Death windows are inclusive: active if a cast in `[atMs − durationS×1000, atMs]`; available if no cast in the half-open window `(atMs − cooldownS×1000, atMs]` and not active (a cast exactly one cooldown before the death is available again).
- Verdict precedence: immunity available → `immunity available`; else major available and nothing active → `defensive available`; else anything active → `covered`; else `nothing available`.
- Wipe deaths (`inWipe`) are analyzed but excluded from `avoidableDeaths` / `countedDeaths`.
- Survival sub-signals `defensiveUsage` (curve `[[0,20],[0.3,55],[0.6,85],[0.9,100]]`, weights 2/2/2) and `avoidableDeaths` (curve `[[0,100],[0.34,60],[0.67,30],[1,10]]`, weights 3/3/3) are `null` unless `analyzedRuns ≥ cfg.confidence.deepdiveMinRuns` (default 2); `avoidableDeaths` also null when Σ countedDeaths = 0.
- Web front: types-only imports from `src/` (`@shared/*`), except runtime `src/wow/classes.ts`; pure tested view models in `web/src/lib/*`; all UI strings English.
- Commits: `git commit` messages end (after a blank line) with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`. Never stage `biwaasham.json`. Never rewrite history.
- `just check` (tsc for CLI + web) and `bun test` must pass at the end of every task.

## File structure

| File | Responsibility |
|---|---|
| `src/deepdive/types.ts` | Shared types: `DefensiveSpell`, `OverrideEntry`, `RawDeepDive`, `DefensiveUse`, `DeathAnalysis`, `RunDefensives`, `DeepdiveSummary` |
| `src/deepdive/defensives.json` | Shipped table (`version`, `denylist`, `specs`) |
| `src/deepdive/table.ts` | Merge shipped ⊕ override, validation, patching, load/save of the override file |
| `src/deepdive/player.ts` | `playerOf(report, character)` → actor id / class / spec from the cached run report |
| `src/deepdive/wcl.ts` | `fetchRawDeepDive` — the one network call (+ events pagination) |
| `src/deepdive/analyze.ts` | `analyzeRun` — pure |
| `src/deepdive/aggregate.ts` | `deepdiveSummary` — pure |
| `src/deepdive/attach.ts` | `attachDeepdive(payload, store, tables)` — analyses of displayed runs from the store (0 pts) |
| `src/signals/store.ts` | + `wcl_deepdive` table, `getDeepDive` / `putDeepDive` |
| `src/signals/types.ts` | + optional fields on raw deaths entries / composition `id` |
| `src/wcl/queries.ts` | + `REPORT_DEEPDIVE_QUERY` |
| `src/setup.ts` | + `resolveDefensivesPath()` |
| `src/evaluation/*` | + `deepdive` in `EvalPayload`, two sub-signals, `deepdiveMinRuns`, `analyzedRuns` |
| `src/lookup.ts` | payload gains `deepdive` + `deepdiveSummary` |
| `src/server.ts` | `POST /api/deepdive`, `GET/POST /api/defensives`, history refresh |
| `src/cli.ts`, `src/format-mplus.ts` | `bmpl analyze`, `bmpl defensives`, run line |
| `scripts/capture-deepdive.ts` | Fixture capture (real WCL, ~3 pts per run) |
| `web/src/lib/deepdive.ts` | View model for the panel, cost estimate, compare cell |
| `web/src/components/RunDeepDive.tsx` | Expandable per-run panel with correction actions |
| `web/src/components/DungeonRuns.tsx`, `App.tsx`, `AxisRows.tsx`, `lib/axes.ts`, `lib/compare.ts`, `api.ts`, `types.ts`, `styles/app.css` | Wiring |

---

### Task 1: Types, shipped defensives table, table module

**Files:**
- Create: `src/deepdive/types.ts`, `src/deepdive/defensives.json`, `src/deepdive/table.ts`
- Modify: `src/setup.ts` (add `resolveDefensivesPath`)
- Test: `test/deepdive/table.test.ts`

**Interfaces:**
- Produces: everything in `src/deepdive/types.ts` below; `specKey(className, spec)`, `specDefensives(shipped, override, className, spec): SpecDefensives`, `validateOverride(obj): Override`, `applyPatch(override, key, patch, effective): Override`, `loadDefensives(): Promise<LoadedTables>`, `saveOverride(path, override)`, `SHIPPED: ShippedTable`.

- [ ] **Step 1: Write the types**

`src/deepdive/types.ts`:

```ts
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
  analyzedRuns: number;
  majorUsage: number | null;
  avoidableDeathShare: number | null;
  avoidableDeaths: number;
  countedDeaths: number;
}
```

- [ ] **Step 2: Write the shipped table**

`src/deepdive/defensives.json` — baseline (untalented) cooldowns, authored for the user to validate. Every `Class:Spec` key of `src/signals/kick-cooldowns.ts` is covered either directly or through `Class:*`, except `DemonHunter:Devourer` which is deliberately absent (tableMissing → the audit lists candidates).

```json
{
  "version": "mn-2.1",
  "denylist": [1236616, 31884, 190319, 12472, 1719, 13750, 51271, 375087, 191427, 106951, 191034, 384352, 10060, 32182, 2825, 80353, 264667, 390386, 1236612],
  "specs": {
    "DeathKnight:*": [
      { "id": 48707, "name": "Anti-Magic Shell", "cooldownS": 60, "durationS": 7, "kind": "major" },
      { "id": 48792, "name": "Icebound Fortitude", "cooldownS": 180, "durationS": 8, "kind": "major" },
      { "id": 49039, "name": "Lichborne", "cooldownS": 120, "durationS": 10, "kind": "minor" },
      { "id": 48743, "name": "Death Pact", "cooldownS": 120, "durationS": 0, "kind": "minor" },
      { "id": 51052, "name": "Anti-Magic Zone", "cooldownS": 120, "durationS": 8, "kind": "minor" }
    ],
    "DeathKnight:Blood": [
      { "id": 55233, "name": "Vampiric Blood", "cooldownS": 90, "durationS": 10, "kind": "major" },
      { "id": 49028, "name": "Dancing Rune Weapon", "cooldownS": 120, "durationS": 8, "kind": "major" },
      { "id": 194679, "name": "Rune Tap", "cooldownS": 25, "durationS": 4, "kind": "minor" },
      { "id": 219809, "name": "Tombstone", "cooldownS": 60, "durationS": 8, "kind": "minor" }
    ],
    "DemonHunter:Havoc": [
      { "id": 198589, "name": "Blur", "cooldownS": 60, "durationS": 10, "kind": "major" },
      { "id": 196555, "name": "Netherwalk", "cooldownS": 180, "durationS": 6, "kind": "immunity" },
      { "id": 196718, "name": "Darkness", "cooldownS": 300, "durationS": 8, "kind": "minor" }
    ],
    "DemonHunter:Vengeance": [
      { "id": 203720, "name": "Demon Spikes", "cooldownS": 20, "durationS": 6, "kind": "minor" },
      { "id": 204021, "name": "Fiery Brand", "cooldownS": 60, "durationS": 10, "kind": "major" },
      { "id": 187827, "name": "Metamorphosis", "cooldownS": 180, "durationS": 15, "kind": "major" },
      { "id": 212084, "name": "Fel Devastation", "cooldownS": 40, "durationS": 2, "kind": "minor" }
    ],
    "Druid:*": [
      { "id": 22812, "name": "Barkskin", "cooldownS": 60, "durationS": 12, "kind": "major" },
      { "id": 108238, "name": "Renewal", "cooldownS": 90, "durationS": 0, "kind": "minor" }
    ],
    "Druid:Feral": [
      { "id": 61336, "name": "Survival Instincts", "cooldownS": 180, "durationS": 6, "kind": "major" }
    ],
    "Druid:Guardian": [
      { "id": 61336, "name": "Survival Instincts", "cooldownS": 180, "durationS": 6, "kind": "major" },
      { "id": 22842, "name": "Frenzied Regeneration", "cooldownS": 36, "durationS": 3, "kind": "minor" },
      { "id": 200851, "name": "Rage of the Sleeper", "cooldownS": 90, "durationS": 10, "kind": "major" }
    ],
    "Evoker:*": [
      { "id": 363916, "name": "Obsidian Scales", "cooldownS": 90, "durationS": 12, "kind": "major" },
      { "id": 374348, "name": "Renewing Blaze", "cooldownS": 90, "durationS": 8, "kind": "major" },
      { "id": 374227, "name": "Zephyr", "cooldownS": 120, "durationS": 8, "kind": "minor" }
    ],
    "Hunter:*": [
      { "id": 264735, "name": "Survival of the Fittest", "cooldownS": 120, "durationS": 8, "kind": "major" },
      { "id": 186265, "name": "Aspect of the Turtle", "cooldownS": 180, "durationS": 8, "kind": "immunity" },
      { "id": 109304, "name": "Exhilaration", "cooldownS": 120, "durationS": 0, "kind": "minor" }
    ],
    "Mage:*": [
      { "id": 45438, "name": "Ice Block", "cooldownS": 240, "durationS": 10, "kind": "immunity" },
      { "id": 414658, "name": "Ice Cold", "cooldownS": 240, "durationS": 6, "kind": "immunity" },
      { "id": 342245, "name": "Alter Time", "cooldownS": 60, "durationS": 10, "kind": "minor" },
      { "id": 55342, "name": "Mirror Image", "cooldownS": 120, "durationS": 40, "kind": "minor" }
    ],
    "Mage:Arcane": [
      { "id": 235450, "name": "Prismatic Barrier", "cooldownS": 25, "durationS": 60, "kind": "major" },
      { "id": 110959, "name": "Greater Invisibility", "cooldownS": 120, "durationS": 3, "kind": "major" }
    ],
    "Mage:Fire": [
      { "id": 235313, "name": "Blazing Barrier", "cooldownS": 25, "durationS": 60, "kind": "major" }
    ],
    "Mage:Frost": [
      { "id": 11426, "name": "Ice Barrier", "cooldownS": 25, "durationS": 60, "kind": "major" }
    ],
    "Monk:*": [
      { "id": 115203, "name": "Fortifying Brew", "cooldownS": 180, "durationS": 15, "kind": "major" },
      { "id": 122278, "name": "Dampen Harm", "cooldownS": 120, "durationS": 10, "kind": "major" },
      { "id": 122783, "name": "Diffuse Magic", "cooldownS": 90, "durationS": 6, "kind": "major" }
    ],
    "Monk:Brewmaster": [
      { "id": 322507, "name": "Celestial Brew", "cooldownS": 60, "durationS": 8, "kind": "major" },
      { "id": 115176, "name": "Zen Meditation", "cooldownS": 300, "durationS": 8, "kind": "major" },
      { "id": 119582, "name": "Purifying Brew", "cooldownS": 20, "durationS": 0, "kind": "minor" }
    ],
    "Monk:Windwalker": [
      { "id": 122470, "name": "Touch of Karma", "cooldownS": 90, "durationS": 10, "kind": "major" }
    ],
    "Paladin:*": [
      { "id": 642, "name": "Divine Shield", "cooldownS": 300, "durationS": 8, "kind": "immunity" },
      { "id": 633, "name": "Lay on Hands", "cooldownS": 600, "durationS": 0, "kind": "major" },
      { "id": 1022, "name": "Blessing of Protection", "cooldownS": 300, "durationS": 10, "kind": "minor" }
    ],
    "Paladin:Holy": [
      { "id": 498, "name": "Divine Protection", "cooldownS": 60, "durationS": 8, "kind": "major" },
      { "id": 31821, "name": "Aura Mastery", "cooldownS": 180, "durationS": 8, "kind": "minor" }
    ],
    "Paladin:Protection": [
      { "id": 31850, "name": "Ardent Defender", "cooldownS": 120, "durationS": 8, "kind": "major" },
      { "id": 86659, "name": "Guardian of Ancient Kings", "cooldownS": 300, "durationS": 8, "kind": "major" },
      { "id": 387174, "name": "Eye of Tyr", "cooldownS": 60, "durationS": 9, "kind": "minor" }
    ],
    "Paladin:Retribution": [
      { "id": 403876, "name": "Divine Protection", "cooldownS": 60, "durationS": 8, "kind": "major" },
      { "id": 184662, "name": "Shield of Vengeance", "cooldownS": 90, "durationS": 15, "kind": "major" }
    ],
    "Priest:*": [
      { "id": 19236, "name": "Desperate Prayer", "cooldownS": 90, "durationS": 10, "kind": "major" },
      { "id": 586, "name": "Fade", "cooldownS": 30, "durationS": 10, "kind": "minor" }
    ],
    "Priest:Shadow": [
      { "id": 47585, "name": "Dispersion", "cooldownS": 120, "durationS": 6, "kind": "major" }
    ],
    "Priest:Discipline": [
      { "id": 33206, "name": "Pain Suppression", "cooldownS": 90, "durationS": 8, "kind": "minor" }
    ],
    "Priest:Holy": [
      { "id": 47788, "name": "Guardian Spirit", "cooldownS": 180, "durationS": 10, "kind": "minor" }
    ],
    "Rogue:*": [
      { "id": 31224, "name": "Cloak of Shadows", "cooldownS": 120, "durationS": 5, "kind": "immunity" },
      { "id": 5277, "name": "Evasion", "cooldownS": 120, "durationS": 10, "kind": "major" },
      { "id": 185311, "name": "Crimson Vial", "cooldownS": 30, "durationS": 4, "kind": "minor" },
      { "id": 1966, "name": "Feint", "cooldownS": 15, "durationS": 6, "kind": "minor" }
    ],
    "Shaman:*": [
      { "id": 108271, "name": "Astral Shift", "cooldownS": 120, "durationS": 12, "kind": "major" },
      { "id": 108270, "name": "Stone Bulwark Totem", "cooldownS": 180, "durationS": 30, "kind": "major" },
      { "id": 198103, "name": "Earth Elemental", "cooldownS": 300, "durationS": 60, "kind": "minor" }
    ],
    "Warlock:*": [
      { "id": 104773, "name": "Unending Resolve", "cooldownS": 180, "durationS": 8, "kind": "major" },
      { "id": 108416, "name": "Dark Pact", "cooldownS": 60, "durationS": 20, "kind": "major" },
      { "id": 6789, "name": "Mortal Coil", "cooldownS": 45, "durationS": 0, "kind": "minor" }
    ],
    "Warrior:*": [
      { "id": 23920, "name": "Spell Reflection", "cooldownS": 25, "durationS": 5, "kind": "minor" },
      { "id": 97462, "name": "Rallying Cry", "cooldownS": 180, "durationS": 10, "kind": "minor" },
      { "id": 383762, "name": "Bitter Immunity", "cooldownS": 180, "durationS": 0, "kind": "minor" }
    ],
    "Warrior:Arms": [
      { "id": 118038, "name": "Die by the Sword", "cooldownS": 120, "durationS": 8, "kind": "major" }
    ],
    "Warrior:Fury": [
      { "id": 184364, "name": "Enraged Regeneration", "cooldownS": 120, "durationS": 8, "kind": "major" }
    ],
    "Warrior:Protection": [
      { "id": 871, "name": "Shield Wall", "cooldownS": 240, "durationS": 8, "kind": "major" },
      { "id": 12975, "name": "Last Stand", "cooldownS": 180, "durationS": 15, "kind": "major" },
      { "id": 1160, "name": "Demoralizing Shout", "cooldownS": 45, "durationS": 8, "kind": "minor" }
    ]
  }
}
```

(`denylist` ids: Light's Potential 1236616, Avenging Wrath 31884, Bloodlust/Heroism/Time Warp family, Berserking, Blood Fury, Arcane Torrent, Fireblood, Ancestral Call, Bag of Tricks, Tempered Potion 1236612 — all self-buffs that show up in the Buffs table but are not defensives.)

- [ ] **Step 3: Add the override path resolver**

Append to `src/setup.ts`:

```ts
/** User override for the defensives table: BMPL_DEFENSIVES, else `defensives.json` next to .env. May not exist. */
export async function resolveDefensivesPath(): Promise<string> {
  const override = (process.env.BMPL_DEFENSIVES ?? "").trim();
  if (override) return override;
  return path.join(path.dirname(await resolveEnvPath()), "defensives.json");
}
```

- [ ] **Step 4: Write the failing tests**

`test/deepdive/table.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED, applyPatch, loadDefensives, saveOverride, specDefensives, specKey, validateOverride } from "../../src/deepdive/table.ts";
import type { Override } from "../../src/deepdive/types.ts";

describe("shipped table", () => {
  test("covers every kick-table spec except Devourer, with valid entries", () => {
    const specs = Object.keys(SHIPPED.specs);
    expect(specs).toContain("Paladin:*");
    expect(specs).toContain("Paladin:Holy");
    for (const [key, entries] of Object.entries(SHIPPED.specs)) {
      expect(key).toMatch(/^[A-Za-z]+:(\*|[A-Za-z]+)$/);
      for (const e of entries) {
        expect(e.id).toBeGreaterThan(0);
        expect(e.cooldownS).toBeGreaterThan(0);
        expect(e.durationS).toBeGreaterThanOrEqual(0);
        expect(["major", "immunity", "minor"]).toContain(e.kind);
      }
    }
    expect(specDefensives(SHIPPED, {}, "Demon Hunter", "Devourer").tableMissing).toBe(true);
    expect(specDefensives(SHIPPED, {}, "DeathKnight", "Frost").tableMissing).toBe(false);
  });
});

describe("specKey / specDefensives", () => {
  test("normalizes class spacing", () => {
    expect(specKey("Death Knight", "Blood")).toBe("DeathKnight:Blood");
    expect(specKey("Paladin", "*")).toBe("Paladin:*");
  });
  test("merges Class:* then Class:Spec; spec wins on the same id", () => {
    const d = specDefensives(SHIPPED, {}, "Druid", "Guardian");
    const ids = d.entries.map((e) => e.id);
    expect(ids).toContain(22812);   // Barkskin from Druid:*
    expect(ids).toContain(61336);   // Survival Instincts from Druid:Guardian
    expect(ids.filter((i) => i === 61336).length).toBe(1);
    expect(d.entries.every((e) => e.origin === "shipped")).toBe(true);
  });
  test("override patches, adds, ignores", () => {
    const override: Override = {
      "Paladin:Holy": [
        { id: 498, cooldownS: 30 },
        { id: 642, ignore: true },
        { id: 999999, name: "Test Spell", cooldownS: 90, durationS: 6, kind: "major" },
      ],
    };
    const d = specDefensives(SHIPPED, override, "Paladin", "Holy");
    const dp = d.entries.find((e) => e.id === 498)!;
    expect(dp.cooldownS).toBe(30);
    expect(dp.name).toBe("Divine Protection");
    expect(dp.origin).toBe("override");
    expect(d.entries.find((e) => e.id === 642)).toBeUndefined();
    expect(d.ignored).toEqual([642]);
    const added = d.entries.find((e) => e.id === 999999)!;
    expect(added.kind).toBe("major");
    expect(added.origin).toBe("override");
    expect(d.tableMissing).toBe(false);
  });
  test("override alone makes a missing spec present", () => {
    const d = specDefensives(SHIPPED, { "DemonHunter:Devourer": [{ id: 1, name: "X", cooldownS: 60, durationS: 5, kind: "major" }] }, "DemonHunter", "Devourer");
    expect(d.tableMissing).toBe(false);
    expect(d.entries.length).toBe(1);
  });
});

describe("validateOverride", () => {
  test("accepts the documented shapes", () => {
    expect(() => validateOverride({ "Paladin:Holy": [{ id: 498, cooldownS: 30 }, { id: 1, ignore: true }] })).not.toThrow();
  });
  test("rejects bad keys, ids and kinds with the path in the message", () => {
    expect(() => validateOverride({ "Paladin": [] })).toThrow(/Paladin/);
    expect(() => validateOverride({ "Paladin:Holy": [{ id: "x" }] })).toThrow(/Paladin:Holy.*id/);
    expect(() => validateOverride({ "Paladin:Holy": [{ id: 1, kind: "huge" }] })).toThrow(/kind/);
    expect(() => validateOverride([])).toThrow(/object/);
  });
});

describe("applyPatch", () => {
  const effective = specDefensives(SHIPPED, {}, "Paladin", "Holy");
  test("patching a known id keeps only the changed fields in the override", () => {
    const o = applyPatch({}, "Paladin:Holy", { id: 498, cooldownS: 45 }, effective);
    expect(o).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] });
    const o2 = applyPatch(o, "Paladin:Holy", { id: 498, durationS: 9 }, effective);
    expect(o2["Paladin:Holy"]).toEqual([{ id: 498, cooldownS: 45, durationS: 9 }]);
  });
  test("ignore replaces any previous patch for that id", () => {
    const o = applyPatch({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] }, "Paladin:Holy", { id: 498, ignore: true }, effective);
    expect(o["Paladin:Holy"]).toEqual([{ id: 498, ignore: true }]);
  });
  test("adding an unknown id requires name, cooldownS, durationS and kind", () => {
    expect(() => applyPatch({}, "Paladin:Holy", { id: 424242, cooldownS: 60 }, effective)).toThrow(/424242/);
    const o = applyPatch({}, "Paladin:Holy", { id: 424242, name: "New", cooldownS: 60, durationS: 5, kind: "minor" }, effective);
    expect(o["Paladin:Holy"]![0]!.name).toBe("New");
  });
});

describe("loadDefensives / saveOverride", () => {
  test("round trip through a temp file; invalid JSON yields a warning and shipped only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-def-"));
    const p = join(dir, "defensives.json");
    try {
      process.env.BMPL_DEFENSIVES = p;
      const empty = await loadDefensives();
      expect(empty.override).toEqual({});
      expect(empty.overridePath).toBe(p);
      await saveOverride(p, { "Paladin:Holy": [{ id: 498, cooldownS: 30 }] });
      const loaded = await loadDefensives();
      expect(loaded.override["Paladin:Holy"]![0]!.cooldownS).toBe(30);
      expect(loaded.warning).toBeUndefined();
      writeFileSync(p, "{ not json");
      const broken = await loadDefensives();
      expect(broken.override).toEqual({});
      expect(broken.warning).toMatch(/defensives\.json/);
    } finally {
      delete process.env.BMPL_DEFENSIVES;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `bun test test/deepdive/table.test.ts`
Expected: FAIL — cannot resolve `../../src/deepdive/table.ts`.

- [ ] **Step 6: Implement `src/deepdive/table.ts`**

```ts
import shippedJson from "./defensives.json" with { type: "json" };
import { resolveDefensivesPath } from "../setup.ts";
import type { DefensiveKind, DefensiveSpell, EffectiveEntry, LoadedTables, Override, OverrideEntry, ShippedTable, SpecDefensives } from "./types.ts";

export const SHIPPED = shippedJson as ShippedTable;

const KINDS: readonly DefensiveKind[] = ["major", "immunity", "minor"];
const KEY_RE = /^[A-Za-z]+:(\*|[A-Za-z]+)$/;

/** WCL reports multi-word classes without spaces ("DeathKnight"); normalize so "Death Knight" matches too. */
export const specKey = (className: string, spec: string): string => `${className.replace(/\s+/g, "")}:${spec.replace(/\s+/g, "")}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (msg: string): never => { throw new Error(`defensives override: ${msg}`); };

function validateEntry(e: unknown, path: string): OverrideEntry {
  if (!isObj(e)) return fail(`${path}: must be an object`);
  if (typeof e.id !== "number" || !Number.isInteger(e.id) || e.id <= 0) return fail(`${path}: id must be a positive integer`);
  const out: OverrideEntry = { id: e.id };
  if (e.ignore !== undefined) { if (typeof e.ignore !== "boolean") return fail(`${path}: ignore must be a boolean`); out.ignore = e.ignore; }
  if (e.name !== undefined) { if (typeof e.name !== "string" || !e.name.trim()) return fail(`${path}: name must be a non-empty string`); out.name = e.name; }
  for (const k of ["cooldownS", "durationS"] as const) {
    if (e[k] !== undefined) {
      if (typeof e[k] !== "number" || !Number.isFinite(e[k]) || (e[k] as number) < 0 || (k === "cooldownS" && (e[k] as number) === 0)) return fail(`${path}: ${k} must be a ${k === "cooldownS" ? "positive" : "non-negative"} number`);
      out[k] = e[k] as number;
    }
  }
  if (e.kind !== undefined) { if (!KINDS.includes(e.kind as DefensiveKind)) return fail(`${path}: kind must be one of ${KINDS.join(", ")}`); out.kind = e.kind as DefensiveKind; }
  return out;
}

/** Structural validation; throws with the offending key/id in the message. */
export function validateOverride(obj: unknown): Override {
  if (!isObj(obj)) return fail("must be an object keyed by \"Class:Spec\"");
  const out: Override = {};
  for (const [key, list] of Object.entries(obj)) {
    if (!KEY_RE.test(key)) return fail(`key "${key}" must look like "Class:Spec" or "Class:*"`);
    if (!Array.isArray(list)) return fail(`${key}: must be an array`);
    out[key] = list.map((e, i) => validateEntry(e, `${key}[${i}]${isObj(e) && typeof e.id === "number" ? ` (id ${e.id})` : ""}`));
  }
  return out;
}

const complete = (e: OverrideEntry): e is OverrideEntry & DefensiveSpell =>
  typeof e.name === "string" && typeof e.cooldownS === "number" && typeof e.durationS === "number" && e.kind !== undefined;

/** Effective list for a class/spec: shipped Class:* ⊕ Class:Spec, then override entries of both keys. */
export function specDefensives(shipped: ShippedTable, override: Override, className: string, spec: string): SpecDefensives {
  const key = specKey(className, spec);
  const starKey = specKey(className, "*");
  const keys = [starKey, key];
  const byId = new Map<number, EffectiveEntry>();
  let present = false;
  for (const k of keys) {
    const list = shipped.specs[k];
    if (!list) continue;
    present = true;
    for (const e of list) byId.set(e.id, { ...e, origin: "shipped" });
  }
  const ignored: number[] = [];
  for (const k of keys) {
    const list = override[k];
    if (!list) continue;
    present = true;
    for (const e of list) {
      if (e.ignore) { byId.delete(e.id); if (!ignored.includes(e.id)) ignored.push(e.id); continue; }
      const cur = byId.get(e.id);
      if (cur) {
        byId.set(e.id, { ...cur, ...(e.name !== undefined ? { name: e.name } : {}), ...(e.cooldownS !== undefined ? { cooldownS: e.cooldownS } : {}), ...(e.durationS !== undefined ? { durationS: e.durationS } : {}), ...(e.kind !== undefined ? { kind: e.kind } : {}), origin: "override" });
      } else if (complete(e)) {
        byId.set(e.id, { id: e.id, name: e.name, cooldownS: e.cooldownS, durationS: e.durationS, kind: e.kind, origin: "override" });
      }
      // An incomplete entry for an unknown id is ignored here; applyPatch/validate refuse to write one.
    }
  }
  return { key, entries: [...byId.values()], ignored, tableMissing: !present };
}

/**
 * Pure: returns a new override with `patch` merged under `key`. A known id (in `effective`)
 * keeps only the patched fields; `ignore` replaces any earlier patch; an unknown id must be complete.
 */
export function applyPatch(override: Override, key: string, patch: OverrideEntry, effective: SpecDefensives): Override {
  if (!KEY_RE.test(key)) fail(`key "${key}" must look like "Class:Spec" or "Class:*"`);
  const known = effective.entries.some((e) => e.id === patch.id) || effective.ignored.includes(patch.id);
  const list = [...(override[key] ?? [])];
  const idx = list.findIndex((e) => e.id === patch.id);
  let next: OverrideEntry;
  if (patch.ignore) next = { id: patch.id, ignore: true };
  else {
    const prev = idx >= 0 && !list[idx]!.ignore ? list[idx]! : { id: patch.id };
    const { ignore: _i, ...fields } = patch;
    next = { ...prev, ...fields };
    if (!known && !complete(next)) fail(`id ${patch.id} is not in the table for ${key}: name, cooldownS, durationS and kind are required to add it`);
  }
  if (idx >= 0) list[idx] = next; else list.push(next);
  return { ...override, [key]: list };
}

export async function saveOverride(path: string, override: Override): Promise<void> {
  await Bun.write(path, JSON.stringify(override, null, 2) + "\n");
}

/** Shipped table + the user's override file (if any). Never throws: a bad file yields a warning. */
export async function loadDefensives(): Promise<LoadedTables> {
  const overridePath = await resolveDefensivesPath();
  const file = Bun.file(overridePath);
  if (!(await file.exists())) return { shipped: SHIPPED, override: {}, overridePath };
  try {
    return { shipped: SHIPPED, override: validateOverride(JSON.parse(await file.text())), overridePath };
  } catch (e) {
    return { shipped: SHIPPED, override: {}, overridePath, warning: `bmpl: ignoring ${overridePath}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

- [ ] **Step 7: Run the tests**

Run: `bun test test/deepdive/table.test.ts && just check`
Expected: PASS; tsc clean (JSON import with `with { type: "json" }` needs `"resolveJsonModule": true` — check `tsconfig.json`; `src/evaluation/config.ts` already imports `default-config.json`, so it is enabled).

- [ ] **Step 8: Commit**

```bash
git add src/deepdive/types.ts src/deepdive/defensives.json src/deepdive/table.ts src/setup.ts test/deepdive/table.test.ts
git commit -m "feat(deepdive): defensives table, user override merge and validation"
```

---

### Task 2: Raw types, store table, player resolution

**Files:**
- Modify: `src/signals/types.ts` (composition `id`, deaths entry fields), `src/signals/store.ts` (`wcl_deepdive`)
- Create: `src/deepdive/player.ts`
- Test: `test/deepdive/store.test.ts`, `test/deepdive/player.test.ts`

**Interfaces:**
- Consumes: `RawDeepDive` (Task 1).
- Produces: `Store.getDeepDive(code, fightID, character): RawDeepDive | null`, `Store.putDeepDive(code, fightID, character, raw): void`, `DEEPDIVE_QUERY_VERSION = 1`; `playerOf(report, character): { actorID: number; className: string; spec: string } | null`.

- [ ] **Step 1: Extend the raw types**

In `src/signals/types.ts`, change `RawTableEntry` and `RawTable.data.composition`:

```ts
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
```

and in `composition`: `{ name: string; id?: number; type?: string; specs?: Array<{ spec?: string; role?: string }> }`.

- [ ] **Step 2: Write the failing store test**

`test/deepdive/store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { openStore } from "../../src/signals/store.ts";
import type { RawDeepDive } from "../../src/deepdive/types.ts";

const raw = (over: Partial<RawDeepDive> = {}): RawDeepDive => ({
  code: "ABC", fightID: 3, character: "Muleyoxo", actorID: 1, fightStart: 0, fightEnd: 1000,
  casts: null, buffs: null, castEvents: [], tableIds: [498], truncated: false, fetchedAt: 1, pointsSpent: 3, ...over,
});

describe("store: wcl_deepdive", () => {
  test("round trip keyed by report, fight and character", () => {
    const s = openStore(":memory:");
    expect(s.getDeepDive("ABC", 3, "Muleyoxo")).toBeNull();
    s.putDeepDive("ABC", 3, "Muleyoxo", raw());
    expect(s.getDeepDive("ABC", 3, "Muleyoxo")?.actorID).toBe(1);
    expect(s.getDeepDive("ABC", 3, "Other")).toBeNull();
    s.putDeepDive("ABC", 3, "Muleyoxo", raw({ actorID: 7 }));
    expect(s.getDeepDive("ABC", 3, "Muleyoxo")?.actorID).toBe(7);
    s.close();
  });
  test("rows from another query version are ignored", () => {
    const s = openStore(":memory:");
    s._db.run("INSERT INTO wcl_deepdive (report_code, fight_id, character, query_version, fetched_at, json) VALUES ('X', 1, 'A', 0, 0, '{}')");
    expect(s.getDeepDive("X", 1, "A")).toBeNull();
    s.close();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/deepdive/store.test.ts`
Expected: FAIL — `s.getDeepDive is not a function`.

- [ ] **Step 4: Add the table to the store**

In `src/signals/store.ts`: add `export const DEEPDIVE_QUERY_VERSION = 1;` under `QUERY_VERSION` with the comment `// Bump when REPORT_DEEPDIVE_QUERY changes shape (not when the defensives table changes: analysis is recomputed from raw rows).`; import `type { RawDeepDive } from "../deepdive/types.ts"`; add to the `Store` interface:

```ts
  getDeepDive(code: string, fightID: number, character: string): RawDeepDive | null;
  putDeepDive(code: string, fightID: number, character: string, raw: RawDeepDive): void;
```

Append to `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS wcl_deepdive (
  report_code   TEXT    NOT NULL,
  fight_id      INTEGER NOT NULL,
  character     TEXT    NOT NULL,
  query_version INTEGER NOT NULL,
  fetched_at    INTEGER NOT NULL,
  json          TEXT    NOT NULL,
  PRIMARY KEY (report_code, fight_id, character)
);
```

Prepared statements and methods, next to the run ones:

```ts
  const getDd = db.query<{ json: string }, [string, number, string, number]>(
    "SELECT json FROM wcl_deepdive WHERE report_code = ? AND fight_id = ? AND character = ? AND query_version = ?",
  );
  const putDd = db.query(
    "INSERT OR REPLACE INTO wcl_deepdive (report_code, fight_id, character, query_version, fetched_at, json) VALUES (?, ?, ?, ?, ?, ?)",
  );
  …
    getDeepDive(code, fightID, character) {
      const row = getDd.get(code, fightID, character, DEEPDIVE_QUERY_VERSION);
      return row ? (JSON.parse(row.json) as RawDeepDive) : null;
    },
    putDeepDive(code, fightID, character, raw) {
      putDd.run(code, fightID, character, DEEPDIVE_QUERY_VERSION, Date.now(), JSON.stringify(raw));
    },
```

- [ ] **Step 5: Write the failing player test**

`test/deepdive/player.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { playerOf } from "../../src/deepdive/player.ts";
import { loadWclFixture } from "../fixtures.ts";

describe("playerOf", () => {
  test("resolves actor id, class and spec from the cached summary composition", async () => {
    const f = await loadWclFixture("s2-healer");
    expect(playerOf(f.report, f.character)).toEqual({ actorID: 1, className: "Paladin", spec: "Holy" });
    expect(playerOf(f.report, "Nobody")).toBeNull();
    expect(playerOf({ code: "x" }, f.character)).toBeNull();
  });
});
```

- [ ] **Step 6: Implement `src/deepdive/player.ts`**

```ts
import type { RawRunReport } from "../signals/types.ts";

export interface RunPlayer { actorID: number; className: string; spec: string }

/** The character's actor id / class / spec, from the cached run's Summary composition. */
export function playerOf(report: RawRunReport | null | undefined, character: string): RunPlayer | null {
  const p = report?.summary?.data?.composition?.find((c) => c.name === character);
  if (!p || typeof p.id !== "number") return null;
  return { actorID: p.id, className: p.type ?? "", spec: p.specs?.[0]?.spec ?? "" };
}
```

- [ ] **Step 7: Run tests, typecheck, commit**

Run: `bun test test/deepdive && just check`
Expected: PASS.

```bash
git add src/signals/types.ts src/signals/store.ts src/deepdive/player.ts test/deepdive/store.test.ts test/deepdive/player.test.ts
git commit -m "feat(deepdive): raw death event types, wcl_deepdive store table, player resolution"
```

---

### Task 3: WCL fetch, capture script, real fixtures

**Files:**
- Modify: `src/wcl/queries.ts` (add `REPORT_DEEPDIVE_QUERY`)
- Create: `src/deepdive/wcl.ts`, `scripts/capture-deepdive.ts`, `test/fixtures/deepdive-s2-voidscar-arena-healer.json`, `test/fixtures/deepdive-s2-temple-of-sethraliss-rogue.json`
- Modify: `test/fixtures.ts` (loader for deep-dive fixtures)
- Test: `test/deepdive/wcl.test.ts`

**Interfaces:**
- Consumes: `RawDeepDive` (Task 1), `GqlFn` from `src/signals/enrich.ts`, `RateLimitData` from `src/wcl/types.ts`.
- Produces: `fetchRawDeepDive(gql, opts: { code, fightID, character, actorID, ids }): Promise<RawDeepDive>`, `estimateDeepdiveCost(): number` (constant 3), `loadDeepdiveFixture(name): Promise<{ character, run, report, deepdive }>`.

- [ ] **Step 1: Add the query**

Append to `src/wcl/queries.ts`:

```ts
// Deep-dive: one request per (report, fight, actor). Casts/Buffs tables (~1 pt each) plus the
// cast events of the defensives we know about (~1 pt per page; one page for a whole key).
export const REPORT_DEEPDIVE_QUERY = /* GraphQL */ `
  query ReportDeepDive($code: String!, $fightID: Int!, $actorID: Int!, $filter: String!, $startTime: Float) {
    rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
    reportData {
      report(code: $code) {
        fights(fightIDs: [$fightID]) { startTime endTime }
        casts: table(fightIDs: [$fightID], dataType: Casts, sourceID: $actorID)
        buffs: table(fightIDs: [$fightID], dataType: Buffs, targetID: $actorID)
        castEvents: events(fightIDs: [$fightID], dataType: Casts, sourceID: $actorID, filterExpression: $filter, limit: 500, startTime: $startTime) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;
```

- [ ] **Step 2: Write the failing fetch test (fake gql, pagination, budget)**

`test/deepdive/wcl.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { BudgetLowError, MAX_EVENT_PAGES, fetchRawDeepDive } from "../../src/deepdive/wcl.ts";

const page = (events: unknown[], next: number | null, spent = 10) => ({
  rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: 100 },
  reportData: { report: {
    fights: [{ startTime: 1000, endTime: 61000 }],
    casts: { data: { entries: [{ guid: 498, name: "Divine Protection", total: 2 }] } },
    buffs: { data: { auras: [{ guid: 498, name: "Divine Protection", totalUptime: 16000, totalUses: 2 }] } },
    castEvents: { data: events, nextPageTimestamp: next },
  } },
});

describe("fetchRawDeepDive", () => {
  test("one page: shapes the raw row and passes the id filter", async () => {
    const calls: Record<string, unknown>[] = [];
    const gql = async <T,>(_q: string, v?: Record<string, unknown>) => { calls.push(v!); return page([{ timestamp: 2000, type: "cast", abilityGameID: 498 }], null) as T; };
    const raw = await fetchRawDeepDive(gql, { code: "ABC", fightID: 16, character: "Muleyoxo", actorID: 1, ids: [498, 642] });
    expect(calls[0]!.filter).toBe("ability.id in (498, 642)");
    expect(calls[0]!.startTime).toBeNull();
    expect(raw.fightStart).toBe(1000);
    expect(raw.fightEnd).toBe(61000);
    expect(raw.castEvents).toEqual([{ timestamp: 2000, abilityGameID: 498, sourceID: undefined, targetID: undefined }]);
    expect(raw.tableIds).toEqual([498, 642]);
    expect(raw.truncated).toBe(false);
    expect(raw.pointsSpent).toBeNull(); // first query of the process: no baseline to diff against
  });
  test("follows nextPageTimestamp up to MAX_EVENT_PAGES and flags truncation", async () => {
    let n = 0;
    const gql = async <T,>() => { n++; return page([{ timestamp: n, type: "cast", abilityGameID: 498 }], n * 1000) as T; };
    const raw = await fetchRawDeepDive(gql, { code: "ABC", fightID: 1, character: "X", actorID: 1, ids: [498] });
    expect(n).toBe(MAX_EVENT_PAGES);
    expect(raw.castEvents.length).toBe(MAX_EVENT_PAGES);
    expect(raw.truncated).toBe(true);
  });
  test("refuses when the remaining budget is under 20 points", async () => {
    const gql = async <T,>() => page([], null, 3590) as T;
    await expect(fetchRawDeepDive(gql, { code: "ABC", fightID: 1, character: "X", actorID: 1, ids: [498] })).rejects.toBeInstanceOf(BudgetLowError);
  });
  test("measures points spent against the previous query's counter", async () => {
    let spent = 100;
    const gql = async <T,>() => { spent += 3; return page([], null, spent) as T; };
    await fetchRawDeepDive(gql, { code: "A", fightID: 1, character: "X", actorID: 1, ids: [498] });
    const second = await fetchRawDeepDive(gql, { code: "B", fightID: 1, character: "X", actorID: 1, ids: [498] });
    expect(second.pointsSpent).toBe(3);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/deepdive/wcl.test.ts`
Expected: FAIL — cannot resolve `src/deepdive/wcl.ts`.

- [ ] **Step 4: Implement `src/deepdive/wcl.ts`**

```ts
import type { GqlFn } from "../signals/enrich.ts";
import type { RawTable } from "../signals/types.ts";
import { REPORT_DEEPDIVE_QUERY } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import type { RawDeepDive } from "./types.ts";

export const MAX_EVENT_PAGES = 5;
export const MIN_BUDGET_POINTS = 20;
/** Shown before the click; the real cost is measured after. */
export const estimateDeepdiveCost = (): number => 3;

export class BudgetLowError extends Error {
  constructor(public readonly pointsLeft: number) {
    super(`WCL budget low (${Math.round(pointsLeft)} pts left this hour)`);
    this.name = "BudgetLowError";
  }
}

interface DeepDiveResponse extends RateLimitData {
  reportData: {
    report: {
      fights?: Array<{ startTime?: number; endTime?: number }>;
      casts?: RawTable | null;
      buffs?: RawDeepDive["buffs"];
      castEvents?: { data?: Array<Record<string, unknown>>; nextPageTimestamp?: number | null };
    } | null;
  };
}

export const castFilter = (ids: number[]): string => `ability.id in (${ids.join(", ")})`;

// Points spent by the previous deep-dive query in this process; the counter WCL returns is
// cumulative for the hour, so the difference between two consecutive answers is one query's cost.
let lastSpent: number | null = null;

export interface FetchOpts { code: string; fightID: number; character: string; actorID: number; ids: number[] }

/** The one network call of a deep-dive. Throws BudgetLowError before spending when the hour's budget is nearly gone. */
export async function fetchRawDeepDive(gql: GqlFn, o: FetchOpts): Promise<RawDeepDive> {
  const events: RawDeepDive["castEvents"] = [];
  let startTime: number | null = null;
  let pages = 0;
  let truncated = false;
  let first: DeepDiveResponse | null = null;
  let spentBefore = lastSpent;
  for (;;) {
    const resp = await gql<DeepDiveResponse>(REPORT_DEEPDIVE_QUERY, { code: o.code, fightID: o.fightID, actorID: o.actorID, filter: castFilter(o.ids), startTime });
    const rl = resp.rateLimitData;
    if (rl.limitPerHour - rl.pointsSpentThisHour < MIN_BUDGET_POINTS) throw new BudgetLowError(rl.limitPerHour - rl.pointsSpentThisHour);
    if (!resp.reportData.report) throw new Error(`WCL: report ${o.code} not found`);
    first ??= resp;
    pages++;
    for (const e of resp.reportData.report.castEvents?.data ?? []) {
      if (typeof e.timestamp === "number" && typeof e.abilityGameID === "number")
        events.push({ timestamp: e.timestamp, abilityGameID: e.abilityGameID, sourceID: e.sourceID as number | undefined, targetID: e.targetID as number | undefined });
    }
    const next = resp.reportData.report.castEvents?.nextPageTimestamp ?? null;
    lastSpent = rl.pointsSpentThisHour;
    if (next === null) break;
    if (pages >= MAX_EVENT_PAGES) { truncated = true; break; }
    startTime = next;
  }
  const report = first!.reportData.report!;
  const fight = report.fights?.[0];
  return {
    code: o.code,
    fightID: o.fightID,
    character: o.character,
    actorID: o.actorID,
    fightStart: fight?.startTime ?? 0,
    fightEnd: fight?.endTime ?? 0,
    casts: report.casts ?? null,
    buffs: report.buffs ?? null,
    castEvents: events,
    tableIds: [...o.ids],
    truncated,
    fetchedAt: Date.now(),
    pointsSpent: spentBefore === null || lastSpent === null ? null : Math.max(0, Math.round((lastSpent - spentBefore) * 10) / 10),
  };
}
```

Note the budget check runs on the answer of the first page (the query is already spent, ~3 pts): that is the cheapest place to read `rateLimitData` without an extra request; the server also pre-checks with the lighter `PING_QUERY` in Task 7.

- [ ] **Step 5: Run the tests**

Run: `bun test test/deepdive/wcl.test.ts`
Expected: PASS (the "measures points" test relies on module state; keep it last in the file).

- [ ] **Step 6: Write the capture script**

`scripts/capture-deepdive.ts` — reads the run from the local cache (`bmpl.db` next to `.env`) and fetches the deep-dive for real (~3 pts):

```ts
#!/usr/bin/env bun
// Usage: bun scripts/capture-deepdive.ts <Name-Realm> <reportCode> <fightID> <out.json>
// The run must already be in the local cache (do a `bmpl lookup` first). Costs ~3 WCL pts.
import { SHIPPED, loadDefensives, specDefensives } from "../src/deepdive/table.ts";
import { playerOf } from "../src/deepdive/player.ts";
import { fetchRawDeepDive } from "../src/deepdive/wcl.ts";
import { fetchMplusData } from "../src/mplus.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { parseNameRealm } from "../src/util.ts";
import { gql } from "../src/wcl/client.ts";

const [who, code, fightStr, out] = process.argv.slice(2);
if (!who || !code || !fightStr || !out) { console.error("usage: capture-deepdive <Name-Realm> <code> <fight> <out.json>"); process.exit(2); }
const target = parseNameRealm(who)!;
const fightID = Number.parseInt(fightStr, 10);
const store = await getStore();
const report = store.getWclRun(code, fightID);
if (!report) { console.error("run not in cache — run `bmpl lookup` for this character first"); process.exit(1); }
const data = await fetchMplusData(target.name, target.realm, {});
const run = data.runs.find((r) => r.reportCode === code && r.fightID === fightID);
if (!run) { console.error("run not in this character's rankings"); process.exit(1); }
const player = playerOf(report, data.character.name)!;
const { override } = await loadDefensives();
const table = specDefensives(SHIPPED, override, player.className, player.spec);
const deepdive = await fetchRawDeepDive(gql, { code, fightID, character: data.character.name, actorID: player.actorID, ids: table.entries.map((e) => e.id) });
await Bun.write(out, JSON.stringify({ character: data.character.name, run: { ...run, signals: undefined }, report, deepdive }, null, 1));
console.log(`wrote ${out}: ${deepdive.castEvents.length} cast events, ${table.entries.length} table ids, ${deepdive.pointsSpent ?? "?"} pts`);
closeStore();
```

- [ ] **Step 7: Capture the two fixtures (real network, ~6 pts total)**

Both runs are in the developer's cache from earlier lookups. If the cache misses, run the lookup first (`bun src/cli.ts lookup <Name-Realm>`), then:

```bash
bun scripts/capture-deepdive.ts Muleyoxo-Hyjal hGd6gTaqVcyLFZB8 16 test/fixtures/deepdive-s2-voidscar-arena-healer.json
bun scripts/capture-deepdive.ts Casualaddict-Kazzak 8DFkgn3LtdBcmGJ4 7 test/fixtures/deepdive-s2-temple-of-sethraliss-rogue.json
```

Expected: the healer file reports ≥ 30 cast events (Divine Protection 27, Divine Shield 5, …); the rogue file has a run with 2 deaths in `report.deaths`. If `Muleyoxo-Hyjal` is not the right realm, find it in `test/fixtures/wcl-run-s2-voidscar-arena-healer.json` (`run` has no realm; use `bmpl lookup` history or the realm in `test/fixtures/rio-profile-muleyoxo.json`).

Add to `test/fixtures.ts`:

```ts
const DEEPDIVE_FILES = {
  "s2-healer": "deepdive-s2-voidscar-arena-healer.json",
  "s2-rogue": "deepdive-s2-temple-of-sethraliss-rogue.json",
} as const;
export type DeepdiveFixtureName = keyof typeof DEEPDIVE_FILES;
// Shape: { character: string; run: MPlusRun; report: RawRunReport; deepdive: RawDeepDive }
export const loadDeepdiveFixture = async (name: DeepdiveFixtureName): Promise<any> =>
  JSON.parse(await Bun.file(path.join(dir, DEEPDIVE_FILES[name])).text());
```

- [ ] **Step 8: Typecheck and commit**

Run: `just check && bun test test/deepdive`
Expected: PASS.

```bash
git add src/wcl/queries.ts src/deepdive/wcl.ts scripts/capture-deepdive.ts test/fixtures.ts test/fixtures/deepdive-*.json test/deepdive/wcl.test.ts
git commit -m "feat(deepdive): WCL deep-dive query, fetch with pagination and budget guard, captured fixtures"
```

---

### Task 4: The analyzer

**Files:**
- Create: `src/deepdive/analyze.ts`
- Test: `test/deepdive/analyze.test.ts`

**Interfaces:**
- Consumes: `RawDeepDive`, `SpecDefensives`, `RunDefensives` (Task 1); `RawRunReport`, `RunSignals` (signals); `WIPE_WINDOW_MS`, `WIPE_MIN_DEATHS` from `src/signals/wcl-run.ts`.
- Produces: `analyzeRun(input: AnalyzeInput): RunDefensives` with `AnalyzeInput = { raw: RawDeepDive; report: RawRunReport; signals: RunSignals; character: string; className: string; spec: string; table: SpecDefensives; tableVersion: string; denylist: number[] }`; `NON_DEFENSIVE_NAME = /potion|flask|phial|food|well fed|rune|vantus|drums|healthstone|augment/i`.

- [ ] **Step 1: Write the failing tests**

`test/deepdive/analyze.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { analyzeRun, type AnalyzeInput } from "../../src/deepdive/analyze.ts";
import { SHIPPED, specDefensives } from "../../src/deepdive/table.ts";
import type { RawDeepDive, SpecDefensives } from "../../src/deepdive/types.ts";
import type { RawRunReport, RunSignals } from "../../src/signals/types.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadDeepdiveFixture } from "../fixtures.ts";

async function fixtureInput(name: "s2-healer" | "s2-rogue"): Promise<AnalyzeInput> {
  const f = await loadDeepdiveFixture(name);
  const signals = parseRunSignals(f.report, f.character, { keyLevel: f.run.keyLevel, affixes: f.run.affixes, encounterID: f.run.encounterID })!;
  const comp = f.report.summary.data.composition.find((c: { name: string }) => c.name === f.character);
  const className = comp.type as string;
  const spec = comp.specs[0].spec as string;
  return { raw: f.deepdive, report: f.report, signals, character: f.character, className, spec, table: specDefensives(SHIPPED, {}, className, spec), tableVersion: SHIPPED.version, denylist: SHIPPED.denylist };
}

// --- synthetic scaffolding -------------------------------------------------
const FIGHT_START = 10_000;
const FIGHT_MS = 600_000; // 10 min
const table: SpecDefensives = {
  key: "Test:Spec",
  tableMissing: false,
  ignored: [],
  entries: [
    { id: 1, name: "Wall", cooldownS: 120, durationS: 10, kind: "major", origin: "shipped" },
    { id: 2, name: "Bubble", cooldownS: 300, durationS: 8, kind: "immunity", origin: "shipped" },
    { id: 3, name: "Sip", cooldownS: 30, durationS: 0, kind: "minor", origin: "shipped" },
  ],
};
const synthetic = (casts: Array<[id: number, atS: number]>, deathsAtS: number[], opts: { wipe?: boolean; buffs?: Array<[number, string, number]>; castsTable?: Array<[number, string, number]> } = {}): AnalyzeInput => {
  const raw: RawDeepDive = {
    code: "SYN", fightID: 1, character: "Me", actorID: 1, fightStart: FIGHT_START, fightEnd: FIGHT_START + FIGHT_MS,
    casts: { data: { entries: (opts.castsTable ?? []).map(([guid, name, total]) => ({ name, guid, total })) } },
    buffs: { data: { auras: (opts.buffs ?? []).map(([guid, name, totalUses]) => ({ guid, name, totalUses, totalUptime: totalUses * 5000 })) } },
    castEvents: casts.map(([id, atS]) => ({ timestamp: FIGHT_START + atS * 1000, abilityGameID: id })),
    tableIds: [1, 2, 3], truncated: false, fetchedAt: 0, pointsSpent: 3,
  };
  const others = opts.wipe ? ["A", "B"] : [];
  const entries = deathsAtS.flatMap((atS) => [
    { name: "Me", timestamp: FIGHT_START + atS * 1000, overkill: 100, killingBlow: { name: "Big Hit", guid: 77 },
      damage: { abilities: [{ name: "Big Hit", guid: 77, total: 600 }, { name: "Dot", guid: 78, total: 300 }, { name: "Tick", guid: 79, total: 50 }, { name: "Splash", guid: 80, total: 50 }], sources: [] }, events: [] },
    ...others.map((name) => ({ name, timestamp: FIGHT_START + atS * 1000 + 500, damage: { abilities: [], sources: [] } })),
  ]);
  const report: RawRunReport = {
    code: "SYN",
    fights: [{ id: 1, startTime: FIGHT_START, endTime: FIGHT_START + FIGHT_MS, keystoneLevel: 15, keystoneBonus: 1, keystoneTime: FIGHT_MS }],
    summary: { data: { totalTime: FIGHT_MS, composition: [{ name: "Me", id: 1, type: "Test", specs: [{ spec: "Spec", role: "dps" }] }] } },
    deaths: { data: { entries } },
  };
  const signals: RunSignals = parseRunSignals(report, "Me", { keyLevel: 15, affixes: [], encounterID: 1 })!;
  return { raw, report, signals, character: "Me", className: "Test", spec: "Spec", table, tableVersion: "t", denylist: [] };
};

describe("analyzeRun — usage vs capacity", () => {
  test("capacity, usage capped at 1, min interval, cdMismatch", () => {
    const r = analyzeRun(synthetic([[1, 10], [1, 100], [1, 250], [2, 30], [3, 5], [3, 20]], []));
    const wall = r.defensives.find((d) => d.id === 1)!;
    expect(wall.capacity).toBe(5);              // ceil(600 / 120)
    expect(wall.casts).toBe(3);
    expect(wall.usage).toBeCloseTo(0.6, 9);
    expect(wall.observedMinIntervalS).toBe(90);  // 100 − 10
    expect(wall.cdMismatch).toBe(true);          // 90 < 0.9 × 120
    const bubble = r.defensives.find((d) => d.id === 2)!;
    expect(bubble.capacity).toBe(2);
    expect(bubble.observedMinIntervalS).toBeNull();
    expect(bubble.cdMismatch).toBe(false);
    const sip = r.defensives.find((d) => d.id === 3)!;
    expect(sip.capacity).toBe(20);
    expect(sip.observedMinIntervalS).toBe(15);
    // majorUsage = mean over major+immunity only: (0.6 + 0.5) / 2
    expect(r.majorUsage).toBeCloseTo(0.55, 9);
    const many = analyzeRun(synthetic(Array.from({ length: 9 }, (_, i) => [1, i * 65] as [number, number]), []));
    expect(many.defensives.find((d) => d.id === 1)!.usage).toBe(1);
  });
  test("capacity floors at 1 on a fight shorter than the cooldown; majorUsage null with no major", () => {
    const long = { id: 9, name: "Long", cooldownS: 900, durationS: 5, kind: "minor" as const, origin: "shipped" as const };
    const r = analyzeRun({ ...synthetic([], []), table: { ...table, entries: [long] } });
    expect(r.defensives[0]!.capacity).toBe(1);   // 600 s fight, 900 s cooldown
    expect(r.majorUsage).toBeNull();
  });
});

describe("analyzeRun — deaths", () => {
  test("killing hits are the top 3 abilities with shares; killing blow named", () => {
    const r = analyzeRun(synthetic([], [300]));
    const d = r.deaths[0]!;
    expect(d.atMs).toBe(300_000);
    expect(d.killingBlow).toBe("Big Hit");
    expect(d.killingHits.map((h) => h.name)).toEqual(["Big Hit", "Dot", "Tick"]);
    expect(d.killingHits[0]!.share).toBeCloseTo(0.6, 9);
    expect(d.killingHits[2]!.share).toBeCloseTo(0.05, 9);
  });
  test("availability windows are inclusive and use the table cooldown", () => {
    // Wall cast exactly 120 s before death → available again; Bubble cast 100 s before → on cooldown (200 s left).
    const r = analyzeRun(synthetic([[1, 180], [2, 200]], [300]));
    const d = r.deaths[0]!;
    expect(d.available).toContain("Wall");
    expect(d.onCooldown).toEqual([{ name: "Bubble", readyInS: 200 }]);
    expect(d.verdict).toBe("defensive available");
  });
  test("active if cast within durationS before death; instant (durationS 0) is never active", () => {
    const r = analyzeRun(synthetic([[1, 295], [3, 299]], [300]));
    const d = r.deaths[0]!;
    expect(d.active).toEqual(["Wall"]);
    expect(d.available).not.toContain("Wall");
    expect(d.onCooldown.map((c) => c.name)).toEqual(["Sip"]); // Sip: cast 1 s ago, 30 s cd
    expect(d.verdict).toBe("immunity available"); // Bubble never cast → available
  });
  test("verdict precedence: covered beats nothing, minors never drive it", () => {
    const covered = analyzeRun(synthetic([[1, 295], [2, 100]], [300])).deaths[0]!;
    expect(covered.verdict).toBe("covered");
    const nothing = analyzeRun(synthetic([[1, 250], [2, 100]], [300])).deaths[0]!;
    expect(nothing.verdict).toBe("nothing available");
    expect(nothing.available).toContain("Sip"); // listed, but does not change the verdict
  });
  test("wipe deaths are analyzed but not counted", () => {
    const r = analyzeRun(synthetic([], [300], { wipe: true }));
    expect(r.deaths[0]!.inWipe).toBe(true);
    expect(r.deaths[0]!.verdict).toBe("immunity available");
    expect(r.countedDeaths).toBe(0);
    expect(r.avoidableDeaths).toBe(0);
    const solo = analyzeRun(synthetic([], [300, 500]));
    expect(solo.countedDeaths).toBe(2);
    expect(solo.avoidableDeaths).toBe(2);
  });
});

describe("analyzeRun — audit", () => {
  test("unlisted = self-cast buffs not in table, not ignored, not denylisted, not consumables", () => {
    const r = analyzeRun(synthetic([], [], {
      buffs: [[1, "Wall", 2], [50, "Mystery Buff", 3], [51, "Tempered Potion", 2], [52, "Offensive", 1], [53, "Ignored", 1], [54, "Received Only", 4]],
      castsTable: [[1, "Wall", 2], [50, "Mystery Buff", 3], [51, "Tempered Potion", 2], [52, "Offensive", 1], [53, "Ignored", 1]],
    }));
    expect(r.unlisted.map((u) => u.id)).toEqual([50, 52, 53]);
    const ignored = analyzeRun({ ...synthetic([], [], { buffs: [[53, "Ignored", 1]], castsTable: [[53, "Ignored", 1]] }), table: { ...table, ignored: [53] }, denylist: [52] });
    expect(ignored.unlisted).toEqual([]);
    expect(r.unlisted[0]).toEqual({ id: 50, name: "Mystery Buff", casts: 3, uptimeS: 15 });
  });
  test("staleTable when the table gained an id the raw row was not filtered on", () => {
    const extra = { id: 77, name: "New", cooldownS: 60, durationS: 5, kind: "major" as const, origin: "override" as const };
    expect(analyzeRun(synthetic([], [])).staleTable).toBe(false);
    expect(analyzeRun({ ...synthetic([], []), table: { ...table, entries: [...table.entries, extra] } }).staleTable).toBe(true);
  });
  test("tableMissing still audits", () => {
    const r = analyzeRun({ ...synthetic([], [], { buffs: [[50, "X", 1]], castsTable: [[50, "X", 1]] }), table: { key: "Test:Spec", entries: [], ignored: [], tableMissing: true } });
    expect(r.tableMissing).toBe(true);
    expect(r.defensives).toEqual([]);
    expect(r.majorUsage).toBeNull();
    expect(r.unlisted.length).toBe(1);
  });
});

describe("analyzeRun — real fixtures", () => {
  test("Muleyoxo (Holy Paladin, Voidscar Arena)", async () => {
    const r = analyzeRun(await fixtureInput("s2-healer"));
    expect(r.className).toBe("Paladin");
    expect(r.spec).toBe("Holy");
    expect(r.tableMissing).toBe(false);
    const dp = r.defensives.find((d) => d.id === 498)!;
    expect(dp.casts).toBe(27);
    expect(dp.capacity).toBe(30); // ceil(1775 / 60)
    expect(r.defensives.find((d) => d.id === 642)!.casts).toBe(5);
    expect(r.deaths.length).toBe(1);
    expect(r.deaths[0]!.killingHits[0]!.name).toBe("Cosmic Crash");
    expect(r.deaths[0]!.killingBlow).toBe("Unstable Singularity");
    expect(r.countedDeaths).toBe(1);
    expect(r.unlisted.map((u) => u.name)).not.toContain("Light's Potential"); // denylisted
  });
  test("Casualaddict (Assassination Rogue, Temple of Sethraliss)", async () => {
    const r = analyzeRun(await fixtureInput("s2-rogue"));
    expect(r.className).toBe("Rogue");
    expect(r.deaths.length).toBe(2);
    expect(r.countedDeaths).toBe(2);
    for (const d of r.deaths) expect(["immunity available", "defensive available", "covered", "nothing available"]).toContain(d.verdict);
    expect(r.defensives.some((d) => d.id === 31224)).toBe(true); // Cloak of Shadows listed
  });
});
```

After capturing the fixtures (Task 3), replace the healer expectations if the numbers differ from the probe (`27`, `5`, `30`, `Cosmic Crash`, `Unstable Singularity`) — they come from the probe of 2026-09-16 and must match the captured file, not be loosened.

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/deepdive/analyze.test.ts`
Expected: FAIL — cannot resolve `src/deepdive/analyze.ts`.

- [ ] **Step 3: Implement `src/deepdive/analyze.ts`**

```ts
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

/** Self-buffs that are consumables or similar, never defensives (audit noise). */
export const NON_DEFENSIVE_NAME = /potion|flask|phial|food|well fed|rune|vantus|drums|healthstone|augment/i;
const CD_MISMATCH_RATIO = 0.9;

const round1 = (x: number) => Math.round(x * 10) / 10;

function usageOf(raw: RawDeepDive, fightS: number, table: SpecDefensives): DefensiveUse[] {
  const tableCounts = new Map<number, number>();
  for (const e of raw.casts?.data?.entries ?? []) if (typeof e.guid === "number") tableCounts.set(e.guid, e.total ?? 0);
  return table.entries.map((d) => {
    const times = raw.castEvents.filter((e) => e.abilityGameID === d.id).map((e) => e.timestamp).sort((a, b) => a - b);
    const casts = times.length > 0 ? times.length : tableCounts.get(d.id) ?? 0;
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

function deathOf(entry: RawTableEntry, atMs: number, inWipe: boolean, raw: RawDeepDive, table: SpecDefensives): DeathAnalysis {
  const abilities = (entry.damage?.abilities ?? []).filter((a) => typeof a.total === "number");
  const sum = abilities.reduce((s, a) => s + (a.total ?? 0), 0);
  const killingHits = [...abilities].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 3)
    .map((a) => ({ name: a.name, amount: a.total ?? 0, share: sum > 0 ? (a.total ?? 0) / sum : 0 }));
  const deathTs = raw.fightStart + atMs;
  const available: string[] = [];
  const active: string[] = [];
  const onCooldown: { name: string; readyInS: number }[] = [];
  let immunityAvail = false;
  let majorAvail = false;
  let anyActive = false;
  for (const d of table.entries) {
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
    return deathOf(e, atMs, ev?.inWipe ?? false, i.raw, i.table);
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
```

- [ ] **Step 4: Run the tests**

Run: `bun test test/deepdive/analyze.test.ts && just check`
Expected: PASS. If a real-fixture expectation fails, inspect the fixture (`bun -e`) and fix the *test constant* only when the fixture provably says otherwise (e.g. the capacity if the fight is not 1775 s).

- [ ] **Step 5: Commit**

```bash
git add src/deepdive/analyze.ts test/deepdive/analyze.test.ts
git commit -m "feat(deepdive): pure run analyzer — usage vs capacity, deaths with availability verdicts, audit"
```

---

### Task 5: Aggregation and the two Survival sub-signals

**Files:**
- Create: `src/deepdive/aggregate.ts`
- Modify: `src/evaluation/inputs.ts`, `src/evaluation/axes/survival.ts`, `src/evaluation/default-config.json`, `src/evaluation/config.ts`, `src/evaluation/types.ts`, `src/evaluation/evaluate.ts`
- Test: `test/deepdive/aggregate.test.ts`, `test/evaluation/inputs.test.ts`, `test/evaluation/axes.test.ts`, `test/evaluation/config.test.ts`

**Interfaces:**
- Consumes: `RunDefensives`, `DeepdiveSummary` (Task 1).
- Produces: `deepdiveSummary(runs: RunDefensives[]): DeepdiveSummary`; `EvalPayload.deepdive?: RunDefensives[]`; `EvalInputs.analyzedRuns: number`; `EvalInputs.survival.{defensiveUsage, avoidableDeathShare, avoidableDeathsCount, countedDeathsCount}`; `EvaluationConfig.confidence.deepdiveMinRuns`; `Evaluation.analyzedRuns: number`.

- [ ] **Step 1: Write the failing aggregate test**

`test/deepdive/aggregate.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { deepdiveSummary } from "../../src/deepdive/aggregate.ts";
import type { RunDefensives } from "../../src/deepdive/types.ts";

const run = (majorUsage: number | null, avoidableDeaths: number, countedDeaths: number): RunDefensives => ({
  reportCode: "R", fightID: 1, character: "X", className: "C", spec: "S", tableMissing: false, tableVersion: "t",
  defensives: [], deaths: [], majorUsage, avoidableDeaths, countedDeaths, unlisted: [], staleTable: false, truncated: false, fetchedAt: 0, pointsSpent: null,
});

describe("deepdiveSummary", () => {
  test("median usage over runs that have majors; share over all counted deaths", () => {
    const s = deepdiveSummary([run(0.2, 1, 2), run(0.6, 0, 1), run(null, 1, 1), run(0.4, 0, 0)]);
    expect(s.analyzedRuns).toBe(4);
    expect(s.majorUsage).toBeCloseTo(0.4, 9);
    expect(s.avoidableDeaths).toBe(2);
    expect(s.countedDeaths).toBe(4);
    expect(s.avoidableDeathShare).toBeCloseTo(0.5, 9);
  });
  test("nulls when nothing to aggregate", () => {
    expect(deepdiveSummary([])).toEqual({ analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 });
    const noDeaths = deepdiveSummary([run(0.5, 0, 0), run(null, 0, 0)]);
    expect(noDeaths.avoidableDeathShare).toBeNull();
    expect(noDeaths.majorUsage).toBe(0.5);
  });
});
```

- [ ] **Step 2: Implement `src/deepdive/aggregate.ts`**

```ts
import { median } from "../evaluation/curve.ts";
import type { DeepdiveSummary, RunDefensives } from "./types.ts";

/** Cross-run aggregate of analyzed runs. Pure. */
export function deepdiveSummary(runs: RunDefensives[]): DeepdiveSummary {
  const usages = runs.map((r) => r.majorUsage).filter((u): u is number => u !== null);
  const avoidableDeaths = runs.reduce((s, r) => s + r.avoidableDeaths, 0);
  const countedDeaths = runs.reduce((s, r) => s + r.countedDeaths, 0);
  return {
    analyzedRuns: runs.length,
    majorUsage: usages.length > 0 ? (median(usages) ?? null) : null,
    avoidableDeathShare: countedDeaths > 0 ? avoidableDeaths / countedDeaths : null,
    avoidableDeaths,
    countedDeaths,
  };
}
```

Run: `bun test test/deepdive/aggregate.test.ts` → PASS.

- [ ] **Step 3: Write the failing evaluation tests**

Append to `test/evaluation/inputs.test.ts` (new `describe`):

```ts
describe("collectInputs — deep-dive", () => {
  const dd = (reportCode: string, majorUsage: number | null, avoidable: number, counted: number) => ({
    reportCode, fightID: 1, character: "X", className: "C", spec: "S", tableMissing: false, tableVersion: "t",
    defensives: [], deaths: [], majorUsage, avoidableDeaths: avoidable, countedDeaths: counted, unlisted: [], staleTable: false, truncated: false, fetchedAt: 0, pointsSpent: null,
  });
  test("null below deepdiveMinRuns (2), populated at or above; only analyses of evaluated runs count", () => {
    const a = runWith({}); const b = runWith({}); const c = runWith({});
    const one = collectInputs(payloadWith([a, b, c], { deepdive: [dd(a.reportCode, 0.5, 1, 1)] }), cfg);
    expect(one.analyzedRuns).toBe(1);
    expect(one.survival.defensiveUsage).toBeNull();
    expect(one.survival.avoidableDeathShare).toBeNull();
    const two = collectInputs(payloadWith([a, b, c], { deepdive: [dd(a.reportCode, 0.5, 1, 1), dd(b.reportCode, 0.3, 0, 1), dd("NOT-SHOWN", 0, 5, 5)] }), cfg);
    expect(two.analyzedRuns).toBe(2);
    expect(two.survival.defensiveUsage).toBeCloseTo(0.4, 9);
    expect(two.survival.avoidableDeathShare).toBeCloseTo(0.5, 9);
    expect(two.survival.avoidableDeathsCount).toBe(1);
    expect(two.survival.countedDeathsCount).toBe(2);
  });
  test("avoidableDeathShare is null with zero counted deaths even when usage is present", () => {
    const a = runWith({}); const b = runWith({});
    const i = collectInputs(payloadWith([a, b], { deepdive: [dd(a.reportCode, 0.5, 0, 0), dd(b.reportCode, 0.7, 0, 0)] }), cfg);
    expect(i.survival.defensiveUsage).toBeCloseTo(0.6, 9);
    expect(i.survival.avoidableDeathShare).toBeNull();
  });
});
```

In `test/evaluation/axes.test.ts`, extend every `survival: { … }` literal (in `baseInputs` and the two inside `describe("survival")`) with `defensiveUsage: null, avoidableDeathShare: null, avoidableDeathsCount: 0, countedDeathsCount: 0`, add `analyzedRuns: 0` next to `runsUsed` in `baseInputs`, and add:

```ts
  test("deep-dive sub-signals score and label from the counts", () => {
    const a = scoreSurvival(baseInputs({ analyzedRuns: 3, survival: { ...baseInputs().survival, defensiveUsage: 0.6, avoidableDeathShare: 2 / 3, avoidableDeathsCount: 2, countedDeathsCount: 3 } }), cfg);
    const usage = a.evidence.find((e) => e.source === "survival.defensiveUsage")!;
    expect(usage.label).toBe("majors used 60% of possible (3 runs)");
    const deaths = a.evidence.find((e) => e.source === "survival.avoidableDeaths")!;
    expect(deaths.label).toBe("2/3 deaths with a defensive available");
    expect(deaths.delta).toBeLessThan(0);   // 0.67 → 30 on the curve
    expect(usage.delta).toBeGreaterThan(0); // 0.6 → 85
  });
```

In `test/evaluation/config.test.ts` add:

```ts
  test("confidence.deepdiveMinRuns is required and numeric", () => {
    expect(validateConfig(DEFAULT_CONFIG).confidence.deepdiveMinRuns).toBe(2);
    expect(() => validateConfig(deepMerge(DEFAULT_CONFIG, { confidence: { deepdiveMinRuns: "x" } }))).toThrow(/deepdiveMinRuns/);
  });
```

Run: `bun test test/evaluation` → FAIL (unknown fields / missing config keys).

- [ ] **Step 4: Implement**

`src/evaluation/types.ts`: `confidence: { high: number; medium: number; consistencyMinRuns: number; deepdiveMinRuns: number }`; `Evaluation` gains `analyzedRuns: number;` after `runsUsed`.

`src/evaluation/default-config.json`: under `axes.survival.subSignals` add two lines (keep the one-line-per-signal style; edit with targeted `sed`/Edit, never reformat the file):

```json
        "defensiveUsage":   { "curve": [[0, 20], [0.3, 55], [0.6, 85], [0.9, 100]],       "weights": { "dps": 2, "healer": 2, "tank": 2 } },
        "avoidableDeaths":  { "curve": [[0, 100], [0.34, 60], [0.67, 30], [1, 10]],        "weights": { "dps": 3, "healer": 3, "tank": 3 } }
```

and `"confidence": { "high": 6, "medium": 3, "consistencyMinRuns": 5, "deepdiveMinRuns": 2 }`.

`src/evaluation/config.ts` `validateConfig`: `expectKeys(…, ["high", "medium", "consistencyMinRuns", "deepdiveMinRuns"], "confidence")` and `deepdiveMinRuns: checkNumber(cf.deepdiveMinRuns, "confidence.deepdiveMinRuns")`.

`src/evaluation/inputs.ts`:

```ts
import { deepdiveSummary } from "../deepdive/aggregate.ts";
import type { RunDefensives } from "../deepdive/types.ts";
```

`EvalPayload` gains, after `summary`:

```ts
  /** Deep-dive analyses of displayed runs (optional; 0 pts — from the raw cache). */
  deepdive?: RunDefensives[];
```

`EvalInputs` gains `analyzedRuns: number;` after `runsUsed`, and `survival` gains:

```ts
    /** Deep-dive: median over analyzed runs of mean major/immunity usage; null under deepdiveMinRuns. */
    defensiveUsage: number | null;
    /** Deep-dive: avoidable / counted deaths; null under deepdiveMinRuns or with no counted death. */
    avoidableDeathShare: number | null;
    avoidableDeathsCount: number;
    countedDeathsCount: number;
```

In `collectInputs`, after the survival block:

```ts
  // --- deep-dive (defensives) ---
  // Only analyses of runs this evaluation looks at; below the floor the two signals are n/a.
  const shown = new Set(runs.map((r) => `${r.reportCode}:${r.fightID}`));
  const dd = deepdiveSummary((payload.deepdive ?? []).filter((d) => shown.has(`${d.reportCode}:${d.fightID}`)));
  const ddOk = dd.analyzedRuns >= cfg.confidence.deepdiveMinRuns;
  const defensiveUsage = ddOk ? dd.majorUsage : null;
  const avoidableDeathShare = ddOk ? dd.avoidableDeathShare : null;
```

Return `analyzedRuns: dd.analyzedRuns` and, in `survival`, `defensiveUsage, avoidableDeathShare, avoidableDeathsCount: dd.avoidableDeaths, countedDeathsCount: dd.countedDeaths`.

`src/evaluation/axes/survival.ts` — add after `groupDeaths`:

```ts
    { id: "defensiveUsage", value: s.defensiveUsage, label: (r) => `majors used ${Math.round(r * 100)}% of possible (${i.analyzedRuns} run${i.analyzedRuns === 1 ? "" : "s"})` },
    { id: "avoidableDeaths", value: s.avoidableDeathShare, label: () => `${s.avoidableDeathsCount}/${s.countedDeathsCount} deaths with a defensive available` },
```

`src/evaluation/evaluate.ts`: `analyzedRuns: inputs.analyzedRuns,` in the returned object.

- [ ] **Step 5: Run all tests and typecheck**

Run: `bun test && just check`
Expected: PASS. If a test pins the literal `configVersion` hash of the default config, update it (the default config changed).

- [ ] **Step 6: Commit**

```bash
git add src/deepdive/aggregate.ts src/evaluation test/deepdive/aggregate.test.ts test/evaluation
git commit -m "feat(evaluation): defensiveUsage and avoidableDeaths survival sub-signals from deep-dive analyses"
```

---

### Task 6: Attach analyses to lookups (0 pts), payload fields, CLI line

**Files:**
- Create: `src/deepdive/attach.ts`
- Modify: `src/deepdive/table.ts` (`getDefensives`/`resetDefensives`), `src/lookup.ts`, `src/format-mplus.ts`, `src/cli.ts` (`cmdLookup` render call only)
- Test: `test/deepdive/attach.test.ts`, `test/format.test.ts`

**Interfaces:**
- Consumes: `Store.getDeepDive`, `playerOf`, `specDefensives`, `analyzeRun`, `deepdiveSummary`, `evaluate`, `evalRuns`.
- Produces: `analyzeCached(store, tables, run: { reportCode; fightID }, character): RunDefensives | null`; `attachDeepdive(payload, store, tables, cfg): LookupPayload` (new object: `deepdive`, `deepdiveSummary`, re-run `evaluation`); `getDefensives(): Promise<LoadedTables>`, `resetDefensives(): void`; `LookupPayload.deepdive: RunDefensives[]`, `LookupPayload.deepdiveSummary: DeepdiveSummary`; `renderDeepdiveLine(d: RunDefensives): string`.

- [ ] **Step 1: Write the failing tests**

`test/deepdive/attach.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { analyzeCached, attachDeepdive } from "../../src/deepdive/attach.ts";
import { SHIPPED } from "../../src/deepdive/table.ts";
import type { LoadedTables } from "../../src/deepdive/types.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import type { LookupPayload } from "../../src/lookup.ts";
import { analyzeLookup, type MPlusRun } from "../../src/mplus.ts";
import { openStore } from "../../src/signals/store.ts";
import { signalSummary } from "../../src/signals/summary.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadDeepdiveFixture } from "../fixtures.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const tables: LoadedTables = { shipped: SHIPPED, override: {}, overridePath: "/dev/null" };

async function payloadFor(names: Array<"s2-healer" | "s2-rogue">) {
  const store = openStore(":memory:");
  const fixtures = await Promise.all(names.map(loadDeepdiveFixture));
  const runs: MPlusRun[] = fixtures.map((f) => {
    const run: MPlusRun = { ...f.run };
    run.signals = parseRunSignals(f.report, f.character, { keyLevel: run.keyLevel, affixes: run.affixes, encounterID: run.encounterID })!;
    store.putWclRun(run.reportCode, run.fightID, f.report);
    return run;
  });
  const character = fixtures[0]!.character as string;
  const result = analyzeLookup(runs, runs[0]!.keyLevel, runs.map((r) => ({ id: r.encounterID, name: r.encounterName })), true);
  const base = { metric: "hps" as const, targetLevel: result.targetLevel, perDungeon: result.perDungeon, prevLevelBest: result.prevLevelBest, rio: null, summary: signalSummary(runs, null) };
  const payload = {
    character: { id: 1, name: character, classID: 6, spec: "Holy", scoreTop: null, realmSlug: "hyjal", region: "eu" },
    zone: { id: 1, name: "z", partition: 1 }, metricAutoSelected: true, alternateMetricHasData: false, specFilter: null, runsIndexed: runs.length, seasonDungeons: [],
    targetAutoDetected: true, atOrAboveTargetCount: 0, rioError: null,
    ...base, evaluation: evaluate(base, cfg), deepdive: [], deepdiveSummary: { analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
  } as unknown as LookupPayload;
  return { payload, store, fixtures };
}

describe("analyzeCached", () => {
  test("null without a raw deep-dive row; analysis when both rows are cached", async () => {
    const { store, fixtures } = await payloadFor(["s2-healer"]);
    const f = fixtures[0]!;
    const run = { reportCode: f.run.reportCode as string, fightID: f.run.fightID as number };
    expect(analyzeCached(store, tables, run, f.character)).toBeNull();
    store.putDeepDive(run.reportCode, run.fightID, f.character, f.deepdive);
    const r = analyzeCached(store, tables, run, f.character)!;
    expect(r.spec).toBe("Holy");
    expect(r.defensives.find((d) => d.id === 498)!.casts).toBe(27);
    store.close();
  });
});

describe("attachDeepdive", () => {
  test("adds analyses of displayed runs, the summary and a re-run evaluation; pure on the input", async () => {
    const { payload, store, fixtures } = await payloadFor(["s2-healer"]);
    const before = JSON.stringify(payload);
    const none = attachDeepdive(payload, store, tables, cfg);
    expect(none.deepdive).toEqual([]);
    expect(none.deepdiveSummary.analyzedRuns).toBe(0);
    expect(none.evaluation.analyzedRuns).toBe(0);
    const f = fixtures[0]!;
    store.putDeepDive(f.run.reportCode, f.run.fightID, f.character, f.deepdive);
    const one = attachDeepdive(payload, store, tables, cfg);
    expect(one.deepdive.length).toBe(1);
    expect(one.deepdiveSummary.analyzedRuns).toBe(1);
    expect(one.evaluation.analyzedRuns).toBe(1);
    // Below deepdiveMinRuns: no deep-dive evidence yet.
    expect(one.evaluation.axes.find((a) => a.key === "survival")!.evidence.some((e) => e.source === "survival.defensiveUsage")).toBe(false);
    expect(JSON.stringify(payload)).toBe(before);
    store.close();
  });
});
```

Append to `test/format.test.ts` (it already has a `strip` helper for ANSI colors and imports from `../src/format-mplus.ts`; add `renderDeepdiveLine` to that import and `import type { RunDefensives } from "../src/deepdive/types.ts";`):

```ts
describe("renderDeepdiveLine", () => {
  const base: RunDefensives = {
    reportCode: "R", fightID: 1, character: "X", className: "Paladin", spec: "Holy", tableMissing: false, tableVersion: "t",
    defensives: [], deaths: [], majorUsage: 0.41, avoidableDeaths: 1, countedDeaths: 2,
    unlisted: [{ id: 5, name: "Mystery", casts: 5, uptimeS: 40 }], staleTable: false, truncated: false, fetchedAt: 0, pointsSpent: 3,
  };
  test("majors, deaths, unlisted", () => {
    const line = strip(renderDeepdiveLine(base));
    expect(line).toContain("defensives: majors 41%");
    expect(line).toContain("1/2 deaths with a defensive available");
    expect(line).toContain("unlisted: Mystery (5x)");
  });
  test("no table, no deaths", () => {
    const line = strip(renderDeepdiveLine({ ...base, tableMissing: true, majorUsage: null, countedDeaths: 0, avoidableDeaths: 0, unlisted: [] }));
    expect(line).toContain("no defensives table for Holy Paladin");
    expect(line).toContain("no deaths");
  });
});
```

Run: `bun test test/deepdive/attach.test.ts test/format.test.ts` → FAIL.

- [ ] **Step 2: Implement `src/deepdive/attach.ts`**

```ts
import { evaluate } from "../evaluation/evaluate.ts";
import { evalRuns } from "../evaluation/inputs.ts";
import type { EvaluationConfig } from "../evaluation/types.ts";
import type { LookupPayload } from "../lookup.ts";
import type { Store } from "../signals/store.ts";
import { parseRunSignals } from "../signals/wcl-run.ts";
import { deepdiveSummary } from "./aggregate.ts";
import { analyzeRun } from "./analyze.ts";
import { playerOf } from "./player.ts";
import { specDefensives } from "./table.ts";
import type { LoadedTables, RunDefensives } from "./types.ts";

/** Analysis from the two cached rows (run report + raw deep-dive); null when either is missing. 0 pts. */
export function analyzeCached(store: Store, tables: LoadedTables, run: { reportCode: string; fightID: number }, character: string): RunDefensives | null {
  const raw = store.getDeepDive(run.reportCode, run.fightID, character);
  const report = store.getWclRun(run.reportCode, run.fightID);
  if (!raw || !report) return null;
  const player = playerOf(report, character);
  if (!player) return null;
  // The fallback is only used when the fight is missing from the report; a cached run has it.
  const signals = parseRunSignals(report, character, { keyLevel: 0, affixes: [], encounterID: 0 });
  if (!signals) return null;
  const table = specDefensives(tables.shipped, tables.override, player.className, player.spec);
  return analyzeRun({ raw, report, signals, character, className: player.className, spec: player.spec, table, tableVersion: tables.shipped.version, denylist: tables.shipped.denylist });
}

/** New payload with `deepdive` for every displayed run that has a cached analysis, its summary, and a re-run evaluation. */
export function attachDeepdive(payload: LookupPayload, store: Store, tables: LoadedTables, cfg: EvaluationConfig): LookupPayload {
  const character = payload.character.name;
  const deepdive = evalRuns(payload)
    .map((r) => analyzeCached(store, tables, r, character))
    .filter((d): d is RunDefensives => d !== null);
  const next = { ...payload, deepdive, deepdiveSummary: deepdiveSummary(deepdive) };
  return { ...next, evaluation: evaluate(next, cfg) };
}
```

`src/lookup.ts` imports `src/deepdive/attach.ts` and `attach.ts` imports the `LookupPayload` type from `src/lookup.ts` — a type-only cycle, fine under `verbatimModuleSyntax`.

- [ ] **Step 3: Wire the payload and the process-wide table loader**

Add to `src/deepdive/table.ts`:

```ts
let cachedTables: Promise<LoadedTables> | null = null;
/** Process-wide effective tables; warns once on stderr. Call resetDefensives() after writing the override. */
export const getDefensives = (): Promise<LoadedTables> => {
  if (!cachedTables) cachedTables = loadDefensives().then((t) => { if (t.warning) console.error(t.warning); return t; });
  return cachedTables;
};
export const resetDefensives = (): void => { cachedTables = null; };
```

`src/lookup.ts`:
- `LookupOutcome` (ok branch) gains `deepdive: RunDefensives[]; deepdiveSummary: DeepdiveSummary;`.
- `Deps` gains `tables?: LoadedTables;`.
- In `performLookup`, after the `Promise.all` and before `payloadForEval`:

```ts
  const tables = deps.tables ?? (await getDefensives());
  const shown = displayedRuns(result);
  const deepdive = shown
    .map((r) => analyzeCached(store, tables, r, data.character.name))
    .filter((d): d is RunDefensives => d !== null);
```

  add `deepdive` to `payloadForEval`, and return `deepdive, deepdiveSummary: deepdiveSummary(deepdive)`.
- `buildLookupPayload` adds `deepdive: o.deepdive, deepdiveSummary: o.deepdiveSummary,` after `summary`.

- [ ] **Step 4: CLI line**

`src/format-mplus.ts`: import `type { RunDefensives } from "./deepdive/types.ts"` and add

```ts
export const renderDeepdiveLine = (d: RunDefensives): string => {
  const parts: string[] = [];
  if (d.tableMissing) parts.push(pc.yellow(`no defensives table for ${d.spec} ${d.className}`));
  else if (d.majorUsage !== null) parts.push(`majors ${Math.round(d.majorUsage * 100)}%`);
  parts.push(d.countedDeaths === 0 ? dim("no deaths") : `${d.avoidableDeaths}/${d.countedDeaths} deaths with a defensive available`);
  if (d.unlisted.length > 0) parts.push(dim(`unlisted: ${d.unlisted.slice(0, 3).map((u) => `${u.name} (${u.casts}x)`).join(", ")}`));
  return `defensives: ${parts.join(" · ")}`;
};
```

`renderRun(r, metric, indent = "    ", deepdive?: RunDefensives)`: when `deepdive` is given, append `\n${indent}   ${renderDeepdiveLine(deepdive)}` after the quality line. `renderLookup` gains a last parameter `deepdive: RunDefensives[] = []` and passes `deepdive.find((d) => d.reportCode === r.reportCode && d.fightID === r.fightID)` at both `renderRun` call sites. `src/cli.ts` `cmdLookup` passes `o.deepdive` as that argument.

- [ ] **Step 5: Run everything, commit**

Run: `bun test && just check`
Expected: PASS.

```bash
git add src/deepdive/attach.ts src/deepdive/table.ts src/lookup.ts src/format-mplus.ts src/cli.ts test/deepdive/attach.test.ts test/format.test.ts
git commit -m "feat(deepdive): attach cached analyses to lookups (0 pts), payload fields, CLI run line"
```

---

### Task 7: Deep-dive runner, server routes, history refresh

**Files:**
- Create: `src/deepdive/run.ts`
- Modify: `src/server.ts`, `src/server-history.ts`
- Test: `test/deepdive/run.test.ts`, `test/server-deepdive.test.ts`, `test/server-history.test.ts`

**Interfaces:**
- Consumes: `fetchRawDeepDive`, `BudgetLowError`, `MIN_BUDGET_POINTS` (Task 3), `analyzeCached`, `attachDeepdive` (Task 6), `getDefensives`/`resetDefensives`/`applyPatch`/`validateOverride`/`saveOverride`/`specDefensives`/`specKey` (Tasks 1, 6), `PING_QUERY`.
- Produces: `runDeepdive(req: DeepdiveRequest, deps: RunDeps): Promise<DeepdiveOutcome>`; `History.updateResult(key, result)`; routes `POST /api/deepdive`, `GET /api/defensives`, `POST /api/defensives`.

```ts
// src/deepdive/run.ts — shared by the server route and `bmpl analyze`.
export interface DeepdiveRequest { reportCode: string; fightID: number; character: string; force?: boolean }
export interface RunDeps { store: Store; tables: LoadedTables; gql?: GqlFn }
export type DeepdiveOutcome =
  | { ok: true; result: RunDefensives; fromCache: boolean; pointsSpent: number | null }
  | { ok: false; status: 402 | 404 | 502; error: string };
```

- [ ] **Step 1: Write the failing runner test**

`test/deepdive/run.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { runDeepdive } from "../../src/deepdive/run.ts";
import { SHIPPED } from "../../src/deepdive/table.ts";
import type { LoadedTables } from "../../src/deepdive/types.ts";
import { openStore } from "../../src/signals/store.ts";
import { loadDeepdiveFixture } from "../fixtures.ts";

const tables: LoadedTables = { shipped: SHIPPED, override: {}, overridePath: "/dev/null" };
const ping = (spent: number) => ({ rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: 10 } });

describe("runDeepdive", () => {
  test("404 when the run is not cached; no network", async () => {
    const store = openStore(":memory:");
    let calls = 0;
    const gql = async <T,>() => { calls++; return {} as T; };
    const r = await runDeepdive({ reportCode: "NOPE", fightID: 1, character: "X" }, { store, tables, gql });
    expect(r).toEqual({ ok: false, status: 404, error: "run NOPE:1 is not in the cache — look the character up first" });
    expect(calls).toBe(0);
    store.close();
  });
  test("cache hit → no network; force → refetch; budget refusal before spending", async () => {
    const store = openStore(":memory:");
    const f = await loadDeepdiveFixture("s2-healer");
    store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
    const req = { reportCode: f.run.reportCode as string, fightID: f.run.fightID as number, character: f.character as string };
    const queries: string[] = [];
    let spent = 100;
    const gql = async <T,>(q: string) => {
      queries.push(q.includes("rateLimitData") && !q.includes("reportData") ? "ping" : "deepdive");
      if (queries[queries.length - 1] === "ping") return ping(spent) as T;
      return { ...ping(spent), reportData: { report: { fights: [{ startTime: f.deepdive.fightStart, endTime: f.deepdive.fightEnd }], casts: f.deepdive.casts, buffs: f.deepdive.buffs, castEvents: { data: f.deepdive.castEvents.map((e: { timestamp: number; abilityGameID: number }) => ({ ...e, type: "cast" })), nextPageTimestamp: null } } } } as T;
    };
    const first = await runDeepdive(req, { store, tables, gql });
    expect(first.ok).toBe(true);
    expect(queries).toEqual(["ping", "deepdive"]);
    if (first.ok) { expect(first.fromCache).toBe(false); expect(first.result.defensives.find((d) => d.id === 498)!.casts).toBe(27); }
    const second = await runDeepdive(req, { store, tables, gql });
    expect(queries.length).toBe(2);
    if (second.ok) expect(second.fromCache).toBe(true);
    await runDeepdive({ ...req, force: true }, { store, tables, gql });
    expect(queries.length).toBe(4);
    spent = 3590;
    const low = await runDeepdive({ ...req, force: true }, { store, tables, gql });
    expect(low).toEqual({ ok: false, status: 402, error: "WCL budget low (10 pts left this hour)" });
    expect(queries.length).toBe(5); // ping only
    store.close();
  });
  test("a WCL error is relayed as 502 and nothing is cached", async () => {
    const store = openStore(":memory:");
    const f = await loadDeepdiveFixture("s2-healer");
    store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
    const gql = async <T,>(q: string) => { if (!q.includes("reportData")) return ping(0) as T; throw new Error("WCL GraphQL error: boom"); };
    const r = await runDeepdive({ reportCode: f.run.reportCode, fightID: f.run.fightID, character: f.character }, { store, tables, gql });
    expect(r).toEqual({ ok: false, status: 502, error: "WCL GraphQL error: boom" });
    expect(store.getDeepDive(f.run.reportCode, f.run.fightID, f.character)).toBeNull();
    store.close();
  });
});
```

- [ ] **Step 2: Implement `src/deepdive/run.ts`**

```ts
import type { GqlFn } from "../signals/enrich.ts";
import type { Store } from "../signals/store.ts";
import { gql as realGql } from "../wcl/client.ts";
import { PING_QUERY } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import { analyzeCached } from "./attach.ts";
import { playerOf } from "./player.ts";
import { specDefensives } from "./table.ts";
import type { LoadedTables, RunDefensives } from "./types.ts";
import { BudgetLowError, MIN_BUDGET_POINTS, fetchRawDeepDive } from "./wcl.ts";

export interface DeepdiveRequest { reportCode: string; fightID: number; character: string; force?: boolean }
export interface RunDeps { store: Store; tables: LoadedTables; gql?: GqlFn }
export type DeepdiveOutcome =
  | { ok: true; result: RunDefensives; fromCache: boolean; pointsSpent: number | null }
  | { ok: false; status: 402 | 404 | 502; error: string };

/**
 * Analyze one run for one character: cached raw row → 0 pts; otherwise a budget pre-check
 * (PING, negligible) then the one deep-dive request (~3 pts), stored forever.
 */
export async function runDeepdive(req: DeepdiveRequest, deps: RunDeps): Promise<DeepdiveOutcome> {
  const gql = deps.gql ?? realGql;
  const report = deps.store.getWclRun(req.reportCode, req.fightID);
  if (!report) return { ok: false, status: 404, error: `run ${req.reportCode}:${req.fightID} is not in the cache — look the character up first` };
  const player = playerOf(report, req.character);
  if (!player) return { ok: false, status: 404, error: `${req.character} is not in the cached run ${req.reportCode}:${req.fightID}` };
  const table = specDefensives(deps.tables.shipped, deps.tables.override, player.className, player.spec);
  const ids = table.entries.map((e) => e.id);

  const cached = deps.store.getDeepDive(req.reportCode, req.fightID, req.character);
  if (cached && !req.force) {
    const result = analyzeCached(deps.store, deps.tables, req, req.character);
    if (result) return { ok: true, result, fromCache: true, pointsSpent: null };
  }
  try {
    const ping = await gql<RateLimitData>(PING_QUERY);
    const left = ping.rateLimitData.limitPerHour - ping.rateLimitData.pointsSpentThisHour;
    if (left < MIN_BUDGET_POINTS) return { ok: false, status: 402, error: new BudgetLowError(left).message };
    const raw = await fetchRawDeepDive(gql, { code: req.reportCode, fightID: req.fightID, character: req.character, actorID: player.actorID, ids });
    deps.store.putDeepDive(req.reportCode, req.fightID, req.character, raw);
    const result = analyzeCached(deps.store, deps.tables, req, req.character);
    if (!result) return { ok: false, status: 502, error: "analysis failed on the fetched data" };
    return { ok: true, result, fromCache: false, pointsSpent: raw.pointsSpent };
  } catch (e) {
    if (e instanceof BudgetLowError) return { ok: false, status: 402, error: e.message };
    return { ok: false, status: 502, error: e instanceof Error ? e.message : String(e) };
  }
}
```

Run: `bun test test/deepdive/run.test.ts` → PASS.

- [ ] **Step 3: History update method**

`src/server-history.ts`: add

```ts
  /** Replace the stored payload of an entry (e.g. after a deep-dive changed its analyses); no-op for unknown keys. */
  updateResult(key: string, result: unknown): void {
    const e = this.entries.get(key);
    if (e) e.result = result;
  }
```

and in `test/server-history.test.ts`:

```ts
  test("updateResult replaces the payload in place and keeps the key", () => {
    const h = new History(5);
    const e = h.record({ character: "A-B", level: null, spec: null, metric: null }, { result: { v: 1 }, label: "A-B", charClass: 1, spec: null, targetLevel: 10, targetAutoDetected: true });
    h.updateResult(e.key, { v: 2 });
    expect(h.get(e.key)!.result).toEqual({ v: 2 });
    h.updateResult("nope", { v: 3 });
    expect(h.size).toBe(1);
  });
```

(Match the existing test file's `record` call shape; adjust the request/record literals to whatever the file already uses.)

- [ ] **Step 4: Server routes**

In `src/server.ts`:

```ts
import { runDeepdive } from "./deepdive/run.ts";
import { attachDeepdive } from "./deepdive/attach.ts";
import { applyPatch, getDefensives, resetDefensives, saveOverride, specDefensives, specKey, validateOverride } from "./deepdive/table.ts";
import type { OverrideEntry } from "./deepdive/types.ts";
import { getEvalConfig } from "./evaluation/config.ts";
import type { LookupPayload } from "./lookup.ts";
import { getStore } from "./signals/store.ts";
```

```ts
/** Re-attach cached analyses (and re-evaluate) on every history entry — after an analysis or a table change. 0 pts. */
async function refreshHistoryDeepdive(): Promise<void> {
  const [store, tables, cfg] = await Promise.all([getStore(), getDefensives(), getEvalConfig()]);
  for (const e of history.list()) history.updateResult(e.key, attachDeepdive(e.result as LookupPayload, store, tables, cfg));
}

interface DeepdiveBody { reportCode?: string; fightID?: number; character?: string; force?: boolean }

async function handleDeepdive(req: Request): Promise<Response> {
  let body: DeepdiveBody;
  try { body = (await req.json()) as DeepdiveBody; } catch { return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400); }
  if (!body.reportCode || typeof body.fightID !== "number" || !body.character) return jsonResponse({ ok: false, error: "`reportCode`, `fightID` and `character` are required" }, 400);
  if (!hasCredentials()) return jsonResponse({ ok: false, error: "No credentials configured. Visit /setup first." }, 400);
  const [store, tables] = await Promise.all([getStore(), getDefensives()]);
  const r = await runDeepdive({ reportCode: body.reportCode, fightID: body.fightID, character: body.character, force: !!body.force }, { store, tables });
  if (!r.ok) return jsonResponse({ ok: false, error: r.error }, r.status);
  await refreshHistoryDeepdive();
  return jsonResponse({ ok: true, result: r.result, fromCache: r.fromCache, pointsSpent: r.pointsSpent });
}

async function handleDefensivesGet(url: URL): Promise<Response> {
  const className = (url.searchParams.get("class") ?? "").trim();
  const spec = (url.searchParams.get("spec") ?? "").trim();
  if (!className || !spec) return jsonResponse({ ok: false, error: "`class` and `spec` are required" }, 400);
  const tables = await getDefensives();
  const d = specDefensives(tables.shipped, tables.override, className, spec);
  return jsonResponse({ ok: true, key: d.key, entries: d.entries, ignored: d.ignored, tableMissing: d.tableMissing, overridePath: tables.overridePath, warning: tables.warning ?? null });
}

interface DefensivesPatchBody { className?: string; spec?: string; patch?: OverrideEntry }

async function handleDefensivesPost(req: Request): Promise<Response> {
  let body: DefensivesPatchBody;
  try { body = (await req.json()) as DefensivesPatchBody; } catch { return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400); }
  if (!body.className || !body.spec || !body.patch) return jsonResponse({ ok: false, error: "`className`, `spec` and `patch` are required" }, 400);
  const tables = await getDefensives();
  if (tables.warning) return jsonResponse({ ok: false, error: `${tables.overridePath} is invalid — fix it by hand first: ${tables.warning}` }, 409);
  try {
    const key = specKey(body.className, body.spec);
    const effective = specDefensives(tables.shipped, tables.override, body.className, body.spec);
    const next = validateOverride(applyPatch(tables.override, key, validateOverride({ [key]: [body.patch] })[key]![0]!, effective));
    await saveOverride(tables.overridePath, next);
    resetDefensives();
    await refreshHistoryDeepdive();
    const fresh = await getDefensives();
    const d = specDefensives(fresh.shipped, fresh.override, body.className, body.spec);
    return jsonResponse({ ok: true, key: d.key, entries: d.entries, ignored: d.ignored, tableMissing: d.tableMissing, overridePath: fresh.overridePath });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
```

Routes inside `fetch`, next to `/api/lookup`:

```ts
      if (req.method === "POST" && path === "/api/deepdive") return handleDeepdive(req);
      if (req.method === "GET" && path === "/api/defensives") return handleDefensivesGet(url);
      if (req.method === "POST" && path === "/api/defensives") return handleDefensivesPost(req);
```

- [ ] **Step 5: Server tests**

`test/server-deepdive.test.ts` (own file: it sets env before the server starts):

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDefensives } from "../src/deepdive/table.ts";
import { runServer } from "../src/server.ts";
import { closeStore } from "../src/signals/store.ts";

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-dd-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "");
  writeFileSync(join(dir, "assets", "app.css"), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  process.env.BMPL_DEFENSIVES = join(dir, "defensives.json");
  resetDefensives();
  server = await runServer({ port: 0, open: false, assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets", "app.js"), appCss: join(dir, "assets", "app.css") }) });
});
afterAll(() => {
  server.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  delete process.env.BMPL_DEFENSIVES;
  resetDefensives();
  rmSync(dir, { recursive: true, force: true });
});

const url = (p: string) => `http://localhost:${server.port}${p}`;
const post = (p: string, body: unknown) => fetch(url(p), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/deepdive", () => {
  test("400 on a bad body, 404 when the run is not cached (no network)", async () => {
    expect((await post("/api/deepdive", {})).status).toBe(400);
    const res = await post("/api/deepdive", { reportCode: "NOPE", fightID: 1, character: "X" });
    // Without credentials the server answers 400 before touching the store; with them, 404.
    expect([400, 404]).toContain(res.status);
    expect((await res.json()).ok).toBe(false);
  });
});

describe("/api/defensives", () => {
  test("GET returns the effective table with origins", async () => {
    const res = await fetch(url("/api/defensives?class=Paladin&spec=Holy"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.key).toBe("Paladin:Holy");
    expect(j.tableMissing).toBe(false);
    expect(j.entries.find((e: { id: number }) => e.id === 498).origin).toBe("shipped");
    expect(j.overridePath).toBe(join(dir, "defensives.json"));
    expect((await fetch(url("/api/defensives?class=Paladin"))).status).toBe(400);
  });
  test("POST writes the override, returns the new table; bad patch → 400", async () => {
    const res = await post("/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 498, cooldownS: 45 } });
    expect(res.status).toBe(200);
    const j = await res.json();
    const dp = j.entries.find((e: { id: number }) => e.id === 498);
    expect(dp.cooldownS).toBe(45);
    expect(dp.origin).toBe("override");
    const file = JSON.parse(await Bun.file(join(dir, "defensives.json")).text());
    expect(file["Paladin:Holy"]).toEqual([{ id: 498, cooldownS: 45 }]);
    const ignore = await post("/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 642, ignore: true } });
    expect((await ignore.json()).ignored).toEqual([642]);
    const bad = await post("/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 424242, cooldownS: 1 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/424242/);
  });
});
```

- [ ] **Step 6: Run, typecheck, commit**

Run: `bun test && just check`
Expected: PASS.

```bash
git add src/deepdive/run.ts src/server.ts src/server-history.ts test/deepdive/run.test.ts test/server-deepdive.test.ts test/server-history.test.ts
git commit -m "feat(server): POST /api/deepdive, GET/POST /api/defensives, history refresh after analyses and table edits"
```

---

### Task 8: CLI — `bmpl analyze`, `bmpl defensives`, full run rendering

**Files:**
- Modify: `src/cli.ts`, `src/format-mplus.ts`
- Test: `test/format.test.ts`, `test/evaluation/cli.test.ts`

**Interfaces:**
- Consumes: `performLookup`, `displayedRuns`, `runDeepdive`, `getDefensives`, `specDefensives`, `loadDefensives`, `estimateDeepdiveCost`.
- Produces: `renderDeepdive(d: RunDefensives): string` (multi-line panel), commands `analyze` and `defensives`.

- [ ] **Step 1: Write the failing render test**

Append to `test/format.test.ts` (reuse the `base` RunDefensives literal from the `renderDeepdiveLine` describe — move it to file scope):

```ts
describe("renderDeepdive", () => {
  test("usage table, deaths with verdicts, audit", () => {
    const d: RunDefensives = {
      ...base,
      defensives: [
        { id: 498, name: "Divine Protection", cooldownS: 60, durationS: 8, kind: "major", origin: "shipped", casts: 27, capacity: 30, usage: 0.9, observedMinIntervalS: 38, cdMismatch: true },
        { id: 642, name: "Divine Shield", cooldownS: 300, durationS: 8, kind: "immunity", origin: "override", casts: 5, capacity: 6, usage: 5 / 6, observedMinIntervalS: 310, cdMismatch: false },
      ],
      deaths: [
        { atMs: 1_764_223, inWipe: false, killingHits: [{ name: "Cosmic Crash", amount: 559197, share: 0.55 }, { name: "Unstable Singularity", amount: 458887, share: 0.45 }], killingBlow: "Unstable Singularity", available: ["Divine Shield"], active: [], onCooldown: [{ name: "Divine Protection", readyInS: 12 }], verdict: "immunity available" },
        { atMs: 100_000, inWipe: true, killingHits: [], killingBlow: null, available: [], active: ["Divine Protection"], onCooldown: [], verdict: "covered" },
      ],
    };
    const out = strip(renderDeepdive(d));
    expect(out).toContain("Divine Protection");
    expect(out).toContain("27/30");
    expect(out).toContain("90%");
    expect(out).toContain("cd 60s · seen 38s ?"); // cdMismatch marker
    expect(out).toContain("(override)");
    expect(out).toContain("29:24");                // 1_764_223 ms
    expect(out).toContain("Cosmic Crash 55%");
    expect(out).toContain("immunity available");
    expect(out).toContain("Divine Protection on cd (12s)");
    expect(out).toContain("wipe");
    expect(out).toContain("Not in table: Mystery (5x, 40s up)");
  });
});
```

- [ ] **Step 2: Implement `renderDeepdive` in `src/format-mplus.ts`**

```ts
const mmss = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const verdictColor = (v: RunDefensives["deaths"][number]["verdict"], s: string): string =>
  v === "covered" || v === "nothing available" ? pc.green(s) : v === "immunity available" ? pc.red(pc.bold(s)) : pc.red(s);

/** Multi-line panel for `bmpl analyze`. */
export const renderDeepdive = (d: RunDefensives): string => {
  const lines: string[] = [];
  lines.push(heading(`Defensives · ${d.spec} ${d.className}`) + (d.tableMissing ? pc.yellow("  (no table for this spec)") : "") + (d.truncated ? pc.yellow("  (events truncated)") : ""));
  for (const u of d.defensives) {
    const usage = `${Math.round(u.usage * 100)}%`.padStart(4);
    const cd = u.cdMismatch ? pc.yellow(`cd ${u.cooldownS}s · seen ${u.observedMinIntervalS}s ?`) : dim(`cd ${u.cooldownS}s${u.observedMinIntervalS !== null ? ` · seen ${u.observedMinIntervalS}s` : ""}`);
    lines.push(`  ${u.name.padEnd(26)} ${dim(u.kind.padEnd(8))} ${String(u.casts).padStart(3)}/${String(u.capacity).padEnd(3)} ${usage}  ${cd}${u.origin === "override" ? dim(" (override)") : ""}`);
  }
  if (d.majorUsage !== null) lines.push(dim(`  majors used ${Math.round(d.majorUsage * 100)}% of possible`));
  lines.push(d.deaths.length === 0 ? dim("  no deaths") : `  ${d.avoidableDeaths}/${d.countedDeaths} deaths with a defensive available`);
  for (const x of d.deaths) {
    const hits = x.killingHits.map((h) => `${h.name} ${Math.round(h.share * 100)}%`).join(" · ");
    const state = [
      ...x.active.map((n) => pc.green(`${n} active`)),
      ...x.available.map((n) => pc.red(`${n} available`)),
      ...x.onCooldown.map((c) => dim(`${c.name} on cd (${c.readyInS}s)`)),
    ].join(", ");
    lines.push(`    ${mmss(x.atMs)}  ${verdictColor(x.verdict, x.verdict)}${x.inWipe ? pc.yellow(" · wipe") : ""}  ${dim(hits)}`);
    if (state) lines.push(`           ${state}`);
  }
  if (d.unlisted.length > 0) lines.push(pc.yellow(`  Not in table: ${d.unlisted.map((u) => `${u.name} (${u.casts}x, ${u.uptimeS}s up)`).join(", ")}`));
  return lines.join("\n");
};
```

Run: `bun test test/format.test.ts` → PASS.

- [ ] **Step 3: Commands**

In `src/cli.ts`:

USAGE additions (after `bmpl evaluate`):

```
  bmpl analyze <Name-Realm> [--run <code>:<fight>]... [--all] [--force] [--yes] [--level <N>] [--spec X] [--json]
                                     Deep-dive the defensive cooldowns of shown runs
                                     (~3 WCL pts per run, cached forever). Without
                                     --run/--all: lists the runs and their status.
  bmpl defensives <Class> <Spec> | --check
                                     Show the effective defensives table for a spec
                                     (shipped + your defensives.json), or validate the file.
```

Helper:

```ts
function parseFlags(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1] !== undefined) out.push(args[i + 1]!);
  return out;
}
```

`cmdAnalyze`:

```ts
async function cmdAnalyze(
  name: string, realm: string, targetLevel: number | null, spec: string | null,
  runKeys: string[], all: boolean, force: boolean, yes: boolean, json: boolean,
): Promise<void> {
  const o = await performLookup({ name, realm, level: targetLevel, spec, enrich: true });
  if (!o.ok) { console.error(json ? o.error : err("✗ " + o.error)); closeStore(); process.exit(1); }
  const shown = displayedRuns(o.result);
  const analyzed = new Set(o.deepdive.map((d) => `${d.reportCode}:${d.fightID}`));
  const key = (r: MPlusRun) => `${r.reportCode}:${r.fightID}`;
  if (!all && runKeys.length === 0) {
    console.log(heading(`${o.data.character.name}-${realm}`) + dim("  runs shown by lookup — pass --run <code>:<fight> or --all"));
    for (const r of shown) console.log(`  ${analyzed.has(key(r)) ? ok("✓") : dim("·")} ${key(r).padEnd(24)} +${r.keyLevel} ${r.encounterName}`);
    closeStore();
    return;
  }
  const wanted = shown.filter((r) => (all || runKeys.includes(key(r))) && (force || !analyzed.has(key(r))));
  const unknown = runKeys.filter((k) => !shown.some((r) => key(r) === k));
  if (unknown.length > 0) { console.error(err(`✗ not among the shown runs: ${unknown.join(", ")}`)); closeStore(); process.exit(2); }
  if (wanted.length === 0) { console.log(dim("nothing to analyze (already analyzed — use --force to re-fetch)")); }
  else if (!yes && !json) {
    const go = confirm(`Analyze ${wanted.length} run${wanted.length === 1 ? "" : "s"} for ~${wanted.length * estimateDeepdiveCost()} WCL pts?`);
    if (!go) { closeStore(); process.exit(0); }
  }
  const [store, tables] = await Promise.all([getStore(), getDefensives()]);
  const results: RunDefensives[] = [];
  for (const r of wanted) {
    const res = await runDeepdive({ reportCode: r.reportCode, fightID: r.fightID, character: o.data.character.name, force }, { store, tables });
    if (!res.ok) { console.error(err(`✗ ${key(r)}: ${res.error}`)); if (res.status === 402) break; continue; }
    results.push(res.result);
    if (!json) {
      console.log(`\n${keyBadgeText(r)} ${r.encounterName}  ${dim(res.fromCache ? "cached · 0 pts" : `${res.pointsSpent ?? "~3"} pts`)}`);
      console.log(renderDeepdive(res.result));
    }
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  closeStore();
}
```

(`keyBadgeText(r)` = `` `+${r.keyLevel}` ``; inline it.) `confirm` is Bun's global (`confirm(message): boolean`).

`cmdDefensives`:

```ts
async function cmdDefensives(className: string | undefined, spec: string | undefined, check: boolean): Promise<void> {
  const t = await loadDefensives();
  if (check) {
    if (t.warning) { console.error(err(`✗ ${t.warning}`)); process.exit(1); }
    console.log(ok(`✓ ${t.overridePath}: ${Object.keys(t.override).length} spec key(s)`));
    return;
  }
  if (!className || !spec) { console.error(err("Usage: bmpl defensives <Class> <Spec> | --check")); process.exit(2); }
  const d = specDefensives(t.shipped, t.override, className, spec);
  console.log(heading(`${d.key}`) + dim(`  override: ${t.overridePath}${t.warning ? "  (ignored: invalid)" : ""}`));
  if (d.tableMissing) console.log(pc.yellow("  no table for this spec — add entries to your defensives.json"));
  for (const e of d.entries) console.log(`  ${String(e.id).padStart(8)}  ${e.name.padEnd(28)} ${e.kind.padEnd(8)} cd ${String(e.cooldownS).padStart(3)}s  dur ${String(e.durationS).padStart(3)}s  ${e.origin === "override" ? pc.cyan("override") : dim("shipped")}`);
  if (d.ignored.length > 0) console.log(dim(`  ignored: ${d.ignored.join(", ")}`));
}
```

`main()` cases:

```ts
      case "analyze": {
        const lvlStr = parseFlag(rest, "--level");
        const spec = parseFlag(rest, "--spec") ?? null;
        const runs = parseFlags(rest, "--run");
        const positional = stripFlags(rest, ["--level", "--spec", "--run"], ["--all", "--force", "--yes", "--json"]);
        const target = resolveTarget(positional);
        if (!target) { console.error(err("Usage: bmpl analyze <Name-Realm> [--run <code>:<fight>]... [--all] [--force] [--yes] [--level <N>] [--spec X] [--json]")); process.exit(2); }
        let lvl: number | null = null;
        if (lvlStr) { lvl = Number.parseInt(lvlStr, 10); if (!Number.isFinite(lvl) || lvl < 2) { console.error(err(`Invalid --level value: ${lvlStr}`)); process.exit(2); } }
        await cmdAnalyze(target.name, target.realm, lvl, spec, runs, hasFlag(rest, "--all"), hasFlag(rest, "--force"), hasFlag(rest, "--yes"), hasFlag(rest, "--json"));
        break;
      }
      case "defensives": {
        const positional = stripFlags(rest, [], ["--check"]);
        await cmdDefensives(positional[0], positional[1], hasFlag(rest, "--check"));
        break;
      }
```

Imports to add: `displayedRuns` from `./signals/enrich.ts`, `getStore` from `./signals/store.ts`, `runDeepdive` from `./deepdive/run.ts`, `getDefensives, loadDefensives, specDefensives` from `./deepdive/table.ts`, `estimateDeepdiveCost` from `./deepdive/wcl.ts`, `renderDeepdive` from `./format-mplus.ts`, `type MPlusRun` from `./mplus.ts`, `type RunDefensives` from `./deepdive/types.ts`, `pc` from `picocolors`.

- [ ] **Step 4: CLI test for `defensives`**

Append to `test/evaluation/cli.test.ts`:

```ts
describe("bmpl defensives", () => {
  const cwd = path.join(import.meta.dir, "..", "..");
  test("prints the effective table for a spec, with the override marked", async () => {
    const p = path.join(tmp, "defensives.json");
    await Bun.write(p, JSON.stringify({ "Paladin:Holy": [{ id: 498, cooldownS: 42 }] }));
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "defensives", "Paladin", "Holy"], { cwd, env: { ...process.env, BMPL_DEFENSIVES: p } });
    expect(proc.exitCode).toBe(0);
    const out = strip(proc.stdout.toString());
    expect(out).toContain("Paladin:Holy");
    expect(out).toMatch(/Divine Protection\s+major\s+cd\s+42s.*override/);
    expect(out).toMatch(/Divine Shield\s+immunity.*shipped/);
    const check = Bun.spawnSync(["bun", "src/cli.ts", "defensives", "--check"], { cwd, env: { ...process.env, BMPL_DEFENSIVES: p } });
    expect(check.exitCode).toBe(0);
    await Bun.write(p, "{ nope");
    const bad = Bun.spawnSync(["bun", "src/cli.ts", "defensives", "--check"], { cwd, env: { ...process.env, BMPL_DEFENSIVES: p } });
    expect(bad.exitCode).toBe(1);
  });
  test("analyze without credentials or without --run lists usage and exits non-zero on a bad target", () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "analyze"], { cwd });
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("Usage: bmpl analyze");
  });
});
```

- [ ] **Step 5: Manual check, README, commit**

Run: `bun test && just check`, then a real smoke test (costs ~3 pts once): `bun src/cli.ts analyze Muleyoxo-Hyjal` (lists runs, 0 pts) and `bun src/cli.ts analyze Muleyoxo-Hyjal --run hGd6gTaqVcyLFZB8:16 --yes` (cached after Task 3's capture only if the same `bmpl.db` was used; otherwise ~3 pts). Paste the panel output in the report.

README: add a "Deep-dive: defensive cooldowns" section after the evaluation section — what it measures (usage vs capacity, deaths with a defensive available), the cost (~3 pts per run, once), the commands, `defensives.json` next to `.env` with the three override shapes (patch / add / ignore) and `BMPL_DEFENSIVES`, and that Survival gains `defensiveUsage` / `avoidableDeaths` once ≥ 2 shown runs are analyzed (`confidence.deepdiveMinRuns`).

```bash
git add src/cli.ts src/format-mplus.ts test/format.test.ts test/evaluation/cli.test.ts README.md
git commit -m "feat(cli): bmpl analyze and bmpl defensives, deep-dive panel rendering"
```

---

### Task 9: Web — types, API client, panel view model

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`
- Create: `web/src/lib/deepdive.ts`
- Test: `web/src/lib/deepdive.test.ts`

**Interfaces:**
- Consumes (types only): `RunDefensives`, `DeathAnalysis`, `DefensiveUse`, `EffectiveEntry`, `OverrideEntry`, `DeepdiveSummary` from `@shared/deepdive/types.ts`.
- Produces: `api.deepdive(req)`, `api.defensives(className, spec)`, `api.patchDefensives(body)`; `analysisFor(p, run)`, `unanalyzedRuns(p)`, `costText(n)`, `panelModel(d)`, `defensivesCell(p)`.

- [ ] **Step 1: Types and API**

`web/src/types.ts`: add `export type { RunDefensives, DeathAnalysis, DefensiveUse, EffectiveEntry, OverrideEntry, DeepdiveSummary, DefensiveKind } from "@shared/deepdive/types.ts";` and

```ts
export interface DeepdiveRequest { reportCode: string; fightID: number; character: string; force?: boolean }
export interface DefensivesResponse { key: string; entries: EffectiveEntry[]; ignored: number[]; tableMissing: boolean; overridePath: string; warning?: string | null }
export interface DefensivesPatch { className: string; spec: string; patch: OverrideEntry }
```

`web/src/api.ts`:

```ts
  deepdive: (req: DeepdiveRequest) =>
    call<{ result: RunDefensives; fromCache: boolean; pointsSpent: number | null }>("/api/deepdive", post(req)),
  defensives: (className: string, spec: string) =>
    call<DefensivesResponse>(`/api/defensives?class=${encodeURIComponent(className)}&spec=${encodeURIComponent(spec)}`),
  patchDefensives: (body: DefensivesPatch) => call<DefensivesResponse>("/api/defensives", post(body)),
```

Add a case to `web/src/api.test.ts` mirroring the existing ones (it stubs `fetch`): `api.deepdive` posts JSON to `/api/deepdive` and returns `{ ok: true, result, fromCache, pointsSpent }`.

- [ ] **Step 2: Write the failing view-model test**

`web/src/lib/deepdive.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { LookupPayload, RunDefensives } from "../types.ts";
import { analysisFor, costText, defensivesCell, panelModel, unanalyzedRuns } from "./deepdive.ts";

const dd = (over: Partial<RunDefensives> = {}): RunDefensives => ({
  reportCode: "ABC", fightID: 3, character: "Muleyoxo", className: "Paladin", spec: "Holy", tableMissing: false, tableVersion: "t",
  defensives: [
    { id: 498, name: "Divine Protection", cooldownS: 60, durationS: 8, kind: "major", origin: "shipped", casts: 27, capacity: 30, usage: 0.9, observedMinIntervalS: 38, cdMismatch: true },
    { id: 642, name: "Divine Shield", cooldownS: 300, durationS: 8, kind: "immunity", origin: "override", casts: 5, capacity: 6, usage: 5 / 6, observedMinIntervalS: 310, cdMismatch: false },
    { id: 1022, name: "Blessing of Protection", cooldownS: 300, durationS: 10, kind: "minor", origin: "shipped", casts: 3, capacity: 6, usage: 0.5, observedMinIntervalS: null, cdMismatch: false },
  ],
  deaths: [
    { atMs: 1_764_223, inWipe: false, killingHits: [{ name: "Cosmic Crash", amount: 559197, share: 0.55 }, { name: "Unstable Singularity", amount: 458887, share: 0.45 }], killingBlow: "Unstable Singularity", available: ["Divine Shield"], active: [], onCooldown: [{ name: "Divine Protection", readyInS: 12 }], verdict: "immunity available" },
    { atMs: 100_000, inWipe: true, killingHits: [], killingBlow: null, available: [], active: ["Divine Protection"], onCooldown: [], verdict: "covered" },
  ],
  majorUsage: 0.87, avoidableDeaths: 1, countedDeaths: 1,
  unlisted: [{ id: 31821, name: "Aura Mastery", casts: 2, uptimeS: 16 }],
  staleTable: false, truncated: false, fetchedAt: 1_000_000, pointsSpent: 3,
  ...over,
});

const payload = (deepdive: RunDefensives[], runs = [{ reportCode: "ABC", fightID: 3 }, { reportCode: "DEF", fightID: 1 }]): LookupPayload =>
  ({
    character: { name: "Muleyoxo" },
    perDungeon: { runs: runs.map((r) => ({ ...r, signals: {} })) },
    prevLevelBest: null,
    deepdive,
    deepdiveSummary: { analyzedRuns: deepdive.length, majorUsage: deepdive[0]?.majorUsage ?? null, avoidableDeathShare: deepdive.length ? 1 : null, avoidableDeaths: deepdive.length, countedDeaths: deepdive.length },
  }) as unknown as LookupPayload;

describe("analysisFor / unanalyzedRuns / costText", () => {
  test("finds the analysis of a run and lists runs still to analyze (only runs with signals)", () => {
    const p = payload([dd()]);
    expect(analysisFor(p, { reportCode: "ABC", fightID: 3 })?.spec).toBe("Holy");
    expect(analysisFor(p, { reportCode: "DEF", fightID: 1 })).toBeNull();
    expect(unanalyzedRuns(p).map((r) => r.reportCode)).toEqual(["DEF"]);
    const noSig = payload([], [{ reportCode: "X", fightID: 1 }]);
    (noSig.perDungeon.runs[0] as { signals?: unknown }).signals = undefined;
    expect(unanalyzedRuns(noSig)).toEqual([]);
  });
  test("cost text", () => {
    expect(costText(1)).toBe("~3 pts");
    expect(costText(8)).toBe("~24 pts");
  });
});

describe("panelModel", () => {
  test("usage rows, deaths, audit and headline", () => {
    const m = panelModel(dd(), 1_000_000 + 2 * 3600_000);
    expect(m.title).toBe("Defensives · Holy Paladin");
    expect(m.meta).toBe("analyzed 2h ago · 3 pts");
    expect(m.usage[0]).toEqual({ id: 498, name: "Divine Protection", kind: "major", counts: "27 / 30", pct: 90, pctText: "90%", cls: "tone-good", cd: "cd 60 s · seen 38 s", mismatch: true, origin: "shipped", countsUsage: true });
    expect(m.usage[2]!.countsUsage).toBe(false);
    expect(m.usage[2]!.pctText).toBe("—");
    expect(m.majorsText).toBe("majors used 87% of possible");
    expect(m.deathsHeadline).toBe("1/1 deaths with a defensive available");
    expect(m.deaths[0]).toEqual({
      time: "29:24", verdict: "immunity available", cls: "tone-bad", wipe: false,
      hits: "Cosmic Crash 55% · Unstable Singularity 45%", blow: "killing blow: Unstable Singularity",
      states: [{ text: "Divine Shield available", cls: "tone-bad" }, { text: "Divine Protection on cd · 12 s left", cls: "faint" }],
    });
    expect(m.deaths[1]!.wipe).toBe(true);
    expect(m.deaths[1]!.cls).toBe("tone-good");
    expect(m.deaths[1]!.states).toEqual([{ text: "Divine Protection active", cls: "tone-good" }]);
    expect(m.unlisted).toEqual([{ id: 31821, name: "Aura Mastery", text: "Aura Mastery · 2× · 16 s up" }]);
    expect(m.tableUsed).toBe("Table used: Holy Paladin · 3 entries · 1 from your override");
    expect(m.notice).toBeNull();
  });
  test("verdict tones and notices", () => {
    expect(panelModel(dd({ deaths: [{ ...dd().deaths[0]!, verdict: "defensive available" }] })).deaths[0]!.cls).toBe("tone-warn");
    expect(panelModel(dd({ deaths: [{ ...dd().deaths[0]!, verdict: "nothing available" }] })).deaths[0]!.cls).toBe("tone-good");
    expect(panelModel(dd({ deaths: [], countedDeaths: 0, avoidableDeaths: 0 })).deathsHeadline).toBe("No deaths");
    expect(panelModel(dd({ tableMissing: true, defensives: [], majorUsage: null })).notice).toBe("No defensives table for Holy Paladin yet — add entries from the audit below.");
    expect(panelModel(dd({ staleTable: true })).notice).toBe("The table changed since this run was analyzed — re-analyze to include the new entries.");
    expect(panelModel(dd({ truncated: true })).notice).toBe("Cast events were truncated (more than 5 pages) — counts may be low.");
    expect(panelModel(dd({ pointsSpent: null })).meta).toMatch(/analyzed .* ago$/);
  });
});

describe("defensivesCell", () => {
  test("usage and avoidable share; dash without analyses", () => {
    expect(defensivesCell(payload([dd()]))).toEqual({ text: "87% · 1/1 avoidable", value: 0.87 });
    expect(defensivesCell(payload([]))).toEqual({ text: "—", value: null });
    const noDeaths = payload([dd({ countedDeaths: 0, avoidableDeaths: 0 })]);
    noDeaths.deepdiveSummary = { analyzedRuns: 1, majorUsage: 0.5, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 };
    expect(defensivesCell(noDeaths)).toEqual({ text: "50% · no deaths", value: 0.5 });
  });
});
```

- [ ] **Step 3: Implement `web/src/lib/deepdive.ts`**

```ts
import type { DeathAnalysis, DefensiveUse, LookupPayload, MPlusRun, RunDefensives } from "../types.ts";
import { fmtAge } from "./format.ts";

export const POINTS_PER_RUN = 3;
export const costText = (runs: number): string => `~${runs * POINTS_PER_RUN} pts`;

const runKey = (r: { reportCode: string; fightID: number }) => `${r.reportCode}:${r.fightID}`;

export const analysisFor = (p: LookupPayload, run: { reportCode: string; fightID: number }): RunDefensives | null =>
  p.deepdive.find((d) => runKey(d) === runKey(run)) ?? null;

/** Displayed runs that have signals (so a deep-dive is possible) and no analysis yet. */
export function unanalyzedRuns(p: LookupPayload): MPlusRun[] {
  const done = new Set(p.deepdive.map(runKey));
  const all: MPlusRun[] = [...(p.prevLevelBest ? [p.prevLevelBest.best] : []), ...p.perDungeon.runs];
  const seen = new Set<string>();
  return all.filter((r) => { const k = runKey(r); if (seen.has(k) || !r.signals || done.has(k)) return false; seen.add(k); return true; });
}

export interface UsageRow { id: number; name: string; kind: DefensiveUse["kind"]; counts: string; pct: number; pctText: string; cls: string; cd: string; mismatch: boolean; origin: DefensiveUse["origin"]; countsUsage: boolean }
export interface DeathLine { time: string; verdict: DeathAnalysis["verdict"]; cls: string; wipe: boolean; hits: string; blow: string | null; states: { text: string; cls: string }[] }
export interface PanelModel {
  title: string; meta: string; notice: string | null;
  usage: UsageRow[]; majorsText: string | null;
  deathsHeadline: string; deaths: DeathLine[];
  unlisted: { id: number; name: string; text: string }[]; tableUsed: string;
}

const mmss = (ms: number): string => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const usageTone = (pct: number): string => (pct >= 70 ? "tone-good" : pct >= 40 ? "tone-warn" : "tone-bad");
const verdictTone = (v: DeathAnalysis["verdict"]): string => (v === "immunity available" ? "tone-bad" : v === "defensive available" ? "tone-warn" : "tone-good");

const usageRow = (u: DefensiveUse): UsageRow => {
  const pct = Math.round(u.usage * 100);
  const countsUsage = u.kind !== "minor";
  return {
    id: u.id, name: u.name, kind: u.kind, counts: `${u.casts} / ${u.capacity}`, pct,
    pctText: countsUsage ? `${pct}%` : "—", cls: countsUsage ? usageTone(pct) : "faint",
    cd: `cd ${u.cooldownS} s${u.observedMinIntervalS !== null ? ` · seen ${u.observedMinIntervalS} s` : ""}`,
    mismatch: u.cdMismatch, origin: u.origin, countsUsage,
  };
};

const deathLine = (x: DeathAnalysis): DeathLine => ({
  time: mmss(x.atMs), verdict: x.verdict, cls: verdictTone(x.verdict), wipe: x.inWipe,
  hits: x.killingHits.map((h) => `${h.name} ${Math.round(h.share * 100)}%`).join(" · "),
  blow: x.killingBlow ? `killing blow: ${x.killingBlow}` : null,
  states: [
    ...x.active.map((n) => ({ text: `${n} active`, cls: "tone-good" })),
    ...x.available.map((n) => ({ text: `${n} available`, cls: "tone-bad" })),
    ...x.onCooldown.map((c) => ({ text: `${c.name} on cd · ${c.readyInS} s left`, cls: "faint" })),
  ],
});

export function panelModel(d: RunDefensives, now = Date.now()): PanelModel {
  const specClass = `${d.spec} ${d.className}`;
  const overrides = d.defensives.filter((u) => u.origin === "override").length;
  let notice: string | null = null;
  if (d.tableMissing) notice = `No defensives table for ${specClass} yet — add entries from the audit below.`;
  else if (d.staleTable) notice = "The table changed since this run was analyzed — re-analyze to include the new entries.";
  else if (d.truncated) notice = "Cast events were truncated (more than 5 pages) — counts may be low.";
  return {
    title: `Defensives · ${specClass}`,
    meta: `analyzed ${fmtAge(d.fetchedAt, now)}${d.pointsSpent !== null ? ` · ${d.pointsSpent} pts` : ""}`,
    notice,
    usage: d.defensives.map(usageRow),
    majorsText: d.majorUsage === null ? null : `majors used ${Math.round(d.majorUsage * 100)}% of possible`,
    deathsHeadline: d.deaths.length === 0 ? "No deaths" : `${d.avoidableDeaths}/${d.countedDeaths} deaths with a defensive available`,
    deaths: d.deaths.map(deathLine),
    unlisted: d.unlisted.map((u) => ({ id: u.id, name: u.name, text: `${u.name} · ${u.casts}× · ${u.uptimeS} s up` })),
    tableUsed: `Table used: ${specClass} · ${d.defensives.length} entries · ${overrides} from your override`,
  };
}

/** Compare-table cell. */
export function defensivesCell(p: LookupPayload): { text: string; value: number | null } {
  const s = p.deepdiveSummary;
  if (s.analyzedRuns === 0 || s.majorUsage === null) return { text: "—", value: null };
  const deaths = s.countedDeaths === 0 ? "no deaths" : `${s.avoidableDeaths}/${s.countedDeaths} avoidable`;
  return { text: `${Math.round(s.majorUsage * 100)}% · ${deaths}`, value: s.majorUsage };
}
```

(`fmtAge(ms, now)` in `web/src/lib/format.ts` yields `2h ago` for a two-hour age.)

- [ ] **Step 4: Run, typecheck, commit**

Run: `bun test web/src && just check`
Expected: PASS.

```bash
git add web/src/types.ts web/src/api.ts web/src/api.test.ts web/src/lib/deepdive.ts web/src/lib/deepdive.test.ts
git commit -m "feat(web): deep-dive API client and panel view model"
```

---

### Task 10: Web — run-row actions, Defensives panel, App wiring, styles

**Files:**
- Create: `web/src/components/RunDeepDive.tsx`
- Modify: `web/src/components/DungeonRuns.tsx`, `web/src/components/Detail.tsx`, `web/src/App.tsx`, `web/src/styles/app.css`

**Interfaces:**
- Consumes: Task 9 (`api.deepdive`, `api.patchDefensives`, `panelModel`, `analysisFor`, `unanalyzedRuns`, `costText`).
- Produces: `DetailProps` gains `deepdive: DeepdiveActions` = `{ analyzing: string | null; progress: string | null; analyze: (run, force?) => Promise<void>; analyzeAll: () => Promise<void>; patch: (className, spec, patch: OverrideEntry) => Promise<void> }`.

Layout (mirrors the design canvas "deep-dive" page — the controller shows it to the user before this task runs; match it):

```
run row ……………………………………………………………………………  [Analyze · ~3 pts]   ↗
run row (analyzed) …………………………………………………  [Analyzed ✓ ▾]       ↗
  ┌ Defensives · Holy Paladin      analyzed 2 h ago · 3 pts        [Re-analyze · ~3 pts] ┐
  │ (notice line, when any)                                                              │
  │ USAGE                                                                                │
  │  Divine Protection   major     27 / 30   90% ▰▰▰▰▰▰▰▰▰▱   cd 60 s · seen 38 s  talent?│
  │  Divine Shield       immunity   5 / 6    83% ▰▰▰▰▰▰▰▰▱▱   cd 300 s · seen 310 s      │
  │  Blessing of Prot.   minor      3 / 6     —               cd 300 s                    │
  │  majors used 87% of possible                                                          │
  │ DEATHS · 1/1 deaths with a defensive available                                       │
  │  29:24  immunity available    Cosmic Crash 55% · Unstable Singularity 45%            │
  │         Divine Shield available · Divine Protection on cd · 12 s left                │
  │  1:40   covered  wipe         (no hits)                                              │
  │ AUDIT                                                                                 │
  │  Not in table: Aura Mastery · 2× · 16 s up   [+ major] [+ immunity] [+ minor] [Ignore]│
  │  ▸ Table used: Holy Paladin · 3 entries · 1 from your override                       │
  │      Divine Protection  major  cd 60 s  [Edit cd] [Remove]   (expanded)              │
  └───────────────────────────────────────────────────────────────────────────────────────┘
section header right side: [Analyze all shown (~24 pts)]  — or "Analyzing 2/8…" while running
```

- [ ] **Step 1: `RunDeepDive.tsx`**

```tsx
import { useState } from "react";
import type { DefensiveKind, OverrideEntry, RunDefensives } from "../types.ts";
import { costText, panelModel } from "../lib/deepdive.ts";

interface Props {
  d: RunDefensives;
  busy: boolean;
  onReanalyze: () => void;
  onPatch: (patch: OverrideEntry) => Promise<void>;
}

const KINDS: DefensiveKind[] = ["major", "immunity", "minor"];

export function RunDeepDive({ d, busy, onReanalyze, onPatch }: Props) {
  const m = panelModel(d);
  const [tableOpen, setTableOpen] = useState(false);
  // Inline "add" form: which unlisted id, as which kind.
  const [adding, setAdding] = useState<{ id: number; name: string; kind: DefensiveKind } | null>(null);
  const [cd, setCd] = useState("60");
  const [dur, setDur] = useState("8");
  // Inline "edit cooldown" form for a table row.
  const [editing, setEditing] = useState<{ id: number; cd: string } | null>(null);

  const submitAdd = async () => {
    if (!adding) return;
    const cooldownS = Number(cd); const durationS = Number(dur);
    if (!Number.isFinite(cooldownS) || cooldownS <= 0 || !Number.isFinite(durationS) || durationS < 0) return;
    await onPatch({ id: adding.id, name: adding.name, kind: adding.kind, cooldownS, durationS });
    setAdding(null);
  };
  const submitEdit = async () => {
    if (!editing) return;
    const cooldownS = Number(editing.cd);
    if (!Number.isFinite(cooldownS) || cooldownS <= 0) return;
    await onPatch({ id: editing.id, cooldownS });
    setEditing(null);
  };

  return (
    <div className="dd inset">
      <div className="dd-head">
        <span className="dd-title">{m.title}</span>
        <span className="muted">{m.meta}</span>
        <div className="grow" />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onReanalyze}>Re-analyze · {costText(1)}</button>
      </div>
      {m.notice && <div className="dd-notice tone-warn">{m.notice}</div>}

      {m.usage.length > 0 && (
        <>
          <div className="label-caps dd-section">Usage</div>
          <div className="dd-usage">
            {m.usage.map((u) => (
              <div key={u.id} className="dd-row">
                <span>{u.name}{u.origin === "override" && <span className="faint"> · override</span>}</span>
                <span className="faint">{u.kind}</span>
                <span className="mono">{u.counts}</span>
                <span className={"mono " + u.cls}>{u.pctText}</span>
                <span className="dd-bar" aria-hidden="true"><span style={{ width: `${u.countsUsage ? u.pct : 0}%` }} /></span>
                <span className="faint">{u.cd}{u.mismatch && <span className="chip chip-warn" title="Casts seen closer than the table cooldown — a talent, or the table is wrong">talent?</span>}</span>
              </div>
            ))}
          </div>
          {m.majorsText && <div className="muted dd-foot">{m.majorsText}</div>}
        </>
      )}

      <div className="label-caps dd-section">Deaths · <span className="muted">{m.deathsHeadline}</span></div>
      {m.deaths.map((x, i) => (
        <div key={i} className={"dd-death" + (x.wipe ? " dd-wipe" : "")}>
          <span className="mono">{x.time}</span>
          <span className={x.cls}>{x.verdict}{x.wipe && <span className="chip"> wipe</span>}</span>
          <span className="faint">{x.hits || "—"}{x.blow && <span> · {x.blow}</span>}</span>
          <span className="dd-states">{x.states.map((s, j) => <span key={j} className={s.cls}>{j > 0 && <span className="faint"> · </span>}{s.text}</span>)}</span>
        </div>
      ))}

      <div className="label-caps dd-section">Audit</div>
      {m.unlisted.length === 0 && <div className="faint dd-foot">Every self-cast buff is in the table.</div>}
      {m.unlisted.map((u) => (
        <div key={u.id} className="dd-audit">
          <span>{u.text}</span>
          {adding?.id === u.id ? (
            <span className="dd-form">
              <label>cd <input className="mono" value={cd} onChange={(e) => setCd(e.target.value)} size={4} /> s</label>
              <label>duration <input className="mono" value={dur} onChange={(e) => setDur(e.target.value)} size={4} /> s</label>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void submitAdd()}>Add as {adding.kind}</button>
              <button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>Cancel</button>
            </span>
          ) : (
            <span className="dd-actions">
              {KINDS.map((k) => <button key={k} type="button" className="chip" disabled={busy} onClick={() => setAdding({ id: u.id, name: u.name, kind: k })}>+ {k}</button>)}
              <button type="button" className="chip" disabled={busy} onClick={() => void onPatch({ id: u.id, ignore: true })}>Ignore</button>
            </span>
          )}
        </div>
      ))}
      <button type="button" className="section-head dd-table-head" onClick={() => setTableOpen((o) => !o)} aria-expanded={tableOpen}>
        <span className={"chev" + (tableOpen ? " open" : "")}>›</span>
        <span className="muted">{m.tableUsed}</span>
      </button>
      {tableOpen && d.defensives.map((u) => (
        <div key={u.id} className="dd-audit">
          <span>{u.name} <span className="faint">{u.kind} · cd {u.cooldownS} s · {u.durationS} s{u.origin === "override" ? " · override" : ""}</span></span>
          {editing?.id === u.id ? (
            <span className="dd-form">
              <label>cd <input className="mono" value={editing.cd} onChange={(e) => setEditing({ id: u.id, cd: e.target.value })} size={4} /> s</label>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void submitEdit()}>Save</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </span>
          ) : (
            <span className="dd-actions">
              <button type="button" className="chip" disabled={busy} onClick={() => setEditing({ id: u.id, cd: String(u.cooldownS) })}>Edit cd</button>
              <button type="button" className="chip" disabled={busy} onClick={() => void onPatch({ id: u.id, ignore: true })}>Remove for this spec</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `DungeonRuns.tsx`**

Props become `{ payload: LookupPayload; deepdive: DeepdiveActions }`. Per row, after the `↗` link:

```tsx
{(() => {
  const run = payload.perDungeon.runs.find((x) => `${x.reportCode}:${x.fightID}` === r.key)!;
  const a = analysisFor(payload, run);
  const busy = deepdive.analyzing === r.key;
  if (!run.signals) return <span className="faint" title="No WCL stats for this run">—</span>;
  if (!a) return <button type="button" className="btn btn-sm" disabled={deepdive.analyzing !== null} onClick={() => void deepdive.analyze(run)}>{busy ? <span className="spinner" /> : null} Analyze · {costText(1)}</button>;
  return <button type="button" className={"btn btn-sm" + (openRow === r.key ? " active" : "")} onClick={() => setOpenRow(openRow === r.key ? null : r.key)}>Analyzed ✓ <span className={"chev" + (openRow === r.key ? " open" : "")}>›</span></button>;
})()}
```

and, after the row `div` when `openRow === r.key` and an analysis exists: `<RunDeepDive d={a} busy={deepdive.analyzing !== null} onReanalyze={() => void deepdive.analyze(run, true)} onPatch={(patch) => deepdive.patch(a.className, a.spec, patch)} />`. `openRow` is a new `useState<string | null>(null)` in `DungeonRuns` (the existing `open` state stays the section toggle). Restructure the row loop into a small `RunRow` component so the lookups happen once per row (no IIFE in JSX). The `.run` grid gains one column: `grid-template-columns: 150px minmax(0, 1fr) 80px 70px 100px 110px 140px 24px`.

Section header: keep the toggle button, add to its right (outside the button element) `<div className="grow" />` and

```tsx
{pending > 0 && <button type="button" className="btn btn-sm" disabled={deepdive.analyzing !== null} onClick={() => void deepdive.analyzeAll()}>{deepdive.progress ?? `Analyze all shown (${costText(pending)})`}</button>}
```

where `const pending = unanalyzedRuns(payload).length;`. Wrap header + button in `<div className="section-row">` (flex).

- [ ] **Step 3: `Detail.tsx` and `App.tsx`**

`DetailProps` gains `deepdive: DeepdiveActions` (export the interface from `Detail.tsx`) and passes it to `DungeonRuns`.

In `App.tsx` `Main`:

```tsx
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  /** Drop every cached payload (analyses/table edits affect all tabs server-side) and reload the active one. */
  const reloadActive = useCallback(async () => {
    payloads.current.clear();
    if (activeKey) await fetchPayload(activeKey);
    touch();
  }, [activeKey, fetchPayload]);

  const analyze = useCallback(async (run: { reportCode: string; fightID: number }, force = false) => {
    if (!activePayload) return;
    const key = `${run.reportCode}:${run.fightID}`;
    setAnalyzing(key);
    const r = await api.deepdive({ reportCode: run.reportCode, fightID: run.fightID, character: activePayload.character.name, force });
    setAnalyzing(null);
    if (!r.ok) { setToast(r.error); return false; }
    await reloadActive();
    return true;
  }, [activePayload, reloadActive]);

  const analyzeAll = useCallback(async () => {
    if (!activePayload) return;
    const todo = unanalyzedRuns(activePayload);
    for (let i = 0; i < todo.length; i++) {
      setProgress(`Analyzing ${i + 1}/${todo.length}…`);
      const ok = await analyze(todo[i]!);
      if (!ok) break; // a 402/502 stops the batch; the toast says why
    }
    setProgress(null);
  }, [activePayload, analyze]);

  const patchDefensives = useCallback(async (className: string, spec: string, patch: OverrideEntry) => {
    const r = await api.patchDefensives({ className, spec, patch });
    if (!r.ok) { setToast(r.error); return; }
    await reloadActive();
  }, [reloadActive]);

  const deepdiveActions: DeepdiveActions = { analyzing, progress, analyze: async (run, force) => { await analyze(run, force); }, analyzeAll, patch: patchDefensives };
```

(`analyze` returns `boolean | undefined` internally; the `DeepdiveActions.analyze` wrapper returns `void`.) Pass `deepdive={deepdiveActions}` to `<Detail>`. Note `reloadActive` after an analysis re-fetches `/api/history/:key`, whose payload the server refreshed (Task 7) — `analyze` must **not** write `r.result` into the payload cache itself.

- [ ] **Step 4: Styles**

Append to `web/src/styles/app.css` (tokens only from `tokens.css`):

```css
/* --- deep-dive panel --- */
.btn-sm { height: 26px; padding: 0 9px; font-size: 12px; }
.btn.active { color: var(--text); border-color: var(--muted); }
.section-row { display: flex; align-items: center; gap: 10px; }
.dd { margin: 0 10px 8px; padding: 10px 12px; font-size: 13px; }
.dd-head { display: flex; align-items: center; gap: 10px; }
.dd-title { font-weight: 600; }
.dd-notice { font-size: 12px; margin-top: 6px; }
.dd-section { margin-top: 12px; margin-bottom: 4px; }
.dd-row { display: grid; grid-template-columns: minmax(160px, 1.2fr) 70px 70px 48px 120px minmax(0, 1fr); gap: 10px; align-items: center; padding: 3px 0; }
.dd-bar { display: inline-block; height: 6px; background: var(--border-soft); border-radius: 3px; overflow: hidden; }
.dd-bar > span { display: block; height: 100%; background: var(--green); }
.dd-foot { font-size: 12px; margin-top: 4px; }
.dd-death { display: grid; grid-template-columns: 48px 180px minmax(0, 1fr); gap: 10px; padding: 4px 0; align-items: baseline; }
.dd-death .dd-states { grid-column: 2 / -1; font-size: 12px; }
.dd-wipe { opacity: .6; }
.dd-audit { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 3px 0; }
.dd-actions { display: inline-flex; gap: 6px; }
.dd-form { display: inline-flex; gap: 8px; align-items: center; font-size: 12px; }
.dd-form input { width: 48px; height: 24px; padding: 0 6px; }
.dd-table-head { margin-top: 8px; font-size: 12px; }
.chip-warn { color: var(--warn); border-color: var(--yellow-border); margin-left: 6px; }
@media (max-width: 900px) {
  .dd-row { grid-template-columns: minmax(0, 1fr) 60px 60px 44px; }
  .dd-row .dd-bar, .dd-row > :last-child { display: none; }
  .dd-death { grid-template-columns: 48px minmax(0, 1fr); }
  .dd-death .dd-states { grid-column: 1 / -1; }
}
```

Edit the existing `.run` rule's `grid-template-columns` to the 8-column value above — do not add a second `.run` rule.

- [ ] **Step 5: Verify visually and commit**

Run: `just check && bun test web/src`, then `just web-build && bun build src/cli.ts --compile --outfile bmpl && pkill -f "bmpl serve"; ./bmpl serve --no-open --port 3000 &`. In a browser (or `curl` the payload) look up a character with cached runs, click **Analyze** on one run (~3 pts), open the panel, edit a cooldown from the audit "Table used" list and see the panel update; click **Analyze all shown** on a second character only if the user has agreed to the cost (say so in the report instead of spending). Kill the server afterwards.

```bash
git add web/src/components/RunDeepDive.tsx web/src/components/DungeonRuns.tsx web/src/components/Detail.tsx web/src/App.tsx web/src/styles/app.css
git commit -m "feat(web): per-run Analyze actions and the Defensives panel with table corrections"
```

---

### Task 11: Web — Survival badge, compare row, docs

**Files:**
- Modify: `web/src/lib/axes.ts`, `web/src/lib/axes.test.ts`, `web/src/components/AxisRows.tsx`, `web/src/lib/compare.ts`, `web/src/lib/compare.test.ts`, `web/src/components/VerdictHero.tsx` (only if `axisRows` is called there), `README.md`

- [ ] **Step 1: Failing tests**

`web/src/lib/axes.test.ts` — extend the `Evaluation` literal(s) with `analyzedRuns: 0` and add:

```ts
  test("survival carries an analyzed-runs badge when deep-dive evidence exists", () => {
    const rows = axisRows({ ...ev, analyzedRuns: 3 });
    expect(rows.find((r) => r.key === "survival")!.badge).toBe("3 runs analyzed");
    expect(rows.find((r) => r.key === "utility")!.badge).toBeNull();
    expect(axisRows({ ...ev, analyzedRuns: 1 }).find((r) => r.key === "survival")!.badge).toBe("1 run analyzed");
    expect(axisRows(ev).find((r) => r.key === "survival")!.badge).toBeNull();
  });
```

(`ev` = whichever `Evaluation` fixture the file already builds.)

`web/src/lib/compare.test.ts` — the `payload()` helper gains `deepdive: [], deepdiveSummary: { analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 }` and the `evaluation` literal gains `analyzedRuns: 0`; add:

```ts
  test("Defensives row: higher usage wins, dash without analyses", () => {
    const a = payload({ deepdiveSummary: { analyzedRuns: 2, majorUsage: 0.8, avoidableDeathShare: 0.5, avoidableDeaths: 1, countedDeaths: 2 } });
    const b = payload({});
    const s = compareSections([a, b]);
    const row = s.find((x) => x.title === "Summary")!.rows.find((r) => r.label === "Defensives")!;
    expect(row.cells[0]).toEqual({ text: "80% · 1/2 avoidable", cls: "", best: true });
    expect(row.cells[1]).toEqual({ text: "—", cls: "faint", best: false });
  });
```

- [ ] **Step 2: Implement**

`web/src/lib/axes.ts`: `AxisRowModel` gains `badge: string | null`; in `axisRows`, `badge: key === "survival" && ev.analyzedRuns > 0 ? `${ev.analyzedRuns} run${ev.analyzedRuns === 1 ? "" : "s"} analyzed` : null`.

`web/src/components/AxisRows.tsx`: after the `label-caps` span, `{r.badge && <span className="chip" title="Deep-dive analyses feed this axis">{r.badge}</span>}`.

`web/src/lib/compare.ts`: import `defensivesCell` from `./deepdive.ts`; in the Summary rows, after "Kicks vs peers":

```ts
      row("Defensives", "higher", ps.map((p) => defensivesCell(p).value), ps.map((p) => { const c = defensivesCell(p); return cell(c.text, c.value === null ? "faint" : ""); })),
```

- [ ] **Step 3: README**

In the "Graphical UI" section add a short "Deep-dive a run" paragraph: the per-run **Analyze · ~3 pts** button, **Analyze all shown**, what the panel shows (usage vs capacity, deaths with what was available, the audit) and that table corrections (add / ignore / edit cooldown / remove) are saved to `defensives.json` next to `.env` and applied to every tab at 0 pts. In "API cost" add `analyze: ~3 pts per run, once ever (cached forever); re-opening tabs or correcting the table costs 0`. In "Verdict and axes" mention the two Survival sub-signals and `confidence.deepdiveMinRuns`. In "Repo layout" add `src/deepdive/`.

- [ ] **Step 4: Run everything, commit**

Run: `bun test && just check && just web-build`
Expected: PASS, build ok.

```bash
git add web/src README.md
git commit -m "feat(web): survival analyzed-runs badge, Defensives compare row, docs"
```

---

## Self-review notes (controller)

- Spec coverage: table + override (T1), store (T2), fetch + budget + pagination + fixtures (T3), analyzer incl. audit and cdMismatch (T4), aggregation + sub-signals + `deepdiveMinRuns` + `analyzedRuns` (T5), payload attach at 0 pts + CLI line (T6), routes + history refresh (T7), `bmpl analyze` / `bmpl defensives` (T8), web API + view model (T9), panel + actions + Analyze all (T10), badge + compare + README (T11).
- Deviation from the spec, ruled here: **no `POST /api/deepdive/batch` and no SSE `deepdive` events** — "Analyze all shown" is a client-side sequential loop over `POST /api/deepdive` with the same stop-on-402 behaviour and inline progress. Same user-visible result, one route fewer; the spec was amended with this plan.
- `pointsSpent` is measured as the delta of `pointsSpentThisHour` between consecutive deep-dive answers in the process (null on the first); the UI shows the ~3 estimate before the click and the measured value after.
