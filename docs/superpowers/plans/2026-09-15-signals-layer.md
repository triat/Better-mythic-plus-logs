# Signals Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add timed/depleted, cooldown-normalized interrupts, dispels, avoidable damage, death context and a Raider.IO profile to every `bmpl` lookup, backed by a SQLite store so each WCL enrichment is paid for once.

**Architecture:** A new `src/signals/` layer holds pure parsers (`wcl-run.ts`, `rio-profile.ts`) over raw JSON, a generic `peerComparison`, a `bun:sqlite` store of raw responses, and two orchestrators (`enrich.ts`, `rio-client.ts`) that are the only network/store touchpoints. A new `src/lookup.ts` consolidates the lookup flow that is currently duplicated across `cli.ts`, `server.ts` and `watch.ts`. Rendering (CLI + inline web UI) is extended minimally; no redesign.

**Tech Stack:** Bun 1.3 (runtime, `bun test`, `bun:sqlite`), TypeScript strict, WCL GraphQL v2, Raider.IO REST v1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-signals-design.md`

## Global Constraints

- Bun ≥ 1.3, TypeScript strict; `bun run typecheck` must stay clean after every task.
- No new runtime dependencies (`bun:sqlite` is built in).
- Region stays hardcoded `EU` (`config.region`); Raider.IO uses the lowercase form.
- Parsers in `src/signals/` are pure functions over JSON and never throw on missing sub-tables.
- `enrich.ts` and `rio-client.ts` are the only modules that touch the network or the store.
- A Raider.IO failure never fails a lookup: `rio: null` + `rioError`.
- WCL raw rows never expire; Raider.IO rows expire after 1 h (`refresh` bypasses).
- `bmpl.db` lives next to `.env` and is git-ignored.
- Previous-season Raider.IO score absence renders `—` (never `0`) and is never penalized.
- Avoidable-damage data is attributed to postmortem (`lonezebra`, https://github.com/Sharpened-Banana/postmortem) in the data file and README.
- No composite score, no per-role interpretation, no WCL↔RIO join, no UI redesign.

## Reference: fixture facts (already captured in `test/fixtures/`)

`test/fixtures/wcl-run-s1-magisters-terrace-tank.json` — `{ character: "Biwaadrood", run, report }`, report has `fights`, `summary`, `damageTaken`, `deaths`, `interrupts`, `dispels` (no `avoidable`).

| Fact | Value |
|---|---|
| fight | `encounterID 12811`, `keystoneLevel 18`, `keystoneBonus 1`, `keystoneTime 1751502`, `keystoneAffixes [10,9,147]`, `startTime 150874` |
| `summary.data.totalTime` | `1700498` |
| roles | Biwaadrood tank (Guardian Druid), Mariabanks dps (BeastMastery Hunter), Forssaken dps (Unholy DK), Mstercheif dps (Windwalker Monk), Aicham healer (Restoration Shaman) |
| ilvl (min) | Biwaadrood 280, Mariabanks 284, Forssaken 283, Mstercheif 283, Aicham 278 |
| damageTaken totals | Biwaadrood 112246233, Mariabanks 32707271, Mstercheif 39472185, Forssaken 34730334, Aicham 40862303 |
| deaths (name, ms since fight start, top ability, top source, overkill) | Mstercheif 98742 Holy Fire / Lightward Healer / 11498; Mstercheif 272004 Holy Fire / Lightward Healer / 790; Mstercheif 568766 Runic Glaive / Runed Spellbreaker / 54794; Mariabanks 1125739 Consuming Shadows / Shadowrift Voidcaller / 53393 |
| interrupts per player | Biwaadrood 23, Mariabanks 16, Mstercheif 16, Forssaken 24, Aicham 4 |
| dispels per player | Mariabanks 21, Aicham 37, Forssaken 4, Mstercheif 1 (Biwaadrood absent = 0) |

`test/fixtures/wcl-run-s2-voidscar-arena-healer.json` — `{ character: "Muleyoxo", run, report }`, report additionally has `avoidable` (DamageTaken filtered on the postmortem list).

| Fact | Value |
|---|---|
| fight | `encounterID 12923`, `keystoneLevel 21`, `keystoneBonus 1`, `keystoneTime 1796309`, `keystoneAffixes [9,10,147]` |
| `summary.data.totalTime` | `1775032` |
| roles | Muleyoxo healer (Holy Priest), Deeprayaa dps (Elemental Shaman), Bizentein dps (Arms Warrior), Wazocutie tank (Blood DK), Zerøcool dps (Assassination Rogue) |
| deaths (ms since fight start) | Deeprayaa 1324905, Bizentein 1412843, Muleyoxo 1764223, Deeprayaa 1768262, Zerøcool 1772205 |
| interrupts | Muleyoxo 1, Deeprayaa 26, Bizentein 15, Wazocutie 18, Zerøcool 9 |
| dispels | Muleyoxo 9, Zerøcool 1 |
| avoidable totals | Muleyoxo 10724909, Deeprayaa 11199439, Bizentein 12634574, Wazocutie 17051476, Zerøcool 11507332 |

`test/fixtures/rio-profile-muleyoxo.json` — raw Raider.IO profile: ilvl 322, `active_spec_name "Holy"`, `active_spec_role "HEALING"`, seasons `[season-mn-2 all 3942.8, season-mn-1 all 4152.7 / healer 3964.7]`, 10 recent runs (`num_keystone_upgrades` = `[1,1,1,1,1,1,1,1,0,1]`, dates 2026-09-12 and 2026-09-14, newest `2026-09-14T18:33:32.000Z`), 8 best runs, 10 weekly runs, `last_crawled_at "2026-09-13T11:02:49.000Z"`.

Raider.IO field syntax that works for two seasons in one call: `mythic_plus_scores_by_season:current:previous` (two separate `:current` / `:previous` fields collapse to one).

WCL season-2 encounter IDs (zone 55): Altar of Fangs 12993, Den of Nalorakk 12825, Kings' Rest 61762, Murder Row 12813, Ruby Life Pools 112521, Temple of Sethraliss 61877, The Blinding Vale 12859, Voidscar Arena 12923. Postmortem's `dungeons` keys are MDT indices: `17` King's Rest, `20` Temple of Sethraliss, `42` Ruby Life Pools, `160` Murder Row, `161` Den of Nalorakk, `162` The Blinding Vale, `163` Voidscar Arena, `164` Altar of Fangs.

---

### Task 1: Test infrastructure and fixtures

**Files:**
- Modify: `package.json` (scripts)
- Modify: `justfile`
- Modify: `.gitignore`
- Create: `test/fixtures.ts`
- Create: `test/fixtures.test.ts`
- Commit (already on disk, untracked): `test/fixtures/wcl-run-s1-magisters-terrace-tank.json`, `test/fixtures/wcl-run-s2-voidscar-arena-healer.json`, `test/fixtures/rio-profile-muleyoxo.json`

**Interfaces:**
- Produces: `loadWclFixture(name: "s1-tank" | "s2-healer"): { character: string; run: MPlusRun; report: RawRunReport }` and `loadRioFixture(): unknown` from `test/fixtures.ts` (typed loosely with `any` until Task 2 defines `RawRunReport`; tighten then).

- [ ] **Step 1: Add the test script, just recipe and db ignore**

`package.json` scripts:

```json
"test": "bun test",
```

`justfile` (after the `check` recipe):

```make
# run unit tests
test *args:
    bun test {{args}}
```

`.gitignore` (append):

```
bmpl.db
bmpl.db-journal
bmpl.db-wal
bmpl.db-shm
```

- [ ] **Step 2: Write the fixture loader**

`test/fixtures.ts`:

```ts
import * as path from "node:path";

const dir = path.join(import.meta.dir, "fixtures");

const WCL_FILES = {
  "s1-tank": "wcl-run-s1-magisters-terrace-tank.json",
  "s2-healer": "wcl-run-s2-voidscar-arena-healer.json",
} as const;

export type WclFixtureName = keyof typeof WCL_FILES;

// Shape: { character: string; run: MPlusRun; report: <raw WCL report object> }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadWclFixture = async (name: WclFixtureName): Promise<any> =>
  JSON.parse(await Bun.file(path.join(dir, WCL_FILES[name])).text());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadRioFixture = async (): Promise<any> =>
  JSON.parse(await Bun.file(path.join(dir, "rio-profile-muleyoxo.json")).text());
```

- [ ] **Step 3: Write a smoke test**

`test/fixtures.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadRioFixture, loadWclFixture } from "./fixtures.ts";

