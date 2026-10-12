# UI redesign: one shell, answer first, a run timeline with layers — design

Status: approved 2026-10-11 ("go"), with the two open points as proposed: the Experience axis leaves the model (config version bump), and the redesign canvas replaces the old project canvas for this work. Phase 1 implemented 2026-10-11; phase 2 implemented 2026-10-12 (plan `docs/superpowers/plans/2026-10-12-ui-redesign-phase-2.md`, see "Phase 2 notes"). Mockups chosen over three rounds on the redesign canvas
(https://claude.ai/artifact/WeznnnDkrDGMPyAsuSKBeE, page "4 · Final"); the chosen artboards are checked in under
`docs/design/redesign/` (`F-*.dc.html`) with the mockup rules (`mockup-rules-round2.md`, `mockup-rules-round3.md`).
This spec supersedes the visual parts of `2026-09-16-web-front-design.md` (screens, header, tabs) and the layout
parts of `2026-10-09-self-review-pillars-design.md` / `2026-10-10-self-review-control-design.md`; their data flow,
view models and rules stay unless a section below changes them.

## Goal

A player understands a profile in a few seconds and can dig when needed. Today the data is good but every element
has the same weight: four score families on one page, colour used for ten meanings, run rows written as sentences,
the deep-dive as a wall of red text (audit: canvas page "1 · Audit"). The redesign gives the app one frame (a left
sidebar), one score family per context, colour with one meaning each, real columns, and a run timeline the player
can filter by layer — without dropping any information the app shows today.

## Non-goals

- No change to how a verdict, an axis or a pillar is computed (weights, curves, thresholds stay; see decision 4 for
  the Experience axis, which already weighs 0).
- No new WCL data in this spec. Timeline layers that need new fetches (avoidable hits, missed interrupts, pulls /
  Bloodlust with timestamps) are listed as follow-ups with their own spec (decision 9).
- No redesign of the admin page, `/settings`, `/privacy`, `/help` content: they move into the new frame and the new
  tokens, nothing more.
- No new runtime dependency (rule from `docs/agents/web-front.md`): no router, icon package, chart or UI library.
- No light theme.

## Decisions

| # | Decision | Source |
|---|---|---|
| 1 | **Frame = left sidebar** (≈ 248 px): logo, a 48 px search field at the top with the region and key-level chips under it, navigation (Accueil · Candidats · Mes persos · Comparer · Live · Aide; admin and settings in the account menu), a **Récents** list (history: verdict dot, name, score) and the account block at the bottom (avatar, WCL budget line hosted / "Reconfigurer", "Quitter", clipboard watcher locally). No search bar in the content column. **Ctrl K** opens a centred command palette (personnages récents, mes persos, actions). On narrow screens the sidebar stacks above the content. | User 2026-10-11: "Cadre & recherche: B"; mockup `F-Palette` |
| 2 | **The connected home page is outside the frame**: slim top bar, a split hero (search left, "Toi cette semaine" for the main character right), then two equal columns "Ta progression" and "Tes candidats", then a strip with the other characters. A visitor who is not signed in (hosted) sees a **landing** page instead (what bmpl does, 3 steps, a product preview, the Discord button, the WCL / privacy note); locally there is no landing — the home page is shown (or `Setup` when no WCL client). | User: "Accueil: B" + "le contenu … uniquement tourné vers l'autre", "la page d'accueil si non connecté devrait être différente"; mockups `F-Accueil`, `F-Landing` |
| 3 | **One score family per context.** Candidate pages show the verdict and the axes; owner pages ("mon perso") show the five pillars, with the verdict reduced to one card "Comment un chef de groupe te voit". | Audit finding 2; user kept both owner variants' card from V1 |
| 4 | **The Experience axis is removed** from the evaluation output, the help registry and every screen. It already weighs 0 for every role (`default-config.json` `axisWeights`), so no score changes; config version bumps. Facts it carried that are still useful (previous season score, activity) stay visible as plain facts in the profile header. | User: "je pense de plus en plus à enlever la partie Expérience"; config check 2026-10-11 |
| 5 | **Régularité stays, labelled "informatif · poids 0"**, never counted in a "what would flip the verdict" gap or a contribution waterfall. | Config: `consistency: 0` for all roles; found while drawing the Méthode tab |
| 6 | **Candidate profile = four tabs**: Synthèse (verdict, forces / faiblesses with value vs peers and effect in points, "ce qui ferait basculer", axes table), Runs, Donjons, **Méthode** (new: how this player's verdict is built — path, axis cards with signals / weight / effect, the raw → percentile curve with the INVITE / MAYBE / PASS zones). | Mockups `F-Synthese`, `F-Runs`, `F-Donjons`, `F-Methode`; user: Méthode V1 |
| 7 | **Runs tab = list on top, the selected run below with a full-width timeline** and a vertical layer checklist at its left. **"Ouvrir en grand" opens the run in a wide sheet** (~72 % of the viewport, ≥ 960 px) over the page; the left part still shows the run list, dimmed but clickable to switch run. | User: "Candidat runs: B", "Analyse d'un run: B"; mockups `F-Runs`, `F-Run` |
| 8 | **No horizontal scroll anywhere.** Tables are CSS grids that fit their column: low-value columns merge into two-line cells, rows turn into stacked cards on narrow screens. | User: "je ne veux surtout pas avoir de scroll horizontaux" |
| 9 | **Timeline layers, phase 1 = data the app already has, at 0 pts**: deaths (signals `deaths.events[].atMs`, every run), defensive state at each death and major cooldowns at each death (deep-dive analysis), **defensive casts** (deep-dive raw `castEvents` — already cached, the analysis output gains the cast times), crowd control casts (own characters, `wcl_run_control`). Layers needing new WCL fetches are drawn nowhere in phase 1; they get their own spec. | Code check 2026-10-11: `src/deepdive/analyze.ts` reads `castEvents[].timestamp`; `src/wcl/queries.ts` fetches avoidable / interrupts as tables only |
| 10 | **Owner pages**: Ma forme = bento (last week, pillars, season key-level chart, à travailler checklist with before → now) + the chef-de-groupe card; Donjons = the heatmap across the full width, the selected dungeon's detail below; Runs = runs grouped by week with filters (dungeon, spec, timed, period, **key level min–max + "niveau cible"**) under a strip of season tiles (one square per run). | User feedback round 2 / 3; mockups `F-Moi-Forme`, `F-Moi-Donjons`, `F-Moi-Runs` |
| 11 | **Mes personnages** = cards two per row (main may span), small toolbar buttons (32 px), secondary actions in a "⋯" menu; characters without a season are a compact group below. | User: "j'aime la v2 … pas assez large … boutons pas trop grands"; mockup `F-Persos` |
| 12 | **Compare**: two candidates = the mirror layout; three to **five** = the ranking layout with small per-candidate profiles (no overlaid radar beyond two). The compare limit rises from 3 to 5. A line warns when target keys differ (each score is relative to its own key). | User: "garder les deux … augmenter la limite"; readability test in `F-Comparer-Multi` |
| 13 | **Live** keeps today's content (applicants by role, cached verdict or "Évaluer · 3 pts") in the new frame; the connection state sits in the page header and as a dot on the sidebar's Live item. | User: "Live: v1 bien mieux"; mockup `F-Live` |
| 14 | **Visual system**: new token values (below), fonts **Geist** + **Geist Mono** (tabular numbers) **self-hosted** (`font-src 'self'` in the hosted CSP), icons as inline SVG components, class and dungeon icons from `wow.zamimg.com` (already allowed for images) with the 2-letter tile as fallback. | Mockups; `src/server/security.ts` |

## Visual system

Tokens replace the values of `web/src/styles/tokens.css` (names kept where they exist, new ones added with a comment
saying where they come from, per the tokens rule):

| Token | Value | Use |
|---|---|---|
| `--bg` / `--card` / `--card-2` / `--card-3` | #0E1014 / #161920 / #1C2029 / #232836 | ground, cards, inner blocks, selected |
| `--border` / `--border-2` | #232733 / #2A2F3B | card border, control border |
| `--text` / `--text-soft` / `--muted` / `--label` / `--dim` | #ECEEF2 / #C9CED8 / #A0A7B4 / #8D95A3 / #5A6272 | `--dim` decoration only |
| `--link` | #7FB4FF | links |
| `--invite` (+ `-bg`, `-border`) | #3FCF8E (#12201B, #24523F) | verdict INVITE only |
| `--maybe` (+ `-bg`, `-border`) | #F2B544 (#1A1812, #3D3420) | verdict MAYBE only |
| `--pass` (+ `-bg`, `-border`) | #F2665C (#1E1416, #4A2228) | verdict PASS, deaths, depleted |
| `--better` / `--worse` | #5AB8F0 / #F59E5B | every "vs peers / vs before" delta (colour-blind safe; never green / red) |
| heat scale | <45 #5A2E14/#FFB27A · 45–54 #3A2A1C/#F5C79B · 55–69 #1C2029/#C9CED8 · 70–84 #152A3A/#8CCBF2 · ≥85 #16405C/#BEE4FF | heatmap cells (bg / fg) |
| parse scale | WCL: <25 grey · 25–49 green · 50–74 blue · 75–94 purple · 95–98 orange · 99 pink · 100 gold | only on a parse % |
| `--primary` / `--on-primary` | #ECEEF2 / #0E1014 | the single primary button of a view |
| radii | 16 card · 10 block / button · 999 chip | |

Rules: numbers in Geist Mono with tabular figures; a score bar is blue ≥ 70, neutral 50–69, orange < 50, with a
2 px "joueur moyen" tick at 50; buttons inside cards and rows 32–36 px, one 40–44 px primary per view; text contrast
4.5 : 1 (labels use `--label`, never `--dim`). Class colours from `src/wow/classes.ts`, lightened for text on dark
where the game colour fails contrast (Shaman, Death Knight).

## Screens and data flow

All reads below are existing endpoints at 0 WCL points unless marked.

| Screen | Content | Data |
|---|---|---|
| Landing (hosted, signed out) | hero, Discord sign-in, 3 steps, static preview, WCL / privacy note, footer | `GET /api/status` |
| Home (connected) | search; "Toi cette semaine" (main character: runs last game week, best timed key, timed rate, à travailler, chef-de-groupe verdict); Ta progression (best timed key per week, strengths, costs, pillars); Tes candidats (history, Live entry); other characters strip | `GET /api/history`, `GET /api/season` for the main character, settings characters |
| Candidate · Synthèse | profile header (class icon, name, spec · realm, verdict pill, RIO, ilvl, ranks, previous season), verdict block, forces / faiblesses, ce qui ferait basculer, axes table, dungeon coverage strip | lookup payload (history entry), `GET /api/docs` (curve, weights) |
| Candidate · Runs | run list (best per dungeon / all / with deaths), selected run panel: header, timeline with layers, stats, deaths, defensives, "Analyser · 3 pts" when not analysed (spends points — the one action here that does) | payload `perDungeon.runs[].signals`, deep-dive analysis when present; `POST /api/deepdive` on demand |
| Run sheet | same run, wide: timeline full width, moments clés, défensifs, ce qui l'a tué, sorts passés / contrôle (own characters only; "non récupéré pour un candidat" otherwise), run list on the left | as above + season run detail for own characters |
| Candidate · Donjons | per-dungeon rows with role-aware columns (two-line cells), tinted better / worse, inline detail | payload |
| Candidate · Méthode | path, axis cards (signals, player value, peer reference, weight, effect), curve with zones, rules | payload `evaluation`, `GET /api/docs` |
| Mon perso · Ma forme / Donjons / Runs | decision 10 | `GET /api/season` (+ sync as today) |
| Mes personnages | decision 11, Battle.net card unchanged in behaviour | as today (`GET /api/bnet`, settings) |
| Compare | decision 12 | cached payloads of the selected history entries |
| Live | decision 13 | as today |

Navigation keeps the no-router rule: `pageOf` gains `home`, `candidate`, `compare`, `live` next to the existing
pages; the candidate tab and the open run are query parameters (`?open=<history key>&tab=runs&run=<report:fight>`),
so a reload or a shared link lands on the same view. The history tab strip and its "Fermer" / "Comparer (0/3)" bar
are replaced by the sidebar's Récents list (remove = the row's "⋯" menu) and the Compare page's picker.

## The run timeline

- Track 0 → fight duration (`signals.fightDurationMs`), ticks every 5 min, never wider than its container.
- Layer checklist (vertical, left of the track): each layer has its marker swatch, a count, and is a
  `<button aria-pressed>`. Phase-1 layers: Morts (default on), Défensif dispo à la mort (on), Recharges majeures à la
  mort (on), Casts de défensifs (off), Contrôle (own characters, off). A layer whose data is missing for this run
  (not analysed, candidate without control data) is disabled with the reason as its tooltip and, where it applies,
  the "Analyser · 3 pts" action.
- Selecting an event shows a callout (time, cause with killing-blow share, defensives state) and highlights it in the
  "Moments clés" list under the track; arrow keys move between events.
- View model in `web/src/lib/timeline.ts` (pure, tested): lanes, markers, ticks, counts and the disabled reasons
  from a run's signals + optional analysis + optional control. The deep-dive analysis output gains
  `defensives[].castsAtMs: number[]` (computed from the cached raw `castEvents`; no new fetch; analysis is
  recomputed from raw as today, so existing analysed runs get it without spending points).

## Error handling

- A layer without data is disabled with its reason, never drawn empty.
- A run whose fight duration is missing falls back to the list view without a timeline.
- Fonts failing to load fall back to the system stack; icons failing to load fall back to the 2-letter tile.
- Every existing toast, quota (429) and budget message keeps its wording and place (now the top of the content).

## Tests

- View models are pure and tested as today (`bun test`), with French assertions where wording is not a word swap:
  new `timeline.ts`, the forces / faiblesses and "ce qui ferait basculer" model (in `verdict.ts` or a new
  `synthesis.ts`), the Méthode model, the compare model for 2–5 candidates, the run-list grid model (which columns per
  role), the week grouping and key-level filter for owner runs, the home "Toi cette semaine" model.
- `src/deepdive`: `castsAtMs` from fixtures, and re-analysis of a cached raw run gives the same result plus the new
  field.
- Evaluation: the Experience axis gone from the output and the docs registry (`test/evaluation/docs.test.ts`), all
  existing global scores unchanged on the fixtures (weight was 0).
- i18n parity test covers every new key.
- `just check` and `bun test` green with `web/dist` absent.

## Implementation phases (each one shippable)

1. **Foundation**: tokens, self-hosted fonts (embedded like the other assets in `src/web-assets.ts`), icon component,
   sidebar frame + command palette, `pageOf` additions, home + landing. Existing views render inside the new frame.
2. **Candidate**: Synthèse, Runs with the timeline (+ `castsAtMs` in the deep-dive), run sheet, Donjons, Méthode;
   Experience axis removed.
3. **Owner**: Ma forme, Donjons, Runs (filters), Mes personnages.
4. **Compare and Live**: compare 2–5, Live in the frame; old components and CSS removed.

Docs per phase: `docs/agents/web-front.md` (components map, design canvas pointer → the redesign canvas and
`docs/design/redesign/`), `README.md` screenshots, `docs/scoring.md` (Experience removed, Régularité informatif),
`docs/deep-dive.md` (cast times).

## Phase 2 notes

What phase 2 (the candidate profile) settled while it was planned and built; these override the sections above.

1. **Contrôle layer**: `RunControl` (`src/signals/types.ts`) has counts per spell, no timestamps. The Contrôle layer is
   shown disabled, reason "not fetched for a candidate" (vetting view); timed crowd control joins the "new WCL data"
   follow-up below.
2. **Par times** are not in the payload (only Raider.IO's recent runs carry `parMs`): the Donjons tab shows the upgrade
   (`✓ +2`, depleted) and the clear time instead of a "marge timer" column.
3. **"Tous les runs"** is not available for a candidate (the payload holds the best run per dungeon only): the Runs
   filters are "Meilleur par donjon" and "Avec morts".
4. `GET /api/docs` `config` gains `globalCurve` and `reference` (the Méthode tab's curve and average player).
5. A user `evaluation.json` written before the change may still name `experience` (axes, weights, references): those
   keys are dropped with a warning instead of failing the config.
6. **Cached analyses on every read**: a local history read (`GET /api/history/:key`) and a local lookup cache hit go
   through `withCachedAnalyses` like hosted reads do — today's cached analyses re-attached and the evaluation re-run
   with today's config, 0 WCL pts, the stored payload untouched — so an entry saved before `castsAtMs` existed gains
   it. The history row's verdict and score follow that re-evaluated result (`HistoryStore.syncSummary`; the front
   patches its Récents item on load), so Récents and the profile header always agree.
7. **Class and spec names stay English in the French UI**: the app has no localized class or spec names
   (`src/wow/classes.ts` is English, WCL's names); the profile header and the run rows show them as WCL does.

## Out of scope / follow-ups

- Timeline layers needing new WCL fetches (avoidable hits with timestamps, interrupted / missed casts, boss pulls and
  Bloodlust): own spec with a points estimate per run.
- Dungeon icon id mapping per season beyond the current eight (fallback tile until then).
- A light theme, user-configurable layouts, and the admin page redesign.
