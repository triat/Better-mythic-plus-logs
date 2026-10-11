# bmpl redesign — round 2 shared spec (every artboard follows this)
Class ids in the digest are WCL ids: 1 DeathKnight, 2 Druid, 3 Hunter, 4 Mage, 5 Monk, 6 Paladin, 7 Priest, 8 Rogue, 9 Shaman, 10 Warlock, 11 Warrior, 12 DemonHunter, 13 Evoker (Danilaskuf = Blood DK, Moadmoad = Holy Priest, Circe = Arcane Mage, Obye = Devourer DH, Loutrasse/Lights = Hunter).

User feedback that drives round 2:
- REMOVE the "Expérience" axis everywhere. Five axes only: Survie, Utilité, Throughput, Régularité, Préparation.
  (Keep the existing axis scores; keep the verdict score as given — a small footnote "score recalculé sans Expérience" is allowed once on the synthèse page, nowhere else.)
- Loved from A: name + class + score header; the verdict "on l'invite ?" block; strengths/weaknesses — make them RICHER (more items, numbers vs peers, impact in points, a mini comparison bar player vs peer median, the axis it belongs to, "ce qui ferait basculer le verdict").
- Loved from A and B: the owner view ("mon profil"): à travailler en premier, 5 piliers, heatmap by dungeon, B's season chart (key level per run by week).
- Loved from C: the run table + "run ouvert" (expanded row) — very readable. Reuse that pattern, restyled in this spec.
- Liked from B: deep-dive with a TIMELINE of interesting events — rework it: lanes, event markers, legend, a list of key moments under it.
- Disliked: A/B "meilleur run par donjon" and "runs en détail" (weaker than the rest); C's "Mes personnages" page (do not reuse its look).
- The user is open to new menus / moving things. Copy in FRENCH (the app's fr locale register: "tu"). Product tone: short, factual, no exclamation marks.

## Two product versions — every page exists in both
- **Version 1 · « Barre du haut »**: top bar navigation + a strip of opened profiles (like browser tabs). Content max-width 1200px centred.
- **Version 2 · « Barre latérale »**: a 248px left sidebar (nav + "Récents" candidate list with verdict dot and score), content to the right, max-width 1120px. On phone width the sidebar stacks above (flex-wrap row; sidebar `flex: 1 1 248px; max-width: 100%` is NOT allowed to be sticky / 100vh).
Content may ALSO differ between V1 and V2 (another layout of the same page, other data shown, another character) — that is the point: two real options per page. Say in the artboard `<title>` which version.

## Tokens (only these values)
Fonts: `Geist` (UI) + `Geist Mono` (all numbers, tabular-nums). Google Fonts link:
`<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&amp;family=Geist+Mono:wght@400;500;600;700&amp;display=swap" rel="stylesheet">`
- bg #0E1014 · surface #161920 · surface-2 #1C2029 · surface-3 #232836 · line #232733 · line-2 #2A2F3B
- text #ECEEF2 · text-2 #C9CED8 · muted #A0A7B4 · label #8D95A3 · dim #5A6272 (decor only, never text that matters)
- link #7FB4FF
- Verdict ONLY: INVITE #3FCF8E (bg #12201B, border #24523F) · MAYBE #F2B544 (bg #1A1812, border #3D3420) · PASS #F2665C (bg #1E1416, border #4A2228)
- Versus peers: better #5AB8F0 · worse #F59E5B (colour-blind safe; never green/red for deltas)
- Failure (death, depleted, wipe): #F2665C. Timed check: #3FCF8E allowed on the ✓ glyph only.
- Score bars / pillars / axes (0–100): ≥70 #5AB8F0 · 50–69 #C9CED8 · <50 #F59E5B; peer/average marker = 2px #8D95A3 tick at 50% labelled "joueur moyen".
- Heatmap cells: <45 bg #5A2E14 fg #FFB27A · 45–54 bg #3A2A1C fg #F5C79B · 55–69 bg #1C2029 fg #C9CED8 · 70–84 bg #152A3A fg #8CCBF2 · ≥85 bg #16405C fg #BEE4FF
- Parse % colour (WCL) only on a parse number: <25 #8A8F98 · 25–49 #1EFF00 · 50–74 #3D8BFF · 75–94 #A335EE · 95–98 #FF8000 · 99 #E268A8 · 100 #E5CC80
- Class colours (text/icon on dark): Shaman #4FA3FF · DeathKnight #E0475F · Paladin #F48CBA · DemonHunter #B65CE0 · Mage #3FC7EB · Hunter #AAD372 · Priest #E6E6E6 · Warrior #C69B6D · Monk #00FF98 · Druid #FF7C0A · Rogue #FFF468 · Warlock #8788EE · Evoker #33937F. Class badge = rounded square (radius 14–18) bg = class colour at ~15% on dark (write the hex, e.g. Shaman #0F2A4D border #1F4D85), inline stroke SVG glyph in class colour.
- Radii: cards 16, inner blocks 10, chips/pills 999, buttons 10. Card = surface + 1px line border. Spacing rhythm 8/12/16/24/40.
- Buttons: primary = bg #ECEEF2 text #0E1014; secondary = surface-2 + line-2 border. Min height 44 (32–36 allowed inside dense tables). WCL cost shown on the button: "Analyser · 3 pts".
- Icons: inline stroke SVG only (stroke-width 1.8–2), aria-hidden when decorative. Dungeon icon = 40×40 radius-10 tile, surface-3, 2-letter abbreviation (TS, KR, BV, DN, MR, VA, AF, RL) — state in the reply that real Wowhead icons would replace them.

## Shared helmet (paste as-is, add page classes after it)
```
<style>
body{margin:0;background:#0E1014}
a{color:#7FB4FF;text-decoration:none}a:hover{color:#A9CCFF}
.m{font-family:'Geist Mono',monospace;font-variant-numeric:tabular-nums}
.card{background:#161920;border:1px solid #232733;border-radius:16px;box-sizing:border-box;min-width:0}
.lbl{font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#8D95A3}
.chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;background:#1C2029;border:1px solid #2A2F3B;font-size:13px;color:#C9CED8;white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 18px;border-radius:10px;border:1px solid #2A2F3B;background:#1C2029;color:#ECEEF2;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.btn-p{background:#ECEEF2;color:#0E1014;border-color:#ECEEF2}
.h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-0.01em}
.nav-a{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:10px;color:#A0A7B4;font-size:14px;font-weight:600}
.nav-on{background:#1C2029;color:#ECEEF2}
</style>
```
Root: `<div style="font-family: Geist, system-ui, sans-serif; color: #ECEEF2; background: #0E1014; min-height: 100%">`.

## Shell V1 — top bar (copy, set the active nav link + active profile tab)
```
<header style="border-bottom: 1px solid #1E222C; padding: 10px 24px">
  <div style="max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 20px; flex-wrap: wrap">
    <strong style="font-size: 18px; letter-spacing: -0.02em">bmpl</strong>
    <nav style="display: flex; gap: 4px; flex-wrap: wrap">
      <a href="#" class="nav-a nav-on">Candidats</a><a href="#" class="nav-a">Mes persos</a><a href="#" class="nav-a">Live</a><a href="#" class="nav-a">Aide</a>
    </nav>
    <label style="flex: 1 1 280px; display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 8px 0 12px; border-radius: 10px; background: #161920; border: 1px solid #2A2F3B">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8D95A3" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
      <input aria-label="Rechercher un personnage" placeholder="Nom-Serveur ou lien Raider.IO" style="flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #ECEEF2; font: inherit; font-size: 14px">
      <span class="m" style="font-size: 12px; color: #8D95A3; border: 1px solid #2A2F3B; border-radius: 6px; padding: 2px 6px">Ctrl K</span>
    </label>
    <span class="chip">EU · clé +19</span>
    <a href="#" class="chip" aria-label="Compte">Biwaa</a>
  </div>
</header>
<div style="border-bottom: 1px solid #1E222C; padding: 8px 24px">
  <div style="max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
    (profile tabs: <a class="chip"> with an 8px verdict-colour dot + name + mono key; active one: background #232836, border #3A4152, color #ECEEF2)
    <span style="margin-left: auto; font-size: 13px; color: #8D95A3">en cache · 0 pt</span>
    <button class="btn" style="height: 34px; font-size: 13px">Comparer</button>
  </div>
</div>
```
(On "Mes persos" / "Live" / "Aide" pages the profile strip may be omitted.)

## Shell V2 — sidebar (copy, set the active item)
```
<div style="display: flex; flex-wrap: wrap; align-items: flex-start; min-height: 100%">
  <aside style="flex: 1 1 248px; max-width: 100%; box-sizing: border-box; padding: 20px 14px; border-right: 1px solid #1E222C; display: flex; flex-direction: column; gap: 20px; align-self: stretch">
    <strong style="font-size: 18px; letter-spacing: -0.02em; padding: 0 8px">bmpl</strong>
    <button class="btn" style="justify-content: flex-start; height: 40px; color: #A0A7B4; font-weight: 500">(search svg) Rechercher… <span class="m" style="margin-left: auto; font-size: 12px; color: #5A6272">Ctrl K</span></button>
    <nav style="display: flex; flex-direction: column; gap: 2px">
      (nav-a items with an 18px stroke icon each: Accueil, Mes persos, Live, Comparer, Aide — active one gets nav-on)
    </nav>
    <div style="display: flex; flex-direction: column; gap: 4px">
      <span class="lbl" style="padding: 0 12px">Récents</span>
      (rows: nav-a with 8px verdict dot + name + right-aligned mono score in the verdict colour; the open profile gets nav-on)
    </div>
    <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: 0 8px">
      <span class="chip" style="align-self: flex-start">EU · clé +19</span>
      <span style="font-size: 13px; color: #8D95A3">Biwaa · 412 / 1000 pts cette heure</span>
    </div>
  </aside>
  <main style="flex: 999 1 640px; min-width: 0; padding: 32px 32px 96px; box-sizing: border-box">
    <div style="max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px"> … </div>
  </main>
</div>
```
Récents list content (use these): Vachâman INVITE 77 · Obye MAYBE 59 · Danilaskuf INVITE 76 · Moadmoad INVITE 82 · Loutrasse MAYBE 59 · Circe INVITE 76. Use the digest's real scores where they exist; Vachâman's live value is 77 (+19).

## Data
Real data only: `scratchpad/data/digest.md` (8 characters: DPS, tank Danilaskuf Blood DK, healer Moadmoad Holy Priest, MAYBE cases Obye / Loutrasse) plus what the conversation already holds (Vachâman live: INVITE 77 for +19, runs/deep-dive of Temple of Sethraliss; Biwaasham live owner data: pillars, dungeon grid, Kings' Rest panel, runs list, /me). If a design needs data the app does not have yet (e.g. timestamps of defensive casts for a timeline lane), you may draw it but mark that lane/element with a small chip "nouvelle donnée" so the user knows it is a proposal, and never invent a precise-looking value for real data the app has. No PASS character exists in the data — don't invent one.

## Artboard rules recap
Fluid PAGE: root fluid, max-width containers, flex-wrap / auto-fit grids, wide tables in `overflow-x: auto`. Real `<button>`/`<a href>`/`<input>`. Use `<sc-for>` with data in `renderVals()` for repeated rows; precompute colours/widths there. Never put `<sc-for>`/`<sc-if>` directly inside `<table>/<tbody>/<tr>` (the HTML parser moves them) — use CSS-grid "tables" instead. data-props only `$preview` (width 1440, height = your estimate of the page height). Keep the `<script src="./support.js"></script>` line exactly. Each file self-contained (shell markup copied in).