describe("fixtures", () => {
  test("S1 tank run fixture has the tables the parser needs", async () => {
    const f = await loadWclFixture("s1-tank");
    expect(f.character).toBe("Biwaadrood");
    expect(f.report.fights[0].keystoneBonus).toBe(1);
    for (const t of ["summary", "damageTaken", "deaths", "interrupts", "dispels"]) {
      expect(f.report[t]?.data).toBeDefined();
    }
    expect(f.report.avoidable).toBeUndefined();
  });

  test("S2 healer run fixture has an avoidable table", async () => {
    const f = await loadWclFixture("s2-healer");
    expect(f.character).toBe("Muleyoxo");
    expect(f.report.avoidable.data.entries.length).toBe(5);
  });

  test("RIO fixture has two seasons and ten recent runs", async () => {
    const r = await loadRioFixture();
    expect(r.mythic_plus_scores_by_season.map((s: any) => s.season)).toEqual(["season-mn-2", "season-mn-1"]);
    expect(r.mythic_plus_recent_runs.length).toBe(10);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `bun test test/fixtures.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add package.json justfile .gitignore test/
git commit -m "test: add bun test setup and raw WCL/Raider.IO fixtures"
```

---

### Task 2: Signal types and generic peer comparison

**Files:**
- Create: `src/signals/types.ts`
- Create: `src/signals/peers.ts`
- Test: `test/signals/peers.test.ts`

**Interfaces:**
- Produces (types.ts): `GroupRole`, `PeerComparison`, `DeathEvent`, `RunSignals`, `RioRun`, `RioProfile`, `RawRunReport`, `RawFight`, `RawTable`.
- Produces (peers.ts): `median(xs: number[]): number | null`; `peerComparison(values: Array<{ name: string; value: number | null }>, target: string, roleByName: Map<string, GroupRole>, peerRoles: ReadonlySet<GroupRole>): PeerComparison | null`.

- [ ] **Step 1: Write the types**

`src/signals/types.ts`:

```ts
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
  deaths: { count: number; groupTotal: number; events: DeathEvent[] };
  damageTaken: { total: number; dtps: number; peer: PeerComparison | null };
  interrupts: {
    count: number;
    kickCooldownS: number | null; // null = spec has no kick (or unknown spec)
    capacity: number | null;      // fightDuration / kickCooldownS
    usage: number | null;         // count / capacity
    peer: PeerComparison | null;  // peers compared on usage
  };
  dispels: { count: number };
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

export interface RawTableEntry {
  name: string;
  total?: number;
  timestamp?: number;
  overkill?: number;
  damage?: {
    abilities?: Array<{ name: string; total?: number }>;
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
      type?: string; // class name, e.g. "Druid"
      specs?: Array<{ spec?: string; role?: string }>;
    }>;
    playerDetails?: {
      dps?: Array<{ name: string; minItemLevel?: number }>;
      healers?: Array<{ name: string; minItemLevel?: number }>;
      tanks?: Array<{ name: string; minItemLevel?: number }>;
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
```

- [ ] **Step 2: Write the failing peers test**

`test/signals/peers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { median, peerComparison } from "../../src/signals/peers.ts";
import type { GroupRole } from "../../src/signals/types.ts";

const roles = new Map<string, GroupRole>([
  ["Me", "dps"], ["A", "dps"], ["B", "dps"], ["T", "tank"], ["H", "healer"],
]);
const DPS = new Set<GroupRole>(["dps"]);
const NON_HEALERS = new Set<GroupRole>(["dps", "tank"]);

describe("median", () => {
  test("empty → null", () => expect(median([])).toBeNull());
  test("odd count", () => expect(median([3, 1, 2])).toBe(2));
  test("even count averages the middle pair", () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe("peerComparison", () => {
  const values = [
    { name: "Me", value: 100 }, { name: "A", value: 10 }, { name: "B", value: 30 },
    { name: "T", value: 500 }, { name: "H", value: 5 },
  ];
  test("excludes the target and filters by role", () => {
    expect(peerComparison(values, "Me", roles, DPS)).toEqual({ median: 20, count: 2 });
  });
  test("tank counts when tank is in the peer roles", () => {
    expect(peerComparison(values, "Me", roles, NON_HEALERS)).toEqual({ median: 30, count: 3 });
  });
  test("null values are skipped", () => {
    const v = [...values, { name: "C", value: null }];
    roles.set("C", "dps");
    expect(peerComparison(v, "Me", roles, DPS)).toEqual({ median: 20, count: 2 });
  });
  test("no peers → null", () => {
    expect(peerComparison(values, "Me", roles, new Set<GroupRole>(["healer"]))).toEqual({ median: 5, count: 1 });
    expect(peerComparison([{ name: "Me", value: 1 }], "Me", roles, DPS)).toBeNull();
  });
  test("unknown role never counts as a peer", () => {
    const v = [{ name: "Me", value: 1 }, { name: "X", value: 2 }];
    expect(peerComparison(v, "Me", roles, DPS)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/signals/peers.test.ts`
Expected: FAIL — cannot resolve `../../src/signals/peers.ts`.

- [ ] **Step 4: Implement peers.ts**

`src/signals/peers.ts`:

```ts
import type { GroupRole, PeerComparison } from "./types.ts";

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
};

/**
 * Median of `value` across every player that is not the target, whose role
 * is in `peerRoles`, and whose value is not null. Players missing from
 * `roleByName` are "unknown" and never count.
 */
export function peerComparison(
  values: Array<{ name: string; value: number | null }>,
  target: string,
  roleByName: Map<string, GroupRole>,
  peerRoles: ReadonlySet<GroupRole>,
): PeerComparison | null {
  const peers: number[] = [];
  for (const v of values) {
    if (v.name === target || v.value === null) continue;
    const role = roleByName.get(v.name) ?? "unknown";
    if (!peerRoles.has(role)) continue;
    peers.push(v.value);
  }
  const m = median(peers);
  return m === null ? null : { median: m, count: peers.length };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test test/signals/peers.test.ts && bun run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/signals/types.ts src/signals/peers.ts test/signals/peers.test.ts
git commit -m "feat(signals): types and generic peer comparison"
```

---

### Task 3: Kick cooldown table

**Files:**
- Create: `src/signals/kick-cooldowns.ts`
- Test: `test/signals/kick-cooldowns.test.ts`

**Interfaces:**
- Produces: `kickCooldownFor(className: string, spec: string): number | null`.

WCL spells class names as in `composition[].type` (`"Death Knight"`, `"Demon Hunter"`, `"Druid"`, …) and specs without spaces (`"BeastMastery"`). Cooldowns are baseline (no talent reductions).

- [ ] **Step 1: Write the failing test**

`test/signals/kick-cooldowns.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { kickCooldownFor } from "../../src/signals/kick-cooldowns.ts";

describe("kickCooldownFor", () => {
  test("melee kicks are 15 s", () => {
    expect(kickCooldownFor("Rogue", "Assassination")).toBe(15);
    expect(kickCooldownFor("Warrior", "Arms")).toBe(15);
    expect(kickCooldownFor("Druid", "Guardian")).toBe(15);
  });
  test("caster kicks have longer cooldowns", () => {
    expect(kickCooldownFor("Mage", "Frost")).toBe(24);
    expect(kickCooldownFor("Hunter", "BeastMastery")).toBe(24);
    expect(kickCooldownFor("Druid", "Balance")).toBe(60);
    expect(kickCooldownFor("Evoker", "Devastation")).toBe(40);
    expect(kickCooldownFor("Priest", "Shadow")).toBe(45);
    expect(kickCooldownFor("Shaman", "Elemental")).toBe(12);
  });
  test("same spec name, different class", () => {
    expect(kickCooldownFor("Shaman", "Restoration")).toBe(12);
    expect(kickCooldownFor("Druid", "Restoration")).toBeNull();
    expect(kickCooldownFor("Paladin", "Holy")).toBeNull();
    expect(kickCooldownFor("Priest", "Holy")).toBeNull();
  });
  test("specs without a kick and unknown specs → null", () => {
    expect(kickCooldownFor("Monk", "Mistweaver")).toBeNull();
    expect(kickCooldownFor("Priest", "Discipline")).toBeNull();
    expect(kickCooldownFor("Bard", "Lute")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/signals/kick-cooldowns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the table**

`src/signals/kick-cooldowns.ts`:

```ts
// Baseline interrupt cooldowns (seconds) per class:spec, no talent
// reductions. `null` = the spec has no interrupt. Keyed by the class name
// and spec name exactly as WCL's Summary `composition` reports them.
const KICK_CD: Record<string, number | null> = {
  "Death Knight:Blood": 15, "Death Knight:Frost": 15, "Death Knight:Unholy": 15,        // Mind Freeze
  "Demon Hunter:Havoc": 15, "Demon Hunter:Vengeance": 15, "Demon Hunter:Devourer": 15,  // Disrupt
  "Druid:Balance": 60,                                                                   // Solar Beam
  "Druid:Feral": 15, "Druid:Guardian": 15,                                               // Skull Bash
  "Druid:Restoration": null,
  "Evoker:Devastation": 40, "Evoker:Preservation": 40, "Evoker:Augmentation": 40,        // Quell
  "Hunter:BeastMastery": 24, "Hunter:Marksmanship": 24,                                  // Counter Shot
  "Hunter:Survival": 15,                                                                 // Muzzle
  "Mage:Arcane": 24, "Mage:Fire": 24, "Mage:Frost": 24,                                  // Counterspell
  "Monk:Brewmaster": 15, "Monk:Windwalker": 15,                                          // Spear Hand Strike
  "Monk:Mistweaver": null,
  "Paladin:Protection": 15, "Paladin:Retribution": 15,                                   // Rebuke
  "Paladin:Holy": null,
  "Priest:Shadow": 45,                                                                   // Silence
  "Priest:Holy": null, "Priest:Discipline": null,
  "Rogue:Assassination": 15, "Rogue:Outlaw": 15, "Rogue:Subtlety": 15,                   // Kick
  "Shaman:Elemental": 12, "Shaman:Enhancement": 12, "Shaman:Restoration": 12,            // Wind Shear
  "Warlock:Affliction": 24, "Warlock:Demonology": 24, "Warlock:Destruction": 24,         // Spell Lock (pet)
  "Warrior:Arms": 15, "Warrior:Fury": 15, "Warrior:Protection": 15,                      // Pummel
};

export const kickCooldownFor = (className: string, spec: string): number | null =>
  KICK_CD[`${className}:${spec}`] ?? null;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test test/signals/kick-cooldowns.test.ts && bun run typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/signals/kick-cooldowns.ts test/signals/kick-cooldowns.test.ts
git commit -m "feat(signals): interrupt cooldown table per class/spec"
```

---

### Task 4: Avoidable-damage spell list (imported from postmortem)

**Files:**
- Create: `scripts/import-postmortem-avoidable.ts`
- Create: `src/signals/avoidable/season-mn-2.json` (generated by the script)
- Create: `src/signals/avoidable/index.ts`
- Test: `test/signals/avoidable.test.ts`
- Modify: `justfile` (recipe `import-avoidable`)

**Interfaces:**
- Produces: `avoidableSpellIdsFor(encounterID: number): number[] | null`; `avoidableFilterExpression(ids: number[]): string`; `AvoidableSeasonList` type.

The data file shape:

```json
{
  "season": "season-mn-2",
  "source": "https://github.com/Sharpened-Banana/postmortem (addon by lonezebra) — Blizzard's in-game avoidable-damage classification, captured via C_DamageMeter",
  "importedAt": "2026-09-15T00:00:00.000Z",
  "spells": { "265914": "Molten Gold", "...": "..." },
  "dungeons": { "61762": [265914, 266191], "...": [] }
}
```

`dungeons` keys are **WCL encounter IDs**; `spells` maps id → name (for transparency and debugging).

- [ ] **Step 1: Write the import script**

`scripts/import-postmortem-avoidable.ts`:

```ts
// Imports postmortem's avoidable-damage spell list (Blizzard's in-game
// classification captured by their addon) and re-keys it by WCL encounter
// ID. Re-run whenever upstream updates: `just import-avoidable`.
//
// Attribution: https://github.com/Sharpened-Banana/postmortem (lonezebra).

const UPSTREAM =
  "https://raw.githubusercontent.com/Sharpened-Banana/postmortem/main/src/postmortem/data/avoidable_spells.json";
const OUT = new URL("../src/signals/avoidable/season-mn-2.json", import.meta.url);

// postmortem keys dungeons by MDT index (see their dungeon_data.json).
// WCL encounter IDs come from `worldData.zone(id: 55).encounters`.
const MDT_TO_WCL: Record<string, { wcl: number; name: string }> = {
  "17": { wcl: 61762, name: "Kings' Rest" },
  "20": { wcl: 61877, name: "Temple of Sethraliss" },
  "42": { wcl: 112521, name: "Ruby Life Pools" },
  "160": { wcl: 12813, name: "Murder Row" },
  "161": { wcl: 12825, name: "Den of Nalorakk" },
  "162": { wcl: 12859, name: "The Blinding Vale" },
  "163": { wcl: 12923, name: "Voidscar Arena" },
  "164": { wcl: 12993, name: "Altar of Fangs" },
};

interface Upstream {
  spells: Array<{ id: number; name: string }>;
  dungeons: Record<string, number[]>;
}

const res = await fetch(UPSTREAM);
if (!res.ok) throw new Error(`upstream ${res.status}`);
const up = (await res.json()) as Upstream;

const spells: Record<string, string> = {};
for (const s of up.spells) spells[String(s.id)] = s.name;

const dungeons: Record<string, number[]> = {};
for (const [mdt, ids] of Object.entries(up.dungeons)) {
  const m = MDT_TO_WCL[mdt];
  if (!m) {
    console.warn(`skip unknown MDT dungeon index ${mdt} (${ids.length} spells)`);
    continue;
  }
  dungeons[String(m.wcl)] = [...ids].sort((a, b) => a - b);
}

const out = {
  season: "season-mn-2",
  source:
    "https://github.com/Sharpened-Banana/postmortem (addon by lonezebra) — Blizzard's in-game avoidable-damage classification, captured via C_DamageMeter",
  importedAt: new Date().toISOString(),
  spells,
  dungeons,
};
await Bun.write(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(
  `wrote ${OUT.pathname}: ${Object.keys(spells).length} spells, ${Object.keys(dungeons).length} dungeons`,
);
```

`justfile` (after `introspect`):

```make
# refresh the avoidable-damage spell list from postmortem
import-avoidable:
    bun scripts/import-postmortem-avoidable.ts
```

- [ ] **Step 2: Run the import**

Run: `bun scripts/import-postmortem-avoidable.ts`
Expected: `wrote …/season-mn-2.json: 101 spells, 8 dungeons`. Open the file and check `dungeons["12923"]` has 12 ids and `dungeons["61762"]` has 16.

- [ ] **Step 3: Write the failing test**

`test/signals/avoidable.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  avoidableFilterExpression,
  avoidableSpellIdsFor,
} from "../../src/signals/avoidable/index.ts";

describe("avoidable list", () => {
  test("Voidscar Arena (S2) has a list", () => {
    const ids = avoidableSpellIdsFor(12923);
    expect(ids).not.toBeNull();
    expect(ids!.length).toBeGreaterThan(5);
    expect(ids).toContain(1222724); // Noxious Breath
  });
  test("Magisters' Terrace (S1) has no list", () => {
    expect(avoidableSpellIdsFor(12811)).toBeNull();
  });
  test("filter expression is a WCL `in` clause", () => {
    expect(avoidableFilterExpression([3, 1, 2])).toBe("ability.id in (1,2,3)");
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `bun test test/signals/avoidable.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the index**

`src/signals/avoidable/index.ts`:

```ts
import seasonMn2 from "./season-mn-2.json";

export interface AvoidableSeasonList {
  season: string;
  source: string;
  importedAt: string;
  spells: Record<string, string>;
  dungeons: Record<string, number[]>;
}

const SEASONS: AvoidableSeasonList[] = [seasonMn2 as AvoidableSeasonList];

/** Spell IDs Blizzard flags as avoidable for this dungeon, or null if we have no list for it. */
export const avoidableSpellIdsFor = (encounterID: number): number[] | null => {
  for (const s of SEASONS) {
    const ids = s.dungeons[String(encounterID)];
    if (ids && ids.length > 0) return ids;
  }
  return null;
};

export const avoidableFilterExpression = (ids: number[]): string =>
  `ability.id in (${[...ids].sort((a, b) => a - b).join(",")})`;
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test test/signals/avoidable.test.ts && bun run typecheck`
Expected: pass (`resolveJsonModule` is already on in tsconfig).

- [ ] **Step 7: Commit**

```bash
git add scripts/import-postmortem-avoidable.ts src/signals/avoidable/ test/signals/avoidable.test.ts justfile
git commit -m "feat(signals): avoidable-damage spell list per dungeon, imported from postmortem"
```

- [ ] **Step 8 (outward-facing — ask the user before doing it): attribution issue upstream**

The upstream repo has no license. Open an issue on https://github.com/Sharpened-Banana/postmortem titled "Reusing avoidable_spells.json in bmpl (attribution)" saying that bmpl (link) bundles a re-keyed copy of `avoidable_spells.json` with attribution to the project and author, and asking whether that is fine / whether they would add a license. Do this only after the user confirms in the session.

---

### Task 5: WCL run parser and extended query

**Files:**
- Modify: `src/wcl/queries.ts` (replace `REPORT_RUN_SUMMARY_QUERY`, add `REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY`)
- Create: `src/signals/wcl-run.ts`
- Test: `test/signals/wcl-run.test.ts`

**Interfaces:**
- Consumes: `RawRunReport`, `RunSignals`, `GroupRole` (Task 2); `peerComparison`, `median` (Task 2); `kickCooldownFor` (Task 3); `avoidableSpellIdsFor` (Task 4).
- Produces: `parseRunSignals(report: RawRunReport | null | undefined, characterName: string, fallback: { keyLevel: number; affixes: number[]; encounterID: number }): RunSignals | null`; `WIPE_WINDOW_MS = 15_000`; `WIPE_MIN_DEATHS = 3`.

- [ ] **Step 1: Replace the queries**

In `src/wcl/queries.ts`, replace `REPORT_RUN_SUMMARY_QUERY` with:

```ts
const RUN_SUMMARY_FIELDS = /* GraphQL */ `
        code
        fights(fightIDs: [$fightID]) {
          id encounterID keystoneLevel keystoneBonus keystoneTime keystoneAffixes startTime endTime
        }
        summary: table(fightIDs: [$fightID], dataType: Summary)
        damageTaken: table(fightIDs: [$fightID], dataType: DamageTaken)
        deaths: table(fightIDs: [$fightID], dataType: Deaths)
        interrupts: table(fightIDs: [$fightID], dataType: Interrupts)
        dispels: table(fightIDs: [$fightID], dataType: Dispels)
`;

export const REPORT_RUN_SUMMARY_QUERY = /* GraphQL */ `
  query ReportRunSummary($code: String!, $fightID: Int!) {
    reportData {
      report(code: $code) {
${RUN_SUMMARY_FIELDS}
      }
    }
  }
`;

// Same, plus a DamageTaken table restricted to the dungeon's avoidable
// spell list (see src/signals/avoidable). Separate query because passing
// a null filterExpression would return *all* damage taken.
export const REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY = /* GraphQL */ `
  query ReportRunSummaryWithAvoidable($code: String!, $fightID: Int!, $avoidFilter: String!) {
    reportData {
      report(code: $code) {
${RUN_SUMMARY_FIELDS}
        avoidable: table(fightIDs: [$fightID], dataType: DamageTaken, filterExpression: $avoidFilter)
      }
    }
  }
`;
```

- [ ] **Step 2: Write the failing parser tests**

`test/signals/wcl-run.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadWclFixture } from "../fixtures.ts";

const fb = (f: any) => ({ keyLevel: f.run.keyLevel, affixes: f.run.affixes, encounterID: f.run.encounterID });

describe("parseRunSignals — S1 tank (Biwaadrood, Magisters' Terrace +18)", () => {
  test("keystone, role, ilvl, duration", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", fb(f))!;
    expect(s.keystone).toEqual({ level: 18, chests: 1, timed: true, timeMs: 1751502, affixes: [10, 9, 147] });
    expect(s.role).toBe("tank");
    expect(s.itemLevel).toBe(280);
    expect(s.fightDurationMs).toBe(1700498);
    expect(s.partial).toBeUndefined();
  });

  test("tank gets no damage-taken peer comparison", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", fb(f))!;
    expect(s.damageTaken.total).toBe(112246233);
    expect(s.damageTaken.dtps).toBeCloseTo(112246233 / 1700.498, 0);
    expect(s.damageTaken.peer).toBeNull();
  });

  test("a DPS is compared to the other DPS on damage taken", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Mstercheif", fb(f))!;
    // peers = Mariabanks 32707271, Forssaken 34730334 → median 33718802.5 dtps-normalized
    expect(s.damageTaken.peer!.count).toBe(2);
    expect(s.damageTaken.peer!.median).toBeCloseTo(33718802.5 / 1700.498, 0);
  });

  test("interrupts: count, cooldown-normalized usage, peers on usage", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", fb(f))!;
    expect(s.interrupts.count).toBe(23);
    expect(s.interrupts.kickCooldownS).toBe(15);
    expect(s.interrupts.capacity).toBeCloseTo(1700.498 / 15, 3);
    expect(s.interrupts.usage).toBeCloseTo(23 / (1700.498 / 15), 4);
    // peers = dps+tank with a kick, excluding target: Mariabanks (24 s), Forssaken (15 s), Mstercheif (15 s)
    expect(s.interrupts.peer!.count).toBe(3);
    const usages = [16 / (1700.498 / 24), 24 / (1700.498 / 15), 16 / (1700.498 / 15)].sort((a, b) => a - b);
    expect(s.interrupts.peer!.median).toBeCloseTo(usages[1]!, 4);
  });

  test("Restoration Shaman healer keeps its Wind Shear (12 s)", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Aicham", fb(f))!;
    expect(s.interrupts.kickCooldownS).toBe(12);
    expect(s.interrupts.count).toBe(4);
    expect(s.dispels.count).toBe(37);
  });

  test("dispels: player absent from the table → 0", async () => {
    const f = await loadWclFixture("s1-tank");
    expect(parseRunSignals(f.report, "Biwaadrood", fb(f))!.dispels.count).toBe(0);
    expect(parseRunSignals(f.report, "Mariabanks", fb(f))!.dispels.count).toBe(21);
  });

  test("deaths with context, no wipe", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Mstercheif", fb(f))!;
    expect(s.deaths.count).toBe(3);
    expect(s.deaths.groupTotal).toBe(4);
    expect(s.deaths.events[0]).toEqual({
      atMs: 98742, cause: "Holy Fire", source: "Lightward Healer", overkill: 11498, inWipe: false,
    });
    expect(s.deaths.events.map((e) => e.inWipe)).toEqual([false, false, false]);
  });

  test("no avoidable list for an S1 dungeon → null", async () => {
    const f = await loadWclFixture("s1-tank");
    expect(parseRunSignals(f.report, "Biwaadrood", fb(f))!.avoidableDamage).toBeNull();
  });
});

describe("parseRunSignals — S2 healer (Muleyoxo, Voidscar Arena +21)", () => {
  test("Holy Priest has no kick: usage null, still reports the count", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    expect(s.role).toBe("healer");
    expect(s.interrupts.count).toBe(1);
    expect(s.interrupts.kickCooldownS).toBeNull();
    expect(s.interrupts.usage).toBeNull();
    // peers still computed (dps + tank with a kick): Deeprayaa 12 s, Bizentein 15 s, Wazocutie 15 s, Zerøcool 15 s
    expect(s.interrupts.peer!.count).toBe(4);
  });

  test("avoidable damage with all-other-players peers", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    const minutes = 1775032 / 60000;
    expect(s.avoidableDamage).not.toBeNull();
    expect(s.avoidableDamage!.total).toBe(10724909);
    expect(s.avoidableDamage!.perMinute).toBeCloseTo(10724909 / minutes, 0);
    expect(s.avoidableDamage!.peer!.count).toBe(4);
    // peers per minute: 11199439, 12634574, 17051476, 11507332 → median (11507332+12634574)/2
    expect(s.avoidableDamage!.peer!.median).toBeCloseTo(((11507332 + 12634574) / 2) / minutes, 0);
    expect(s.avoidableDamage!.spellCount).toBeGreaterThan(5);
  });

  test("wipe detection: three deaths within 15 s", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    expect(s.deaths.count).toBe(1);
    expect(s.deaths.events[0]!.atMs).toBe(1764223);
    expect(s.deaths.events[0]!.inWipe).toBe(true);
    const d = parseRunSignals(f.report, "Deeprayaa", fb(f))!;
    expect(d.deaths.events.map((e) => e.inWipe)).toEqual([false, true]);
  });
});

