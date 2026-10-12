# UI redesign, phase 4 (Compare 2–5, Live, old CSS removed) — implementation plan

**Goal:** the Compare page takes two to five profiles. Two profiles get the **duel** layout: a summary built from the
data, two head cards, mirrored axis rows, "Chiffres clés" and "Meilleure clé par donjon". Three to five get the
**ranking** layout: ranked mini-profiles, "Axe par axe", "Meilleure clé par donjon". The selection is kept in the URL,
so a reload keeps it. The Live page gets a page header with the connection state, a status card, applicants grouped by
role, role chips and a "Ton groupe" card. Everything the old compare table and the old Live panel showed stays
reachable. Then the pre-redesign CSS, components, view models and strings are deleted, and the docs say the redesign
is complete.

**Architecture:** there is still no router. `/compare` reads its selection once at boot from the URL as repeated
`pick` params: `/compare?pick=<key>&pick=<key>…`. The profile header's existing `compareHref(key)` (`?pick=<key>`)
already uses that form, so old links keep working. Every change of the selection is written back with
`history.replaceState`. The payloads come from the history cache through `fetchPayload` (`GET /api/history/:key`, 0
pts), as today in `CompareLoader`. Two pure view models over those payloads, `duelView` and `rankingView`, share one
facts model (`compareFacts`) and one dungeon model (`dungeonCompare`). The page component `components/compare/*`
picks the layout from the count. The Live page keeps App's state, auto-queue and scope logic unchanged. Only the
rendering changes: a new pure `liveView` in `lib/live/panel.ts` and the components `components/live/*`.
`POST /api/live/cached` gains `spec` and `ilvl`, read from the cached payload it already loads (0 WCL pts).

