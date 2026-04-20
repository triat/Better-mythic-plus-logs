const COMMON_CSS = /* css */ `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #0d1117;
  color: #e6edf3;
  line-height: 1.5;
  min-height: 100vh;
}
a { color: #58a6ff; }
.mono { font-family: ui-monospace, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace; }
button {
  font: inherit;
  background: #238636;
  color: white;
  border: 0;
  padding: .55rem 1.1rem;
  border-radius: 6px;
  cursor: pointer;
}
button:hover { background: #2ea043; }
button.ghost { background: transparent; color: #8b949e; border: 1px solid #30363d; }
button.ghost:hover { background: #161b22; color: #e6edf3; }
input, select {
  font: inherit;
  background: #0d1117;
  color: #e6edf3;
  border: 1px solid #30363d;
  padding: .5rem .7rem;
  border-radius: 6px;
  width: 100%;
}
input:focus, select:focus { outline: 0; border-color: #58a6ff; }
label { display: block; margin-bottom: 1rem; }
label > span.lbl { display: block; margin-bottom: .3rem; color: #8b949e; font-size: .85rem; }
h1, h2, h3, h4 { margin: 0 0 .75rem; }
.dim { color: #8b949e; }
.warn { color: #d29922; }
.err { color: #f85149; background: #490202; padding: .6rem .8rem; border-radius: 6px; }
.ok { color: #56d364; }
.tag { display: inline-block; font-size: .75rem; padding: .1rem .45rem; border-radius: 999px; background: #21262d; color: #8b949e; }
`;