describe("parseRunSignals — degraded inputs", () => {
  test("null report → null", () => {
    expect(parseRunSignals(null, "X", { keyLevel: 10, affixes: [9], encounterID: 1 })).toBeNull();
  });

  test("missing fights → keystone from fallback, partial flag", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals({ ...f.report, fights: [] }, "Biwaadrood", fb(f))!;
    expect(s.partial).toBe(true);
    expect(s.keystone).toEqual({ level: 18, chests: 0, timed: false, timeMs: 0, affixes: f.run.affixes });
  });

  test("missing interrupts/dispels tables → zero counts, null peers", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals({ ...f.report, interrupts: null, dispels: null }, "Biwaadrood", fb(f))!;
    expect(s.interrupts.count).toBe(0);
    expect(s.interrupts.peer).toBeNull();
    expect(s.dispels.count).toBe(0);
  });

  test("character not in composition → role unknown, ilvl null", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Nobody", fb(f))!;
    expect(s.role).toBe("unknown");
    expect(s.itemLevel).toBeNull();
    expect(s.deaths.count).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/signals/wcl-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the parser**

`src/signals/wcl-run.ts`:

```ts
import { avoidableSpellIdsFor } from "./avoidable/index.ts";
import { kickCooldownFor } from "./kick-cooldowns.ts";
import { peerComparison } from "./peers.ts";
import type {
  DeathEvent,
  GroupRole,
  PeerComparison,
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

const itemLevelFor = (summary: RawTable | null | undefined, name: string): number | null => {
  const pd = summary?.data?.playerDetails;
  for (const group of [pd?.dps, pd?.healers, pd?.tanks]) {
    const hit = group?.find((p) => p.name === name);
    if (hit && typeof hit.minItemLevel === "number") return hit.minItemLevel;
  }
  return null;
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
    peer: peerComparison(toValues(usageByName), characterName, roleByName, NON_HEALERS),
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
    deaths: { count: events.length, groupTotal: allDeaths.length, events },
    damageTaken,
    interrupts,
    dispels,
    avoidableDamage,
    fightDurationMs: durationMs,
    ...(partial ? { partial: true } : {}),
  };
}

export type { PeerComparison };
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test test/signals/wcl-run.test.ts && bun run typecheck`
Expected: all pass. If a numeric expectation is off by rounding, loosen the `toBeCloseTo` digits — do not change the fixture.

- [ ] **Step 6: Commit**

```bash
git add src/wcl/queries.ts src/signals/wcl-run.ts test/signals/wcl-run.test.ts
git commit -m "feat(signals): parse timed/kicks/dispels/avoidable/death context from a raw WCL run"
```

---

### Task 6: Raider.IO profile parser

**Files:**
- Create: `src/signals/rio-profile.ts`
- Test: `test/signals/rio-profile.test.ts`

**Interfaces:**
- Consumes: `RioProfile`, `RioRun` (Task 2).
- Produces: `parseRioProfile(raw: unknown, now: number): RioProfile`; `RIO_FIELDS` (the `fields=` value); `rioProfileUrl(region, realmSlug, name): string`.

- [ ] **Step 1: Write the failing test**

`test/signals/rio-profile.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { RIO_FIELDS, parseRioProfile, rioProfileUrl } from "../../src/signals/rio-profile.ts";
import { loadRioFixture } from "../fixtures.ts";

const NOW = Date.parse("2026-09-15T12:00:00Z");

describe("parseRioProfile", () => {
  test("identity and gear", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.fetchedAt).toBe(NOW);
    expect(p.lastCrawledAt).toBe(Date.parse("2026-09-13T11:02:49.000Z"));
    expect(p.profileUrl).toBe("https://raider.io/characters/eu/silvermoon/Muleyoxo");
    expect(p.itemLevel).toBe(322);
    expect(p.activeSpec).toBe("Holy");
    expect(p.activeRole).toBe("HEALING");
  });

  test("seasons keep Raider.IO order (current first)", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.seasons.map((s) => s.slug)).toEqual(["season-mn-2", "season-mn-1"]);
    expect(p.seasons[1]).toEqual({ slug: "season-mn-1", all: 4152.7, dps: 4152.7, healer: 3964.7, tank: 1406.3 });
  });

  test("runs are normalized", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.recentRuns.length).toBe(10);
    expect(p.bestRuns.length).toBe(8);
    expect(p.weeklyBest.length).toBe(10);
    const r = p.recentRuns[0]!;
    expect(r).toEqual({
      dungeon: "Voidscar Arena", shortName: "VSA", level: 21,
      completedAt: Date.parse("2026-09-14T18:33:32.000Z"),
      clearMs: 1796309, parMs: 1800999, chests: 1, score: 500.1,
      affixes: r.affixes, url: "https://raider.io/mythic-plus-runs/season-mn-2/12226069-21-voidscar-arena",
    });
    expect(r.affixes[0]).toBe("Tyrannical");
  });

  test("derived: timed ratio, activity", async () => {
    const p = parseRioProfile(await loadRioFixture(), NOW);
    expect(p.derived.recentTotal).toBe(10);
    expect(p.derived.recentTimed).toBe(9);
    expect(p.derived.runsLast7d).toBe(10);
    expect(p.derived.lastRunAt).toBe(Date.parse("2026-09-14T18:33:32.000Z"));
  });

  test("runsLast7d uses `now`", async () => {
    const p = parseRioProfile(await loadRioFixture(), Date.parse("2026-09-20T12:00:00Z"));
    expect(p.derived.runsLast7d).toBe(6); // only the 2026-09-14 runs
  });

  test("tolerates a profile with no runs and no seasons", () => {
    const p = parseRioProfile({ name: "X", profile_url: "u" }, NOW);
    expect(p.seasons).toEqual([]);
    expect(p.recentRuns).toEqual([]);
    expect(p.itemLevel).toBeNull();
    expect(p.derived).toEqual({ recentTimed: 0, recentTotal: 0, runsLast7d: 0, lastRunAt: null });
  });
});

describe("rioProfileUrl", () => {
  test("encodes name, lowercases region", () => {
    expect(rioProfileUrl("EU", "nerzhul", "Biwaadrood")).toBe(
      `https://raider.io/api/v1/characters/profile?region=eu&realm=nerzhul&name=Biwaadrood&fields=${RIO_FIELDS}`,
    );
    expect(rioProfileUrl("EU", "hyjal", "Zerøcool")).toContain("name=Zer%C3%B8cool");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/signals/rio-profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