**Spec:** `docs/superpowers/specs/2026-10-11-ui-redesign-design.md`, decisions 1, 8, 12, 13 and 14, plus "Phase 2
notes" and "Phase 3 notes". Mockups: `docs/design/redesign/F-Comparer-Duel.dc.html`, `F-Comparer-Multi.dc.html`,
`F-Live.dc.html` (the data sits in each file's `renderVals()`), with `mockup-rules-round3.md`. The canvas is
https://claude.ai/artifact/WeznnnDkrDGMPyAsuSKBeE, page "4 · Final". When the plan and a mockup disagree, the plan
wins. Data a mockup shows that the app does not have is never invented. The plan says what is missing instead (see
"Missing data" below).

## Global Constraints (from the spec, verbatim where quoted)

- Decision 12: "**Compare**: two candidates = the mirror layout; three to **five** = the ranking layout with small
  per-candidate profiles (no overlaid radar beyond two). The compare limit rises from 3 to 5. A line warns when target
  keys differ (each score is relative to its own key)."
- Decision 13: "**Live** keeps today's content (applicants by role, cached verdict or "Évaluer · 3 pts") in the new
  frame; the connection state sits in the page header and as a dot on the sidebar's Live item."
- Decision 8: "**No horizontal scroll anywhere.** Tables are CSS grids that fit their column: low-value columns merge
  into two-line cells, rows turn into stacked cards on narrow screens." Check every grid at 390 px.
- Decision 5: Régularité stays, labelled "informatif · poids 0". It is never a winner, a best value, a strength or a
  gap. More generally, an axis whose role weight is 0 is informational (`GET /api/docs` `axisWeights`; nothing about
  weights is hard-coded in the front).
- Colours: score bars are blue ≥ 70, neutral 50–69 and orange < 50 (`scoreBand`). Every "vs peers" or "best of the
  row" highlight uses `--better` (blue), never green. `--invite`, `--maybe` and `--pass` are for verdicts only;
  `--pass` is also used for depleted keys (✗) and `--invite` for timed keys (✓), as the mockups do. The WCL parse scale
  is used only on a parse %. Buttons inside cards and rows are 32–36 px; a view has one 40–44 px primary at most.
- **Never spend WCL points automatically.** Opening `/compare`, adding or removing a profile, and reloading only read
  history (`GET /api/history`, `GET /api/history/:key`, `GET /api/docs`). On Live, `POST /api/live/cached` (0 pts) runs
  as today. A lookup runs only from a click on "Évaluer", or from the auto toggle the member switched on, with its
  existing rules: one at a time, it turns off on quota, and hosted it needs a usable own client.
- No new runtime dependency. View models are pure and tested. Strings live in `web/src/i18n/en.ts` (the source) and
  `fr.ts` (its key-for-key mirror); a component never holds a UI literal. `web/` imports from `src/` are types only,
  with the single exception of `src/wow/classes.ts`. Colours, radii and fonts come only from
  `web/src/styles/tokens.css`. A new value becomes a token with a comment naming its mockup.
- Git: work on `main` in place. Stage explicit paths only (`git add <paths>`, never `-A` or `.`). Never stage
  `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env` or `bmpl.db*`. Never read `.env`. No push, no tag, no
  release, no `just deploy`. To stop a server, kill it by PID (`for p in $(pgrep -f '^\./bmpl'); do kill $p; done`);
  never run `pkill -f "bmpl serve"`.
- `just check` and `bun test` are green with `web/dist` absent after every task. Gate:
  `rm -rf web/dist && just check && bun test`.
- Each task is one commit with the message given. The message body ends with a blank line, then:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GbKBtx9kHiwVNWMkxiP94m
  ```

## Before you start

- Bun on PATH. This machine has 1.3.4; the repo pins 1.4.3. Mention the difference, do not change it.
- Read `docs/agents/web-front.md` and `docs/agents/testing.md`, then phase 2's and phase 3's models and components.
  Reuse their helpers rather than re-deriving:
  - `lib/profile.ts`: `classToken`, `classInitials`, `specWords`, `profileHeader`, `compareHref`.
  - `lib/synthesis.ts`: `synthesisView`, `synthesisDocs`, `scoreBand`, `Band`.
  - `lib/runList.ts`: `dungeonAbbr`, `parseCell`, `signedPct`, `upgradeOf`, `clearTime`.
  - `lib/format.ts`: `parseTier`, `fmtAmount`, `signed`, `realmName`.
  - `lib/verdict.ts`: `verdictView`, `AXIS_ORDER`, `axisTitle`.
  - `lib/deepdive.ts`: `defensivesCell`.
  - `lib/admin.ts`: `fmtShortAge`.
  - `lib/history.ts`: `MAX_COMPARE`, `toggleSelection`, `initialPick`, `pruneSelection`.
  - `web/src/docs.tsx`: `useDocs`.
  - Components: `ChipMenu`, and `ClassIcon` (`components/candidate/ProfileHeader.tsx`).
- The code being replaced:
  - `components/Compare.tsx` and `CompareLoader` in `App.tsx`, with the checkbox fieldset (`.compare-pick*`).
  - `lib/compare.ts`'s `compareSections`; `bestIndices` is kept.
  - `components/Radar.tsx`, `lib/radar.ts` and `lib/axes.ts`'s `radarPoints`, which only Compare uses.
  - `components/LivePanel.tsx`, and `components/LiveChip.tsx` (kept, restyled).
  - `lib/live/panel.ts`'s `panelView`. `autoQueue`, `verdictScope`, `sortMenu` and `classMenu` are kept.
- App's boot effect (`App.tsx` ~l. 251) clears every query with `history.replaceState({}, "", location.pathname)`.
  `/compare` must read its `pick` params before that, then write its own URL (Task 1).
- A history key is a JSON array (`cacheKey` in `src/server-history.ts`), so it contains commas. That is why the URL
  repeats `pick=` instead of using one `keys=a,b,c`.

## Missing data (decided — the mockups show these, the app does not have them)

| Mockup | Decision |
|---|---|
| Live: "Ta clé : **Temple of Sethraliss** +19" | The strip carries no dungeon name, only "your key" (the level, `yourKey`). The line reads "Ta clé : +19 · mis à jour il y a 2 s", or "Ta clé : auto" when no level is set. |
| Live: spec and ilvl per applicant | The game gives only name, class, role and RIO score. **`POST /api/live/cached` is extended** with `spec` and `ilvl`, read from the cached payload the route already loads through `peek` (0 WCL pts, no new read, one `src/` change with a test). An applicant without a cached verdict shows "—", and the page's note says why. This is cheap (two fields from an object already in memory), and it is the only way the mockup's columns can hold real values. |
| Live: "Évaluer · 3 pts" | One lookup costs about **10** pts (the rankings query; `lib/help.ts` `budgetPill` already assumes 10 per lookup). The button reads "Évaluer · ~10 pts" from a new shared constant `LOOKUP_PTS = 10`, exported from `lib/help.ts` and used by `budgetPill` too. "3 pts" is the deep-dive's cost, not a lookup's. *Open question for the user.* |
| Duel: summary sentence ("Circe si tu cherches des dégâts…") | Free prose with an intent needs data we do not have. The sentence is built from the axis winners and the largest real gaps (Task 2). |
| Multi: series colour squares | These are new tokens `--series-1` … `--series-5` (values `#9D8CFF #EC7FB6 #B5D86A #4DD4C6 #D9B38C` from `F-Comparer-Multi`, with a comment). They are decoration only: they tell columns apart when two candidates share a class colour. |
| Multi: axis sub-lines ("morts, évitable, DTPS") | Taken from `GET /api/docs`: the axis's first three sub-signal titles, joined. The front never hard-codes sub-signal names. |
| Duel: "Fiche" link | `candidateHref(key)` (0 pts, opens the history entry). |

---

## Files

| File | Responsibility |
|---|---|
| `web/src/lib/history.ts` (+ test) | `MAX_COMPARE = 5`; `compareKeys`, `compareSearch`, `addPick`, `pickMenu` |
| `web/src/lib/compare.ts` (+ test) | `bestIndices` (kept), `compareFacts`, `dungeonCompare`, `targetWarning`, `duelView`, `rankingView` |
| `web/src/components/compare/*.tsx` | `ComparePage`, `ComparePicker`, `CompareDuel`, `CompareRanking` |
| `web/src/App.tsx` | the compare block becomes `ComparePage`; boot keeps `pick`; the Live block becomes `LivePage` (same state) |
| `src/server/routes-live.ts`, `test/server-live.test.ts` | `LiveVerdict.spec`, `LiveVerdict.ilvl` |
| `web/src/lib/live/{roster,panel}.ts` (+ tests) | `CachedVerdict` gains `spec`, `ilvl`; `liveView` replaces `panelView` |
| `web/src/components/live/*.tsx` | `LivePage`, `LiveStatus`, `LiveRoster`, `LiveGroup` (+ `LiveChip` restyled in place) |
| `web/src/lib/help.ts` | `LOOKUP_PTS` |
| `web/src/i18n/en.ts`, `fr.ts` | `compare.*` rewritten, `live.*` extended, unused keys removed |
| `web/src/styles/app.css`, `tokens.css` | `.cmp-*`, `.lv-*`; `--series-1..5`; old selectors removed |
| docs | spec status + "Phase 4 notes", `web-front.md`, `AGENTS.md`, `docs/cli.md` (Compare 2–3 + radars), `docs/hosted.md` (`/api/live/cached` row), help FAQ string |

---

## Task 1 — Compare selection in the URL, limit 5 (`lib/history.ts`)

1. `MAX_COMPARE = 5`. `toggleSelection` and `pruneSelection` stay as they are.
2. Add these pure functions:
   ```ts
   /** Every `pick` param in order, each kept only once and only when it is a history key, capped at MAX_COMPARE. Replaces `initialPick`. */
   export function compareKeys(search: string, existingKeys: readonly string[]): string[];
   /** "?pick=a&pick=b", or "" for an empty selection (URLSearchParams, so JSON keys are encoded). */
   export function compareSearch(keys: readonly string[]): string;
   /** Appends a key unless it is already there or the selection is full (then unchanged). */
   export function addPick(selected: readonly string[], key: string): string[];
   /** The "+ Ajouter un candidat" menu: the history entries not selected, newest first, as `MenuItem`s (label = item.label, hint = "+18 · 77"). */
   export function pickMenu(t: T, items: readonly HistoryItem[], selected: readonly string[]): MenuItem[];
   ```
   `initialPick` is removed. `compareKeys` covers the single `?pick=` that `compareHref` produces.
3. `App.tsx`:
   - On `/compare`, boot reads `compareKeys(location.search, items)` after `loadHistory()`. The query is cleared as
     today, then rewritten with `history.replaceState({}, "", "/compare" + compareSearch(keys))`.
   - An effect writes the URL on every later change of `selected` while `page === "compare"`, including the
     pruning done by `loadHistory`.
   - The old fieldset's checkbox flow stays wired until Task 3 replaces it; only its limit follows `MAX_COMPARE`.
4. i18n: `shell.compare.sub` becomes "Pick two to five profiles from your recent lookups." in EN, with the matching
   FR. `compare.pick.*`: `add` "+ Add a candidate", `addFull` "+ Add ({max} max)", `remove` "Remove {name}", `head`
   "Recent lookups", `hint` "From three candidates on, the view becomes a ranking", `none` "Pick at least two
   profiles.". Do not delete `shell.compare.count` or `shell.compare.pick` yet; Task 3 removes them with the fieldset.
5. Tests in `history.test.ts`:
   - a URL with several `pick` params, in order, with unknown keys dropped and duplicates dropped;
   - a sixth key is ignored;
   - a JSON key with commas and quotes survives a `compareSearch` → `compareKeys` round trip;
   - `?pick=<one>` (the profile header's link);
   - `addPick` when the selection is full, and with a duplicate;
   - `pickMenu` leaves out the selected entries and keeps newest first;
   - one FR hint.

Gate. Commit `feat(web): compare selection in the URL, up to five`.

## Task 2 — Compare view models (`lib/compare.ts`)

Mockups: `F-Comparer-Duel` and `F-Comparer-Multi`. Every function takes `(t, locale, …)`. `entries` is
`{ key: string; payload: LookupPayload }[]` in selection order. `docs: SynthesisDocs` comes from `synthesisDocs(useDocs())`
(the page waits for docs).

**Shared**

```ts
export type FactId = "rio" | "prevSeason" | "ilvl" | "recentTimed" | "deaths" | "avoidable" | "kicks" | "output" | "parse"
  | "atTarget" | "regionRank" | "covered" | "medianKey" | "timedShown" | "dtps" | "defensives" | "bestPrev";
export interface FactCell { text: string; best: boolean; tier: ParseTier | null }
export interface FactRow { id: FactId; label: string; cells: FactCell[] }
export function compareFacts(t: T, locale: Locale, ps: LookupPayload[]): FactRow[];
```

- **Order.** The duel mockup's rows come first: RIO saison, Saison précédente (value + role, e.g. "2900 tank"; "— pas
  de données (reroll ?)" when absent), ilvl, Runs récents timés, Morts / run, Dégâts évitables vs pairs, Kicks vs
  pairs, DPS/HPS médian (metric label when all payloads share it, "Output médian" + the unit otherwise, no best then),
  Parse médian (tier), Donjons au niveau cible, Classement région (`character.scoreTop.regionRank`, "#591"; the row is
  dropped when nobody has one). Then the rest of today's `compareSections` summary: Donjons couverts, Clé médiane,
  Timés (runs affichés), Δ DTPS vs pairs, Défensifs, Meilleur run niveau précédent. Each row's best (`bestIndices`)
  keeps the old higher/lower rule. Numbers use the locale's decimal comma.
- **Target level** ("+21 auto") is not a fact row. It is in the heads and the cards.
- **Score and axes** are not fact rows either. They are in the mirror rows and the "Axe par axe" grid.

```ts
export interface DungeonCell { level: string; timed: boolean | null; parse: { text: string; tier: ParseTier }; sub: string; top: boolean }
export interface DungeonCompareRow { id: number; name: string; abbr: string; cells: (DungeonCell | null)[] }
export function dungeonCompare(t: T, locale: Locale, ps: LookupPayload[]): DungeonCompareRow[];
export function targetWarning(t: T, ps: LookupPayload[]): string | null;
```

- **Rows.** One row per season dungeon where someone has a run, as today; `null` = no run ("—").
- **`timed`** comes from `signals.keystone.timed` (null when the signals are missing or partial).
- **`sub`** is the second line that carries what the old per-dungeon cell had: deaths and the DTPS delta vs peers, e.g.
  "1 mort · +14 % DTPS". It is empty without signals.
- **`top`** marks the highest *timed* key level of the row (every tie is top; nothing is top when nothing is timed).
  The duel shows it as a blue key text, the ranking as the blue outline. This is one rule for both layouts; the duel
  mockup, which ignores timing, is overridden.
- **`targetWarning`** is null when every `evaluation.targetLevel` is equal. Otherwise it is "Clés cibles différentes
  (+11 à +18) : chaque score est relatif à sa propre clé." (`compare.warning`, `{min}`/`{max}`).

**Duel** (exactly two entries)

```ts
export interface DuelNote { sign: "+" | "−"; tone: "better" | "worse"; text: string }
export interface DuelHead {
  key: string; href: string; name: string; classId: number; classColor: string; iconUrl: string | null; initials: string;
  sub: string;            // "Elemental Shaman · Ysondre EU · RIO 3650" (RIO part only when present)
  verdict: { cls: string; label: string; score: string | null };
  runs: string;           // "+18 · 9 runs scored" (target + auto suffix, evaluation.runsUsed)
  notes: DuelNote[];      // ≤ 3: the two strongest pros then the strongest con (synthesisView pros/cons `detail`), filled from the other list when one is short
}
export interface MirrorSide { score: number | null; text: string; band: Band; wins: boolean; why: string }
export interface MirrorRow { key: AxisKey; name: string; informational: boolean; left: MirrorSide; right: MirrorSide; win: { text: string; side: "left" | "right" | null } }
export interface DuelView {
  summary: { title: string; lead: string; detail: string };
  warning: string | null;
  heads: [DuelHead, DuelHead];
  axes: MirrorRow[];          // AXIS_ORDER (Experience is dropped)
  facts: FactRow[];
  dungeons: DungeonCompareRow[];
}
export function duelView(t: T, locale: Locale, entries: CompareEntry[], docs: SynthesisDocs): DuelView;
```

- **Mirror rows.**
  - An axis is `informational` when its weight is 0 for either player's role.
  - When |Δ| ≤ 2, the win text is "égalité" (side null).
  - When a score is null, the text is "—" and nobody wins.
  - Otherwise the win text is "← Vachâman +14" or "Circe +28 →".
  - An informational row's win text is "informatif · poids 0" (`compare.duel.informational`); it never wins and is
    drawn pale.
  - `why` is the axis's top evidence text (`synthesisView(...).axes[i].why`, first part before " · ").
- **Summary.**
  - `title` is "En résumé · pour une +18", or just "En résumé" when the targets differ.
  - `lead` groups the counted axes each player wins:
    - both win some: "Circe devant en throughput ; Vachâman en survie et utilité.";
    - one wins and the rest are ties: "Circe devant en throughput, égalité ailleurs.";
    - none wins: "Aucun écart de plus de 2 points sur les axes comptés.";
    - one wins everything: "Circe devant sur tous les axes comptés.".
  - Axis names are lowercased and joined with `Intl.ListFormat`.
  - `detail` is the verdict sentence followed by the gaps sentence:
    - verdict: "Les deux sont INVITE." or "Vachâman est INVITE, Loutrasse MAYBE.";
    - gaps: "Écarts réels : le parse médian (54 % contre 26 %) et les morts par run (0,7 contre 0,9).". These are
      the two counted axes with the largest |Δ| > 2, each through its headline fact: survival → deaths per run,
      utility → kicks vs peers, throughput → median parse, preparation → ilvl (`compare.duel.axisFact.*`). When that
      fact is null on either side, the axis scores are used instead ("utilité (72 contre 60)"). With no such axis,
      there is no gaps sentence.
- **Insufficient data** on one side: the verdict pill is "DONNÉES INSUFFISANTES", the side has no score, never wins,
  and the summary says "{name} n'a pas assez de runs notés pour comparer les axes." in place of `lead`.

**Ranking** (three to five entries)

```ts
export interface RankBar { key: AxisKey; short: string; value: number | null; band: Band; informational: boolean }
export interface RankCard {
  key: string; href: string; rank: number; series: 1 | 2 | 3 | 4 | 5;   // series = selection order (stable when the ranking changes)
  name: string; classColor: string; spec: string;            // "Elemental Shaman · Hyjal"
  target: string;                                           // "+18"
  score: string | null; verdict: { cls: string; label: string };
  top: boolean;                                             // rank 1, its border takes the verdict's border token
  bars: RankBar[]; aria: string;                            // "Survival 80, Utility 80, …"
  line: string;                                             // "+ {first pro} · − {first con}" (either part alone when the other is missing; the verdict summary when both are)
}
export interface AxisGridRow { key: AxisKey; name: string; sub: string; informational: boolean; cells: { text: string; value: number | null; band: Band; best: boolean }[] }
export interface RankingView {
  warning: string | null;
  cards: RankCard[];                 // ranked
  columns: { key: string; name: string; series: number }[];   // ranked order, used by every grid below
  axes: AxisGridRow[];               // best = highest of the row, none on an informational row, none when all equal
  main: FactRow[];                   // RIO saison, Parse médian, Runs récents timés (mockup) — ranked order
  more: FactRow[];                   // every other compareFacts row, ranked order, under a disclosure
  dungeons: DungeonCompareRow[];     // ranked order
}
export function rankingView(t: T, locale: Locale, entries: CompareEntry[], docs: SynthesisDocs): RankingView;
```

- **Rank order:** `evaluation.global` descending, with null (insufficient) last; ties keep selection order.
- **`sub`:** the axis's first three sub-signal titles from docs (`docs.titleOf`), or "informatif · poids 0" on an
  informational axis.
- **`short`:** the column's short axis labels (`compare.multi.short.survival` "SUR" / "SUR" …).

**Tests** (`compare.test.ts`; `tEn`, plus `tFr` where the wording is not a word swap). The fixtures adapt the payloads
in the existing test, with a third, a fourth and a fifth built from them.

- `compareFacts`: the order, the bests (lower for deaths, avoidable and DTPS), mixed metrics with no best, the
  region-rank row dropped when absent, and FR decimal commas.
- `dungeonCompare`: `top` on the highest timed level only, ties, a depleted higher key that is not top, a dungeon
  nobody ran left out, and the `sub` text.
- `targetWarning`: null when the levels are equal; FR "Clés cibles différentes (+11 à +18) : …".
- `duelView`:
  - a winner on each side;
  - a tie at Δ = 2 and a win at Δ = 3;
  - the informational axis is never a winner and carries its text;
  - the four `lead` variants, in FR;
  - the gaps sentence uses the headline facts and falls back to the scores;
  - the notes take two pros and one con, filled from the other list when one is short;
  - one side insufficient.
- `rankingView`:
  - rank order with ties and nulls;
  - the series stay in selection order;
  - the best of each axis row, none on the informational row;
  - `main` and `more` split;
  - the cards' `line`.
- **Nothing lost:** for the same two payloads, every cell text of the old `compareSections` (still in the file until
  Task 3) is found in `duelView`: in a fact cell, a mirror score, a head (target, score), or a dungeon cell's level,
  parse or `sub` (normalise "✓ " / "✗ " to `timed`). The same holds for five payloads in `rankingView` (`cards`,
  `axes`, `main` + `more`, `dungeons`). List the few deliberate format changes in the test, for example
  "+21 · 79%" → level "+21" and parse "79 %".

Gate. Commit `feat(web): compare duel and ranking view models`.

## Task 3 — Compare page (`components/compare/*`)

1. **`ComparePage.tsx`** replaces the compare block in `App.tsx` and `CompareLoader`. Its props are `tabs`,
   `selected`, `onSelect(keys)`, `fetchPayload` and `cache`. It loads the selected payloads as `CompareLoader` did,
   reads `useDocs()`, and shows a spinner (`compare.building`) until the payloads and the docs are there. Then:
   - fewer than 2 selected: `ComparePicker` and `compare.pick.none`;
   - exactly 2: `CompareDuel`;
   - 3 to 5: `CompareRanking`.
   An empty history keeps today's empty text. `track("compare_open")` keeps its rule (once when the comparison opens).
2. **`ComparePicker.tsx`** follows the mockup's chip row: the `h1`, then one chip per selected profile (the verdict
   dot, or in the ranking layout the `--series-n` square; the name; the target key in mono; a × button labelled
   `compare.pick.remove`), then "+ Ajouter un candidat". That control is a `ChipMenu` fed by `pickMenu`; at 5 it is
   disabled with "+ Ajouter (5 max)". The hint `compare.pick.hint` sits at the right while 2 are selected. Removing
   or adding calls `onSelect`, and App writes the URL (Task 1).
3. **`CompareDuel.tsx`** (`.cmp-duel`):
   - the summary card;
   - the warning line (`--maybe` icon + text), when there is one;
   - two head cards (`ClassIcon`, name in its class colour, sub, "Fiche" `btn` → `href`, the verdict block in its
     verdict tokens with the score and `runs`, and the notes, `+` in `--better` and `−` in `--worse`);
   - the mirror card (`.cmp-mirror`: `minmax(0,1fr) 150px minmax(0,1fr)`, bars filled by band, a winner's score in
     `--better`, informational rows at 0.7 opacity);
   - "Chiffres clés" (`.cmp-facts`: `minmax(0,1fr) 96px 96px`, best in `--better` and bold, parse in its tier) with
     the note "en bleu : le meilleur des deux";
   - "Meilleure clé par donjon" (`.cmp-dgrid`: `minmax(0,1fr) 112px 112px`, abbr tile, a two-line cell: key + ✓/✗ +
     parse, then `sub`).

   The facts card and the dungeon card sit side by side from 900 px up (`flex: 1 1 440px`).
4. **`CompareRanking.tsx`** (`.cmp-rank`):
   - the warning line;
   - the cards grid (`repeat(auto-fit, minmax(190px, 1fr))`: #rank, series square, "cible +18", name, spec, score
     32 px mono, verdict word, five bars in a 44 px box with the informational bar at 0.4 opacity, the short labels,
     the line), with the note under it (`compare.multi.barsNote`);
   - "Axe par axe" (`.cmp-g5`: `150px repeat(N, minmax(0,1fr))`, N = 3–5, the column heads with series square and
     name, the cells as value + 6 px bar, best in `--better`), then the `main` rows and a `<details>`
     "Tous les chiffres (N)" holding `more`;
   - "Meilleure clé par donjon" (`.cmp-g5`, each cell a bordered 32 px box: key, ✓/✗, parse, `sub` as its `title`;
     `--better` border when `top`; "—" when null) with the legend note.

   Names link to `href` (0 pts).
5. **Narrow screens (decision 8).** Under 900 px, `.cmp-g5` restacks per row: the label cell spans the full width,
   and the candidates' cells wrap two per line. Each cell shows a `.cmp-who` label (series square + name), visible
   only below 900 px. This means one DOM and no duplicated tables. Under 640 px, `.cmp-mirror` stacks: the axis name
   and the win text on top, then the two sides one under the other, each with its name. `.cmp-facts` and
   `.cmp-dgrid` fit 390 px as specified (check: 358 px content − 2 × 96 − 2 × 12 leaves the label ≥ 140 px; the dungeon
   columns drop to 96 px under 480 px). The cards grid falls to one column.
6. **`tokens.css`:** `--series-1`…`--series-5` with the comment "Compare ranking: column identity squares,
   F-Comparer-Multi". `app.css`: `.cmp-*` (tokens only).
7. **Delete:**
   - `components/Compare.tsx`, `CompareLoader`, the checkbox fieldset;
   - `compareSections` and the "nothing lost" test's dependency on it (keep the literal expectations it produced;
     inline them so the test still pins every fact);
   - `components/Radar.tsx`, `lib/radar.ts` (+ test), and `radarPoints` (+ its test in `axes.test.ts`). The duel
     mockup has no radar, and nothing else uses them; confirm with a grep first.
   - the i18n keys only these used: `compare.evaluation`, `summary`, `note`, `perDungeon`, …, `shell.compare.count`,
     `shell.compare.pick`, the `radar` label in `en`/`fr`.
