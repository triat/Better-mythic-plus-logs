# bmpl redesign — round 3 spec (extends SPEC-v2.md: same tokens, fonts, data rules, .dc.html rules)

Read SPEC-v2.md first; everything there still holds unless overridden here. Round-2 artboards live next to this file in
`project/V1-*.dc.html` / `project/V2-*.dc.html` — START from the named round-2 file and adapt it; do not redesign from zero
what the user already approved.

## User decisions (round 2 → 3)
- Shell = the LEFT SIDEBAR (V2) everywhere, except the connected home page (see below). The sidebar search was too small:
  the default placement is now a full-width search bar at the top of the content column (below).
- NO HORIZONTAL SCROLL anywhere in the app. No `overflow-x: auto` tables, no `min-width` wider than the column. Tables are
  CSS grids whose columns fit the content width (≈ 1120 px in the main column; ≈ 640–720 px inside a detail panel):
  drop or merge low-value columns, stack secondary values under the primary one (two-line cells), and at narrow widths
  switch rows to stacked cards (flex-wrap). Check the arithmetic of your grid-template-columns + gaps against the width.
- Buttons compact: inside cards and rows 32–36 px high, 13 px text, padding 0 12px; only the page's single primary action
  may be 40–44 px. No full-width fat buttons in small cards.
- Experience axis gone (it already weighed 0). Régularité also weighs 0: show it, labelled "informatif" (small chip),
  never counted in waterfalls/weights.

## Shell V3 (sidebar + top search) — copy into every in-app artboard
```
<div style="display: flex; flex-wrap: wrap; align-items: stretch; min-height: 100%">
  <aside style="flex: 1 1 232px; max-width: 100%; box-sizing: border-box; padding: 20px 12px; border-right: 1px solid #1E222C; display: flex; flex-direction: column; gap: 20px">
    <strong style="font-size: 18px; letter-spacing: -0.02em; padding: 0 10px">bmpl</strong>
    <nav style="display: flex; flex-direction: column; gap: 2px">
      nav-a items, each with an 18px stroke icon: Accueil · Candidats (count chip "6") · Mes persos · Comparer · Live (status dot) · Aide
    </nav>
    <div style="display: flex; flex-direction: column; gap: 2px">
      <span class="lbl" style="padding: 0 12px 4px">Récents</span>
      rows: nav-a with 8px verdict dot + name + right-aligned mono score in the verdict colour (Vachâman 77 · Obye 59 · Danilaskuf 76 · Moadmoad 82 · Loutrasse 59 · Circe 76); the open one gets nav-on
    </div>
    <div style="margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; background: #161920; border: 1px solid #232733">
      avatar circle 32px (initials "B") · <div>Biwaa<br><span 12px #8D95A3>412 / 1000 pts · cette heure</span></div>
    </div>
  </aside>
  <div style="flex: 999 1 720px; min-width: 0; display: flex; flex-direction: column">
    <header style="padding: 14px 32px; border-bottom: 1px solid #1E222C; display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
      <label style="flex: 1 1 420px; max-width: 760px; display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 8px 0 16px; border-radius: 12px; background: #161920; border: 1px solid #2A2F3B">
        search svg 18px · <input placeholder="Rechercher un joueur : Nom-Serveur ou lien Raider.IO" style="... font-size: 15px"> · chip "EU" · chip "Clé +19" · kbd "Ctrl K"
      </label>
      <span style="margin-left: auto" class="chip">● Live · jeu connecté</span>   (or "Live · off" in dim)
    </header>
    <main style="padding: 28px 32px 96px; box-sizing: border-box">
      <div style="max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px"> … </div>
    </main>
  </div>
</div>
```
Candidate pages keep a compact profile header inside the content (class badge, name, spec · realm, verdict pill + score,
actions Comparer / Raider.IO ↗ / WCL ↗ as small buttons) and the profile tabs Synthèse · Runs · Donjons · Méthode.
Owner pages ("mon perso"): header with "C'est moi" chip + Synchroniser, tabs Ma forme · Donjons · Runs.

## The run TIMELINE with layers (shared component — Runs tab and run overlay use the same one)
- Horizontal track 0:00 → run duration, time ticks every 5 min, full width of its container (never wider).
- A row of LAYER TOGGLES above it: chips with a checkbox look (`<button aria-pressed>`), each with its marker swatch and
  a count: Morts (real) · Défensif dispo à la mort (real) · Recharges majeures (real only at death times) · Casts de
  défensifs · Dégâts évitables · Sorts passés / kicks manqués · Contrôle · Pulls de boss / Bloodlust. Layers that need
  data the app does not fetch yet carry a tiny "nouvelle donnée" tag inside the chip and their markers are drawn
  dashed/hollow, explicitly illustrative (never precise-looking fake values; keep them few and clearly marked).
- Each enabled layer = one lane (label at left, 28–36 px high) or markers on the main track; a selected event shows a
  callout card (time, what happened, defensives state) and is highlighted in the "Moments clés" list below.
- Make toggles and event selection WORK in the artboard (state in the DCLogic class; precompute visible lanes in
  renderVals; mark the board is_interactive). Default: Morts + Défensif dispo + Recharges on.
- Real data available: Vachâman Temple of Sethraliss +20 ✓+1 30:31 — deaths 1:53 (Ground Pound 71 % / Slither Strike
  29 %, Astral Shift en recharge 41 s, potions dispo), 13:45 (Storm Strikes 100 %, Astral Shift DISPO + 2 potions dispo,
  Earth Elemental en recharge 94 s), 17:50 (Spark Step 62 % / Release Charge 38 %, Astral Shift en recharge 32 s);
  Astral Shift 10/15, Earth Elemental 3/6, potions de soin 0/6 + 0/6; kicks 37/146 (pairs 32 %); dispels 8; dtps 53,4k
  +14 % vs 2 dps; évitable 0/min (−100 %); 376,6k dps, parse 72,2 %.