`src/signals/rio-profile.ts`:

```ts
import type { RioProfile, RioRun, RioSeasonScore } from "./types.ts";

// Two seasons in one field: separate `:current` and `:previous` fields
// collapse to a single entry on Raider.IO's side.
export const RIO_FIELDS =
  "gear,mythic_plus_scores_by_season:current:previous,mythic_plus_recent_runs,mythic_plus_best_runs,mythic_plus_weekly_highest_level_runs";

export const rioProfileUrl = (region: string, realmSlug: string, name: string): string =>
  `https://raider.io/api/v1/characters/profile?region=${region.toLowerCase()}&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}&fields=${RIO_FIELDS}`;

const DAY_MS = 86_400_000;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

const parseRun = (raw: unknown): RioRun => {
  const r = obj(raw);
  return {
    dungeon: str(r.dungeon) ?? "",
    shortName: str(r.short_name) ?? "",
    level: num(r.mythic_level),
    completedAt: Date.parse(str(r.completed_at) ?? "") || 0,
    clearMs: num(r.clear_time_ms),
    parMs: num(r.par_time_ms),
    chests: num(r.num_keystone_upgrades),
    score: num(r.score),
    affixes: arr(r.affixes).map((a) => str(obj(a).name) ?? "").filter(Boolean),
    url: str(r.url) ?? "",
  };
};

const parseSeason = (raw: unknown): RioSeasonScore => {
  const s = obj(raw);
  const sc = obj(s.scores);
  return {
    slug: str(s.season) ?? "",
    all: num(sc.all),
    dps: num(sc.dps),
    healer: num(sc.healer),
    tank: num(sc.tank),
  };
};

