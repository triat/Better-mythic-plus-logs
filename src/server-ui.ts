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
main { max-width: 1100px; margin: 1.5rem auto; padding: 0 1.5rem; }
.tabs {
  display: flex; flex-wrap: wrap; gap: .35rem; align-items: center;
  margin-bottom: .9rem; min-height: 2.2rem;
}
.tabs:empty::before { content: "Your tabs will appear here after a lookup."; color: #8b949e; font-size: .85rem; }
.tab {
  display: inline-flex; align-items: center; gap: .5rem;
  padding: .35rem .75rem; border-radius: 6px;
  background: #161b22; border: 1px solid #30363d; color: #c9d1d9;
  cursor: pointer; font: inherit; font-size: .82rem;
  max-width: 280px;
}
.tab:hover { background: #21262d; }
.tab.active { background: #0d3b66; border-color: #388bfd; color: white; }
.tab .tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .tab-sub { color: #8b949e; font-size: .72rem; }
.tab.active .tab-sub { color: #b9d3ff; }
.tab .tab-close {
  background: transparent; border: 0; color: inherit; opacity: .55;
  padding: 0 .15rem; cursor: pointer; font-size: 1rem; line-height: 1;
}
.tab .tab-close:hover { opacity: 1; color: #f85149; }
.toolbar {
  display: flex; gap: .5rem; align-items: center;
  margin: .5rem 0 1rem;
  color: #8b949e; font-size: .82rem;
}
.toolbar button { padding: .3rem .6rem; font-size: .82rem; }
.from-cache { background: #21262d; color: #56d364; padding: .1rem .4rem; border-radius: 4px; font-size: .7rem; }
.compare-table {
  width: 100%; border-collapse: collapse; font-size: .85rem;
}
.compare-table th, .compare-table td {
  text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #21262d;
}
.compare-table th { color: #8b949e; font-weight: 500; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
.compare-table tbody tr:hover { background: #161b22; }
.compare-table .numeric { text-align: right; font-variant-numeric: tabular-nums; }
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
  <div class="tabs" id="tabs"></div>

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

  <div class="toolbar" id="toolbar" hidden>
    <button class="ghost" id="compareBtn">Compare all tabs</button>
    <button class="ghost" id="refreshBtn" title="Re-fetch the active tab">↻ Refresh</button>
    <button class="ghost" id="clearBtn" title="Close all tabs">Clear tabs</button>
    <span id="cacheTag"></span>
    <span id="fetchedAt" class="dim"></span>
  </div>

  <section id="result"></section>
  <section id="compare" hidden></section>
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
  if (r.quality.peerMedianDtps && r.quality.peerMedianDtps > 0) {
    const delta = (r.quality.dtps - r.quality.peerMedianDtps) / r.quality.peerMedianDtps * 100;
    const sign = delta >= 0 ? '+' : '';
    const peers = r.quality.peerCount;
    const label = sign + delta.toFixed(0) + '% vs ' + peers + ' dps peer' + (peers === 1 ? '' : 's');
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
const compareEl = document.getElementById("compare");
const tabsEl = document.getElementById("tabs");
const toolbarEl = document.getElementById("toolbar");
const cacheTagEl = document.getElementById("cacheTag");
const fetchedAtEl = document.getElementById("fetchedAt");

let activeKey = null;
let tabs = [];           // summaries (from /api/history)
let activePayload = null; // full result for currently-shown tab

const classShort = { 1:"DK",2:"Druid",3:"Hntr",4:"Mage",5:"Monk",6:"Pal",7:"Priest",8:"Rogue",9:"Sham",10:"Lock",11:"Warr",12:"DH",13:"Evoker" };

function showToolbar(hasTabs) {
  toolbarEl.hidden = !hasTabs;
}

function updateFetchedAt(ts, fromCache) {
  fetchedAtEl.textContent = ts ? "fetched " + fmtAge(ts) : "";
  cacheTagEl.innerHTML = fromCache ? '<span class="from-cache">cached · 0 API pts</span>' : "";
}

function renderTabs() {
  tabsEl.innerHTML = tabs.map((t) => {
    const classClass = "class-" + t.charClass;
    const cls = classShort[t.charClass] || "";
    const auto = t.targetAutoDetected ? " auto" : "";
    const sub = "+" + t.targetLevel + auto + (t.spec ? " · " + esc(t.spec) : "");
    const active = t.key === activeKey ? " active" : "";
    return '<button class="tab' + active + '" data-key="' + esc(t.key) + '">' +
      '<span class="tab-title ' + classClass + '">' + esc(t.label) +
        '<span class="dim" style="font-weight:400"> · ' + cls + '</span>' +
      '</span>' +
      '<span class="tab-sub">' + esc(sub) + '</span>' +
      '<span class="tab-close" data-close="' + esc(t.key) + '" title="Close tab">×</span>' +
    '</button>';
  }).join("");
}

async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    tabs = data.items || [];
    renderTabs();
    showToolbar(tabs.length > 0);
  } catch {}
}

async function showTab(key) {
  activeKey = key;
  renderTabs();
  try {
    const res = await fetch("/api/history/" + encodeURIComponent(key));
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ("HTTP " + res.status));
    activePayload = data.result;
    resultEl.innerHTML = render(data.result);
    compareEl.hidden = true;
    resultEl.hidden = false;
    const entry = tabs.find((t) => t.key === key);
    updateFetchedAt(entry ? entry.fetchedAt : null, true);
  } catch (err) {
    resultEl.innerHTML = '<div class="err">✗ ' + esc(err.message) + '</div>';
  }
}

async function closeTab(key) {
  try {
    await fetch("/api/history/" + encodeURIComponent(key), { method: "DELETE" });
  } catch {}
  if (activeKey === key) {
    activeKey = null;
    resultEl.innerHTML = "";
    compareEl.hidden = true;
    updateFetchedAt(null, false);
  }
  await loadHistory();
  if (!activeKey && tabs.length > 0) showTab(tabs[0].key);
}

async function clearAllTabs() {
  if (!confirm("Close all " + tabs.length + " tabs?")) return;
  try { await fetch("/api/history", { method: "DELETE" }); } catch {}
  activeKey = null;
  activePayload = null;
  resultEl.innerHTML = "";
  compareEl.hidden = true;
  updateFetchedAt(null, false);
  await loadHistory();
}

async function runLookup(formValues, refresh) {
  const body = Object.assign({}, formValues, { refresh: refresh || false });
  resultEl.innerHTML = '<div class="dim"><span class="spinner"></span> ' + (refresh ? "refreshing " : "looking up ") + esc(body.character) + '…</div>';
  compareEl.hidden = true;
  resultEl.hidden = false;
  try {
    const res = await fetch("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ("HTTP " + res.status));
    activeKey = data.key;
    activePayload = data.result;
    resultEl.innerHTML = render(data.result);
    await loadHistory();
    updateFetchedAt(Date.now(), !!data.fromCache);
  } catch (err) {
    resultEl.innerHTML = '<div class="err">✗ ' + esc(err.message) + '</div>';
  }
}

function openCompare() {
  if (tabs.length === 0) return;
  // Fetch all tab payloads in parallel, build a table.
  compareEl.hidden = false;
  resultEl.hidden = true;
  compareEl.innerHTML = '<div class="dim"><span class="spinner"></span> building compare view…</div>';
  Promise.all(tabs.map(async (t) => {
    try {
      const res = await fetch("/api/history/" + encodeURIComponent(t.key));
      const d = await res.json();
      return d.ok ? { tab: t, payload: d.result } : null;
    } catch { return null; }
  })).then((rows) => {
    const valid = rows.filter(Boolean);
    if (valid.length === 0) {
      compareEl.innerHTML = '<div class="dim">No tabs to compare.</div>';
      return;
    }
    const rowHtml = valid.map(({ tab, payload }) => {
      const pd = payload.perDungeon;
      const prev = payload.prevLevelBest;
      // medians across displayed runs (includes prev-level-best if present)
      const displayedRuns = [];
      if (prev) displayedRuns.push(prev.best);
      for (const r of pd.runs) displayedRuns.push(r);
      const deathsList = displayedRuns.map((r) => (r.quality ? r.quality.deaths : null)).filter((v) => v !== null);
      const deltaList = displayedRuns.map((r) => {
        if (!r.quality || !r.quality.peerMedianDtps) return null;
        return (r.quality.dtps - r.quality.peerMedianDtps) / r.quality.peerMedianDtps * 100;
      }).filter((v) => v !== null);
      const medianNum = (xs) => { if (xs.length === 0) return null; const s = [...xs].sort((a,b)=>a-b); const m = Math.floor(s.length/2); return s.length%2===0 ? (s[m-1]+s[m])/2 : s[m]; };
      const totalDeaths = deathsList.reduce((a,b) => a + b, 0);
      const medDelta = medianNum(deltaList);
      const deltaCell = medDelta === null
        ? '—'
        : '<span class="' + dtpsDeltaCls(medDelta) + '">' + (medDelta >= 0 ? "+" : "") + medDelta.toFixed(0) + '%</span>';
      const score = payload.character.scoreTop;
      const classClass = "class-" + payload.character.classID;
      return '<tr data-key="' + esc(tab.key) + '">' +
        '<td><a href="#" class="' + classClass + '" data-jump="' + esc(tab.key) + '">' + esc(tab.label) + '</a> <span class="dim">' + esc(payload.character.spec || "") + '</span></td>' +
        '<td class="numeric">' + (score ? score.points.toFixed(0) : '—') + '</td>' +
        '<td class="numeric">+' + payload.targetLevel + (payload.targetAutoDetected ? ' <span class="dim">auto</span>' : '') + '</td>' +
        '<td class="numeric">' + pd.dungeonsAtOrAboveTarget + '/' + pd.totalDungeonsInSeason + '</td>' +
        '<td class="numeric">' + (prev ? ('+' + prev.level + ' · <span class="' + pclass(prev.best.parsePercent) + '">' + prev.best.parsePercent.toFixed(0) + '%</span>') : '—') + '</td>' +
        '<td class="numeric"><span class="' + (totalDeaths === 0 ? "deaths-0" : (totalDeaths <= 3 ? "deaths-low" : "deaths-high")) + '">' + totalDeaths + '</span></td>' +
        '<td class="numeric">' + deltaCell + '</td>' +
        '<td class="numeric">+' + pd.medianLevel + '</td>' +
      '</tr>';
    }).join("");
    compareEl.innerHTML = '<h3>Compare ' + valid.length + ' tab' + (valid.length === 1 ? '' : 's') + '</h3>' +
      '<table class="compare-table"><thead><tr>' +
        '<th>Character</th><th>Score</th><th>Target</th><th>Timed ≥target</th><th>Best prev-level</th>' +
        '<th>Σ deaths</th><th>med Δ dtps</th><th>Med lvl</th>' +
      '</tr></thead><tbody>' + rowHtml + '</tbody></table>' +
      '<p class="dim" style="margin-top:.75rem;font-size:.8rem">Σ deaths and median Δ dtps computed across the displayed runs (prev-level + per-dungeon bests).</p>';
    compareEl.querySelectorAll("[data-jump]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); showTab(a.getAttribute("data-jump")); });
    });
  });
}

// Wire events.
document.getElementById("lookupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await runLookup({
    character: fd.get("character"),
    level: fd.get("level") || null,
    spec: fd.get("spec") || null,
    metric: fd.get("metric") || null,
  }, false);
});

tabsEl.addEventListener("click", (e) => {
  const close = e.target.closest("[data-close]");
  if (close) { e.stopPropagation(); closeTab(close.getAttribute("data-close")); return; }
  const tab = e.target.closest(".tab");
  if (tab) showTab(tab.getAttribute("data-key"));
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  if (!activeKey) return;
  const entry = tabs.find((t) => t.key === activeKey);
  if (!entry) return;
  runLookup({
    character: entry.request.character,
    level: entry.request.level,
    spec: entry.request.spec,
    metric: entry.request.metric,
  }, true);
});
document.getElementById("compareBtn").addEventListener("click", openCompare);
document.getElementById("clearBtn").addEventListener("click", clearAllTabs);

document.getElementById("quitBtn").addEventListener("click", async () => {
  if (!confirm("Quit bmpl? The server will stop and this page will no longer work.")) return;
  try { await fetch("/api/quit", { method: "POST" }); } catch {}
  document.body.innerHTML = '<main style="max-width:500px;margin:4rem auto;text-align:center"><h2>bmpl stopped</h2><p class="dim">You can close this tab.</p></main>';
});
document.getElementById("setupBtn").addEventListener("click", () => { location.href = "/setup"; });

loadHistory();
</script>
</body>
</html>
`;