8. **Help FAQ.** `help.…compare` "tick two or three tabs to see their radars…" becomes "pick two to five profiles: two
   side by side, three or more as a ranking." (EN + FR).
9. **Verify at 1440 / 390 px** with 2 and with 5 history entries (local history; mock payloads as in Task 7 when the
   local DB lacks them): `scrollWidth <= innerWidth`, the menu works by keyboard, and a reload keeps the selection.

Gate. Commit `feat(web): compare duel and ranking pages`.

## Task 4 — Live data: spec and ilvl, the Live view model

1. **`src/server/routes-live.ts`:** `LiveVerdict` gains `spec: string | null` (`entry.spec ??
   result.character.spec ?? null`) and `ilvl: number | null` (`result.summary.ilvl` when it is a finite number). Both
   are read defensively from the `result` the route already has; no new read and no WCL call. In
   `test/server-live.test.ts`, the existing equality expectation gains the two fields, and new tests cover a payload
   with `summary.ilvl` and `character.spec`, a payload without them (null), and the existing "no network call"
   guard. `docs/hosted.md`'s `/api/live/cached` row names the two fields.
2. **`lib/live/roster.ts`:** `CachedVerdict` gains `spec: string | null; ilvl: number | null`. `App.tsx` fills them in
   both places that build one: the `liveCached` map, and the auto-lookup result, from `r.result.character.spec` and
   `r.result.summary.ilvl`. Nothing else in App's Live logic changes.