export function parseRioProfile(raw: unknown, now: number): RioProfile {
  const p = obj(raw);
  const gear = obj(p.gear);
  const recentRuns = arr(p.mythic_plus_recent_runs).map(parseRun);
  const lastRunAt = recentRuns.reduce<number | null>(
    (acc, r) => (r.completedAt > 0 && (acc === null || r.completedAt > acc) ? r.completedAt : acc),
    null,
  );
  return {
    fetchedAt: now,
    lastCrawledAt: Date.parse(str(p.last_crawled_at) ?? "") || 0,
    profileUrl: str(p.profile_url) ?? "",
    itemLevel: typeof gear.item_level_equipped === "number" ? gear.item_level_equipped : null,
    activeSpec: str(p.active_spec_name),
    activeRole: str(p.active_spec_role),
    seasons: arr(p.mythic_plus_scores_by_season).map(parseSeason),
    recentRuns,
    bestRuns: arr(p.mythic_plus_best_runs).map(parseRun),
    weeklyBest: arr(p.mythic_plus_weekly_highest_level_runs).map(parseRun),
    derived: {
      recentTimed: recentRuns.filter((r) => r.chests > 0).length,
      recentTotal: recentRuns.length,
      runsLast7d: recentRuns.filter((r) => r.completedAt > 0 && now - r.completedAt <= 7 * DAY_MS).length,
      lastRunAt,
    },
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test test/signals/rio-profile.test.ts && bun run typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/signals/rio-profile.ts test/signals/rio-profile.test.ts
git commit -m "feat(signals): Raider.IO profile parser with timed-ratio and activity derivations"
```

---

### Task 7: SQLite store

**Files:**
- Create: `src/signals/store.ts`
- Modify: `src/setup.ts` (add `resolveDbPath`)
- Test: `test/signals/store.test.ts`

**Interfaces:**
- Produces: `openStore(path: string): Store`; `getStore(): Promise<Store>` (process-wide singleton at `resolveDbPath()`); `QUERY_VERSION = 2`; `RIO_TTL_MS = 3_600_000`;
  `interface Store { getWclRun(code: string, fightID: number): RawRunReport | null; putWclRun(code: string, fightID: number, report: RawRunReport): void; getRio(region: string, realmSlug: string, name: string, opts?: { maxAgeMs?: number; now?: number }): { raw: unknown; fetchedAt: number } | null; putRio(region: string, realmSlug: string, name: string, raw: unknown, now?: number): void; close(): void }`.
- Produces (setup.ts): `resolveDbPath(): Promise<string>` — `BMPL_DB_PATH` env override, else `bmpl.db` in the directory of `resolveEnvPath()`.

Rows in `wcl_run_raw` carry the `query_version` they were fetched with; `getWclRun` only returns rows at the current `QUERY_VERSION` (older rows are kept for a future migration).

- [ ] **Step 1: Write the failing test**

`test/signals/store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { QUERY_VERSION, RIO_TTL_MS, openStore } from "../../src/signals/store.ts";
import { loadWclFixture } from "../fixtures.ts";

describe("store", () => {
  test("WCL raw round-trip, never expires", async () => {
    const s = openStore(":memory:");
    const f = await loadWclFixture("s1-tank");
    expect(s.getWclRun("QvhzaWwPNxMVY4Xd", 1)).toBeNull();
    s.putWclRun("QvhzaWwPNxMVY4Xd", 1, f.report);
    const back = s.getWclRun("QvhzaWwPNxMVY4Xd", 1);
    expect(back?.code).toBe("QvhzaWwPNxMVY4Xd");
    expect(back?.fights?.[0]?.keystoneBonus).toBe(1);
    s.close();
  });

  test("put overwrites an existing row", () => {
    const s = openStore(":memory:");
    s.putWclRun("A", 1, { code: "A", fights: [{ id: 1, keystoneBonus: 0 }] });
    s.putWclRun("A", 1, { code: "A", fights: [{ id: 1, keystoneBonus: 2 }] });
    expect(s.getWclRun("A", 1)?.fights?.[0]?.keystoneBonus).toBe(2);
    s.close();
  });

  test("rows from an older query version are hidden", () => {
    const s = openStore(":memory:");
    s.putWclRun("A", 1, { code: "A" });
    // Simulate a row written by an older build.
    s._db.run("UPDATE wcl_run_raw SET query_version = ? WHERE report_code = 'A'", [QUERY_VERSION - 1]);
    expect(s.getWclRun("A", 1)).toBeNull();
    s.close();
  });

  test("RIO TTL", () => {
    const s = openStore(":memory:");
    const t0 = 1_000_000;
    s.putRio("eu", "nerzhul", "Biwaadrood", { name: "Biwaadrood" }, t0);
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS - 1 })).toEqual({
      raw: { name: "Biwaadrood" }, fetchedAt: t0,
    });
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS + 1 })).toBeNull();
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS + 1, maxAgeMs: Infinity })).not.toBeNull();
    s.close();
  });

  test("RIO key is case-insensitive on name", () => {
    const s = openStore(":memory:");
    s.putRio("eu", "nerzhul", "Biwaadrood", { a: 1 }, 5);
    expect(s.getRio("EU", "nerzhul", "biwaadrood", { now: 6 })?.raw).toEqual({ a: 1 });
    s.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/signals/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `resolveDbPath` to setup.ts**

Append to `src/setup.ts`:

```ts
/** SQLite cache path: BMPL_DB_PATH, else `bmpl.db` next to the .env we use. */
export async function resolveDbPath(): Promise<string> {
  const override = (process.env.BMPL_DB_PATH ?? "").trim();
  if (override) return override;
  return path.join(path.dirname(await resolveEnvPath()), "bmpl.db");
}
```

- [ ] **Step 4: Implement the store**

`src/signals/store.ts`:

```ts
import { Database } from "bun:sqlite";
import { resolveDbPath } from "../setup.ts";
import type { RawRunReport } from "./types.ts";

// Bump when REPORT_RUN_SUMMARY_QUERY gains/loses fields: older raw rows are
// then ignored (kept on disk for a possible migration) and re-fetched.
export const QUERY_VERSION = 2;
export const RIO_TTL_MS = 60 * 60 * 1000;

export interface Store {
  getWclRun(code: string, fightID: number): RawRunReport | null;
  putWclRun(code: string, fightID: number, report: RawRunReport): void;
  getRio(
    region: string,
    realmSlug: string,
    name: string,
    opts?: { maxAgeMs?: number; now?: number },
  ): { raw: unknown; fetchedAt: number } | null;
  putRio(region: string, realmSlug: string, name: string, raw: unknown, now?: number): void;
  close(): void;
  /** Exposed for tests only. */
  _db: Database;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wcl_run_raw (
  report_code   TEXT    NOT NULL,
  fight_id      INTEGER NOT NULL,
  query_version INTEGER NOT NULL,
  fetched_at    INTEGER NOT NULL,
  json          TEXT    NOT NULL,
  PRIMARY KEY (report_code, fight_id)
);
CREATE TABLE IF NOT EXISTS rio_profile (
  region     TEXT    NOT NULL,
  realm      TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL,
  json       TEXT    NOT NULL,
  PRIMARY KEY (region, realm, name)
);
`;

const rioKey = (region: string, realmSlug: string, name: string) =>
  [region.toLowerCase(), realmSlug.toLowerCase(), name.toLowerCase()] as const;

export function openStore(path: string): Store {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const getRun = db.query<{ json: string }, [string, number, number]>(
    "SELECT json FROM wcl_run_raw WHERE report_code = ? AND fight_id = ? AND query_version = ?",
  );
  const putRun = db.query(
    "INSERT OR REPLACE INTO wcl_run_raw (report_code, fight_id, query_version, fetched_at, json) VALUES (?, ?, ?, ?, ?)",
  );
  const getRioQ = db.query<{ json: string; fetched_at: number }, [string, string, string]>(
    "SELECT json, fetched_at FROM rio_profile WHERE region = ? AND realm = ? AND name = ?",
  );
  const putRioQ = db.query(
    "INSERT OR REPLACE INTO rio_profile (region, realm, name, fetched_at, json) VALUES (?, ?, ?, ?, ?)",
  );

  return {
    _db: db,
    getWclRun(code, fightID) {
      const row = getRun.get(code, fightID, QUERY_VERSION);
      return row ? (JSON.parse(row.json) as RawRunReport) : null;
    },
    putWclRun(code, fightID, report) {
      putRun.run(code, fightID, QUERY_VERSION, Date.now(), JSON.stringify(report));
    },
    getRio(region, realmSlug, name, opts = {}) {
      const row = getRioQ.get(...rioKey(region, realmSlug, name));
      if (!row) return null;
      const now = opts.now ?? Date.now();
      const maxAge = opts.maxAgeMs ?? RIO_TTL_MS;
      if (now - row.fetched_at > maxAge) return null;
      return { raw: JSON.parse(row.json), fetchedAt: row.fetched_at };
    },
    putRio(region, realmSlug, name, raw, now = Date.now()) {
      putRioQ.run(...rioKey(region, realmSlug, name), now, JSON.stringify(raw));
    },
    close() {
      db.close();
    },
  };
}

let singleton: Promise<Store> | null = null;

/** Process-wide store at the resolved db path (next to .env). */
export const getStore = (): Promise<Store> => {
  if (!singleton) singleton = resolveDbPath().then(openStore);
  return singleton;
};
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test test/signals/store.test.ts && bun run typecheck`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/signals/store.ts src/setup.ts test/signals/store.test.ts
git commit -m "feat(signals): SQLite store for raw WCL runs (immutable) and Raider.IO profiles (1h TTL)"
```

---

### Task 8: WCL enrichment orchestrator

**Files:**
- Create: `src/signals/enrich.ts`
- Modify: `src/mplus.ts` (remove `RunQuality`, `fetchRunSummary`, `enrichLookupResult`, `medianOrNull`, `normalizeRole`, the `ReportSummaryResponse`/`TableDataPayload`/`SummaryTableData` interfaces and the `REPORT_RUN_SUMMARY_QUERY` import; change `MPlusRun.quality?: RunQuality` to `signals?: RunSignals`)
- Test: `test/signals/enrich.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 7), `parseRunSignals` (Task 5), `REPORT_RUN_SUMMARY_QUERY` / `REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY` (Task 5), `avoidableSpellIdsFor` / `avoidableFilterExpression` (Task 4), `MPlusRun`, `LookupResult`, `MPlusData` (mplus.ts).
- Produces: `type GqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>`; `enrichRuns(runs: MPlusRun[], characterName: string, store: Store, deps?: { gql?: GqlFn }): Promise<void>`; `displayedRuns(result: LookupResult): MPlusRun[]` (prev-level best + per-dungeon bests, de-duplicated by `reportCode:fightID`); `enrichLookupResult(data: MPlusData, result: LookupResult, store: Store, deps?): Promise<void>`.

The `mplus.ts` change removes the old enrichment; `cli.ts`, `server.ts`, `watch.ts` will stop compiling until Task 10 rewires them — that is expected. Run `bun test` (not typecheck) at the end of this task; typecheck comes back green in Task 10.

- [ ] **Step 1: Edit mplus.ts**

Replace the `RunQuality` interface and the `quality?: RunQuality` field:

```ts
import type { RunSignals } from "./signals/types.ts";
// ...
export interface MPlusRun {
  // ...unchanged fields...
  // Populated only for runs we chose to display (see signals/enrich.ts).
  signals?: RunSignals;
}
```

Delete from `mplus.ts`: `RunQuality`, `GroupRole`, `TableDataPayload`, `SummaryTableData`, `ReportSummaryResponse`, `normalizeRole`, `medianOrNull`, `fetchRunSummary`, `enrichLookupResult`, and the `REPORT_RUN_SUMMARY_QUERY` import. Keep `median`, `inferTargetLevel`, `analyzeLookup`, `fetchMplusData`, `filterBySpec`, `uniqueSpecs`, `getCurrentMplusZone`.

- [ ] **Step 2: Write the failing test**

`test/signals/enrich.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MPlusRun } from "../../src/mplus.ts";
import { enrichRuns } from "../../src/signals/enrich.ts";
import { openStore } from "../../src/signals/store.ts";
import { loadWclFixture } from "../fixtures.ts";

const runFrom = (f: any): MPlusRun => ({ ...f.run, signals: undefined });

describe("enrichRuns", () => {
  test("fetches once, stores raw, parses signals; second call hits the cache", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const s2 = await loadWclFixture("s2-healer");
    const store = openStore(":memory:");
    const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
    const gql = async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      calls.push({ query, variables });
      const code = variables?.code;
      const report = code === s1.run.reportCode ? s1.report : s2.report;
      return { reportData: { report } } as T;
    };

    const runs = [runFrom(s1), runFrom(s2)];
    await enrichRuns(runs, "Biwaadrood", store, { gql });
    expect(calls.length).toBe(2);
    // S1 dungeon has no avoidable list → plain query; S2 → query with $avoidFilter.
    const s1Call = calls.find((c) => c.variables?.code === s1.run.reportCode)!;
    const s2Call = calls.find((c) => c.variables?.code === s2.run.reportCode)!;
    expect(s1Call.variables?.avoidFilter).toBeUndefined();
    expect(String(s2Call.variables?.avoidFilter)).toMatch(/^ability\.id in \(\d+(,\d+)*\)$/);
    expect(runs[0]!.signals?.keystone.timed).toBe(true);
    expect(runs[0]!.signals?.interrupts.count).toBe(23);
    expect(store.getWclRun(s1.run.reportCode, s1.run.fightID)).not.toBeNull();

    const again = [runFrom(s1), runFrom(s2)];
    await enrichRuns(again, "Biwaadrood", store, { gql });
    expect(calls.length).toBe(2); // no new network calls
    expect(again[0]!.signals?.interrupts.count).toBe(23);
    store.close();
  });

  test("a failing fetch leaves that run without signals and does not throw", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const store = openStore(":memory:");
    const gql = async <T,>(): Promise<T> => { throw new Error("boom"); };
    const runs = [runFrom(s1)];
    await enrichRuns(runs, "Biwaadrood", store, { gql });
    expect(runs[0]!.signals).toBeUndefined();
    expect(store.getWclRun(s1.run.reportCode, s1.run.fightID)).toBeNull();
    store.close();
  });

  test("duplicate runs (same report+fight) are fetched once", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const store = openStore(":memory:");
    let n = 0;
    const gql = async <T,>(): Promise<T> => { n++; return { reportData: { report: s1.report } } as T; };
    const runs = [runFrom(s1), runFrom(s1)];
    await enrichRuns(runs, "Biwaadrood", store, { gql });
    expect(n).toBe(1);
    expect(runs[1]!.signals?.deaths.groupTotal).toBe(4);
    store.close();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/signals/enrich.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement enrich.ts**

`src/signals/enrich.ts`:

```ts
import type { LookupResult, MPlusData, MPlusRun } from "../mplus.ts";
import { gql as realGql } from "../wcl/client.ts";
import {
  REPORT_RUN_SUMMARY_QUERY,
  REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY,
} from "../wcl/queries.ts";
import { avoidableFilterExpression, avoidableSpellIdsFor } from "./avoidable/index.ts";
import type { Store } from "./store.ts";
import type { RawRunReport } from "./types.ts";
import { parseRunSignals } from "./wcl-run.ts";

export type GqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

interface Deps {
  gql?: GqlFn;
}

const runKey = (r: MPlusRun) => `${r.reportCode}:${r.fightID}`;

/** The runs a lookup shows: prev-level best + per-dungeon bests, de-duplicated. */
export const displayedRuns = (result: LookupResult): MPlusRun[] => {
  const all: MPlusRun[] = [];
  if (result.prevLevelBest) all.push(result.prevLevelBest.best);
  all.push(...result.perDungeon.runs);
  return [...new Map(all.map((r) => [runKey(r), r])).values()];
};

async function fetchRaw(run: MPlusRun, gql: GqlFn): Promise<RawRunReport | null> {
  const ids = avoidableSpellIdsFor(run.encounterID);
  const variables: Record<string, unknown> = { code: run.reportCode, fightID: run.fightID };
  let query = REPORT_RUN_SUMMARY_QUERY;
  if (ids) {
    query = REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY;
    variables.avoidFilter = avoidableFilterExpression(ids);
  }
  const resp = await gql<{ reportData: { report: RawRunReport | null } }>(query, variables);
  return resp.reportData.report;
}

/**
 * Attach `signals` to each run: store hit → parse; miss → WCL → store → parse.
 * Runs in parallel. A failure on one run leaves that run's `signals`
 * undefined and never throws. ~10 pts per uncached run.
 */
export async function enrichRuns(
  runs: MPlusRun[],
  characterName: string,
  store: Store,
  deps: Deps = {},
): Promise<void> {
  const gql = deps.gql ?? realGql;
  const byKey = new Map<string, MPlusRun[]>();
  for (const r of runs) {
    const k = runKey(r);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }

  await Promise.all(
    [...byKey.values()].map(async (group) => {
      const first = group[0]!;
      try {
        let raw = store.getWclRun(first.reportCode, first.fightID);
        if (!raw) {
          raw = await fetchRaw(first, gql);
          if (raw) store.putWclRun(first.reportCode, first.fightID, raw);
        }
        const signals = parseRunSignals(raw, characterName, {
          keyLevel: first.keyLevel,
          affixes: first.affixes,
          encounterID: first.encounterID,
        });
        if (signals) for (const r of group) r.signals = signals;
      } catch {
        /* leave signals undefined for this run */
      }
    }),
  );
}

export const enrichLookupResult = (
  data: MPlusData,
  result: LookupResult,
  store: Store,
  deps: Deps = {},
): Promise<void> => enrichRuns(displayedRuns(result), data.character.name, store, deps);
```

- [ ] **Step 5: Run the signals tests**

Run: `bun test test/signals/`
Expected: all pass. (`bun run typecheck` fails in cli/server/watch on `enrichLookupResult` — expected until Task 10.)

- [ ] **Step 6: Commit**

```bash
git add src/signals/enrich.ts src/mplus.ts test/signals/enrich.test.ts
git commit -m "feat(signals): store-backed WCL run enrichment; drop legacy quality enrichment from mplus.ts"
```

---

### Task 9: Raider.IO client with retries

**Files:**
- Create: `src/signals/rio-client.ts`
- Test: `test/signals/rio-client.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 7), `parseRioProfile`, `rioProfileUrl` (Task 6), `realmToSlug` (util.ts), `config.region`.
- Produces: `interface RioFetchResult { profile: RioProfile | null; error?: string; fromCache: boolean }`; `fetchRioProfile(region: string, realm: string, name: string, store: Store, opts?: { refresh?: boolean; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }): Promise<RioFetchResult>`; `RIO_RETRY_DELAYS_MS = [1000, 2000, 4000]`.

Behavior: 200 → store + parse. 400/404 → `{ profile: null, error: "Not found on Raider.IO" , fromCache: false }` without retry. 5xx / network error → retry after 1 s, 2 s, 4 s; after the last failure → `{ profile: null, error: "Raider.IO unavailable (HTTP 502)" }`. Cache hit (within TTL, unless `refresh`) → parse cached raw with `fetchedAt` from the store.

- [ ] **Step 1: Write the failing test**

`test/signals/rio-client.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { RIO_RETRY_DELAYS_MS, fetchRioProfile } from "../../src/signals/rio-client.ts";
import { openStore } from "../../src/signals/store.ts";
import { loadRioFixture } from "../fixtures.ts";

const noSleep = async () => {};
const jsonResp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fetchRioProfile", () => {
  test("200 → parsed profile, cached", async () => {
    const raw = await loadRioFixture();
    const store = openStore(":memory:");
    const urls: string[] = [];
    const fetchFn = (async (u: string | URL | Request) => { urls.push(String(u)); return jsonResp(raw); }) as typeof fetch;
    const r = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep, now: () => 42 });
    expect(r.fromCache).toBe(false);
    expect(r.profile?.itemLevel).toBe(322);
    expect(r.profile?.fetchedAt).toBe(42);
    expect(urls[0]).toContain("region=eu&realm=silvermoon&name=Muleyoxo");

    const again = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep, now: () => 43 });
    expect(again.fromCache).toBe(true);
    expect(again.profile?.fetchedAt).toBe(42);
    expect(urls.length).toBe(1);

    const forced = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep, now: () => 44, refresh: true });
    expect(forced.fromCache).toBe(false);
    expect(urls.length).toBe(2);
    store.close();
  });

  test("404 → error, no retry", async () => {
    const store = openStore(":memory:");
    let n = 0;
    const fetchFn = (async () => { n++; return jsonResp({ statusCode: 400, error: "Bad Request", message: "Could not find requested character" }, 400); }) as typeof fetch;
    const r = await fetchRioProfile("EU", "Nerzhul", "Nobody", store, { fetchFn, sleep: noSleep });
    expect(r.profile).toBeNull();
    expect(r.error).toBe("Not found on Raider.IO");
    expect(n).toBe(1);
    store.close();
  });

  test("5xx → retries with backoff, then error", async () => {
    const store = openStore(":memory:");
    const delays: number[] = [];
    let n = 0;
    const fetchFn = (async () => { n++; return new Response("error code: 502", { status: 502 }); }) as typeof fetch;
    const r = await fetchRioProfile("EU", "Nerzhul", "X", store, { fetchFn, sleep: async (ms) => { delays.push(ms); } });
    expect(n).toBe(RIO_RETRY_DELAYS_MS.length + 1);
    expect(delays).toEqual(RIO_RETRY_DELAYS_MS);
    expect(r.profile).toBeNull();
    expect(r.error).toBe("Raider.IO unavailable (HTTP 502)");
    store.close();
  });

  test("network error then success", async () => {
    const raw = await loadRioFixture();
    const store = openStore(":memory:");
    let n = 0;
    const fetchFn = (async () => { n++; if (n === 1) throw new Error("ECONNRESET"); return jsonResp(raw); }) as typeof fetch;
    const r = await fetchRioProfile("EU", "Silvermoon", "Muleyoxo", store, { fetchFn, sleep: noSleep });
    expect(n).toBe(2);
    expect(r.profile?.recentRuns.length).toBe(10);
    store.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/signals/rio-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement rio-client.ts**

`src/signals/rio-client.ts`:

```ts
import { realmToSlug } from "../util.ts";
import { parseRioProfile, rioProfileUrl } from "./rio-profile.ts";
import type { Store } from "./store.ts";
import type { RioProfile } from "./types.ts";

export const RIO_RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface RioFetchResult {
  profile: RioProfile | null;
  error?: string;
  fromCache: boolean;
}

interface Opts {
  refresh?: boolean;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchRioProfile(
  region: string,
  realm: string,
  name: string,
  store: Store,
  opts: Opts = {},
): Promise<RioFetchResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const slug = realmToSlug(realm);

  if (!opts.refresh) {
    const hit = store.getRio(region, slug, name, { now: now() });
    if (hit) return { profile: parseRioProfile(hit.raw, hit.fetchedAt), fromCache: true };
  }

  const url = rioProfileUrl(region, slug, name);
  let lastError = "Raider.IO unavailable";
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(url);
      if (res.ok) {
        const raw: unknown = await res.json();
        const t = now();
        store.putRio(region, slug, name, raw, t);
        return { profile: parseRioProfile(raw, t), fromCache: false };
      }
      if (res.status === 400 || res.status === 404) {
        return { profile: null, error: "Not found on Raider.IO", fromCache: false };
      }
      lastError = `Raider.IO unavailable (HTTP ${res.status})`;
    } catch (e) {
      lastError = `Raider.IO unreachable (${e instanceof Error ? e.message : String(e)})`;
    }
    if (attempt >= RIO_RETRY_DELAYS_MS.length) break;
    await sleep(RIO_RETRY_DELAYS_MS[attempt]!);
  }
  return { profile: null, error: lastError, fromCache: false };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/signals/rio-client.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/signals/rio-client.ts test/signals/rio-client.test.ts
git commit -m "feat(signals): Raider.IO client with store cache and 5xx backoff"
```

---

### Task 10: Shared lookup flow and payload; rewire CLI, server, watcher

**Files:**
- Create: `src/lookup.ts`
- Create: `src/signals/summary.ts`
- Modify: `src/cli.ts` (`cmdLookup`, the `mplus`/`watch` wiring that calls `enrichLookupResult`, remove `applySpecFilter` duplication where `performLookup` replaces it)
- Modify: `src/server.ts` (`runLookupWithCache`)
- Modify: `src/watch.ts` (the lookup branch)
- Test: `test/signals/summary.test.ts`

**Interfaces:**
- Produces (summary.ts): `signalSummary(runs: MPlusRun[], rio: RioProfile | null): SignalSummary` where
  ```ts
  interface SignalSummary {
    runsWithSignals: number;
    timedShown: number | null;        // runs with keystone.timed among runsWithSignals
    avgDeaths: number | null;
    deathsInWipes: number | null;     // total death events flagged inWipe
    dtpsDeltaPct: number | null;      // median over runs of (dtps - peer.median)/peer.median*100
    kicksDeltaPts: number | null;     // median over runs of (usage - peer.median)*100; null if own usage null everywhere
    avoidableDeltaPct: number | null; // median over runs of (perMinute - peer.median)/peer.median*100
    ilvl: number | null;              // rio.itemLevel
    recentTimed: number | null; recentTotal: number | null;
    prevSeason: { slug: string; all: number; best: { role: "dps" | "healer" | "tank"; score: number } } | null;
  }
  ```
- Produces (lookup.ts):
  ```ts
  interface LookupOptions { name: string; realm: string; level: number | null; spec: string | null; metric?: Metric; enrich: boolean; refresh?: boolean }
  type LookupOutcome =
    | { ok: true; data: MPlusData; result: LookupResult; rio: RioProfile | null; rioError?: string; summary: SignalSummary }
    | { ok: false; status: 404; error: string };
  performLookup(opts: LookupOptions, deps?: { store?: Store; gql?: GqlFn; fetchFn?: typeof fetch }): Promise<LookupOutcome>
  buildLookupPayload(o: Extract<LookupOutcome, { ok: true }>, realm: string): LookupPayload   // the JSON the server and `--json` emit
  ```
  `LookupPayload` = the current server payload + `rio`, `rioError`, `summary`, and `character.realmSlug` / `character.region` (already emitted by the CLI, now by both).

- [ ] **Step 1: Write the failing summary test**

`test/signals/summary.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MPlusRun } from "../../src/mplus.ts";
import { parseRioProfile } from "../../src/signals/rio-profile.ts";
import { signalSummary } from "../../src/signals/summary.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadRioFixture, loadWclFixture } from "../fixtures.ts";

describe("signalSummary", () => {
  test("no signals, no rio → all null", () => {
    const s = signalSummary([{ signals: undefined } as MPlusRun], null);
    expect(s.runsWithSignals).toBe(0);
    expect(s.timedShown).toBeNull();
    expect(s.avgDeaths).toBeNull();
    expect(s.kicksDeltaPts).toBeNull();
    expect(s.avoidableDeltaPct).toBeNull();
    expect(s.ilvl).toBeNull();
    expect(s.prevSeason).toBeNull();
  });

  test("aggregates over runs with signals and rio", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const s2 = await loadWclFixture("s2-healer");
    const runs: MPlusRun[] = [
      { ...s1.run, signals: parseRunSignals(s1.report, "Mstercheif", { keyLevel: 18, affixes: s1.run.affixes, encounterID: s1.run.encounterID })! },
      { ...s2.run, signals: parseRunSignals(s2.report, "Muleyoxo", { keyLevel: 21, affixes: s2.run.affixes, encounterID: s2.run.encounterID })! },
      { ...s2.run, signals: undefined },
    ];
    const rio = parseRioProfile(await loadRioFixture(), Date.parse("2026-09-15T12:00:00Z"));
    const s = signalSummary(runs, rio);
    expect(s.runsWithSignals).toBe(2);
    expect(s.timedShown).toBe(2);
    expect(s.avgDeaths).toBe(2);         // 3 + 1 over 2 runs
    expect(s.deathsInWipes).toBe(1);
    expect(s.avoidableDeltaPct).not.toBeNull(); // only the S2 run contributes
    expect(s.kicksDeltaPts).not.toBeNull();     // only Mstercheif has a usage
    expect(s.ilvl).toBe(322);
    expect(s.recentTimed).toBe(9);
    expect(s.recentTotal).toBe(10);
    expect(s.prevSeason).toEqual({ slug: "season-mn-1", all: 4152.7, best: { role: "dps", score: 4152.7 } });
  });

  test("prevSeason is null when rio has fewer than two seasons", async () => {
    const raw = await loadRioFixture();
    const rio = parseRioProfile({ ...raw, mythic_plus_scores_by_season: [raw.mythic_plus_scores_by_season[0]] }, 0);
    expect(signalSummary([], rio).prevSeason).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/signals/summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement summary.ts**

`src/signals/summary.ts`:

```ts
import type { MPlusRun } from "../mplus.ts";
import { median } from "./peers.ts";
import type { RioProfile, RunSignals } from "./types.ts";

export interface SignalSummary {
  runsWithSignals: number;
  timedShown: number | null;
  avgDeaths: number | null;
  deathsInWipes: number | null;
  dtpsDeltaPct: number | null;
  kicksDeltaPts: number | null;
  avoidableDeltaPct: number | null;
  ilvl: number | null;
  recentTimed: number | null;
  recentTotal: number | null;
  prevSeason: { slug: string; all: number; best: { role: "dps" | "healer" | "tank"; score: number } } | null;
}

const pctDelta = (mine: number, peerMedian: number): number | null =>
  peerMedian > 0 ? ((mine - peerMedian) / peerMedian) * 100 : null;

/** Cross-run aggregates shown as tiles / compare rows. Pure. */
export function signalSummary(runs: MPlusRun[], rio: RioProfile | null): SignalSummary {
  const sig = runs.map((r) => r.signals).filter((s): s is RunSignals => s !== undefined);
  const n = sig.length;

  const dtps = sig.map((s) => (s.damageTaken.peer ? pctDelta(s.damageTaken.dtps, s.damageTaken.peer.median) : null))
    .filter((v): v is number => v !== null);
  const kicks = sig.map((s) => (s.interrupts.usage !== null && s.interrupts.peer ? (s.interrupts.usage - s.interrupts.peer.median) * 100 : null))
    .filter((v): v is number => v !== null);
  const avoid = sig.map((s) => (s.avoidableDamage?.peer ? pctDelta(s.avoidableDamage.perMinute, s.avoidableDamage.peer.median) : null))
    .filter((v): v is number => v !== null);

  let prevSeason: SignalSummary["prevSeason"] = null;
  const prev = rio?.seasons[1];
  if (prev) {
    const roles = [
      { role: "dps" as const, score: prev.dps },
      { role: "healer" as const, score: prev.healer },
      { role: "tank" as const, score: prev.tank },
    ].sort((a, b) => b.score - a.score);
    prevSeason = { slug: prev.slug, all: prev.all, best: roles[0]! };
  }

  return {
    runsWithSignals: n,
    timedShown: n > 0 ? sig.filter((s) => s.keystone.timed).length : null,
    avgDeaths: n > 0 ? sig.reduce((a, s) => a + s.deaths.count, 0) / n : null,
    deathsInWipes: n > 0 ? sig.reduce((a, s) => a + s.deaths.events.filter((e) => e.inWipe).length, 0) : null,
    dtpsDeltaPct: median(dtps),
    kicksDeltaPts: median(kicks),
    avoidableDeltaPct: median(avoid),
    ilvl: rio?.itemLevel ?? null,
    recentTimed: rio ? rio.derived.recentTimed : null,
    recentTotal: rio ? rio.derived.recentTotal : null,
    prevSeason,
  };
}
```

- [ ] **Step 4: Run the summary test**

Run: `bun test test/signals/summary.test.ts`
Expected: pass.

- [ ] **Step 5: Write lookup.ts**

`src/lookup.ts`:

```ts
import { config } from "./config.ts";
import {
  type LookupResult,
  type MPlusData,
  analyzeLookup,
  fetchMplusData,
  filterBySpec,
  inferTargetLevel,
  uniqueSpecs,
} from "./mplus.ts";
import type { Metric } from "./roles.ts";
import { type GqlFn, displayedRuns, enrichRuns } from "./signals/enrich.ts";
import { fetchRioProfile } from "./signals/rio-client.ts";
import { type Store, getStore } from "./signals/store.ts";
import { type SignalSummary, signalSummary } from "./signals/summary.ts";
import type { RioProfile } from "./signals/types.ts";
import { realmToSlug } from "./util.ts";

export interface LookupOptions {
  name: string;
  realm: string;
  level: number | null;
  spec: string | null;
  metric?: Metric;
  enrich: boolean;
  refresh?: boolean;
}

export type LookupOutcome =
  | {
      ok: true;
      data: MPlusData;
      result: LookupResult;
      rio: RioProfile | null;
      rioError?: string;
      summary: SignalSummary;
    }
  | { ok: false; status: 404; error: string };

interface Deps {
  store?: Store;
  gql?: GqlFn;
  fetchFn?: typeof fetch;
}

/** The whole lookup: rankings → analysis → (WCL enrichment ‖ Raider.IO). */
export async function performLookup(opts: LookupOptions, deps: Deps = {}): Promise<LookupOutcome> {
  const store = deps.store ?? (await getStore());
  let data = await fetchMplusData(opts.name, opts.realm, {
    metric: opts.metric,
    specFilter: opts.spec,
  });

  if (opts.spec) {
    const runs = filterBySpec(data.runs, opts.spec);
    if (runs.length === 0) {
      const avail = uniqueSpecs(data.runs);
      return {
        ok: false,
        status: 404,
        error:
          `No runs found for spec "${opts.spec}". ` +
          (avail.length > 0
            ? `Specs seen on this character: ${avail.join(", ")}.`
            : "This character has no runs this season."),
      };
    }
    data = { ...data, runs, specFilter: opts.spec };
  }

  const effective = opts.level ?? inferTargetLevel(data.runs);
  if (effective === null) {
    return {
      ok: false,
      status: 404,
      error: "No runs found — cannot auto-detect target level. Pass --level <N> explicitly.",
    };
  }
  const result = analyzeLookup(data.runs, effective, data.seasonDungeons, opts.level === null);

  const [, rioRes] = await Promise.all([
    opts.enrich
      ? enrichRuns(displayedRuns(result), data.character.name, store, { gql: deps.gql })
      : Promise.resolve(),
    fetchRioProfile(config.region, opts.realm, data.character.name, store, {
      refresh: opts.refresh,
      fetchFn: deps.fetchFn,
    }),
  ]);

  return {
    ok: true,
    data,
    result,
    rio: rioRes.profile,
    ...(rioRes.error ? { rioError: rioRes.error } : {}),
    summary: signalSummary(displayedRuns(result), rioRes.profile),
  };
}

export type LookupPayload = ReturnType<typeof buildLookupPayload>;

/** JSON emitted by `/api/lookup` and `bmpl lookup --json`. */
export function buildLookupPayload(o: Extract<LookupOutcome, { ok: true }>, realm: string) {
  const { data, result } = o;
  return {
    character: { ...data.character, realmSlug: realmToSlug(realm), region: config.region },
    zone: { id: data.zoneID, name: data.zoneName, partition: data.partition },
    metric: data.metric,
    metricAutoSelected: data.metricAutoSelected,
    alternateMetricHasData: data.alternateMetricHasData,
    specFilter: data.specFilter,
    runsIndexed: data.runs.length,
    seasonDungeons: data.seasonDungeons,
    targetLevel: result.targetLevel,
    targetAutoDetected: result.targetAutoDetected,
    atOrAboveTargetCount: result.atOrAboveTarget.length,
    prevLevelBest: result.prevLevelBest,
    perDungeon: result.perDungeon,
    rio: o.rio,
    rioError: o.rioError ?? null,
    summary: o.summary,
  };
}
```

- [ ] **Step 6: Rewire `cli.ts`**

Replace the body of `cmdLookup` with:

```ts
async function cmdLookup(
  name: string,
  realm: string,
  targetLevel: number | null,
  spec: string | null,
  metric: Metric | undefined,
  enrich: boolean,
  json: boolean,
): Promise<void> {
  const o = await performLookup({ name, realm, level: targetLevel, spec, metric, enrich });
  if (!o.ok) {
    console.error(json ? o.error : err("✗ " + o.error));
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify(buildLookupPayload(o, realm), null, 2));
    return;
  }
  console.log(renderLookup(o.data, o.result, o.rio, o.rioError, o.summary));
}
```

Add `import { buildLookupPayload, performLookup } from "./lookup.ts";`, remove `enrichLookupResult` from the `./mplus.ts` import. `cmdMplus` keeps using `applySpecFilter` (it does not enrich); remove `applySpecFilter` only if no caller remains. `renderLookup`'s new signature is defined in Task 11 — until then, pass only `(o.data, o.result)` and let Task 11 extend it (or do Task 11 first; both orders compile).

- [ ] **Step 7: Rewire `server.ts`**

In `runLookupWithCache`, replace everything from `const data = await fetchMplusData(` through `const payload = { … };` with:

```ts
    const o = await performLookup({
      name: target.name,
      realm: target.realm,
      level: opts.level,
      spec: opts.spec,
      metric: opts.metric ?? undefined,
      enrich: true,
      refresh: opts.refresh,
    });
    if (!o.ok) return { ok: false, status: o.status, error: o.error };
    const payload = buildLookupPayload(o, target.realm);
```

and update the `addHistoryEntry` call to read `o.data.character.classID`, `o.data.character.spec`, `o.result.targetLevel`, `o.result.targetAutoDetected`. Remove the now-unused imports (`analyzeLookup`, `enrichLookupResult`, `fetchMplusData`, `filterBySpec`, `inferTargetLevel`, `uniqueSpecs`) and add `import { buildLookupPayload, performLookup } from "./lookup.ts";`.

- [ ] **Step 8: Rewire `watch.ts`**

Replace the block from `const data = await fetchMplusData(` to `console.log(renderLookup(filtered, result));` with:

```ts
        const o = await performLookup({
          name: target.name,
          realm: target.realm,
          level: opts.level,
          spec: opts.spec,
          metric: opts.metric,
          enrich: opts.enrich,
        });
        if (!o.ok) {
          console.log(err("✗ " + o.error));
        } else {
          console.log(renderLookup(o.data, o.result, o.rio, o.rioError, o.summary));
        }
```

(Keep the variable names the file already uses for the parsed clipboard target.) Update imports accordingly.

- [ ] **Step 9: Typecheck and run everything**

Run: `bun run typecheck && bun test`
Expected: clean, all tests pass. If `renderLookup` has not been extended yet (Task 11), temporarily call it with two arguments.

- [ ] **Step 10: Manual smoke test**

Run: `bun src/cli.ts lookup Muleyoxo-Silvermoon --json | head -60`
Expected: JSON with `rio.itemLevel: 322`, `summary.recentTotal: 10`, and each `perDungeon.runs[i].signals.keystone.timed` boolean. Run it again: it should return in well under a second (store hit); `bun src/cli.ts ping` shows only ~10 pts spent for the second call.

- [ ] **Step 11: Commit**

```bash
git add src/lookup.ts src/signals/summary.ts src/cli.ts src/server.ts src/watch.ts test/signals/summary.test.ts
git commit -m "feat: shared lookup flow with WCL enrichment ‖ Raider.IO; payload gains rio + signal summary"
```

---

### Task 11: CLI rendering

**Files:**
- Modify: `src/format-mplus.ts`
- Modify: `src/util.ts` (add `formatDuration(ms): string` → `27:32`)
- Test: `test/format.test.ts`

**Interfaces:**
- Consumes: `RunSignals`, `RioProfile`, `SignalSummary`.
- Produces: `renderLookup(data: MPlusData, result: LookupResult, rio: RioProfile | null, rioError: string | undefined, summary: SignalSummary): string`; `renderRunSignals(s: RunSignals): string` (exported for tests); `formatDuration(ms: number): string`.

- [ ] **Step 1: Write the failing tests**

`test/format.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderRunSignals } from "../src/format-mplus.ts";
import { parseRunSignals } from "../src/signals/wcl-run.ts";
import { formatDuration } from "../src/util.ts";
import { loadWclFixture } from "./fixtures.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("formatDuration", () => {
  test("mm:ss", () => {
    expect(formatDuration(1751502)).toBe("29:11");
    expect(formatDuration(59_000)).toBe("0:59");
    expect(formatDuration(3_600_000)).toBe("60:00");
  });
});

