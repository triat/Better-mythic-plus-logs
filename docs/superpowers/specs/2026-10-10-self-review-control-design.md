# Self-review phase 2: crowd control, and the owner's view — design

Status: approved 2026-10-10; canvas variants chosen 2026-10-10 (decision 8); implemented 2026-10-10 (plan
`docs/superpowers/plans/2026-10-10-self-review-phase-2.md`) except the table audit and the reference
collection, which spend points and wait for the user (plan Tasks 18–19). Parent spec:
`docs/superpowers/specs/2026-10-09-self-review-pillars-design.md` (phase 2 of its "Phases"). Probes of
2026-10-10 on two cached runs (section "Data notes") cost about 12 pts.

## Goal

Fill the Control pillar with what the player does to enemies: stuns, incapacitates, disorients, fears,
silences, knock-backs and grips. The pillar today holds only `dispels`, so a DPS or a tank without a
dispel has an empty Control pillar.

The same phase applies the user's answer to the parent spec's open question 2 (2026-10-10): "Quelqu'un
sans personnage a la vue de la recherche comme avant". The self-review views belong to the member's own
characters; any other character opens the vetting view the result page had before phase 1.

## Non-goals

- No change to the verdict or the global score. The crowd-control sub-signal feeds the Control pillar
  only (decision 5).
- No judgement of whether a given stun was the right one (which cast it stopped, which pack it held).
  bmpl counts what landed; "useful" control is a later question, like useful damage in phase 3.
- No crowd control on bosses: a boss is immune, WCL logs no debuff, so nothing is counted.
- No diminishing returns model. A stun that lands for half its duration still counts as one use.
- No WCL call for a character that is not the member's own (decision 4).

## Decisions

1. **What counts as crowd control.** Six categories: stun, incapacitate (sleeps, polymorphs, saps,
   incapacitating roars), disorient (blinds, dragon's breaths), fear, silence, and knock (knock-backs,
   grips, pulls). Roots and slows are left out: they rarely stop a cast in a key, and almost every spec
   applies one by accident. The first five categories are read as debuffs the player (or their pet)
   applies to an enemy; knocks leave no debuff and are read as casts (amended after the audit, 2026-10-10: a
   pull that does leave one, Sigil of Chains, is read as its debuff).

2. **A crowd-control table, versioned season data.** `src/signals/control/cc-mn-2.json`, `version:
   "mn-2.0"`, same shape and keys as the other season tables: per `Class:Spec` or `Class:*`, a list of
   `{ id, name, category, kind: "debuff" | "cast", pet?: true }`. The first draft comes from the probes
   below and the class kits; `scripts/audit-control.ts` validates it the way `audit-defensives.ts`
   validates the defensives (top runs of each spec, every debuff a player applies to enemies, report:
   table entries never seen, frequent non-damage debuffs missing from the table). The user validates
   the audit's report before the table ships. Bump the version when the content changes.

3. **One more WCL query per run, cached forever.** `REPORT_RUN_CONTROL_QUERY`: the run's events
   filtered on the table (`type = "applydebuff"` on the debuff ids, `type = "cast"` on the knock ids)
   plus `masterData.actors(type: "Pet") { id petOwner }` to credit a pet's stun to its owner. Measured
   at 3 pts per run, one page (section "Data notes"). Stored in a new table `wcl_run_control` (report
   code, fight id, table version, fetched at, json), immutable like `wcl_run_raw`. A table version bump
   makes the stored rows stale: they still show, marked "measured with an older list", and the next
   explicit fetch replaces them. Never refetched automatically.

4. **Who pays, and when.** The control query runs only for the member's own characters (the list of
   "My characters", decision 6):
   - the season sync fetches it for every season run that lacks it (3 pts each, beside the 10 of a run
     not yet analysed); the estimate counts both;
   - a lookup of one of the member's own characters fetches it for the runs it enriches (about 24 pts
     more for eight runs); the request says `mine: true`, and the hosted server checks it against
     `user_settings.characters`;
   - a lookup of anyone else costs exactly what it costs today.

5. **The sub-signal `utility.crowdControl`, Control pillar only.** Per run: crowd-control *uses* per
   10 minutes of key. A use is one cast: applications of the same spell by the same player within 1 s
   count once (an area stun on eight enemies is one use with eight enemies); a knock is one cast. The
   character's value is the median over the runs used, compared with the median of their spec in the
   reference (decision 7), as a difference in percent: the same form as `kicksVsPeers`. Proposed curve
   `[[-60, 15], [-30, 40], [0, 65], [30, 85], [60, 100]]`, weights dps 2, tank 2, healer 1 (dispels
   stay dps 1, tank 1, healer 3). `null`, with the reason, when the spec's reference median is under
   0.5 use per 10 minutes (no real kit) or the spec has no reference yet. A new config flag
   `pillarOnly: true` keeps it out of `scoreAxis`, so the utility axis, the global score and the
   verdict do not move; the pillar computation reads it like any other sub-signal.