3. **`lib/help.ts`:** `export const LOOKUP_PTS = 10`; `budgetPill` uses it (its test stays green).
4. **`lib/live/panel.ts`:** `liveView` replaces `panelView`.
   ```ts
   export type LiveAction = { kind: "open" | "evaluate"; label: string } | null;
   export interface LiveRowView {
     id: string;                 // `${kind}:${index}` (unique across applicants and party)
     character: string; name: string; realm: string; classColor: string; initials: string;
     spec: string; ilvl: string; rio: string;              // "—" when unknown; spec through specWords (English, phase 2 note 7)
     verdict: { cls: string; label: string; score: string | null } | null;
     age: string | null;         // "il y a 2 j"
     state: "vetted" | "queued" | "unvetted" | "self";
     action: LiveAction;         // vetted → "Ouvrir la fiche"; unvetted → "Évaluer · ~10 pts"; queued / self → null
   }
   export interface LiveGroupView { role: LiveRole; label: string; count: number; rows: LiveRowView[] }
   export interface LiveView {
     status: { title: string; key: string; counts: { label: string; value: string; tone: "invite" | null }[] };
     roleChips: { value: "all" | LiveRole; label: string; on: boolean }[];   // "Tous · 7", "Tank · 1", "Heal · 1", "DPS · 5"
     columns: { verdict: string };                                            // "Verdict en +19" / "Verdict"
     groups: LiveGroupView[];        // tank, healer, dps; only non-empty groups; rows keep sortApplicants' order
     hidden: number;                 // applicants hidden by the filters ("N masqués par les filtres")
     party: { line: string; members: LiveRowView[]; missing: LiveRole[] };
     note: string;
   }
   export function liveView(t: T, locale: Locale, o: {
     roster: Roster; verdicts: Map<string, CachedVerdict>; settings: PanelFilter; now: number;
     queued: ReadonlySet<string>; yourKey: number | null;
   }): LiveView;
   /** The role chips' choice mapped onto the stored `liveRoles`: "all" → all three; a role → [role]. */
   export const rolesFor = (v: "all" | LiveRole): LiveRole[];
   ```
   - `status.title`: "Jeu connecté · Group Finder ouvert".
   - `status.key`: "Ta clé : +19 · mis à jour il y a 2 s", from `roster.at` and `fmtShortAge`; "Ta clé : auto" when
     `yourKey` is null.
   - `status.counts`: candidates (all applicants), vetted (applicants with a cached verdict), INVITE (`--invite`).
   - The role chips' counts are taken after the class filter and before the role filter. A chip is `on` when
     `liveRoles` is exactly that role; "Tous" is on when all three are selected or none are (the stored "no filter").
   - `party`: today's party + self rows, in roster order. The line is "1 / 5 · il manque 1 tank, 1 heal, 2 DPS" or
     "5 / 5 · groupe complet", built against one tank, one healer and three DPS with counts clamped at 0 and
     `Intl.ListFormat`, using plurals in i18n. `missing` lists one slot per missing role. A non-self member keeps
     today's behaviour (a cached verdict, or a click that runs the same lookup); self is "toi · DPS".
   - `note`: "Le jeu ne donne que le nom, la classe, le rôle et le score Raider.IO. La spé et l'ilvl viennent de
     l'évaluation bmpl."