describe("renderRunSignals", () => {
  test("tank line: deaths, dtps without peers, kicks with usage, dispels, no avoidable", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", { keyLevel: 18, affixes: [], encounterID: f.run.encounterID })!;
    const line = strip(renderRunSignals(s));
    expect(line).toContain("0 deaths");
    expect(line).toContain("dtps");
    expect(line).not.toContain("vs ");
    expect(line).toMatch(/kicks 23\/113 \(peer \d+%\)/);
    expect(line).toContain("dispels 0");
    expect(line).not.toContain("avoidable");
  });

  test("healer line: death in wipe, avoidable delta, no kick capacity", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", { keyLevel: 21, affixes: [], encounterID: f.run.encounterID })!;
    const line = strip(renderRunSignals(s));
    expect(line).toContain("1 death (1 in wipe)");
    expect(line).toMatch(/avoidable [\d.]+k\/min \(-?\d+%\)/);
    expect(line).toContain("kicks 1 (no kick on spec)");
    expect(line).toContain("dispels 9");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/format.test.ts`
Expected: FAIL — `renderRunSignals` / `formatDuration` not exported.

- [ ] **Step 3: Add `formatDuration` to util.ts**

```ts
export const formatDuration = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
```

- [ ] **Step 4: Rewrite the run rendering in format-mplus.ts**

Replace `deathColor`, `dtpsCompareTag`, `renderQuality` with:

```ts
import type { RioProfile, RunSignals } from "./signals/types.ts";
import type { SignalSummary } from "./signals/summary.ts";
import { ageInDays, formatAge, formatDps, formatDuration, wclReportUrl } from "./util.ts";

const deathsText = (s: RunSignals): string => {
  const n = s.deaths.count;
  const wipes = s.deaths.events.filter((e) => e.inWipe).length;
  const label = `${n} death${n === 1 ? "" : "s"}` + (wipes > 0 ? ` (${wipes} in wipe)` : "");
  if (n === 0) return pc.green(label);
  if (n <= 2) return pc.yellow(label);
  return pc.red(pc.bold(label));
};

const lowerIsBetter = (deltaPct: number, label: string): string => {
  if (deltaPct <= -10) return pc.green(label);
  if (deltaPct <= 10) return dim(label);
  if (deltaPct <= 30) return pc.yellow(label);
  return pc.red(pc.bold(label));
};

const dtpsText = (s: RunSignals): string => {
  const base = `${formatDps(s.damageTaken.dtps)} dtps`;
  const p = s.damageTaken.peer;
  if (!p || p.median <= 0) return base;
  const delta = ((s.damageTaken.dtps - p.median) / p.median) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${base} ${lowerIsBetter(delta, `${sign}${delta.toFixed(0)}% vs ${p.count} dps peer${p.count === 1 ? "" : "s"}`)}`;
};

const avoidableText = (s: RunSignals): string | null => {
  const a = s.avoidableDamage;
  if (!a) return null;
  const base = `avoidable ${formatDps(a.perMinute)}/min`;
  if (!a.peer || a.peer.median <= 0) return base;
  const delta = ((a.perMinute - a.peer.median) / a.peer.median) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${base} ${lowerIsBetter(delta, `(${sign}${delta.toFixed(0)}%)`)}`;
};

const kicksText = (s: RunSignals): string => {
  const i = s.interrupts;
  if (i.capacity === null || i.usage === null) return dim(`kicks ${i.count} (no kick on spec)`);
  const base = `kicks ${i.count}/${Math.round(i.capacity)}`;
  if (!i.peer) return base;
  const peerPct = `(peer ${Math.round(i.peer.median * 100)}%)`;
  const delta = (i.usage - i.peer.median) * 100;
  const colored = delta >= 0 ? pc.green(peerPct) : delta < -25 ? pc.red(peerPct) : dim(peerPct);
  return `${base} ${colored}`;
};

export const renderRunSignals = (s: RunSignals): string => {
  const parts = [deathsText(s), dtpsText(s)];
  const av = avoidableText(s);
  if (av) parts.push(av);
  parts.push(kicksText(s), `dispels ${s.dispels.count}`);
  return parts.join(`  ${dim("·")}  `);
};

const keyBadge = (r: MPlusRun): string => {
  const level = pc.bold(`+${r.keyLevel}`);
  const s = r.signals;
  if (!s || s.partial) return level;
  return s.keystone.timed
    ? `${level} ${pc.green(`✓+${s.keystone.chests} ${formatDuration(s.keystone.timeMs)}`)}`
    : `${level} ${pc.red(`✗ depleted ${formatDuration(s.keystone.timeMs)}`)}`;
};
```

In `renderRun`, use `keyBadge(r)` instead of `level`, and `r.signals ? renderRunSignals(r.signals) : ""` instead of `renderQuality(r)`.

- [ ] **Step 5: Extend `renderLookup`**

Change the signature to `(data, result, rio, rioError, summary)` and, right after `renderHeader(data)`, add a summary block:

```ts
  const fmtDelta = (v: number | null, unit: "%" | "pts", lowerBetter: boolean): string => {
    if (v === null) return dim("—");
    const label = `${v >= 0 ? "+" : ""}${v.toFixed(0)}${unit}`;
    const good = lowerBetter ? v <= -10 : v >= 0;
    const bad = lowerBetter ? v > 30 : v < -25;
    return good ? pc.green(label) : bad ? pc.red(label) : dim(label);
  };
  const tiles: string[] = [];
  tiles.push(`timed ${summary.timedShown === null ? dim("—") : `${summary.timedShown}/${summary.runsWithSignals}`}`);
  tiles.push(`avg deaths ${summary.avgDeaths === null ? dim("—") : summary.avgDeaths.toFixed(1)}${summary.deathsInWipes ? dim(` (${summary.deathsInWipes} in wipes)`) : ""}`);
  tiles.push(`Δdtps ${fmtDelta(summary.dtpsDeltaPct, "%", true)}`);
  tiles.push(`avoidable ${fmtDelta(summary.avoidableDeltaPct, "%", true)}`);
  tiles.push(`kicks ${fmtDelta(summary.kicksDeltaPts, "pts", false)}`);
  tiles.push(`ilvl ${summary.ilvl ?? dim("—")}`);
  tiles.push(`RIO recent timed ${summary.recentTotal ? `${summary.recentTimed}/${summary.recentTotal}` : dim("—")}`);
  tiles.push(`prev season ${summary.prevSeason ? `${summary.prevSeason.all.toFixed(0)} (${summary.prevSeason.best.role})` : dim("— no data (reroll?)")}`);
  lines.push(dim("  ") + tiles.join(dim("  ·  ")));
```

and, at the end (before `return`), a Raider.IO section:

```ts
  lines.push("");
  if (rio) {
    lines.push(heading("Recent (Raider.IO)") + dim(`  · ${rio.profileUrl}`));
    for (const r of rio.recentRuns.slice(0, 10)) {
      const timed = r.chests > 0 ? pc.green(`✓+${r.chests}`) : pc.red("✗");
      lines.push(`    ${pc.bold(`+${r.level}`)} ${r.dungeon.padEnd(24)} ${timed} ${formatDuration(r.clearMs)}/${formatDuration(r.parMs)}  ${dim(formatAge(r.completedAt))}`);
    }
    if (rio.recentRuns.length === 0) lines.push(dim("    (no recent runs on Raider.IO)"));
  } else {
    lines.push(dim(`  Raider.IO: ${rioError ?? "no data"}`));
  }
```

- [ ] **Step 6: Run tests + typecheck + smoke**

Run: `bun run typecheck && bun test && bun src/cli.ts lookup Muleyoxo-Silvermoon`
Expected: tests pass; the CLI shows the summary line, `✓+1 29:56`-style badges, per-run signal lines and the Raider.IO section.

- [ ] **Step 7: Commit**

```bash
git add src/format-mplus.ts src/util.ts test/format.test.ts
git commit -m "feat(cli): render timed state, kicks/avoidable/dispels, death context, RIO recent runs"
```

---

### Task 12: Web UI rendering and README

**Files:**
- Modify: `src/server-ui.ts` (client JS inside the template string: `qualityLine`, `runRow`, `render` tiles, `summaryStatsFromPayload`, `renderCompareTable`, new RIO section; CSS additions)
- Modify: `README.md`

No automated tests (client JS lives in a string). Verify by hand with `just serve`.

- [ ] **Step 1: Replace `qualityLine` with a signals line**

```js
const fmtDuration = (ms) => { const t = Math.round(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
const lowerCls = (p) => (p <= -10 ? "deaths-0" : p <= 10 ? "" : p <= 30 ? "deaths-low" : "deaths-high");
const signalsLine = (r) => {
  const s = r.signals;
  if (!s) return "";
  const wipes = s.deaths.events.filter((e) => e.inWipe).length;
  const parts = [];
  parts.push('<span class="' + deathsCls(s.deaths.count) + '">' + s.deaths.count + ' death' + (s.deaths.count === 1 ? '' : 's') + (wipes ? ' (' + wipes + ' in wipe)' : '') + '</span>');
  let dt = fmtAmount(s.damageTaken.dtps) + ' dtps';
  if (s.damageTaken.peer && s.damageTaken.peer.median > 0) {
    const d = (s.damageTaken.dtps - s.damageTaken.peer.median) / s.damageTaken.peer.median * 100;
    dt += ' <span class="' + lowerCls(d) + '">' + (d >= 0 ? '+' : '') + d.toFixed(0) + '% vs ' + s.damageTaken.peer.count + ' dps</span>';
  }
  parts.push(dt);
  if (s.avoidableDamage) {
    let av = 'avoidable ' + fmtAmount(s.avoidableDamage.perMinute) + '/min';
    const p = s.avoidableDamage.peer;
    if (p && p.median > 0) {
      const d = (s.avoidableDamage.perMinute - p.median) / p.median * 100;
      av += ' <span class="' + lowerCls(d) + '">(' + (d >= 0 ? '+' : '') + d.toFixed(0) + '%)</span>';
    }
    parts.push(av);
  }
  const i = s.interrupts;
  if (i.usage === null) parts.push('<span class="dim">kicks ' + i.count + ' (no kick on spec)</span>');
  else {
    let k = 'kicks ' + i.count + '/' + Math.round(i.capacity);
    if (i.peer) {
      const d = (i.usage - i.peer.median) * 100;
      const cls = d >= 0 ? 'deaths-0' : d < -25 ? 'deaths-high' : 'dim';
      k += ' <span class="' + cls + '">(peer ' + Math.round(i.peer.median * 100) + '%)</span>';
    }
    parts.push(k);
  }
  parts.push('dispels ' + s.dispels.count);
  return '<span class="quality">' + parts.join(' · ') + '</span>';
};
```

In `runRow`, replace the level span with:

```js
    '<span class="level">+' + r.keyLevel +
      (r.signals && !r.signals.partial
        ? (r.signals.keystone.timed
            ? ' <span class="ok">✓+' + r.signals.keystone.chests + ' ' + fmtDuration(r.signals.keystone.timeMs) + '</span>'
            : ' <span class="deaths-high">✗ depleted ' + fmtDuration(r.signals.keystone.timeMs) + '</span>')
        : '') +
    '</span>' +
```

and `qualityLine(r)` → `signalsLine(r)`. Delete `qualityLine` and `dtpsDeltaCls` (replaced by `lowerCls`); update the two other `dtpsDeltaCls` call sites (tiles + compare) to `lowerCls`.

- [ ] **Step 2: Tiles from `payload.summary`**

In `render`, replace the "Avg deaths" and "Δ DTPS vs peers" tiles with tiles driven by `payload.summary` (`sm`):

```js
    const sm = payload.summary;
    const dash = '<span class="dim">—</span>';
    const delta = (v, unit, lowerBetter) => {
      if (v === null) return dash;
      const good = lowerBetter ? v <= -10 : v >= 0;
      const bad = lowerBetter ? v > 30 : v < -25;
      return '<span class="' + (good ? 'deaths-0' : bad ? 'deaths-high' : '') + '">' + (v >= 0 ? '+' : '') + v.toFixed(0) + unit + '</span>';
    };
    html += tile('Timed (shown)', sm.timedShown === null ? dash : '<span class="' + (sm.timedShown === sm.runsWithSignals ? 'ok' : 'warn') + '">' + sm.timedShown + '/' + sm.runsWithSignals + '</span>', '', sm.timedShown === null);
    html += tile('Avg deaths', sm.avgDeaths === null ? dash : '<span class="' + deathsCls(Math.round(sm.avgDeaths)) + '">' + sm.avgDeaths.toFixed(1) + '</span>' + (sm.deathsInWipes ? '<span class="tile-sub">' + sm.deathsInWipes + ' in wipes</span>' : ''), '', sm.avgDeaths === null);
    html += tile('Δ DTPS vs peers', delta(sm.dtpsDeltaPct, '%', true), '', sm.dtpsDeltaPct === null);
    html += tile('Avoidable vs peers', delta(sm.avoidableDeltaPct, '%', true), '', sm.avoidableDeltaPct === null);
    html += tile('Kicks vs peers', delta(sm.kicksDeltaPts, 'pts', false), '', sm.kicksDeltaPts === null);
    html += tile('ilvl', sm.ilvl === null ? dash : String(sm.ilvl), '', sm.ilvl === null);
    html += tile('RIO recent timed', sm.recentTotal ? '<span class="' + (sm.recentTimed / sm.recentTotal >= 0.8 ? 'ok' : sm.recentTimed / sm.recentTotal < 0.5 ? 'deaths-high' : 'warn') + '">' + sm.recentTimed + '/' + sm.recentTotal + '</span>' : dash, '', !sm.recentTotal);
    html += tile('Prev season', sm.prevSeason ? sm.prevSeason.all.toFixed(0) + '<span class="tile-sub">' + esc(sm.prevSeason.best.role) + '</span>' : '<span class="dim">— no data (reroll?)</span>', '', !sm.prevSeason);
```

- [ ] **Step 3: Raider.IO section after the per-dungeon section**

```js
  if (payload.rio) {
    const rio = payload.rio;
    html += '<div class="section"><h3>Recent (Raider.IO) <small>· <a href="' + esc(rio.profileUrl) + '" target="_blank" rel="noopener">profile ↗</a></small></h3>';
    if (rio.recentRuns.length === 0) html += '<div class="dim">(no recent runs)</div>';
    for (const r of rio.recentRuns.slice(0, 10)) {
      html += '<div class="run">' +
        '<span class="level">+' + r.level + '</span>' +
        '<span class="dungeon">' + esc(r.dungeon) + '</span>' +
        '<span class="' + (r.chests > 0 ? 'ok' : 'deaths-high') + '">' + (r.chests > 0 ? '✓+' + r.chests : '✗ depleted') + '</span>' +
        '<span class="dim">' + fmtDuration(r.clearMs) + ' / ' + fmtDuration(r.parMs) + '</span>' +
        '<span class="age">' + fmtAge(r.completedAt) + '</span>' +
        '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" title="Open on Raider.IO">↗</a>' +
      '</div>';
    }
    html += '</div>';
  } else {
    html += '<div class="section dim">Raider.IO: ' + esc(payload.rioError || 'no data') + '</div>';
  }
```

- [ ] **Step 4: Compare view**

In `summaryStatsFromPayload`, replace the `deathsList`/`deltaList` computation with reads from `payload.summary` and add the new fields:

```js
  const sm = payload.summary;
  return {
    // ...existing target/dungeon/median fields unchanged...
    avgDeaths: sm.avgDeaths,
    medianDtpsDelta: sm.dtpsDeltaPct,
    timedShown: sm.timedShown, runsWithSignals: sm.runsWithSignals,
    avoidableDelta: sm.avoidableDeltaPct,
    kicksDelta: sm.kicksDeltaPts,
    ilvl: sm.ilvl,
    recentTimed: sm.recentTimed, recentTotal: sm.recentTotal,
    prevSeason: sm.prevSeason ? sm.prevSeason.all : null,
    prevSeasonRole: sm.prevSeason ? sm.prevSeason.best.role : null,
    // ...prevLevelBest/scorePoints/regionRank/serverRank unchanged...
  };
```

Add these rows to `summaryRows` (after "Median Δ DTPS vs peers"):

```js
    { label: 'Timed (shown runs)', mode: 'higher',
      values: enriched.map((e) => e.stats.runsWithSignals ? e.stats.timedShown / e.stats.runsWithSignals : null),
      cell: (i) => { const s = enriched[i].stats; return s.timedShown === null ? '<span class="dim">—</span>' : s.timedShown + '/' + s.runsWithSignals; } },
    { label: 'Avoidable dmg vs peers', mode: 'lower',
      values: enriched.map((e) => e.stats.avoidableDelta),
      cell: (i) => { const v = enriched[i].stats.avoidableDelta; return v === null ? '<span class="dim">—</span>' : '<span class="' + lowerCls(v) + '">' + (v >= 0 ? '+' : '') + v.toFixed(0) + '%</span>'; } },
    { label: 'Kicks vs peers', mode: 'higher',
      values: enriched.map((e) => e.stats.kicksDelta),
      cell: (i) => { const v = enriched[i].stats.kicksDelta; return v === null ? '<span class="dim">—</span>' : (v >= 0 ? '+' : '') + v.toFixed(0) + ' pts'; } },
    { label: 'ilvl', mode: 'higher', values: enriched.map((e) => e.stats.ilvl),
      cell: (i) => enriched[i].stats.ilvl === null ? '<span class="dim">—</span>' : String(enriched[i].stats.ilvl) },
    { label: 'RIO recent timed', mode: 'higher',
      values: enriched.map((e) => e.stats.recentTotal ? e.stats.recentTimed / e.stats.recentTotal : null),
      cell: (i) => { const s = enriched[i].stats; return s.recentTotal ? s.recentTimed + '/' + s.recentTotal : '<span class="dim">—</span>'; } },
    { label: 'Prev season', mode: 'higher', values: enriched.map((e) => e.stats.prevSeason),
      cell: (i) => { const s = enriched[i].stats; return s.prevSeason === null ? '<span class="dim">— no data (reroll?)</span>' : s.prevSeason.toFixed(0) + ' <span class="dim">' + esc(s.prevSeasonRole) + '</span>'; } },
```

In the per-dungeon cells (`r.quality` block near the end of `renderCompareTable`), read `r.signals` instead: deaths from `r.signals.deaths.count`, DTPS delta from `r.signals.damageTaken.peer`, and prefix the level with `✓`/`✗` from `r.signals.keystone.timed`.

- [ ] **Step 5: Manual verification**

Run: `just serve` and look up `Muleyoxo-Silvermoon` and `Biwaadrood-Nerzhul`:
1. Run rows show `+21 ✓+1 29:56` badges and the signals line with avoidable/kicks/dispels.
2. Tile row shows the eight new/updated tiles; Biwaadrood (no S2 runs) shows `—` tiles and the RIO section with 0 recent runs or the "No M+ runs indexed" line.
3. Select both tabs → Compare: the six new rows render with highlights; `—` where data is missing.
4. Restart the server and look up Muleyoxo again: result comes back fast; `bun src/cli.ts ping` shows ~10 pts spent.

- [ ] **Step 6: README**

In `README.md`, update the **What you get** list:

```markdown
- **Gameplay quality per run** (fetched from each run's raw log, cached forever
  in a local `bmpl.db`): **timed / depleted** with chest count and clear time,
  **deaths** with what killed them and whether it was a group wipe, **DTPS vs
  the DPS in the same group**, **avoidable damage** (Blizzard's in-game
  classification, list courtesy of
  [postmortem](https://github.com/Sharpened-Banana/postmortem)), **interrupts
  normalized by the spec's kick cooldown** vs peers, and **dispels**. Skip with
  `--no-stats` to save API budget (~10 pts per uncached run).
- **Raider.IO profile** (free, no key): item level, last 10 runs with
  timed/depleted, current + previous season score per role. A missing previous
  season shows `—` — the player may simply have rerolled.
```

Add under **Requirements** a note that the SQLite cache lives in `bmpl.db` next to `.env` (override with `BMPL_DB_PATH`). Add `just test` to the commands list.

- [ ] **Step 7: Typecheck, tests, commit**

Run: `bun run typecheck && bun test`
Expected: clean.

```bash
git add src/server-ui.ts README.md
git commit -m "feat(web): timed badges, signal line, new tiles and compare rows, Raider.IO recent runs"
```

---

## Self-review

**Spec coverage.** Timed/depleted → Tasks 5, 11, 12. Interrupts normalized by cooldown + peers on usage → Tasks 3, 5. Dispels raw → Task 5. Avoidable damage via `filterExpression` + per-dungeon list + postmortem import → Tasks 4, 5, 8. Death context + wipe detection → Task 5. Raider.IO profile, derived ratios, retries, `rio: null` never failing the lookup → Tasks 6, 9, 10. Store with immutable WCL rows, RIO TTL, refresh bypass, query-version gating, `bmpl.db` next to `.env`, git-ignored → Tasks 1, 7. `--no-stats` skips only WCL enrichment → Task 10. Rendering rules (badges, signal line, tiles, compare rows, RIO section, reroll-safe `—`) → Tasks 11, 12. Tests with fixtures and no network → every task. README attribution → Task 12. Cost budget is unchanged by the plan.

**Deviations from the spec, deliberate:** (1) the query-version gate is a column on `wcl_run_raw` rather than a `meta` table — same behaviour, simpler; (2) `resolveDbPath()` lives in `setup.ts` next to `resolveEnvPath()` instead of `config.ts`; (3) a `signals/summary.ts` computes the cross-run aggregates server-side and ships them in the payload as `summary`, so CLI and web render the same numbers instead of re-deriving them client-side.

**Placeholders.** None; every step carries its code. The one outward-facing step (upstream attribution issue, Task 4 Step 8) is explicitly gated on the user's confirmation.

**Type consistency.** `RunSignals`, `RioProfile`, `Store`, `GqlFn`, `SignalSummary`, `LookupOutcome`, `buildLookupPayload`, `renderLookup(data, result, rio, rioError, summary)` and `renderRunSignals` are used with the same names and shapes across Tasks 2–12.