export const renderSetupPage = (hasExisting: boolean): string => /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>bmpl — setup</title>
<style>
${COMMON_CSS}
main { max-width: 620px; margin: 4rem auto; padding: 0 1.5rem; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 1.75rem; }
ol { padding-left: 1.2rem; }
ol li { margin-bottom: .5rem; }
code { background: #0d1117; padding: .1rem .4rem; border-radius: 4px; font-family: ui-monospace, monospace; font-size: .9rem; }
#status { margin-top: 1rem; }
</style>
</head>
<body>
<main>
  <h1>bmpl · setup</h1>
  <p class="dim">Paste your Warcraft Logs API credentials. They're saved locally to <code>.env</code> and used only to talk to the WCL API.</p>
  ${hasExisting ? '<p class="warn">⚠ Creds are already set; submitting will replace them.</p>' : ""}

  <div class="card">
    <ol>
      <li>Log in at <a href="https://www.warcraftlogs.com/" target="_blank" rel="noopener">warcraftlogs.com</a></li>
      <li>Open <a href="https://www.warcraftlogs.com/api/clients/" target="_blank" rel="noopener">Clients</a> → <strong>Create Client</strong></li>
      <li>Any name. Redirect URL: <code>http://localhost</code>. Leave <em>Public Client</em> unchecked.</li>
      <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> back here ↓</li>
    </ol>

    <form id="setupForm" style="margin-top: 1.5rem;">
      <label>
        <span class="lbl">Client ID</span>
        <input type="text" name="clientId" autocomplete="off" required />
      </label>
      <label>
        <span class="lbl">Client Secret</span>
        <input type="password" name="clientSecret" autocomplete="off" required />
      </label>
      <button type="submit">Save</button>
    </form>
    <div id="status"></div>
  </div>
</main>
<script>
document.getElementById("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    clientId: fd.get("clientId"),
    clientSecret: fd.get("clientSecret"),
  };
  const status = document.getElementById("status");
  status.className = "dim";
  status.textContent = "Saving…";
  try {
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ("HTTP " + res.status));
    status.className = "ok";
    status.textContent = "✓ saved. redirecting…";
    setTimeout(() => location.href = "/", 400);
  } catch (err) {
    status.className = "err";
    status.textContent = "✗ " + err.message;
  }
});
</script>
</body>
</html>
`;

export const renderMainPage = (): string => /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>bmpl</title>
<style>
${COMMON_CSS}
header.top {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #21262d;
}
header.top h1 { font-size: 1.1rem; margin: 0; }
header.top h1 .tag { margin-left: .5rem; }
main { max-width: 920px; margin: 1.5rem auto; padding: 0 1.5rem; }
form#lookupForm { display: grid; grid-template-columns: 1fr auto; gap: .5rem; margin-bottom: 1rem; }
form#lookupForm input[name="character"] { font-size: 1.05rem; }
details { margin-bottom: 1rem; padding: .6rem .8rem; border: 1px solid #21262d; border-radius: 6px; }
details[open] { background: #0b0f14; }
details > summary { cursor: pointer; color: #8b949e; font-size: .85rem; user-select: none; }
.options { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin-top: .75rem; }
#result { margin-top: 1rem; }
.char-card {
  background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 1.25rem;
  margin-bottom: 1rem;
}
.char-card h2 { font-size: 1.25rem; }
.char-card .score { font-size: 1.7rem; font-weight: 600; }
.char-card .metaline { color: #8b949e; font-size: .85rem; margin-top: .25rem; }
.section { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
.section h3 { font-size: 1rem; margin-bottom: .5rem; }
.section h3 small { color: #8b949e; font-weight: normal; font-size: .85rem; }
.banner-ok { color: #56d364; font-weight: 600; margin-bottom: .5rem; }
.run {
  display: grid;
  grid-template-columns: 3.2rem 1fr 6rem 4rem 7rem 5rem 2.5rem;
  align-items: center;
  gap: .5rem;
  padding: .35rem .5rem;
  border-radius: 4px;
  font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: .88rem;
}
.run:hover { background: #0b0f14; }
.run .quality {
  grid-column: 2 / -1;
  font-size: .8rem;
  color: #8b949e;
  padding-top: .1rem;
}
.deaths-0 { color: #56d364; font-weight: 600; }
.deaths-low { color: #d29922; font-weight: 600; }
.deaths-high { color: #f85149; font-weight: 700; }
.run .level { font-weight: 600; color: #ffa657; }
.run .dungeon { color: #e6edf3; }
.run .amount { text-align: right; color: #e6edf3; }
.run .metric { color: #8b949e; font-size: .75rem; }
.run .parse { text-align: right; font-weight: 600; }
.run .spec { color: #8b949e; font-size: .8rem; }
.run .age { color: #8b949e; font-size: .8rem; text-align: right; }
.run .age.stale { color: #d29922; }
.run a { text-decoration: none; font-size: .75rem; opacity: .7; }
.run a:hover { opacity: 1; }
/* percentile colors, mirror format.ts */
.p-legendary { color: #ff8000; }
.p-magenta { color: #a35fe0; }
.p-red { color: #ef4444; }
.p-blue { color: #58a6ff; }
.p-green { color: #56d364; }
.p-gray { color: #8b949e; }
.class-1 { color: #C41F3B; } .class-2 { color: #FF7D0A; } .class-3 { color: #A9D271; }
.class-4 { color: #40C7EB; } .class-5 { color: #00FF96; } .class-6 { color: #F58CBA; }
.class-7 { color: #FFFFFF; } .class-8 { color: #FFF569; } .class-9 { color: #0070DE; }
.class-10 { color: #8787ED; } .class-11 { color: #C79C6E; } .class-12 { color: #A330C9; }
.class-13 { color: #33937F; }
.spinner { display: inline-block; width: 1rem; height: 1rem; border: 2px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin .7s linear infinite; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<header class="top">
  <h1>Better Mythic+ Logs <span class="tag">bmpl</span></h1>
  <div>
    <button class="ghost" id="setupBtn">Re-configure</button>
    <button class="ghost" id="quitBtn">Quit</button>
  </div>
</header>
<main>
  <form id="lookupForm">
    <input type="text" name="character" required placeholder="Name-Realm (e.g. Drahous-Archimonde)" autofocus autocomplete="off" />
    <button type="submit">Look up</button>
  </form>
  <details>
    <summary>Options</summary>
    <div class="options">
      <label>
        <span class="lbl">Target level (blank = auto)</span>
        <input type="number" name="level" min="2" max="35" />
      </label>
      <label>
        <span class="lbl">Spec filter</span>
        <input type="text" name="spec" placeholder="e.g. Augmentation" autocomplete="off" />
      </label>
      <label>
        <span class="lbl">Metric</span>
        <select name="metric">
          <option value="">auto</option>
          <option value="dps">dps</option>
          <option value="hps">hps</option>
        </select>
      </label>
    </div>
  </details>
  <section id="result"></section>
</main>
<script>
const CLASSES = {1:"Death Knight",2:"Druid",3:"Hunter",4:"Mage",5:"Monk",6:"Paladin",7:"Priest",8:"Rogue",9:"Shaman",10:"Warlock",11:"Warrior",12:"Demon Hunter",13:"Evoker"};
const STALE_DAYS = 14;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtAmount = (n) => {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Math.round(n).toString();
};
const fmtAge = (startMs, now = Date.now()) => {
  const d = now - startMs;
  const H = 3600e3, D = 24 * H;
  if (d < H) return "just now";
  if (d < D) return Math.floor(d / H) + "h ago";
  const days = Math.floor(d / D);
  if (days < 7) return days + "d ago";
  if (days < 30) return Math.floor(days / 7) + "w ago";
  if (days < 365) return Math.floor(days / 30) + "mo ago";
  return Math.floor(days / 365) + "y ago";
};
const ageDays = (ms) => Math.max(0, (Date.now() - ms) / 86400000);
const pclass = (p) => {
  if (p >= 99) return "p-legendary";
  if (p >= 95) return "p-red";
  if (p >= 75) return "p-magenta";
  if (p >= 50) return "p-blue";
  if (p >= 25) return "p-green";
  return "p-gray";
};
const wclUrl = (code, fightID) => "https://www.warcraftlogs.com/reports/" + encodeURIComponent(code) + "#fight=" + fightID;

const deathsCls = (n) => n === 0 ? "deaths-0" : (n <= 2 ? "deaths-low" : "deaths-high");
const dtpsDeltaCls = (p) => {
  if (p <= -10) return "deaths-0";
  if (p <= 10) return "";
  if (p <= 30) return "deaths-low";
  return "deaths-high";
};
const qualityLine = (r) => {
  if (!r.quality) return "";
  const deaths = '<span class="' + deathsCls(r.quality.deaths) + '">' + r.quality.deaths + ' death' + (r.quality.deaths === 1 ? '' : 's') + '</span>';
  const dtps = fmtAmount(r.quality.dtps) + ' dtps';
  let cmp = '';
  if (r.quality.roleMedianDtps && r.quality.roleMedianDtps > 0) {
    const delta = (r.quality.dtps - r.quality.roleMedianDtps) / r.quality.roleMedianDtps * 100;
    const sign = delta >= 0 ? '+' : '';
    const mates = r.quality.roleSize - 1;
    const label = sign + delta.toFixed(0) + '% vs role (' + mates + ' ' + r.quality.role + ' mate' + (mates === 1 ? '' : 's') + ')';
    cmp = ' · <span class="' + dtpsDeltaCls(delta) + '">' + esc(label) + '</span>';
  }
  return '<span class="quality">' + deaths + ' · ' + dtps + cmp + '</span>';
};
const runRow = (r, metric) => {
  const stale = ageDays(r.startTime) >= STALE_DAYS;
  return '<div class="run">' +
    '<span class="level">+' + r.keyLevel + '</span>' +
    '<span class="dungeon">' + esc(r.encounterName) + '</span>' +
    '<span class="amount">' + fmtAmount(r.amount) + ' <span class="metric">' + metric + '</span></span>' +
    '<span class="parse ' + pclass(r.parsePercent) + '">' + r.parsePercent.toFixed(1) + '%</span>' +
    '<span class="spec">' + esc(r.spec) + '</span>' +
    '<span class="age' + (stale ? ' stale' : '') + '">' + fmtAge(r.startTime) + '</span>' +
    '<a href="' + wclUrl(r.reportCode, r.fightID) + '" target="_blank" rel="noopener" title="Open log">↗</a>' +
    qualityLine(r) +
  '</div>';
};

const render = (payload) => {
  const { character, zone, metric, metricAutoSelected, alternateMetricHasData, runsIndexed, specFilter, targetLevel, targetAutoDetected, atOrAboveTargetCount, prevLevelBest, perDungeon, seasonDungeons } = payload;
  const className = CLASSES[character.classID] || ("class " + character.classID);
  const specClass = "class-" + character.classID;
  const score = character.scoreTop;

  let html = '<div class="char-card">';
  html += '<h2>' + esc(character.name) + ' <span class="' + specClass + '">' + esc(character.spec || "") + (character.spec ? " " : "") + className + '</span></h2>';
  if (score) {
    html += '<div class="score">' + score.points.toFixed(1) + ' <span class="dim" style="font-size:.85rem;font-weight:400">' + metric.toUpperCase() + ' score · ' + esc(score.spec) + '</span></div>';
    html += '<div class="metaline">region rank ' + score.regionRank + ' · server rank ' + score.serverRank + '</div>';
  }
  html += '<div class="metaline">Zone: ' + esc(zone.name) + ' · Metric: ' + metric + ' · Runs indexed: <strong>' + runsIndexed + '</strong>';
  if (metricAutoSelected && alternateMetricHasData) {
    const other = metric === "hps" ? "dps" : "hps";
    html += ' <span class="dim">(auto; also has ' + other + ' data)</span>';
  }
  if (specFilter) html += ' · <span class="warn">filter: ' + esc(specFilter) + '</span>';
  html += '</div></div>';

  // Target block
  html += '<div class="section">';
  html += '<h3>Target key level: +' + targetLevel + (targetAutoDetected ? ' <small>(auto — highest key run)</small>' : '') + '</h3>';
  if (atOrAboveTargetCount > 0) {
    html += '<div class="banner-ok">✓ has ' + atOrAboveTargetCount + ' run(s) at or above +' + targetLevel + '</div>';
  }
  if (prevLevelBest) {
    const gap = targetLevel - prevLevelBest.level;
    const label = gap === 1
      ? 'Best run at previous level (+' + prevLevelBest.level + ')'
      : '<span class="warn">Best run at closest available level (+' + prevLevelBest.level + ', ' + gap + ' below target)</span>';
    html += '<h4 style="margin-top:.75rem">' + label + ' <small class="dim">· ' + prevLevelBest.runsAtLevel + ' run(s) indexed at +' + prevLevelBest.level + '</small></h4>';
    html += runRow(prevLevelBest.best, metric);
  } else if (atOrAboveTargetCount === 0) {
    html += '<div class="dim">(no runs found at all — character has no M+ data this season)</div>';
  } else {
    html += '<div class="dim">(no runs below +' + targetLevel + ' — player only has runs at or above target)</div>';
  }
  html += '</div>';

  // Per-dungeon
  if (perDungeon.runs.length > 0) {
    const median = '+' + perDungeon.medianLevel + ', ' + fmtAmount(perDungeon.medianAmount) + ' ' + metric + ', ' + perDungeon.medianParse.toFixed(1) + '%';
    html += '<div class="section">';
    html += '<h3>Best run per dungeon ' +
      '<small>· ' + perDungeon.dungeonsCovered + '/' + perDungeon.totalDungeonsInSeason + ' dungeons · median ' + median +
      (perDungeon.dungeonsAtOrAboveTarget > 0
        ? ' · <span class="ok">' + perDungeon.dungeonsAtOrAboveTarget + '/' + perDungeon.totalDungeonsInSeason + ' at or above +' + targetLevel + '</span>'
        : '') +
      '</small></h3>';
    for (const r of perDungeon.runs) html += runRow(r, metric);
    if (perDungeon.dungeonsCovered < perDungeon.totalDungeonsInSeason) {
      const covered = new Set(perDungeon.runs.map((r) => r.encounterID));
      const missing = seasonDungeons.filter((d) => !covered.has(d.id)).map((d) => d.name);
      if (missing.length > 0) html += '<div class="dim" style="margin-top:.5rem;font-size:.8rem">(no runs in: ' + esc(missing.join(", ")) + ')</div>';
    }
    html += '</div>';
  }

  return html;
};

const resultEl = document.getElementById("result");
document.getElementById("lookupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const body = {
    character: fd.get("character"),
    level: fd.get("level") || null,
    spec: fd.get("spec") || null,
    metric: fd.get("metric") || null,
  };
  resultEl.innerHTML = '<div class="dim"><span class="spinner"></span> looking up ' + esc(body.character) + '…</div>';
  try {
    const res = await fetch("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ("HTTP " + res.status));
    resultEl.innerHTML = render(data.result);
  } catch (err) {
    resultEl.innerHTML = '<div class="err">✗ ' + esc(err.message) + '</div>';
  }
});
document.getElementById("quitBtn").addEventListener("click", async () => {
  if (!confirm("Quit bmpl? The server will stop and this page will no longer work.")) return;
  try { await fetch("/api/quit", { method: "POST" }); } catch {}
  document.body.innerHTML = '<main style="max-width:500px;margin:4rem auto;text-align:center"><h2>bmpl stopped</h2><p class="dim">You can close this tab.</p></main>';
});
document.getElementById("setupBtn").addEventListener("click", () => { location.href = "/setup"; });
</script>
</body>
</html>
`;