5. **Tests** in `panel.test.ts`, reusing the existing roster fixtures and adding the mockup's seven applicants:
   - the grouping and the group counts;
   - the role chips' counts and `on` states (all, none, one);
   - `rolesFor`;
   - each row's state and action: vetted, queued, unvetted, self in party;
   - spec and ilvl "—" without a verdict;
   - the status counts;
   - the party line for 1 / 5, 5 / 5 and two DPS missing, in FR with plurals;
   - `hidden`.

   `autoQueue`, `verdictScope`, `sortMenu` and `classMenu` tests stay unchanged. Remove `panelView` and its tests.
6. **i18n:** `live.status.*`, `live.panel.{all, roleChip, open, evaluate, hidden, columns.*, group.*, note}`, and
   `live.chip.on` → "Live · game connected" (FR "Live · jeu connecté"). Every `{count}` takes the plural form.

Gate. Commit `feat(live): spec and item level in cached verdicts, live view model`.

## Task 5 — Live page (`components/live/*`)

1. **`LivePage.tsx`** replaces the Live block in `App.tsx`; App passes the same props `LivePanel` received, plus
   `state`, `connect`, `disconnect`, `yourKey` and `result`. It renders:
   - the **page header** (`.lv-head`): `h1` Live, `LiveChip` (restyled as the mockup's chip: the dot in `--invite`
     when live, `--maybe` when reconnect or error, `--dim` when off; same dialog and errors), and from waiting on
     **Déconnecter** (`btn`, `live.disconnect()`; `live_connect` events unchanged);
   - with a roster, `LiveStatus` then `LiveRoster`;
   - without one: when off, today's intro (`shell.live.sub`, the chip opens the connect dialog); when waiting,
     reconnect or error, a status card "Jeu connecté · en attente du Group Finder" with the intro line;
   - the selected profile (`result`) below, as today.

   Stale and wrong-roster behaviour is unchanged: the roster is null once stale, and the scope reset happens in App.