6. **The owner's view and the vetting view** (the user's answer, 2026-10-10). A character is the
   member's own when it is in their "My characters" list (hosted: `user_settings.characters`; local
   mode: `localStorage`). The member's own characters open the three tabs (Overview, Dungeons, Runs),
   the season sync and the personal page as in phase 1. Any other character opens the result page as
   it was before phase 1: verdict, signal tiles, dungeon runs, Raider.IO, plus the "This is me" chip,
   which moves the character to the owner's view. No sync and no "Load full season" for others; the
   hosted server refuses `POST /api/season/sync` for a character not in the member's list (403
   `not_your_character`). A lookup still writes the season store at 0 pts, as today, so a character
   marked "me" later already has its first runs. Until Battle.net linking, the list is manual and
   proves nothing (parent spec, decision 1): this is a view rule, not a privacy one.

7. **A reference per spec.** "Compared with the average player" needs the spec's own median: a frost
   mage and an assassination rogue do not have the same kit. `scripts/calibration/control.ts` samples
   ranked runs in the calibration study's scope (EU, +15 to +20, all eight dungeons), fetches the
   Summary table (specs of all five players) and the control query, and writes
   `src/signals/control/reference-mn-2.json` (per `Class:Spec`: median, p25, p75, samples). Each run
   gives five samples; at least 20 samples per spec. Estimated 1 500 to 2 500 pts in one session, run
   with the user's agreement like the calibration study. The table (decision 2) is validated before
   the reference is collected.

8. **What the views show** (owner's view only; canvas page "control", `docs/design/canvas/Control*.dc.html`;
   chosen 2026-10-10: `ControlVettingA` for the vetting view, "This is me" on the name line, and run
   detail B of `ControlDetails`, the run's rate against the spec's median first, then the spells grouped
   by category):
   - Overview: the Control pillar card reads its two sub-signals, crowd control vs the average player
     of the spec and vs the player's own past, like the other pillars.
   - Dungeons: the Control column includes crowd control; the dungeon panel adds "Crowd control here",
     the spells used per run in that dungeon.
   - Runs: a run's detail adds its crowd control, spell by spell: uses and enemies affected.
   - Help page: the Control pillar's entry explains crowd control, its categories and its reference.

## Data flow

```
own lookup / sync ──► REPORT_RUN_CONTROL_QUERY (~3 pts/run) ──► wcl_run_control (forever)
read (0 pts) ──► wcl_run_control + cc-mn-2.json ──► uses per run ──► utility.crowdControl
                     └──► reference-mn-2.json ──► curve score ──► Control pillar (not the verdict)
```

## Numbers

- **Control query:** 3 pts per run (`ESTIMATE_CONTROL = 3`).
- **Sync estimate:** rankings 20 + 10 per run not analysed + 3 per run without control data.
- **Use grouping window:** 1 s, same spell, same player (pet credited to its owner); 10 s for the spells one cast
  lands over longer and whose cooldown is 30 s or more (`windowMs` in the table: Binding Shot, Psychic Scream,
  Terror of the Skies, Chaos Nova, Holy Word: Chastise; table `mn-2.2`, 2026-10-10).
- **Rate:** uses per 10 minutes of key (fight start to end).
- **Kit floor:** spec reference median under 0.5 use per 10 minutes → `null`.
- **Reference:** at least 20 samples per spec; EU, +15 to +20.
- **Curve and weights:** decision 5.

## Data notes (probed 2026-10-10)

Two cached runs of Noshiidk (Frost Death Knight), about 12 pts in total:

- **Debuffs on enemies, unfiltered.** `njVt1bdNAv7x3hcK` fight 9 (Den of Nalorakk +19):
  `table(dataType: Debuffs, hostilityType: Enemies)` cost 2.19 pts and has no per-player split;
  `events(dataType: Debuffs, hostilityType: Enemies)` returned more than 10 000 events over two pages
  for 3 pts (`applydebuff` 1 502, `refreshdebuff` 5 418). Too large to store per run.
- **Filtered on a draft list** (33 debuff ids, 12 cast ids): 148 events, one page, 18.6 KB, with the
  pets: 3.0 pts. On `LMTk3X7BWtgHzjJK` fight 3: 132 events, 16.9 KB; pets alone 2.0 pts, events alone
  2.0 pts, so one query for both.
- **What it caught** (first run): Blind 2094 and 427773, Sap 6770, Kidney Shot 408 (rogue);
  Incapacitating Roar 99, 21 applications (guardian druid); Terror of the Skies 372245, 64
  applications, plus Wing Buffet 357214 and Tail Swipe 368970 as casts (evoker); Blinding Sleet
  207167 and Death Grip 49576 (death knight); Hammer of Justice 853 (paladin). Gnaw 91800 comes from
  the Risen Ghoul: `masterData.actors(type: "Pet")` gives its `petOwner` (the death knight).
