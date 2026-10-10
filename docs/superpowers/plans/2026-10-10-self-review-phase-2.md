# Self-review phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Control pillar with the crowd control a player lands on enemies (stuns, incapacitates, disorients, fears, silences, knocks), measured from one more WCL query per run of the member's own characters, scored against a per-spec reference, without moving the verdict; and give every character outside the member's list the vetting view the result page had before phase 1.

**Architecture:** A versioned crowd-control table (`src/signals/control/cc-mn-2.json`) becomes a WCL filter expression. `REPORT_RUN_CONTROL_QUERY` returns the run's matching events and the pets' owners, stored as-is in `wcl_run_control` (immutable, keyed by run, tagged with the table version). `parseRunControl` turns it into `RunSignals.control` on read (uses grouped within 1 s, pets credited to their owner, rate per 10 minutes, percent vs the spec's reference). The evaluation gains a sub-signal `utility.crowdControl` flagged `pillarOnly`: `scoreAxis` keeps it out of the axis score and puts its evidence in `AxisScore.pillarOnly`, which only `pillarScores` reads, so `axes[].evidence`, the global score, the drivers and the verdict are byte-identical. The control query only runs for the member's own characters: a lookup with `mine: true` (checked against `user_settings.characters` when hosted) and the season sync (hosted: 403 `not_your_character` otherwise). The front picks the owner's view (three tabs) or the pre-phase-1 vetting view from the "My characters" list.

**Tech Stack:** Bun + TypeScript strict (`src/`), `bun:sqlite`, Vite + React 19 (`web/`), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-10-self-review-control-design.md` (approved 2026-10-10). Parent: `docs/superpowers/specs/2026-10-09-self-review-pillars-design.md` (open question 2 settled 2026-10-10). Canvas page "control" is made in Task 12.

## Before you start: what the user validates with this plan

Validated by the user on 2026-10-10, as written.

These choices are not in the spec or were left open there. The plan implements them as written; the user confirms or changes them before Task 1.

1. **Per-run comparison.** Spec decision 5 compares "the median over the runs used" with the spec's reference. The plan compares each run with the reference of the spec played in that run, then takes the median of those percentages (the way `kicksVsPeers` works), so a character who plays two specs is compared fairly. With one spec, both readings give the same number.
2. **Racial abilities** (War Stomp, Quaking Palm, Haymaker…) are left out of the first table; the audit lists them if they show up, and the user decides.
3. **A stale reference counts for nothing.** `reference-mn-2.json` carries the table version it was collected with; when the table's version moves, `utility.crowdControl` is `n/a` until the reference is collected again (Task 19). Otherwise a reference collected on a shorter list would make every player look better than the average.
4. **Spending points.** Task 3 captures two fixtures (about 6 pts). Task 18 runs the audit (about 300 pts) and Task 19 the reference collection (1 500 to 2 500 pts): each of those two stops and asks the user before spending.
5. **Sync wording.** A character synced in phase 1 has every run analysed but no crowd-control data: the sync card then says "N runs need crowd control (~3 pts each)" and the sync fetches only that.

## Global Constraints

- `just check` and `bun test` green after every task, with `web/dist` absent for the final run. (In the cloud environment, where `just` is missing: `bun run typecheck && bun run --cwd web typecheck` and `bun test`.)
- Tests never reach WCL or Raider.IO: fakes through `deps`, dummy `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` in any test that could fall through to a real call. Agents never print the environment.
- English in code, docs and commits; every UI string in `web/src/i18n/en.ts`, mirrored key for key in `fr.ts`; no UI literal in a component.
- `web/` imports from `src/` are `import type` only (runtime exception `src/wow/classes.ts`).
- Colours, radii and fonts only from `web/src/styles/tokens.css`.
- **No change to the verdict or the global score** (spec non-goal): "The crowd-control sub-signal feeds the Control pillar only (decision 5)." `axes`, `global`, `verdict`, `drivers` and `nextVerdict` of every existing evaluation test stay as they are.
- **Categories** (spec decision 1): "stun, incapacitate (sleeps, polymorphs, saps, incapacitating roars), disorient (blinds, dragon's breaths), fear, silence, and knock (knock-backs, grips, pulls). Roots and slows are left out". The first five are debuffs applied to an enemy by the player or their pet; knocks are casts.
- **Table** (spec decision 2): `src/signals/control/cc-mn-2.json`, `version: "mn-2.0"`, per `Class:Spec` or `Class:*`, entries `{ id, name, category, kind: "debuff" | "cast", pet?: true }`; "Bump the version when the content changes."
- **Query and cache** (spec decision 3): "the run's events filtered on the table (`type = "applydebuff"` on the debuff ids, `type = "cast"` on the knock ids) plus `masterData.actors(type: "Pet") { id petOwner }`"; stored in `wcl_run_control` (report code, fight id, table version, fetched at, json), immutable; a version bump makes rows stale, "they still show, marked "measured with an older list", and the next explicit fetch replaces them. Never refetched automatically."
- **Who pays** (spec decision 4): the control query runs only for the member's own characters; sync: "3 pts each, beside the 10 of a run not yet analysed; the estimate counts both"; a lookup of an own character "fetches it for the runs it enriches"; "a lookup of anyone else costs exactly what it costs today."
- **Numbers** (spec), verbatim:
  - "**Control query:** 3 pts per run (`ESTIMATE_CONTROL = 3`)."
  - "**Sync estimate:** rankings 20 + 10 per run not analysed + 3 per run without control data."
  - "**Use grouping window:** 1 s, same spell, same player (pet credited to its owner)."
  - "**Rate:** uses per 10 minutes of key (fight start to end)."
  - "**Kit floor:** spec reference median under 0.5 use per 10 minutes → `null`."
  - "**Reference:** at least 20 samples per spec; EU, +15 to +20."
  - "**Curve and weights:** decision 5": curve `[[-60, 15], [-30, 40], [0, 65], [30, 85], [60, 100]]`, weights dps 2, tank 2, healer 1, flag `pillarOnly: true`.
- **Owner's view** (spec decision 6): "A character is the member's own when it is in their "My characters" list"; others open "verdict, signal tiles, dungeon runs, Raider.IO, plus the "This is me" chip"; "the hosted server refuses `POST /api/season/sync` for a character not in the member's list (403 `not_your_character`)".
- Stage files explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env*`, `bmpl.db*`, `.calibration/`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01VKeqQEbNWAqsCuRB8nKrKP`.

## Files

| File | Responsibility |
|---|---|
| `src/signals/control/cc-mn-2.json` (new) | the crowd-control table (draft, audited in Task 18) |
| `src/signals/control/table.ts` (new) | `CcCategory`, `CcEntry`, `CC_TABLE`, `ccIds`, `ccFilterExpression`, `ccIndex`, `specCc` |
| `src/signals/control/reference-mn-2.json` (new) | per-spec reference (empty until Task 19) |
| `src/signals/control/reference.ts` (new) | `MIN_REFERENCE_SAMPLES`, `KIT_FLOOR`, `CONTROL_REFERENCE`, `referenceFor` |
| `src/signals/control/parse.ts` (new) | `USE_WINDOW_MS`, `parseRunControl`, `controlOf` |
| `src/signals/types.ts` | `RawControlEvent`, `RawRunControl`, `ControlSpell`, `RunControl`, `RunSignals.control` |
| `src/wcl/queries.ts`, `src/wcl/meter.ts` | `REPORT_RUN_CONTROL_QUERY`, `ESTIMATE_CONTROL` |
| `src/signals/store.ts` | `wcl_run_control`, `getRunControl`, `putRunControl`, `hasRunControl` |
| `src/signals/enrich.ts` | `fetchRunControl`; `enrichRuns` attaches control, fetches it when asked |
| `src/evaluation/types.ts`, `config.ts`, `axis.ts`, `axes/utility.ts`, `axes/index.ts`, `inputs.ts`, `pillars.ts`, `default-config.json`, `docs.ts`, `docs.fr.ts` | `pillarOnly`, `utility.crowdControl` |
| `src/lookup.ts`, `src/server/lookup.ts`, `src/server/validate.ts`, `src/self/characters.ts` | `mine`, `ownsCharacter`, `LookupOptions.control` |
| `src/self/sync.ts`, `src/self/season.ts`, `src/server/season.ts` | control in the sync, the season view and the dungeon details; 403 `not_your_character` |
| `scripts/capture-control.ts`, `scripts/audit-control.ts`, `scripts/calibration/control.ts` (new) | fixtures, table audit, reference collection |
| `test/fixtures/wcl-control-s2-*.json` (new), `test/fixtures.ts` | two captured runs |
| `web/src/types.ts`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/useSeason.ts` | `mine` on lookups, `controlOnly` in the sync |
| `web/src/lib/me.ts`, `web/src/lib/self.ts`, `web/src/lib/axes.ts` | `mineRequest`, control view models, evidence format |
| `web/src/components/Detail.tsx`, `components/self/*` | owner's view vs vetting view, control lines (canvas "control") |
| `web/src/i18n/en.ts`, `fr.ts` | new strings |
| `docs/scoring.md`, `docs/hosted.md`, `docs/agents/architecture.md`, `docs/agents/web-front.md`, `README.md`, `AGENTS.md`, `docs/agents/workflow.md` | behaviour docs |

---

### Task 1: The crowd-control table

**Files:** create `src/signals/control/cc-mn-2.json`, `src/signals/control/table.ts`, `test/signals/control-table.test.ts`.

- [ ] **Step 1: Write the failing test** `test/signals/control-table.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { CC_CATEGORIES, CC_TABLE, ccFilterExpression, ccIds, ccIndex, specCc } from "../../src/signals/control/table.ts";
import { CLASS_NAMES } from "../../src/wow/classes.ts";

const CLASS_KEYS = new Set(Object.values(CLASS_NAMES).map((n) => n.replace(/\s+/g, "")));

describe("crowd-control table", () => {
  test("version and keys", () => {
    expect(CC_TABLE.version).toBe("mn-2.0");
    for (const key of Object.keys(CC_TABLE.specs)) {
      const [cls, spec] = key.split(":");
      expect(CLASS_KEYS.has(cls!)).toBe(true);
      expect(spec && spec.length > 0).toBe(true);
    }
  });
  test("every entry is well-formed; knocks are casts, the rest debuffs", () => {
    for (const entries of Object.values(CC_TABLE.specs)) {
      for (const e of entries) {
        expect(Number.isInteger(e.id) && e.id > 0).toBe(true);
        expect(e.name.length > 0).toBe(true);
        expect(CC_CATEGORIES).toContain(e.category);
        expect(e.kind).toBe(e.category === "knock" ? "cast" : "debuff");
      }
    }
  });
  test("ids and the filter", () => {
    const { debuffs, casts } = ccIds();
    expect(debuffs).toContain(2094); // Blind
    expect(casts).toContain(49576);  // Death Grip
    expect([...debuffs].sort((a, b) => a - b)).toEqual(debuffs);
    expect(ccFilterExpression({ version: "x", source: "", specs: { "Rogue:*": [
      { id: 408, name: "Kidney Shot", category: "stun", kind: "debuff" },
      { id: 2094, name: "Blind", category: "disorient", kind: "debuff" },
    ], "Monk:*": [{ id: 116844, name: "Ring of Peace", category: "knock", kind: "cast" }] } }))
      .toBe('(type = "applydebuff" and ability.id in (408,2094)) or (type = "cast" and ability.id in (116844))');
  });
  test("a table without casts filters on debuffs only", () => {
    expect(ccFilterExpression({ version: "x", source: "", specs: { "Rogue:*": [{ id: 408, name: "Kidney Shot", category: "stun", kind: "debuff" }] } }))
      .toBe('(type = "applydebuff" and ability.id in (408))');
  });
  test("index and spec lookup", () => {
    expect(ccIndex().get("debuff:91800")?.pet).toBe(true); // Gnaw, the ghoul's
    expect(specCc("Rogue", "Outlaw").map((e) => e.id)).toContain(2094);
  });
});
```

- [ ] **Step 2: Run it**: `bun test test/signals/control-table.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write the table** `src/signals/control/cc-mn-2.json`. A draft from the probes of 2026-10-10 (spec "Data notes") and the class kits; Task 18's audit validates it against what players actually apply.

```json
{
  "version": "mn-2.0",
  "source": "Draft 2026-10-10 from two probed runs and the class kits; validated by scripts/audit-control.ts.",
  "specs": {
    "DeathKnight:*": [
      { "id": 221562, "name": "Asphyxiate", "category": "stun", "kind": "debuff" },
      { "id": 108194, "name": "Asphyxiate", "category": "stun", "kind": "debuff" },
      { "id": 207167, "name": "Blinding Sleet", "category": "disorient", "kind": "debuff" },
      { "id": 91800, "name": "Gnaw", "category": "stun", "kind": "debuff", "pet": true },
      { "id": 91797, "name": "Monstrous Blow", "category": "stun", "kind": "debuff", "pet": true },
      { "id": 49576, "name": "Death Grip", "category": "knock", "kind": "cast" },
      { "id": 108199, "name": "Gorefiend's Grasp", "category": "knock", "kind": "cast" }
    ],
    "DemonHunter:*": [
      { "id": 179057, "name": "Chaos Nova", "category": "stun", "kind": "debuff" },
      { "id": 211881, "name": "Fel Eruption", "category": "stun", "kind": "debuff" },
      { "id": 217832, "name": "Imprison", "category": "incapacitate", "kind": "debuff" },
      { "id": 207685, "name": "Sigil of Misery", "category": "fear", "kind": "debuff" },
      { "id": 204490, "name": "Sigil of Silence", "category": "silence", "kind": "debuff" }
    ],
    "Druid:*": [
      { "id": 99, "name": "Incapacitating Roar", "category": "incapacitate", "kind": "debuff" },
      { "id": 5211, "name": "Mighty Bash", "category": "stun", "kind": "debuff" },
      { "id": 203123, "name": "Maim", "category": "stun", "kind": "debuff" },
      { "id": 163505, "name": "Rake", "category": "stun", "kind": "debuff" },
      { "id": 2637, "name": "Hibernate", "category": "incapacitate", "kind": "debuff" },
      { "id": 81261, "name": "Solar Beam", "category": "silence", "kind": "debuff" },
      { "id": 132469, "name": "Typhoon", "category": "knock", "kind": "cast" },
      { "id": 102793, "name": "Ursol's Vortex", "category": "knock", "kind": "cast" }
    ],
    "Evoker:*": [
      { "id": 372245, "name": "Terror of the Skies", "category": "stun", "kind": "debuff" },
      { "id": 360806, "name": "Sleep Walk", "category": "incapacitate", "kind": "debuff" },
      { "id": 357214, "name": "Wing Buffet", "category": "knock", "kind": "cast" },
      { "id": 368970, "name": "Tail Swipe", "category": "knock", "kind": "cast" }
    ],
    "Hunter:*": [
      { "id": 24394, "name": "Intimidation", "category": "stun", "kind": "debuff" },
      { "id": 117526, "name": "Binding Shot", "category": "stun", "kind": "debuff" },
      { "id": 3355, "name": "Freezing Trap", "category": "incapacitate", "kind": "debuff" },
      { "id": 213691, "name": "Scatter Shot", "category": "disorient", "kind": "debuff" },
      { "id": 186387, "name": "Bursting Shot", "category": "knock", "kind": "cast" }
    ],
    "Mage:*": [
      { "id": 118, "name": "Polymorph", "category": "incapacitate", "kind": "debuff" },
      { "id": 383121, "name": "Mass Polymorph", "category": "incapacitate", "kind": "debuff" },
      { "id": 82691, "name": "Ring of Frost", "category": "incapacitate", "kind": "debuff" },
      { "id": 31661, "name": "Dragon's Breath", "category": "disorient", "kind": "debuff" },
      { "id": 157981, "name": "Blast Wave", "category": "knock", "kind": "cast" },
      { "id": 157980, "name": "Supernova", "category": "knock", "kind": "cast" }
    ],
    "Monk:*": [
      { "id": 119381, "name": "Leg Sweep", "category": "stun", "kind": "debuff" },
      { "id": 115078, "name": "Paralysis", "category": "incapacitate", "kind": "debuff" },
      { "id": 198909, "name": "Song of Chi-Ji", "category": "disorient", "kind": "debuff" },
      { "id": 116844, "name": "Ring of Peace", "category": "knock", "kind": "cast" }
    ],
    "Paladin:*": [
      { "id": 853, "name": "Hammer of Justice", "category": "stun", "kind": "debuff" },
      { "id": 105421, "name": "Blinding Light", "category": "disorient", "kind": "debuff" },
      { "id": 20066, "name": "Repentance", "category": "incapacitate", "kind": "debuff" },
      { "id": 10326, "name": "Turn Evil", "category": "fear", "kind": "debuff" }
    ],
    "Priest:*": [
      { "id": 8122, "name": "Psychic Scream", "category": "fear", "kind": "debuff" },
      { "id": 64044, "name": "Psychic Horror", "category": "stun", "kind": "debuff" },
      { "id": 200200, "name": "Holy Word: Chastise", "category": "stun", "kind": "debuff" },
      { "id": 200196, "name": "Holy Word: Chastise", "category": "incapacitate", "kind": "debuff" },
      { "id": 9484, "name": "Shackle Undead", "category": "incapacitate", "kind": "debuff" }
    ],
    "Rogue:*": [
      { "id": 2094, "name": "Blind", "category": "disorient", "kind": "debuff" },
      { "id": 427773, "name": "Blind", "category": "disorient", "kind": "debuff" },
      { "id": 6770, "name": "Sap", "category": "incapacitate", "kind": "debuff" },
      { "id": 1776, "name": "Gouge", "category": "incapacitate", "kind": "debuff" },
      { "id": 1833, "name": "Cheap Shot", "category": "stun", "kind": "debuff" },
      { "id": 408, "name": "Kidney Shot", "category": "stun", "kind": "debuff" }
    ],
    "Rogue:Outlaw": [
      { "id": 199804, "name": "Between the Eyes", "category": "stun", "kind": "debuff" }
    ],
    "Shaman:*": [
      { "id": 118905, "name": "Capacitor Totem", "category": "stun", "kind": "debuff" },
      { "id": 51514, "name": "Hex", "category": "incapacitate", "kind": "debuff" },
      { "id": 197214, "name": "Sundering", "category": "incapacitate", "kind": "debuff" },
      { "id": 51490, "name": "Thunderstorm", "category": "knock", "kind": "cast" }
    ],
    "Warlock:*": [
      { "id": 118699, "name": "Fear", "category": "fear", "kind": "debuff" },
      { "id": 5484, "name": "Howl of Terror", "category": "fear", "kind": "debuff" },
      { "id": 30283, "name": "Shadowfury", "category": "stun", "kind": "debuff" },
      { "id": 6789, "name": "Mortal Coil", "category": "incapacitate", "kind": "debuff" },
      { "id": 710, "name": "Banish", "category": "incapacitate", "kind": "debuff" },
      { "id": 6358, "name": "Seduction", "category": "disorient", "kind": "debuff", "pet": true }
    ],
    "Warlock:Demonology": [
      { "id": 89766, "name": "Axe Toss", "category": "stun", "kind": "debuff", "pet": true }
    ],
    "Warrior:*": [
      { "id": 132168, "name": "Shockwave", "category": "stun", "kind": "debuff" },
      { "id": 132169, "name": "Storm Bolt", "category": "stun", "kind": "debuff" },
      { "id": 5246, "name": "Intimidating Shout", "category": "fear", "kind": "debuff" }
    ]
  }
}
```

- [ ] **Step 4: Write the loader** `src/signals/control/table.ts`:

```ts
// The crowd-control table of the self-review's Control pillar (docs/superpowers/specs/2026-10-10-self-review-control-
// design.md, decisions 1 and 2): season data, versioned by file like the avoidable list and the defensives.
import mn2 from "./cc-mn-2.json";

export type CcCategory = "stun" | "incapacitate" | "disorient" | "fear" | "silence" | "knock";
export const CC_CATEGORIES: readonly CcCategory[] = ["stun", "incapacitate", "disorient", "fear", "silence", "knock"];

export interface CcEntry {
  id: number;
  name: string;
  category: CcCategory;
  /** A knock leaves no debuff: it is read as a cast. */
  kind: "debuff" | "cast";
  /** Applied by the player's pet (credited to its owner). */
  pet?: true;
}
/** `specs` is keyed `Class:Spec` or `Class:*` (WCL's spacing-free names, as `src/signals/kick-cooldowns.ts`). */
export interface CcTable { version: string; source: string; specs: Record<string, CcEntry[]> }

export const CC_TABLE = mn2 as CcTable;

const sorted = (ids: Iterable<number>): number[] => [...new Set(ids)].sort((a, b) => a - b);

/** Every id the filter asks WCL for, by kind, deduplicated and sorted. */
export function ccIds(t: CcTable = CC_TABLE): { debuffs: number[]; casts: number[] } {
  const all = Object.values(t.specs).flat();
  return { debuffs: sorted(all.filter((e) => e.kind === "debuff").map((e) => e.id)), casts: sorted(all.filter((e) => e.kind === "cast").map((e) => e.id)) };
}

/** The events filter of REPORT_RUN_CONTROL_QUERY: debuff applications and knock casts of the table. */
export function ccFilterExpression(t: CcTable = CC_TABLE): string {
  const { debuffs, casts } = ccIds(t);
  const parts = [`(type = "applydebuff" and ability.id in (${debuffs.join(",")}))`];
  if (casts.length > 0) parts.push(`(type = "cast" and ability.id in (${casts.join(",")}))`);
  return parts.join(" or ");
}

/** `kind:id` → entry; an id listed for several specs keeps its first entry. */
export function ccIndex(t: CcTable = CC_TABLE): Map<string, CcEntry> {
  const out = new Map<string, CcEntry>();
  for (const e of Object.values(t.specs).flat()) if (!out.has(`${e.kind}:${e.id}`)) out.set(`${e.kind}:${e.id}`, e);
  return out;
}

/** A spec's entries: `Class:*` then `Class:Spec`. */
export const specCc = (className: string, spec: string, t: CcTable = CC_TABLE): CcEntry[] =>
  [...(t.specs[`${className}:*`] ?? []), ...(t.specs[`${className}:${spec}`] ?? [])];
```

- [ ] **Step 5: Run the test**: `bun test test/signals/control-table.test.ts` → PASS. Then `bun run typecheck`.

- [ ] **Step 6: Commit**: `git add src/signals/control/cc-mn-2.json src/signals/control/table.ts test/signals/control-table.test.ts` → `feat(signals): crowd-control table mn-2.0 (draft)`.

### Task 2: The control query and its cache

**Files:** modify `src/signals/types.ts`, `src/wcl/queries.ts`, `src/wcl/meter.ts`, `src/signals/store.ts`, `src/signals/enrich.ts`; tests `test/signals/store.test.ts`, `test/signals/enrich.test.ts`.

- [ ] **Step 1: Raw types** in `src/signals/types.ts`, after `RawRunReport`:

```ts
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
```

- [ ] **Step 2: Query and estimate.** In `src/wcl/queries.ts`, after `REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY`:

```ts
// Crowd control of one run (docs/superpowers/specs/2026-10-10-self-review-control-design.md, decision 3): the
// table's debuff applications and knock casts by the friendly side, and the pets' owners. One page in practice
// (~150 events, 3 pts measured); paged on `startTime` like the deep-dive.
export const REPORT_RUN_CONTROL_QUERY = /* GraphQL */ `
  query ReportRunControl($code: String!, $fightID: Int!, $filter: String!, $startTime: Float) {
    ${RATE_LIMIT}
    reportData {
      report(code: $code) {
        masterData { actors(type: "Pet") { id petOwner } }
        cc: events(fightIDs: [$fightID], filterExpression: $filter, limit: 10000, startTime: $startTime) { data nextPageTimestamp }
      }
    }
  }
`;
```

In `src/wcl/meter.ts`, beside `ESTIMATE_RUN`: `export const ESTIMATE_CONTROL = 3;`

- [ ] **Step 3: Failing store test** (append to `test/signals/store.test.ts`):

```ts
test("wcl_run_control: put, get, version check", () => {
  const store = openStore(":memory:");
  const raw = { tableVersion: "mn-2.0", pets: [{ id: 333, petOwner: 328 }], events: [{ timestamp: 1, type: "applydebuff", sourceID: 333, abilityGameID: 91800 }] };
  expect(store.getRunControl("AbC", 9)).toBeNull();
  expect(store.hasRunControl("AbC", 9, "mn-2.0")).toBe(false);
  store.putRunControl("AbC", 9, raw);
  expect(store.getRunControl("AbC", 9)).toEqual(raw);
  expect(store.hasRunControl("AbC", 9, "mn-2.0")).toBe(true);
  expect(store.hasRunControl("AbC", 9, "mn-2.1")).toBe(false);
  store.putRunControl("AbC", 9, { ...raw, tableVersion: "mn-2.1", events: [] });
  expect(store.getRunControl("AbC", 9)?.events).toEqual([]);
});
```

Run `bun test test/signals/store.test.ts` → FAIL.

- [ ] **Step 4: Store.** In `src/signals/store.ts`: import `RawRunControl` with `RawRunReport`; add to the `Store` interface:

```ts
  /** The run's cached crowd-control events, whatever table version they were fetched with. */
  getRunControl(code: string, fightID: number): RawRunControl | null;
  putRunControl(code: string, fightID: number, raw: RawRunControl): void;
  /** Cached at that table version. */
  hasRunControl(code: string, fightID: number, tableVersion: string): boolean;
```

to `SCHEMA`, after `character_runs`:

```sql
-- Crowd-control events of a run (self-review phase 2, decision 3), all five players and their pets, as fetched.
-- Immutable; a newer table version replaces the row only on an explicit fetch.
CREATE TABLE IF NOT EXISTS wcl_run_control (
  report_code   TEXT    NOT NULL,
  fight_id      INTEGER NOT NULL,
  table_version TEXT    NOT NULL,
  fetched_at    INTEGER NOT NULL,
  json          TEXT    NOT NULL,
  PRIMARY KEY (report_code, fight_id)
);
```

the statements, after `hasRunQ`:

```ts
  const getControlQ = db.query<{ json: string }, [string, number]>("SELECT json FROM wcl_run_control WHERE report_code = ? AND fight_id = ?");
  const putControlQ = db.query(
    "INSERT OR REPLACE INTO wcl_run_control (report_code, fight_id, table_version, fetched_at, json) VALUES (?, ?, ?, ?, ?)",
  );
  const hasControlQ = db.query<{ one: number }, [string, number, string]>(
    "SELECT 1 AS one FROM wcl_run_control WHERE report_code = ? AND fight_id = ? AND table_version = ?",
  );
```

and the methods, after `hasWclRun`:

```ts
    getRunControl(code, fightID) {
      const row = getControlQ.get(code, fightID);
      return row ? (JSON.parse(row.json) as RawRunControl) : null;
    },
    putRunControl(code, fightID, raw) {
      putControlQ.run(code, fightID, raw.tableVersion, Date.now(), JSON.stringify(raw));
    },
    hasRunControl(code, fightID, tableVersion) {
      return hasControlQ.get(code, fightID, tableVersion) !== null;
    },
```

Run the store test → PASS. Any fake `Store` object in other tests (`grep -rln "hasWclRun" test`) gains the three methods (`getRunControl: () => null`, `putRunControl: () => {}`, `hasRunControl: () => false`).

- [ ] **Step 5: Failing fetch test** (append to `test/signals/enrich.test.ts`):

```ts
import { fetchRunControl } from "../../src/signals/enrich.ts";
import { CC_TABLE, ccFilterExpression } from "../../src/signals/control/table.ts";

describe("fetchRunControl", () => {
  test("one page: events, pets with an owner, the table version", async () => {
    const calls: Record<string, unknown>[] = [];
    const gql = async <T>(_q: string, v?: Record<string, unknown>): Promise<T> => {
      calls.push(v!);
      return { reportData: { report: {
        masterData: { actors: [{ id: 333, petOwner: 328 }, { id: 400, petOwner: null }] },
        cc: { data: [{ timestamp: 5, type: "applydebuff", sourceID: 333, abilityGameID: 91800 }], nextPageTimestamp: null },
      } } } as T;
    };
    const out = await fetchRunControl({ reportCode: "AbC", fightID: 9 }, gql);
    expect(out).toEqual({ tableVersion: CC_TABLE.version, pets: [{ id: 333, petOwner: 328 }], events: [{ timestamp: 5, type: "applydebuff", sourceID: 333, abilityGameID: 91800 }] });
    expect(calls).toEqual([{ code: "AbC", fightID: 9, filter: ccFilterExpression() }]);
  });
  test("follows nextPageTimestamp, then stops", async () => {
    let n = 0;
    const gql = async <T>(_q: string, v?: Record<string, unknown>): Promise<T> => {
      n++;
      const first = v!.startTime === undefined;
      return { reportData: { report: { masterData: { actors: [] }, cc: { data: [{ timestamp: first ? 1 : 2, type: "cast", sourceID: 1, abilityGameID: 49576 }], nextPageTimestamp: first ? 2 : null } } } } as T;
    };
    const out = await fetchRunControl({ reportCode: "AbC", fightID: 9 }, gql);
    expect(n).toBe(2);
    expect(out!.events.map((e) => e.timestamp)).toEqual([1, 2]);
  });
  test("a report WCL does not return → null", async () => {
    const gql = async <T>(): Promise<T> => ({ reportData: { report: null } }) as T;
    expect(await fetchRunControl({ reportCode: "AbC", fightID: 9 }, gql)).toBeNull();
  });
});
```

Run `bun test test/signals/enrich.test.ts` → FAIL.

- [ ] **Step 6: `fetchRunControl`** in `src/signals/enrich.ts` (imports: `REPORT_RUN_CONTROL_QUERY`, `CC_TABLE`, `ccFilterExpression`, `RawControlEvent`, `RawRunControl`):

```ts
const CONTROL_MAX_PAGES = 5;

interface RawControlAnswer {
  reportData: { report: {
    masterData?: { actors?: Array<{ id: number; petOwner?: number | null }> };
    cc?: { data?: RawControlEvent[]; nextPageTimestamp?: number | null };
  } | null };
}

/** One run's crowd-control events (~3 pts, spec decision 3); null when WCL returns no report. */
export async function fetchRunControl(run: { reportCode: string; fightID: number }, gql: GqlFn): Promise<RawRunControl | null> {
  const filter = ccFilterExpression();
  const events: RawControlEvent[] = [];
  let pets: RawRunControl["pets"] | null = null;
  let startTime: number | undefined;
  for (let page = 0; page < CONTROL_MAX_PAGES; page++) {
    const resp = await gql<RawControlAnswer>(REPORT_RUN_CONTROL_QUERY, { code: run.reportCode, fightID: run.fightID, filter, ...(startTime === undefined ? {} : { startTime }) });
    const report = resp.reportData.report;
    if (!report) return null;
    pets ??= (report.masterData?.actors ?? []).filter((a) => typeof a.petOwner === "number").map((a) => ({ id: a.id, petOwner: a.petOwner! }));
    events.push(...(report.cc?.data ?? []));
    const next = report.cc?.nextPageTimestamp;
    if (typeof next !== "number") break;
    startTime = next;
  }
  return { tableVersion: CC_TABLE.version, pets: pets ?? [], events };
}
```

Run the enrich test → PASS; `bun run typecheck`.

- [ ] **Step 7: Commit** (`src/signals/types.ts src/wcl/queries.ts src/wcl/meter.ts src/signals/store.ts src/signals/enrich.ts test/signals/store.test.ts test/signals/enrich.test.ts` plus any fake store touched) → `feat(signals): crowd-control query and wcl_run_control cache`.

### Task 3: Parse a run's crowd control

**Files:** create `src/signals/control/reference-mn-2.json`, `src/signals/control/reference.ts`, `src/signals/control/parse.ts`, `scripts/capture-control.ts`, `test/fixtures/wcl-control-s2-dk-frost.json`, `test/fixtures/wcl-control-s2-second.json`; modify `src/signals/types.ts`, `test/fixtures.ts`; test `test/signals/control-parse.test.ts`.

- [ ] **Step 1: Types** in `src/signals/types.ts` (import `CcCategory` type from `./control/table.ts`):

```ts
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
```

and in `RunSignals`, after `avoidableDamage`: `control?: RunControl; // absent when the run's crowd control was never fetched`.

- [ ] **Step 2: Reference file and loader.** `src/signals/control/reference-mn-2.json`:

```json
{ "version": "mn-2.0", "tableVersion": "mn-2.0", "source": "Not collected yet (scripts/calibration/control.ts).", "scope": "EU, +15 to +20", "specs": {} }
```

`src/signals/control/reference.ts`:

```ts
// "Compared with the average player of the spec" (docs/superpowers/specs/2026-10-10-self-review-control-design.md,
// decision 7): per-spec medians of crowd-control uses per 10 minutes, collected by scripts/calibration/control.ts.
import mn2 from "./reference-mn-2.json";
import { CC_TABLE, type CcTable } from "./table.ts";

export const MIN_REFERENCE_SAMPLES = 20;
/** Spec "Numbers": a reference median under 0.5 use per 10 minutes means no real kit → n/a. */
export const KIT_FLOOR = 0.5;

export interface ControlReferenceEntry { median: number; p25: number; p75: number; samples: number }
export interface ControlReference { version: string; tableVersion: string; source: string; scope: string; specs: Record<string, ControlReferenceEntry> }

export const CONTROL_REFERENCE = mn2 as ControlReference;

/** The spec's median, or null: no entry, under 20 samples, under the kit floor, or collected on another table version. */
export function referenceFor(className: string, spec: string, ref: ControlReference = CONTROL_REFERENCE, table: CcTable = CC_TABLE): number | null {
  if (ref.tableVersion !== table.version) return null;
  const e = ref.specs[`${className}:${spec}`];
  if (!e || e.samples < MIN_REFERENCE_SAMPLES || e.median < KIT_FLOOR) return null;
  return e.median;
}
```

- [ ] **Step 3: Capture two fixtures** (spends about 6 WCL pts; the runs must be in the cache the script opens, `BMPL_DB_PATH` may point at a copy that has them). `scripts/capture-control.ts`:

```ts
#!/usr/bin/env bun
// Usage: bun scripts/capture-control.ts <Name> <reportCode> <fightID> <out.json>
// The run's summary must already be cached (a lookup or a sync first). Costs ~3 WCL pts.
import { fetchRunControl } from "../src/signals/enrich.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { gql } from "../src/wcl/client.ts";

const [character, code, fightStr, out] = process.argv.slice(2);
if (!character || !code || !fightStr || !out) { console.error("usage: capture-control <Name> <code> <fight> <out.json>"); process.exit(2); }
const fightID = Number.parseInt(fightStr, 10);
const store = await getStore();
const report = store.getWclRun(code, fightID);
if (!report) { console.error("run not in cache"); process.exit(1); }
const control = await fetchRunControl({ reportCode: code, fightID }, gql);
if (!control) { console.error("WCL returned no report"); process.exit(1); }
await Bun.write(out, JSON.stringify({ character, report, control }, null, 1));
console.log(`wrote ${out}: ${control.events.length} events, ${control.pets.length} pets`);
closeStore();
```

Run it on the two probed runs of the spec's "Data notes" (their summaries are in the phase-1 verification cache; point `BMPL_DB_PATH` at it):

```
bun scripts/capture-control.ts Noshiidk njVt1bdNAv7x3hcK 9 test/fixtures/wcl-control-s2-dk-frost.json
bun scripts/capture-control.ts Noshiidk LMTk3X7BWtgHzjJK 3 test/fixtures/wcl-control-s2-second.json
```

Add to `test/fixtures.ts`:

```ts
const CONTROL_FILES = {
  "s2-dk-frost": "wcl-control-s2-dk-frost.json",
  "s2-second": "wcl-control-s2-second.json",
} as const;
export type ControlFixtureName = keyof typeof CONTROL_FILES;
// Shape: { character: string; report: <raw WCL run report>; control: RawRunControl }.
export const loadControlFixture = async (name: ControlFixtureName): Promise<any> =>
  JSON.parse(await Bun.file(path.join(dir, CONTROL_FILES[name])).text());
```

- [ ] **Step 4: Failing parse test** `test/signals/control-parse.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { controlOf, parseRunControl, USE_WINDOW_MS } from "../../src/signals/control/parse.ts";
import { referenceFor, type ControlReference } from "../../src/signals/control/reference.ts";
import type { CcTable } from "../../src/signals/control/table.ts";
import type { RawRunControl } from "../../src/signals/types.ts";
import { loadControlFixture } from "../fixtures.ts";

const TABLE: CcTable = { version: "t1", source: "", specs: {
  "Rogue:*": [{ id: 408, name: "Kidney Shot", category: "stun", kind: "debuff" }, { id: 2094, name: "Blind", category: "disorient", kind: "debuff" }],
  "DeathKnight:*": [{ id: 91800, name: "Gnaw", category: "stun", kind: "debuff", pet: true }, { id: 49576, name: "Death Grip", category: "knock", kind: "cast" }],
} };
const REF: ControlReference = { version: "r", tableVersion: "t1", source: "", scope: "", specs: {
  "Rogue:Outlaw": { median: 4, p25: 2, p75: 6, samples: 30 },
  "Rogue:Subtlety": { median: 4, p25: 2, p75: 6, samples: 19 },
  "Warrior:Fury": { median: 0.4, p25: 0, p75: 1, samples: 30 },
} };
const ROGUE = { actorID: 10, className: "Rogue", spec: "Outlaw" };
const raw = (events: RawRunControl["events"], pets: RawRunControl["pets"] = [], tableVersion = "t1"): RawRunControl => ({ tableVersion, pets, events });
const ev = (timestamp: number, sourceID: number, abilityGameID: number, type = "applydebuff") => ({ timestamp, type, sourceID, abilityGameID, targetID: 1 });
const TEN_MIN = 600_000;

describe("parseRunControl", () => {
  test("applications within 1 s are one use; enemies count every application", () => {
    const c = parseRunControl(raw([ev(0, 10, 408), ev(400, 10, 408), ev(USE_WINDOW_MS, 10, 408), ev(USE_WINDOW_MS + 1, 10, 408)]), ROGUE, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.spells).toEqual([{ id: 408, name: "Kidney Shot", category: "stun", uses: 2, enemies: 4 }]);
    expect(c.uses).toBe(2);
    expect(c.enemies).toBe(4);
  });
  test("other players, unknown ids and other event types do not count", () => {
    const c = parseRunControl(raw([ev(0, 11, 408), ev(0, 10, 999), ev(0, 10, 408, "removedebuff")]), ROGUE, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.uses).toBe(0);
    expect(c.spells).toEqual([]);
  });
  test("a pet's application goes to its owner; a knock cast is one use and no enemy", () => {
    const dk = { actorID: 328, className: "DeathKnight", spec: "Frost" };
    const c = parseRunControl(raw([ev(0, 333, 91800), ev(5_000, 328, 49576, "cast"), ev(5_100, 328, 49576, "cast")], [{ id: 333, petOwner: 328 }]), dk, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.spells).toEqual([
      { id: 49576, name: "Death Grip", category: "knock", uses: 2, enemies: 0 },
      { id: 91800, name: "Gnaw", category: "stun", uses: 1, enemies: 1 },
    ]);
  });
  test("rate per 10 minutes and the comparison with the spec's reference", () => {
    const events = [0, 2_000, 4_000, 6_000, 8_000, 10_000].map((t) => ev(t, 10, 2094));
    const c = parseRunControl(raw(events), ROGUE, 20 * 60_000, { table: TABLE, reference: REF });
    expect(c.perTenMin).toBe(3);
    expect(c.reference).toBe(4);
    expect(c.vsReference).toBe(-25);
    expect(c.stale).toBe(false);
  });
  test("no usable reference → null comparison; an older table version → stale", () => {
    const c = parseRunControl(raw([ev(0, 10, 408)], [], "t0"), { ...ROGUE, spec: "Subtlety" }, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.reference).toBeNull();
    expect(c.vsReference).toBeNull();
    expect(c.stale).toBe(true);
  });
});

describe("referenceFor", () => {
  test("samples floor, kit floor, table version", () => {
    expect(referenceFor("Rogue", "Outlaw", REF, TABLE)).toBe(4);
    expect(referenceFor("Rogue", "Subtlety", REF, TABLE)).toBeNull();
    expect(referenceFor("Warrior", "Fury", REF, TABLE)).toBeNull();
    expect(referenceFor("Rogue", "Outlaw", { ...REF, tableVersion: "t0" }, TABLE)).toBeNull();
    expect(referenceFor("Mage", "Fire", REF, TABLE)).toBeNull();
  });
});

describe("controlOf on captured runs", () => {
  test("Frost death knight: the ghoul's Gnaw is credited, Blinding Sleet and Death Grip are there", async () => {
    const f = await loadControlFixture("s2-dk-frost");
    const c = controlOf(f.report, f.control, f.character, 30 * 60_000)!;
    const ids = c.spells.map((s) => s.id);
    expect(ids).toContain(91800);
    expect(ids).toContain(207167);
    expect(ids).toContain(49576);
    expect(c.uses).toBeGreaterThan(0);
  });
  test("a name missing from the report → null", async () => {
    const f = await loadControlFixture("s2-second");
    expect(controlOf(f.report, f.control, "Nobody", 30 * 60_000)).toBeNull();
  });
});
```

Run → FAIL.

- [ ] **Step 5: The parser** `src/signals/control/parse.ts`:

```ts
// A run's crowd control (docs/superpowers/specs/2026-10-10-self-review-control-design.md, decision 5, "Numbers"):
// pure, recomputed from the cached events on every read.
import { playerOf } from "../../deepdive/player.ts";
import type { ControlSpell, RawRunControl, RawRunReport, RunControl } from "../types.ts";
import { CONTROL_REFERENCE, referenceFor, type ControlReference } from "./reference.ts";
import { CC_TABLE, ccIndex, type CcTable } from "./table.ts";

/** Applications of the same spell by the same player within 1 s of the use's first one are one use. */
export const USE_WINDOW_MS = 1_000;
const TEN_MINUTES_MS = 600_000;

export interface ControlPlayer { actorID: number; className: string; spec: string }

export function parseRunControl(
  raw: RawRunControl, player: ControlPlayer, durationMs: number,
  deps: { table?: CcTable; reference?: ControlReference } = {},
): RunControl {
  const table = deps.table ?? CC_TABLE;
  const index = ccIndex(table);
  const owner = new Map(raw.pets.map((p) => [p.id, p.petOwner]));
  const mine = raw.events
    .filter((e) => typeof e.sourceID === "number" && (e.sourceID === player.actorID || owner.get(e.sourceID) === player.actorID))
    .sort((a, b) => a.timestamp - b.timestamp);
  const spells = new Map<string, ControlSpell & { start: number }>();
  for (const e of mine) {
    const kind = e.type === "cast" ? "cast" : e.type === "applydebuff" ? "debuff" : null;
    if (kind === null || typeof e.abilityGameID !== "number") continue;
    const entry = index.get(`${kind}:${e.abilityGameID}`);
    if (!entry) continue;
    const key = `${kind}:${entry.id}`;
    let s = spells.get(key);
    if (!s) {
      s = { id: entry.id, name: entry.name, category: entry.category, uses: 0, enemies: 0, start: Number.NEGATIVE_INFINITY };
      spells.set(key, s);
    }
    if (kind === "cast" || e.timestamp - s.start >= USE_WINDOW_MS) {
      s.uses++;
      s.start = e.timestamp;
    }
    if (kind === "debuff") s.enemies++;
  }
  const list = [...spells.values()].map(({ start: _start, ...s }) => s).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  const uses = list.reduce((n, s) => n + s.uses, 0);
  const perTenMin = durationMs > 0 ? uses / (durationMs / TEN_MINUTES_MS) : 0;
  const reference = referenceFor(player.className, player.spec, deps.reference ?? CONTROL_REFERENCE, table);
  return {
    uses,
    enemies: list.reduce((n, s) => n + s.enemies, 0),
    perTenMin,
    reference,
    vsReference: reference === null ? null : ((perTenMin - reference) / reference) * 100,
    stale: raw.tableVersion !== table.version,
    spells: list,
  };
}

/** The player's crowd control in a cached run, or null when nothing was fetched or the name is not in the report. */
export function controlOf(report: RawRunReport, raw: RawRunControl | null, name: string, durationMs: number): RunControl | null {
  if (!raw) return null;
  const p = playerOf(report, name);
  return p ? parseRunControl(raw, p, durationMs) : null;
}
```

The grouping rule in the test ("within 1 s") counts an application exactly 1 000 ms after the use's start as a new use (`>=`).

- [ ] **Step 6: Run** `bun test test/signals/control-parse.test.ts` → PASS; `bun run typecheck`.

- [ ] **Step 7: Commit** (the files above) → `feat(signals): parse a run's crowd control; per-spec reference (empty)`.

### Task 4: The `utility.crowdControl` sub-signal, Control pillar only

**Files:** modify `src/evaluation/types.ts`, `config.ts`, `default-config.json`, `axis.ts`, `axes/utility.ts`, `axes/index.ts`, `inputs.ts`, `pillars.ts`, `docs.ts`, `docs.fr.ts`, `web/src/lib/axes.ts`, `web/src/i18n/en.ts`, `fr.ts`; tests `test/evaluation/*.test.ts`.

- [ ] **Step 1: Failing tests.** In `test/evaluation/pillars.test.ts` (or the file that tests `pillarScores`), add:

```ts
test("utility.crowdControl is in the Control pillar and never in the axis score", () => {
  const cfg = validateConfig(DEFAULT_CONFIG);
  const subs = [
    { id: "dispels", value: 10, label: (r: number) => `${r} dispels/run` },
    { id: "crowdControl", value: 30, label: (r: number) => `crowd control ${r}`, extra: { rate: 4.2 } },
  ];
  const withCc = scoreAxis("utility", subs, "dps", cfg, 8);
  const without = scoreAxis("utility", subs.slice(0, 1), "dps", cfg, 8);
  expect(withCc.score).toBe(without.score);
  expect(withCc.evidence).toEqual(without.evidence);
  expect(withCc.pillarOnly).toEqual([{ label: "crowd control 30", delta: 0, source: "utility.crowdControl", value: 30, extra: { rate: 4.2 }, weight: 2, score: 85 }]);
  const control = pillarScores([withCc]).find((p) => p.key === "control")!;
  expect(control.evidence.map((e) => e.source)).toEqual(["utility.dispels", "utility.crowdControl"]);
  // dispels: weight 1, curve(10) = 85; crowd control: weight 2, curve(30) = 85 → 85.
  expect(control.score).toBe(85);
});
```

In `test/evaluation/config.test.ts`: `pillarOnly` must be a boolean (`expect(() => validateConfig(deepMerge(DEFAULT_CONFIG, { axes: { utility: { subSignals: { crowdControl: { pillarOnly: "yes" } } } } }))).toThrow("pillarOnly")`), and an unknown key still fails. In the evaluation tests that build `EvalInputs` by hand, add `crowdControl: null, controlRate: null` to `utility`.

Run `bun test test/evaluation` → FAIL.

- [ ] **Step 2: Types** (`src/evaluation/types.ts`):
  - `EvidenceExtra`: add `rate?: number` (crowd control's uses per 10 minutes).
  - `SubSignalConfig`: add `/** Scored for its pillar only: kept out of the axis score, so out of the global score and the verdict. */ pillarOnly?: boolean;`
  - `AxisScore`: add `/** Evidence of the axis' pillar-only sub-signals (delta 0): read by \`pillarScores\` only. */ pillarOnly?: Evidence[];`

- [ ] **Step 3: Config.** `default-config.json`: `"version": "5"`, and in `axes.utility.subSignals`, after `dispels`:

```json
"crowdControl": {
  "curve": [[-60, 15], [-30, 40], [0, 65], [30, 85], [60, 100]],
  "weights": { "dps": 2, "healer": 1, "tank": 2 },
  "pillarOnly": true
}
```

`config.ts`, the sub-signal loop:

```ts
      const so = s as Record<string, unknown>;
      expectKeys(so, "pillarOnly" in so ? ["curve", "weights", "pillarOnly"] : ["curve", "weights"], p);
      if ("pillarOnly" in so && typeof so.pillarOnly !== "boolean") fail(`${p}.pillarOnly`, "must be a boolean");
      outSubs[id] = {
        curve: checkCurve(so.curve, `${p}.curve`, 0, 100),
        weights: checkWeights(so.weights, `${p}.weights`),
        ...(so.pillarOnly === true ? { pillarOnly: true } : {}),
      };
```

- [ ] **Step 4: `scoreAxis`** (`src/evaluation/axis.ts`): in the first loop, a `pillarOnly` sub-signal goes to its own list instead of `contributing`, and is not added to `den`:

```ts
  const pillarOnly: Evidence[] = [];
  …
    const s = curve(x, sc.curve);
    const value = sub.raw ?? sub.value;
    if (sc.pillarOnly) {
      pillarOnly.push({ label: sub.label(value), delta: 0, source, value, ...(sub.extra ? { extra: sub.extra } : {}), weight: w, score: s });
      continue;
    }
    contributing.push(…);   // unchanged
```

and the return: `return { key, score: …, confidence: …, evidence, ...(pillarOnly.length > 0 ? { pillarOnly } : {}) };`

- [ ] **Step 5: Inputs and the utility axis.** `src/evaluation/inputs.ts`, `EvalInputs.utility` gains:

```ts
    /** Median over runs of the % vs the spec's reference (src/signals/control); null without one. Control pillar only. */
    crowdControl: number | null;
    /** Median uses per 10 minutes over the same runs, for the label. */
    controlRate: number | null;
```

computed after `dispels`:

```ts
  // Crowd control: each run against the reference of the spec played in it (plan "Before you start", 1).
  const compared = sig.filter((s) => s.control?.vsReference !== null && s.control?.vsReference !== undefined);
  const crowdControl = median(compared.map((s) => s.control!.vsReference!));
  const controlRate = median(compared.map((s) => s.control!.perTenMin));
```

and returned in `utility`. `src/evaluation/axes/utility.ts`:

```ts
  if (!u.hasKick && !u.hasDispel && u.crowdControl === null && i.role !== "healer") { … }   // guard unchanged otherwise
  …
    { id: "dispels", … },
    {
      id: "crowdControl", value: u.crowdControl, label: (r) => `crowd control ${signed(r)}% vs spec median (${rate} per 10 min)`,
      extra: { rate },
    },
```

with `const rate = Math.round((u.controlRate ?? 0) * 10) / 10;` above the `scoreAxis` call (`controlRate` is set whenever `crowdControl` is: both come from the same runs).

`src/evaluation/axes/index.ts`: add `"utility.crowdControl"` after `"utility.dispels"` in `EVIDENCE_SOURCES`.

- [ ] **Step 6: Pillars.** `src/evaluation/pillars.ts`: `control: ["utility.dispels", "utility.crowdControl"]`, and in `pillarScores`: `const all = axes.flatMap((a) => [...a.evidence, ...(a.pillarOnly ?? [])]);`. Update the file's header comment: "Nothing here feeds the global score or the verdict; a `pillarOnly` sub-signal exists only here."

- [ ] **Step 7: Docs registry.** `src/evaluation/docs.ts`, `axes.utility.subSignals`, after `dispels`:

```ts
        crowdControl: { title: "Crowd control", what: "Stuns, incapacitates, disorients, fears, silences and knocks the player (or their pet) landed on enemies, per 10 minutes of key, against the average player of the same spec.", source: "Each run's crowd-control events, filtered on the season's crowd-control table (one more Warcraft Logs query per run of your own characters, about 3 points); the reference is the median of ranked players of the spec at +15 to +20.", how: "Per run: uses per 10 minutes (applications of one spell within 1 s are one use; a pet's go to its owner), then (yours − the spec's median) / the spec's median in %; the median over runs. Counted in the Control pillar only, never in the axis, the global score or the verdict.", why: "A stun or a knock at the right time is a cast that never lands on the group; the parse and the kick count do not see it.", naWhen: "When no run has crowd-control data (only your own characters are measured), or the spec has no reference: fewer than 20 sampled players, or a median under 0.5 use per 10 minutes.", unit: "% vs the spec's median", scaledByLevel: false },
```

and the Control entry of `pillars.items` now reads that the pillar is dispels and crowd control. Mirror both in `docs.fr.ts` (register of `docs/superpowers/specs/2026-09-21-french-locale-design.md`).

- [ ] **Step 8: Front evidence format** (needed for `web` typecheck once `EVIDENCE_SOURCES` grows). `web/src/lib/axes.ts` `VALUE_FORMAT`: `"utility.crowdControl": signed0,`. `en.ts` `evidence.utility`: `crowdControl: "crowd control {value}% vs spec median ({rate} per 10 min)",`; `fr.ts`: `crowdControl: "contrôle {value} % vs médiane de la spé ({rate} / 10 min)",`. `EvidenceExtra.rate` is already rounded to one decimal by the server, so the English `evidenceText` is byte-identical to the server's `label` (the rule of `VALUE_FORMAT`). Add a case to `web/src/lib/axes.test.ts`: `evidenceText(tEn, "en", { label: "x", delta: 0, source: "utility.crowdControl", value: 12.4, extra: { rate: 4.2 } })` → `"crowd control +12% vs spec median (4.2 per 10 min)"`.

- [ ] **Step 9: Run** `bun test test/evaluation web/src/lib/axes.test.ts`, then the whole `bun test` (every existing evaluation snapshot must be unchanged: no fixture has control data), `bun run typecheck && bun run --cwd web typecheck`.

- [ ] **Step 10: Commit** → `feat(evaluation): utility.crowdControl, a Control-pillar-only sub-signal`.

### Task 5: Lookups of the member's own characters fetch crowd control

**Files:** modify `src/signals/enrich.ts`, `src/lookup.ts`; tests `test/signals/enrich.test.ts`, `test/lookup.test.ts`.

- [ ] **Step 1: Failing tests.** In `test/signals/enrich.test.ts`, with the existing fake store and a fake `gql` that answers the summary query with the `s2-dk-frost` fixture's `report` and the control query with its `control` (dispatch on `query.includes("ReportRunControl")`):
  - `enrichRuns(runs, "Noshiidk", store, { gql })` → one summary call, no control call, `signals.control` undefined;
  - with `{ gql, control: true }` → one summary call and one control call, `store.getRunControl` filled, `signals.control.uses > 0`;
  - a second `enrichRuns(…, { gql, control: true })` → no call at all (both cached);
  - a control row at another table version + `control: true` → one control call, the row replaced;
  - a cached control row and `control` unset → no call, `signals.control` attached (0 pts);
  - the control call throws → `signals` still attached, without `control`.

  In `test/lookup.test.ts`: with `reserve` recording its estimates and `control: true`, an uncached run reserves `ESTIMATE_RUN + ESTIMATE_CONTROL`; a run whose raw is cached but control is not reserves `ESTIMATE_CONTROL`; without `control` the estimate is today's.

- [ ] **Step 2: `enrichRuns`** (`src/signals/enrich.ts`): `interface Deps { gql?: GqlFn; /** Fetch crowd control for the runs that lack it (the member's own character only, spec decision 4). */ control?: boolean }`. Inside the per-run `try`, after `parseRunSignals`:

```ts
        if (signals && raw) {
          let control = store.getRunControl(first.reportCode, first.fightID);
          if (deps.control && (!control || control.tableVersion !== CC_TABLE.version)) {
            const fetched = await fetchRunControl(first, gql).catch(() => null);
            if (fetched) {
              store.putRunControl(first.reportCode, first.fightID, fetched);
              control = fetched;
            }
          }
          const c = controlOf(raw, control, characterName, signals.fightDurationMs);
          if (c) signals.control = c;
        }
        if (signals) for (const r of group) r.signals = signals;
```

(import `controlOf` from `./control/parse.ts`). Update the doc comment: "~10 pts per uncached run, ~3 more per run without crowd control when `control` is set."

- [ ] **Step 3: `performLookup`** (`src/lookup.ts`): `LookupOptions` gains `/** The member's own character: fetch crowd control too (spec decision 4). */ control?: boolean;`. The reserve block:

```ts
  if (opts.enrich && deps.reserve) {
    const keys = [...new Map(shown.map((r) => [`${r.reportCode}:${r.fightID}`, r])).values()];
    const uncached = keys.filter((r) => !store.getWclRun(r.reportCode, r.fightID)).length;
    const noControl = opts.control ? keys.filter((r) => !store.hasRunControl(r.reportCode, r.fightID, CC_TABLE.version)).length : 0;
    const estimate = uncached * ESTIMATE_RUN + noControl * ESTIMATE_CONTROL;
    const refusedRuns = estimate > 0 ? deps.reserve(estimate) : null;
    …unchanged
  }
```

and `enrichRuns(shown, data.character.name, store, { gql: deps.gql, control: opts.control })`.

- [ ] **Step 4: Run** `bun test test/signals/enrich.test.ts test/lookup.test.ts` → PASS; `bun run typecheck`.

- [ ] **Step 5: Commit** → `feat(lookup): fetch crowd control for the member's own characters`.

### Task 6: `mine` on the lookup route

**Files:** modify `src/self/characters.ts`, `src/server/validate.ts`, `src/server/lookup.ts`; tests `test/self/characters.test.ts`, `test/server-lookup.test.ts`, `test/server-hosted.test.ts` (or the file with hosted lookups).

- [ ] **Step 1: Failing tests.**
  - `ownsCharacter([{ name: "Noshiidk", realm: "argent-dawn", region: "eu", source: "manual" }], { name: "noshiidk", realm: "Argent Dawn", region: "eu" })` → true; another region → false; another realm → false.
  - Server, local mode: `POST /api/lookup { character, mine: true }` → the `performLookup` fake receives `control: true`; without `mine` → `control: false`.
  - Server, hosted: `mine: true` for a character in the member's `user_settings.characters` → `control: true`; `mine: true` for one that is not → `control: false` (no error: the lookup itself is allowed); two concurrent lookups of the same character, one with `mine`, do not share a flight.

- [ ] **Step 2: `ownsCharacter`** in `src/self/characters.ts` (import `realmToSlug` from `../util.ts`):

```ts
/** Whether a looked-up `Name-Realm` (any realm spelling) is in the member's list. */
export const ownsCharacter = (list: readonly MyCharacter[], c: { name: string; realm: string; region: Region }): boolean => {
  const realm = realmToSlug(c.realm);
  const name = c.name.toLowerCase();
  return list.some((x) => x.region === c.region && x.realm.toLowerCase() === realm && x.name.toLowerCase() === name);
};
```

- [ ] **Step 3: Route.** `validate.ts` `LOOKUP_BODY`: add `mine: opt(bool())`. `src/server/lookup.ts`:
  - `runLookupWithCache` opts gain `/** Decides, once the target is parsed, whether this lookup fetches crowd control (spec decision 4). */ owns?: (t: { name: string; realm: string; region: Region }) => boolean;`
  - after `region` is known: `const control = opts.owns?.({ name: target.name, realm: target.realm, region }) ?? false;`, `control` added to `lookupOptions`, and `const flightKey = cacheKey(request) + (control ? "|control" : "");`.
  - `handleLookup`:

```ts
  const mine = !!body.mine;
  const listed = ctx.hosted && runtime && ctx.user ? runtime.db.settings.get(ctx.user.id).characters : null;
  // Local mode trusts the flag (one person, their own credentials); hosted checks the member's list.
  const owns = !mine ? undefined : listed === null ? () => true : (t: { name: string; realm: string; region: Region }) => ownsCharacter(listed, t);
```

and `owns` passed in the options object.

- [ ] **Step 4: Run** the three test files → PASS; `bun run typecheck`.

- [ ] **Step 5: Commit** → `feat(server): lookups of your own characters measure crowd control`.

### Task 7: Crowd control in the season sync

**Files:** modify `src/self/sync.ts`, `src/server/season.ts`; tests `test/self/sync.test.ts`, `test/server-season.test.ts`.

- [ ] **Step 1: Failing tests.** `SyncState` gains `controlOnly` (runs whose raw report is cached and that only need crowd control). New expectations:
  - `test/self/sync.test.ts:43` (12 runs, 2 analysed without control, 10 not cached) → `{ runs: 12, analysed: 2, pending: 12, controlOnly: 2, failed: 0, estimate: 156 }` (20 + 10 × 10 + 12 × 3);
  - the same with the two analysed runs' control stored at `CC_TABLE.version` → `{ runs: 12, analysed: 2, pending: 10, controlOnly: 0, failed: 0, estimate: 150 }`;
  - `test/self/sync.test.ts:91`: the fake `gql` also answers `ReportRunControl` (empty events) → `state: { runs: 2, analysed: 2, pending: 0, controlOnly: 0, failed: 0, estimate: 0 }`;
  - a batch whose rows only need control makes control calls only, and refuses under `MIN_BUDGET_POINTS + 3 × runs` (not `+ 10 ×`);
  - the control query returning no report marks the run failed (not retried for 24 h);
  - `test/server-season.test.ts:56` → `{ runs: 2, analysed: 1, pending: 2, controlOnly: 1, failed: 0, estimate: 36 }`;
  - hosted `POST /api/season/sync` for a character not in `user_settings.characters` → 403 `{ ok: false, error: "not_your_character" }`, no WCL call (checked first); a listed character without an own client → 403 `own_client_required`.

- [ ] **Step 2: `sync.ts`.**

```ts
const needsRaw = (store: Store, r: SeasonRow): boolean => !store.hasWclRun(r.reportCode, r.fightID);
const needsControl = (store: Store, r: SeasonRow): boolean => !store.hasRunControl(r.reportCode, r.fightID, CC_TABLE.version);
const costOf = (store: Store, r: SeasonRow): number => (needsRaw(store, r) ? ESTIMATE_RUN : 0) + (needsControl(store, r) ? ESTIMATE_CONTROL : 0);
```

`SyncState`: add `/** Pending runs whose raw report is cached: only their crowd control is fetched (~3 pts each). */ controlOnly: number;` and make `pending` "Runs with something to fetch: the raw report, the crowd control, or both". `syncState`:

```ts
export function syncState(store: Store, rows: SeasonRow[], now: number): SyncState {
  let analysed = 0;
  let failed = 0;
  let controlOnly = 0;
  let estimate = 0;
  let pending = 0;
  for (const r of rows) {
    const raw = !needsRaw(store, r);
    if (raw) analysed++;
    if (recentlyFailed(r, now)) { if (costOf(store, r) > 0) failed++; continue; }
    const cost = costOf(store, r);
    if (cost === 0) continue;
    pending++;
    if (raw) controlOnly++;
    estimate += cost;
  }
  return { runs: rows.length, analysed, pending, controlOnly, failed, estimate: pending > 0 ? ESTIMATE_RANKINGS + estimate : 0 };
}

export const pendingRows = (store: Store, rows: SeasonRow[], now: number): SeasonRow[] =>
  rows.filter((r) => costOf(store, r) > 0 && !recentlyFailed(r, now));
```

`syncBatch`: the budget check becomes `MIN_BUDGET_POINTS + batch.reduce((n, r) => n + costOf(store, r), 0)`, and the per-run work:

```ts
  const work = async (r: SeasonRow): Promise<"ok" | "missing"> => {
    if (needsRaw(store, r)) {
      const raw = await fetchRunReport(rowToRun(r), gql);
      if (!raw) return "missing";
      store.putWclRun(r.reportCode, r.fightID, raw);
    }
    if (needsControl(store, r)) {
      const control = await fetchRunControl(r, gql);
      if (!control) return "missing";
      store.putRunControl(r.reportCode, r.fightID, control);
    }
    return "ok";
  };
  const results = await Promise.allSettled(batch.map(work));
```

with `res.value === "ok"` → `fetched++`, `"missing"` → `markSeasonRunFailed` and `failed++`. Update the header comments ("one batch of raw run reports and their crowd control").

- [ ] **Step 3: `server/season.ts`** (`handleSeasonSync`), before the own-client check (amended while implementing: each refusal is then testable without an own client, and the front never offers the sync for a character outside the list anyway):

```ts
  // The sync is for the member's own characters (spec decision 6); local mode has no account to check against.
  if (ctx.hosted && runtime && ctx.user && !ownsCharacter(runtime.db.settings.get(ctx.user.id).characters, body)) {
    return jsonResponse({ ok: false, error: "not_your_character", message: NOT_YOURS }, 403);
  }
```

with `const NOT_YOURS = "A season sync is for your own characters: add this one to My characters first.";`.

- [ ] **Step 4: Run** both test files, then `bun test` (the front tests that build a `SyncState` literal get `controlOnly: 0`), `bun run typecheck && bun run --cwd web typecheck`.

- [ ] **Step 5: Commit** → `feat(self): the season sync fetches crowd control; own characters only`.

### Task 8: Crowd control in the season view

**Files:** modify `src/self/season.ts`, `src/server/season.ts`; test `test/self/season.test.ts`.

- [ ] **Step 1: Failing tests** (`test/self/season.test.ts`, with the `s2-dk-frost` fixture's report and control as the stored run of a row):
  - `SeasonInput.control` returning the fixture's control → `runs[0].signals.control.uses > 0` and the dungeon's `details.control` lists the run's spells (`{ id, name, category, uses, enemies }`, most uses first, at most five), `details.controlRuns === 1`;
  - `control` returning null → `signals.control` undefined, `details.control` `[]`, `controlRuns` 0;
  - a reference for `DeathKnight:Frost` passed through `parseRunControl`'s default is empty in the shipped file, so `pillars.control` is driven by dispels alone (unchanged numbers vs today).

- [ ] **Step 2: `season.ts`.** `SeasonInput`: `/** The run's cached crowd-control events (any table version). */ control: (code: string, fightID: number) => RawRunControl | null;`. In `items`, after `signals` is parsed:

```ts
    const control = raw && signals ? controlOf(raw, input.control(row.reportCode, row.fightID), name, signals.fightDurationMs) : null;
    if (signals && control) signals.control = control;
```

`DungeonDetails` gains:

```ts
  /** The player's crowd control over the dungeon's runs that have it, most uses first (top five). */
  control: { id: number; name: string; category: CcCategory; uses: number; enemies: number }[];
  /** Runs of the dungeon with crowd-control data. */
  controlRuns: number;
```

and `dungeonDetails` sums `s.control?.spells` by id (`uses`, `enemies`), counts the signals with `control`, sorts by uses then name, slices `TOP_DETAILS`.

- [ ] **Step 3: `server/season.ts`** `handleSeasonGet`: `control: (code, fightID) => store.getRunControl(code, fightID),`.

- [ ] **Step 4: Run** `bun test test/self test/server-season.test.ts` → PASS; typecheck both.

- [ ] **Step 5: Commit** → `feat(self): crowd control in the season view and the dungeon details`.

### Task 9: The table audit script

**Files:** create `scripts/audit-control.ts`.

Not run here (it spends points: Task 18). Modelled on `scripts/audit-defensives.ts`: same `KICK_SPECS` list, same flags (`--encounter`, `--runs`, `--only`, `--out`).

- [ ] **Step 1: Write the script.** For every spec: `worldData.encounter.characterRankings(className, specName, serverRegion: "EU")` page 1 (~1 pt), the top `--runs` entries (default 2); per run, one query:

```graphql
query($code: String!, $fightID: Int!, $startTime: Float) {
  rateLimitData { pointsSpentThisHour }
  reportData { report(code: $code) {
    masterData { actors { id name type petOwner } }
    debuffs: events(fightIDs: [$fightID], dataType: Debuffs, hostilityType: Enemies, filterExpression: "type = \"applydebuff\"", limit: 10000, startTime: $startTime) { data nextPageTimestamp }
    casts: events(fightIDs: [$fightID], dataType: Casts, filterExpression: "type = \"cast\"", limit: 10000, startTime: $startTime) { data nextPageTimestamp }
  } }
}
```

(~3 pts measured on the unfiltered debuffs). Each `events` field pages on its own `nextPageTimestamp`: the script runs the two as separate queries when either has a next page, following each like `fetchRunControl`. The ranked player is the `Player` actor whose name matches the ranking; their pets are the actors with `petOwner` = their id. Output per spec, as JSON (`--out`) and text:
  - `seen`: table entries (`specCc(className, spec)`) applied or cast by the player or their pets, with counts;
  - `neverSeen`: table entries no sampled run shows (probably not talented, or a wrong id);
  - `candidates`: debuffs applied to enemies by the player or their pets, not in the table, with their count and name, most frequent first, the damage-over-time ones included (the reader sorts them out: a DoT also shows in the player's damage done, which the script prints beside each candidate as `alsoDamage: true|false` from a `table(dataType: DamageDone, sourceID)` read, ~1 pt);
  - `knockCandidates`: casts of the player whose name matches `/knock|grip|wing buffet|thunderstorm|typhoon|vortex|ring of peace|tail swipe/i` and that are not in the table.
  - the points spent (PING before and after), printed at the end.

- [ ] **Step 2: Check it compiles**: `bun build scripts/audit-control.ts --target bun --outfile /dev/null` and `bun run typecheck`.

- [ ] **Step 3: Commit** → `feat(scripts): crowd-control table audit`.

### Task 10: The reference collection script

**Files:** create `scripts/calibration/control.ts`.

Not run here (Task 19). Scope of `docs/superpowers/specs/2026-09-24-scoring-calibration-design.md`: EU, keys +15 to +20, the eight dungeons.

- [ ] **Step 1: Write the script.** Flags: `--per-spec 20` (samples wanted per spec), `--budget 2500` (stop before the next request when the points spent reach it), `--cache .calibration/control.db` (a scratch SQLite: runs already fetched are never paid twice; `.calibration/` is git-ignored), `--out src/signals/control/reference-mn-2.json`.
  1. Discovery: for each spec still under `--per-spec` samples, walk `characterRankings(encounterID, className, specName, serverRegion: "EU", page)` of each dungeon until an entry at +15 to +20 appears (rankings are sorted by key level, so skip the head above +20), and take entries in that band; ~1 pt per page.
  2. Per sampled run (deduplicated on report and fight): one request with the Summary table (`summary: table(fightIDs, dataType: Summary)`, the five players' specs and actor ids) and the control query's two fields, ~5 pts.
  3. Every player of the run is a sample of their spec: `parseRunControl(raw, player, durationMs).perTenMin` (duration from the Summary's `totalTime`).
  4. Stop when every spec has `--per-spec` samples, or at `--budget`.
  5. Write `{ version: "mn-2.0", tableVersion: CC_TABLE.version, source: "scripts/calibration/control.ts, <date>, <runs> runs, <pts> pts", scope: "EU, +15 to +20", specs: { "Class:Spec": { median, p25, p75, samples } } }`, values rounded to 0.01, keys sorted; print per spec the samples and the median, and the specs under 20.

- [ ] **Step 2: Check it compiles** (as Task 9) and commit → `feat(scripts): crowd-control reference collection`.

### Task 11: The front's data plumbing

**Files:** modify `web/src/types.ts`, `web/src/api.ts`, `web/src/lib/me.ts`, `web/src/App.tsx`, `web/src/useSeason.ts`, `web/src/lib/self.ts`, `web/src/i18n/en.ts`, `fr.ts`; tests `web/src/lib/me.test.ts`, `web/src/lib/self.test.ts`.

- [ ] **Step 1: Types.** `web/src/types.ts` re-exports `RunControl`, `ControlSpell` (from `@shared/signals/types.ts`) and `CcCategory` (from `@shared/signals/control/table.ts`, type only); `LookupRequest` gains `mine?: boolean`.

- [ ] **Step 2: Failing tests.** `me.test.ts`: `mineRequest(list, "Noshiidk-Argent Dawn", "eu")` → true for `{ name: "Noshiidk", realm: "argent-dawn", region: "eu" }`; a Raider.IO link of that character with region `us` passed → true (the link carries its region); another name → false; an unparseable string → false. `self.test.ts`: `syncCard` with `{ pending: 5, controlOnly: 5, analysed: 5, … estimate: 35 }` → the start line reads "Measure crowd control on 5 runs · ~35 pts" (en) and its French mirror; with `controlOnly: 2, pending: 5` → the usual "5 runs to fetch" line plus "2 of them only need crowd control".

- [ ] **Step 3: Code.**
  - `me.ts`: `export const mineRequest = (list: MyCharacter[], character: string, region: Region): boolean => { const c = parseEntry(character, region); return c !== null && list.some((x) => sameId(x, c)); };`
  - `App.tsx` `runLookup`: `api.lookup({ ...req, refresh, mine: mineRequest(characters, req.character, req.region) })`, `characters` being the list `App` already hands to `selfActions` (the Live panel's automatic lookups send no `mine`).
  - `useSeason.ts` unchanged in logic (`pending` still counts every run with something to fetch); its doc comment mentions crowd control.
  - `self.ts` `syncCard`: the `controlOnly` wording of Step 2, new keys `self.sync.controlOnly` ("Measure crowd control on {count} runs") and `self.sync.controlPart` ("{count} of them only need crowd control"), French: "Mesurer le contrôle sur {count} runs", "dont {count} n'ont besoin que du contrôle".

- [ ] **Step 4: Run** `bun test web/src` and `bun run --cwd web typecheck`; commit → `feat(web): lookups of your own characters say so; sync wording for crowd control`.

### Task 12: Canvas page "control" (user's choice)

Done 2026-10-10 (canvas version 24). The user chose **A + B**: `ControlVettingA` (the chip on the verdict block's name line) and run detail **B** (the run's rate and the spec's median first, then the spells grouped by category). The dungeon panel, the Control pillar states and the sync card of `ControlDetails` are shared.

**Files:** `docs/design/canvas/Control*.dc.html` (new), `docs/design/canvas/canvas.json`.

Following `docs/agents/web-front.md` "Design first" (read the artifact first, edit, seed, republish the same artifact, copy the sources back).

- [ ] **Step 1: Artboards**, lifted pixel for pixel from `app.css` and the existing `SelfTabs` / `SelfDetails` artboards:
  - `ControlVetting`: the result page of a character outside "My characters": `VerdictHero`, `SignalTiles`, `DungeonRuns`, `RioSection` exactly as before phase 1, and the "This is me" chip. Variant A: the chip on the verdict block's name line. Variant B: a slim line above the verdict ("Is this you? This is me").
  - `ControlDetails`: the run detail's crowd-control block (variant A: one line per spell, "Kidney Shot · 3 uses · 3 enemies"; variant B: grouped by category, with the run's rate and the spec's median on top), the dungeon panel's "Crowd control here" section, the Control pillar card with its two lines, the sync card with `controlOnly`, and the "measured with an older list" and "n/a, no reference yet" states.
- [ ] **Step 2: Publish and stop.** The user picks per artboard ("A", "B + …"); record the choice in the spec's decision 8 and in this plan, then write Tasks 13 and 14's component steps against the chosen variants (their view models below do not depend on the layout).

### Task 13: Owner's view and vetting view

**Files:** modify `web/src/components/Detail.tsx` (+ the chip's component per the canvas choice); test `web/src/lib/self.test.ts`.

- [ ] **Step 1: View model** in `self.ts`: `export const resultView = (chars: MyCharacter[], p: LookupPayload): "owner" | "vetting" => (isMe(chars, p) ? "owner" : "vetting");` with its test.
- [ ] **Step 2: `Detail.tsx`**: `Detail` renders `OwnerDetail` (today's body: `ResultHead`, `SyncCard`, the three tabs, `useSeason`) when `resultView` says "owner", else `VettingDetail`: the pre-phase-1 markup (`VerdictHero`, then `.detail-rest` with `SignalTiles`, `DungeonRuns`, `RioSection`, as in commit `7fdd2e0`'s `Detail.tsx`) plus the chip placed as the canvas choice says. `useSeason` lives only in `OwnerDetail`, so a vetting view makes no `GET /api/season`. Toggling the chip re-renders into the other view in place.
- [ ] **Step 3**: `bun test web/src`, web typecheck; commit → `feat(web): the self-review tabs are for your own characters; others open the vetting view`.

### Task 14: Crowd control in the owner's view

**Files:** modify `web/src/lib/self.ts`, `components/self/RunDetailExtra.tsx`, `DungeonPanel.tsx`, `Overview.tsx` (pillar card note), `web/src/i18n/en.ts`, `fr.ts`; test `web/src/lib/self.test.ts`.

- [ ] **Step 1: View models** (tests first, English and one French assertion each):
  - `controlLines(t, c: RunControl | undefined)` → `{ head: string; rows: { id; name; text }[]; note: string | null }`: head "Crowd control: {uses} uses · {rate} per 10 min" (+ " · spec median {ref}" when `reference` is set); a row per spell "{uses} uses · {enemies} enemies" (knocks: "{uses} uses"); note "Measured with an older list" when `stale`, "Not measured for this run" when `c` is undefined.
  - `dungeonPanel` gains `control: { id; name; text }[]` and `controlNote` ("over {n} runs with crowd control" / "No crowd control measured in this dungeon yet").
  - `pillarCards`: the Control card's `self.pillar.controlNote` and `naControl` become "dispels and crowd control" / "No dispel and no crowd control measured" (the "until phase 2" wording goes).
- [ ] **Step 2: Components** per the canvas choice (Task 12), thin over those models; spell names through `SpellLink`.
- [ ] **Step 3**: `bun test web/src`, web typecheck, then build and look at it (`just build`, `./bmpl serve --no-open`, screenshots of an own character and of another one); commit → `feat(web): crowd control in the run detail, the dungeon panel and the Control pillar`.

### Task 15: Documentation

**Files:** `docs/scoring.md` (the Control pillar, `utility.crowdControl` and why it is not in the badge), `docs/hosted.md` (the sync is for your own characters; lookups of your own characters cost ~3 pts more per run), `docs/agents/architecture.md` (`wcl_run_control`, `REPORT_RUN_CONTROL_QUERY`, `ESTIMATE_CONTROL`, the `mine` flag, `pillarOnly`), `docs/agents/web-front.md` (owner's view vs vetting view, `mineRequest`, `resultView`, `controlLines`, canvas page "control"), `README.md`, `AGENTS.md` and `docs/agents/workflow.md` (roadmap lines), the spec's status line ("implemented <date>"), the parent spec's phase list.

- [ ] **Step 1**: write them; `bun test test/docs-links.test.ts`; commit → `docs: self-review phase 2`.

### Task 16: Whole-branch review

- [ ] **Step 1**: one reviewer over the whole diff against the spec and this plan; fix the findings in loops; list the deferred minors for the final report.

### Task 17: Fixture check on the shipped table

- [ ] **Step 1**: re-run `bun test test/signals/control-parse.test.ts`: the fixtures were captured with the draft table's filter; if Task 18 changes the table, the affected fixture is re-captured (about 3 pts each) and the version bumped.

### Task 18: Run the audit (stop and ask before spending)

Done 2026-10-10: 477 pts, plus the names pass (cost not measured exactly, 100 to 200 pts estimated); results and the user's decisions in the spec's "Audit" section; table `mn-2.1`; fixtures re-captured (Task 17, ~6 pts).

- [ ] **Step 1: Ask the user**: "Audit of the crowd-control table: 40 specs × 2 runs, about 300 WCL pts on <client>. Go?"
- [ ] **Step 2**: `bun scripts/audit-control.ts --runs 2 --out .calibration/audit-control.json`; report per spec what is never seen and the candidates; the user decides each change. Also look at the spells whose debuff lands over time from one cast (Ring of Frost 82691, Binding Shot 117526, Rake 163505 from stealth): with the 1 s window each enemy walking in later is a new use; count them from the cast (a `cast` entry, or a `group` like Blind's) if the audit shows it (whole-branch review, 2026-10-10).
- [ ] **Step 3**: apply the decisions to `cc-mn-2.json`, bump `version` to `mn-2.1` if anything changed (and `reference-mn-2.json`'s `tableVersion` follows only with Task 19); `bun test`; commit → `feat(signals): crowd-control table mn-2.1 (audited)`.

### Task 19: Collect the reference (stop and ask before spending)

Done 2026-10-10 with the user's budget of 10 000 pts: 422 runs, 2 080 pts; then, at the user's request, one cast
counted once for five spells (table `mn-2.2`, `windowMs`) and the reference re-read from the cache at 0 pts. The
first collection then turned out to come from one dungeon (423 pts to find each run's dungeon); a second one sampled
all eight and weighs them the same (894 runs, 2 552 pts). Details in the spec's "Reference" section.

- [ ] **Step 1: Ask the user**: "Reference collection: EU, +15 to +20, 20 samples per spec, between 1 500 and 2 500 WCL pts (`--budget 2500`) on <client>. Go?"
- [ ] **Step 2**: `bun scripts/calibration/control.ts --per-spec 20 --budget 2500`; report the specs under 20 samples and the medians; the user approves the file.
- [ ] **Step 3**: commit `src/signals/control/reference-mn-2.json` → `feat(signals): crowd-control reference per spec (EU +15–20)`; `bun test`.

### Task 20: Live verification

Done 2026-10-10: numbers in the spec's "Live check" section (own lookup 45.9 pts, someone else's 83.9 pts with no
crowd-control query, sync 311.9 pts against an estimate of 394, hosted refusals confirmed).

- [ ] **Step 1**: with the user's credentials, on Noshiidk (own character) and biwaasham-hyjal (another): a lookup of the own character costs today's points plus ~3 per enriched run, a lookup of the other costs exactly what it cost before; the sync of a phase-1-synced character fetches only crowd control (~3 pts per run, the estimate matches within 20 %); the owner's view shows crowd control in the run detail, the dungeon panel and the Control pillar; the other character opens the vetting view; hosted: `POST /api/season/sync` for a character not in the list → 403 `not_your_character`. Record the numbers in the spec's "Data notes" and in issue #24 if they concern WCL.