2. **`LiveStatus.tsx`** (`.lv-status`): a 44 px icon tile in the invite tokens, the title and key line, the three
   counts, and the auto toggle (`<input type="checkbox">`, `live.panel.auto`, disabled when `!autoAllowed`, with the
   `OWN_CLIENT_GUIDE` link under it then). The mockup's second Déconnecter inside the card is left out, so there is
   one Déconnecter per page.
3. **`LiveRoster.tsx`:**
   - the chip row: the "Group Finder" label, the role chips (`aria-pressed`, `onRolesChange(rolesFor(v))`), a spacer,
     then the class `ChipMenu` and the sort `ChipMenu` (both unchanged);
   - the card with the column heads (`.lv-row` grid `minmax(0,1.6fr) minmax(0,1fr) 52px 60px minmax(0,1.3fr) 136px`);
   - per group, a role header (an inline SVG role icon from the mockup's paths, the label, the count) and its rows:
     - a class tile 34 px in the class colour with initials, the name and realm;
     - spec, ilvl, RIO;
     - the verdict pill + score + age, or "pas encore évalué" / "en file";
     - the action button (`btn` "Ouvrir la fiche", or `btn btn-primary` "Évaluer · ~10 pts"), both calling
       `onSelect(character)` (the existing lookup: a cache hit at 0 pts for a vetted row, a click-only lookup
       otherwise);
   - "N masqués par les filtres" when `hidden > 0`.

   Under 760 px each row becomes a two-line card: identity plus action on the first line, then "spec · ilvl · RIO" and
   the verdict on the second. The mockup's `display: none` would hide the verdict; it is not followed. No row is
   lost, and nothing scrolls sideways.
4. **`LiveGroup.tsx`** ("Ton groupe"): the title, the line, the member chips (36 px; the self chip in its class colour
   with "toi · DPS"; another member is a button with its verdict pill when cached, calling `onSelect`), the dashed
   slot chips for `missing`, and the note.
5. **Delete** `components/LivePanel.tsx` and its CSS (`.live`, `.live-head`, `.live-row*`, `.live-sep`,
   `.live-status`, `.live-auto-guide`, `.rolefilter`, `.rf`, `.sw*` if nothing else uses them; grep first) and the
   i18n keys only it used (`live.panel.count`, `check`, `yourGroup`, `you`, … after a grep).
6. **Sidebar:** `navItems` already has the Live dot (`liveOn`). Check it shows on `/live` and on other pages; no
   change expected.
7. **Verify at 1440 / 390 px** with a mocked roster (see Task 7): no horizontal scroll, the role chips, keyboard on
   the menus, a vetted row's "Ouvrir la fiche" showing the profile below.

Gate. Commit `feat(web): live page in the new frame`.

## Task 6 — Old CSS, components and strings removed; docs

1. **CSS.** List every class selector in `web/src/styles/app.css` (a scratch script, not committed). Keep a selector
   when its name appears in any `web/src/**/*.tsx` or in a `web/src/lib/**/*.ts` that builds class names. Dynamic
   prefixes are kept explicitly: `badge-`, `tier-`, `heat-`, `tone-`, `dot-`, `recent-`, `chip-`, `btn-`, `live-dot`,
   `series-`, and any `\`${…}\`` class you find. Delete the rest, for example `.compare*`, `.cell-best`,
   `.section-row`, `.row-label`, `.radar-*`, `.badge .badge-label` (if unused), and old `.tile*`/`.run-row*` leftovers.
   Re-run the gate and look at every page at 1440 px once (home, candidate tabs, owner tabs, `/me`, `/compare`,
   `/live`, `/help`, `/settings` (hosted-only: through tests), `/admin` (hosted-only)). Nothing may change visually.
2. **Components and modules.** Delete any `.tsx` no longer imported (grep `from "./X` / `/X.tsx"`) and any exported
   function no longer used outside its test, with its test.
3. **`lib/tiles.ts` and `lib/runs.ts`'s `rowOf`.** **Choice: remove both.** They only serve as oracles in phase 2's
   "nothing lost" tests (`dungeonGrid.test.ts`, `runList.test.ts`, `runs.test.ts`), and an oracle that renders nothing
   tests nothing new. Replace each oracle call with the literal values it produces on the same fixture. Run the old
   function once, paste its output as constants with a comment "values the pre-redesign tiles / run row showed", so
   the guarantee stays and the dead code goes. `RunRowModel` goes too, and so does `signalParts` if only `rowOf` and
   the tests use it (keep `vsPeers`, `kickFigures`, `kicksPart`, `dispelsPart` and `missingDungeons`, which are used).
4. **i18n.** Remove the keys no component or view model references. A key is used when its full dotted path appears,
   or when a parent prefix is used with a template (`live.role.${…}`, `verdict.words.${…}`, `cand.header.role.${…}`
   …). `en` and `fr` stay mirrored and the parity test stays green.
5. **Docs.**
   - The spec status line gets "phase 4 implemented 2026-10-12 (plan
     `docs/superpowers/plans/2026-10-12-ui-redesign-phase-4.md`, see "Phase 4 notes")". Add "Phase 4 notes":
     - `pick` repeated in the URL;
     - the duel's summary is built from axis winners and headline facts;
     - `top` = the highest timed key in both layouts;
     - no radar (Radar removed);
     - the ranking's narrow restack;
     - `LiveVerdict.spec`/`ilvl`;
     - "Évaluer · ~10 pts" (a lookup's cost, not 3);
     - no dungeon name in "Ta clé";
     - one Déconnecter;
     - the Live rows stack instead of hiding columns;
     - the tiles / `rowOf` removal;
     - phase 4 also removed the old CSS.

     The line 93 sentence about "Comparer (0/3)" is now history; leave it.
   - `docs/agents/web-front.md`:
     - the view-model list: `compare.ts` (`compareFacts`, `dungeonCompare`, `targetWarning`, `duelView`,
       `rankingView`), `history.ts` (`compareKeys`, `compareSearch`, `addPick`, `pickMenu`), and `panel.ts`'s
       `liveView`/`rolesFor` in the `lib/live/` paragraph; remove `radar.ts`, `tiles.ts`, `runs.ts`'s row model;
     - delete the "Radar" rule;
     - the components map: `/compare` (pick 2–5, `?pick=` repeated), `components/compare/*`, `components/live/*`;
       remove `Compare (2–3 tabs)`, `Radar` and `LivePanel`;
     - the "Page width" paragraph: phase 4 done; no old views left.
   - `AGENTS.md` roadmap: "Redesign phase 4 is implemented (plan …): Compare 2–5 (duel / ranking), the Live page in
     the frame, the old CSS and components removed — the redesign is complete." Keep "self-review phase 3, WCL items
     in issue #24" as next.
   - `docs/cli.md`'s Compare paragraph (2–3, radars overlaid) becomes the 2–5, duel and ranking description.
   - `README.md`: no Compare or Live text found at planning time. Re-grep, and if a screenshot shows the old Compare,
     say so in the report (no new screenshot needed).

Gate. Commit `refactor(web): remove the pre-redesign CSS and components; docs for phase 4`.

## Task 7 — Visual check at 1440 / 390 px (no commit unless a fix is needed)

1. **Setup.** Run `just build`, then `./bmpl serve --no-open` (local mode), or `just serve --no-open` with
   `just web-dev`. Note the server's PID; stop it by PID at the end.
2. **Mocks, so nothing spends points.** In the browser (DevTools MCP: an init script before navigation, or
   `evaluate_script` then reload), override `window.fetch`:
   - `GET /api/history` returns 5 items;
   - `GET /api/history/:key` returns payloads built from `test/fixtures/` (or captured from the local DB when it has
     them);
   - `GET /api/docs` passes through;
   - `POST /api/live/cached` returns verdicts with spec and ilvl for some names;
   - `POST /api/lookup`, `POST /api/deepdive` and `POST /api/season/sync` are answered with a refusal (status 418)
     and logged, and must never be reached by a page load.

   For Live, the roster comes from the screen capture. Mock it with a scratch-only change that is never committed: a
   temporary `useWowCapture` stub returning a fixed roster (the mockup's seven applicants + self) in the Vite dev
   server. `git diff` must be empty at the end.
3. **Check at 1440 and 390 px:**
   - `/compare` with 0, 1, 2, 3 and 5 picks;
   - adding a profile through the menu by keyboard, removing one with ×;
   - a reload keeps the picks;
   - `?pick=<key>` from a profile header's Compare;
   - the different-target warning;
   - `/live` off, waiting and with the roster: the role chips, the class and sort menus, the auto toggle disabled
     with the guide link (hosted simulated through the mocked `/api/status` if needed), "Ouvrir la fiche" showing the
     profile below;
   - the sidebar Live dot;
   - the console is clean;
   - `document.documentElement.scrollWidth <= innerWidth` on every view.

   Take screenshots of each view for the report.
4. **Fixes.** Any fix is a follow-up commit `fix(web): phase 4 visual check` (gate first).

## After the tasks

A fresh agent reviews the whole phase: spec compliance, quality, "no WCL point without a click", no horizontal
scroll, i18n parity, nothing lost from the old compare table and the old Live panel, and no dead CSS left. Fix what it
finds and report. No push unless the user asks.