- **Area control.** 64 applications of one evoker stun in a run is why decision 5 counts uses, not
  applications: one area stun on many enemies is one use.

## Audit (2026-10-10, plan Task 18)

`scripts/audit-control.ts` on the top 2 runs of every spec in Voidscar Arena: 477 pts. Every spec showed at least
one entry, except Discipline priests (none on 2 runs). Changes the user approved, table `mn-2.1`: Typhoon's cast id
is 61391 (132469 never seen); Polymorph 460392 and 391622 and Intimidation 1258508 are grouped with their spell
(`group`, like Blind's area effect 427773); Silence 15487 (Shadow), Sigil of Chains 204843 (a pull read as its
debuff) and Dominate Mind 205364 added; Asphyxiate 108194 dropped. Entries no sampled run showed are kept (the
user's choice: better to have the information when it happens). Not counted: roots and slows (Earthbind, Chains of
Ice, Frost Nova…), and Death Grip's own debuff 51399 (the cast already counts). The candidates' names came from one
more pass over the reports' `masterData.abilities` (cost not measured exactly: the WCL hour turned during the run;
estimated 100 to 200 pts).

## Reference (2026-10-10, plan Task 19)

`scripts/calibration/control.ts`, EU +15 to +20: 422 runs, 2 080 pts, every spec at 20 samples or more
(`reference-mn-2.json`, table `mn-2.2`). After the per-spell windows above, the same cached runs were re-read at
0 pts: Devastation 17.3 → 12.3 uses per 10 minutes, Shadow 6.9 → 6.1, Havoc, Vengeance, Augmentation and Beast
Mastery a little lower. Lowest medians: Discipline 1.0, Devourer 1.1, Frost mage 1.6; highest: Blood 15.8 (Death
Grip, also used to taunt), Devastation 12.3. Devastation still lands Terror of the Skies more often than a 2-minute
Deep Breath would allow; whether the stun has another source this season is not known. Each spec is compared with
its own median, so a counting artefact shared by the whole spec does not bias the comparison. The dungeon spread of
the samples is not recorded: a spec that reached 20 quickly took them from the first dungeons walked.

## Live check (2026-10-10, plan Task 20)

Local mode, the environment's WCL client, a copy of the phase-1 verification cache (Noshiidk's season analysed, no
crowd control yet):

- **Own lookup** (Noshiidk-Draenor, `mine`, refresh): 45.9 pts for the rankings, one new run report and the crowd
  control of the 9 displayed runs; every displayed run carries it; Control pillar 30 ("crowd control −42% vs spec
  median (4.9 per 10 min)").
- **Someone else's lookup** (Biwaasham-Hyjal, refresh): 83.9 pts, no crowd-control query (0 rows added); phase 1
  measured 84.5 pts for the same kind of lookup.
- **Sync** of the phase-1-synced season: 108 pending runs (103 only needing crowd control), estimate 394 pts,
  11 batches, 311.9 pts measured by PING (299.9 reported by the batches); every run then has its crowd control.
  Crowd control cost about 2 to 2.3 pts per run here, so `ESTIMATE_CONTROL = 3` errs high, as the other estimates do.
- **Season view** afterwards: Control pillar 33 over the last 4 weeks (56 runs, −38%); Murder Row: Death Grip 173
  uses, Blinding Sleet 44 uses on 330 enemies, Gnaw 17, over 14 of 14 runs.
- **Hosted**, 0 pts: a sync for a character outside the member's list → 403 `not_your_character`; listed, without an
  own client → 403 `own_client_required`.

## Error handling

- The control query fails or the report is private: the run shows "control not measured", nothing is
  stored, the next explicit fetch retries.
- A run without control data (not yet fetched, or a stranger's run) keeps its other pillars; Control
  then rests on dispels alone and says so.
- A spec missing from the table or the reference: crowd control is `n/a` with the reason, never 0.

## Tests

- Fixtures: the control query's answer for two runs (one with a pet), captured with
  `scripts/capture-*.ts`.
- Grouping: applications within 1 s count once; a pet's applications go to its owner; knock casts
  count one each.
- Signal: rate per 10 minutes, median over runs, percent vs reference, kit floor, `pillarOnly` keeps
  the utility axis and the verdict identical (existing evaluation snapshots unchanged).
- Store: `wcl_run_control` upsert, stale version detection, sync estimate with both kinds of pending
  runs.
- Server: `mine: true` honoured only for a character in the member's list (hosted); sync 403
  `not_your_character`.
- Front: the result page picks the owner's view or the vetting view from the list; view models for
  the new lines, English and French.

## Open questions

1. **Silences.** Some silences are also interrupts (Solar Beam, Sigil of Silence) and already count in
   the Interrupts pillar when they stop a cast. Proposed: count them here too, since the silence lasts
   beyond the interrupted cast. To confirm with the audit.

## Out of scope

- Which enemy cast a stun prevented, or which pack it held.
- Crowd control on the Live panel.
- Comparing crowd control between two members.
