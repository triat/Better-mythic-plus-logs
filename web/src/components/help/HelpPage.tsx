import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api.ts";
import type { StatusInfo } from "../../lib/hostedMode.ts";
import type { DocsResponse, TextBlock } from "../../types.ts";
import { axisIsInformational, curveTable, faqEntries, fmtThresholds, toc } from "../../lib/help.ts";
import { AXIS_ORDER } from "../../lib/verdict.ts";
import { STALE_DAYS } from "../../lib/format.ts";
import { Toast } from "../Toast.tsx";
import { AxisSection } from "./AxisSection.tsx";
import { CurveChart } from "./CurveChart.tsx";
import { Faq } from "./Faq.tsx";
import { HelpToc } from "./HelpToc.tsx";

type Docs = Omit<DocsResponse, "ok">;
const ROLES = ["dps", "healer", "tank"] as const;

interface Props {
  status: StatusInfo;
  /** Anonymous hosted visitor: no app header above, so the page draws the brand line itself (like /privacy). */
  bare?: boolean;
}

/** /help, layout A of the canvas ("HelpA" + "HelpDetails"): sticky TOC and one long page. Every number comes from GET /api/docs (0 WCL pts). */
export function HelpPage({ status, bare = false }: Props) {
  const [data, setData] = useState<Docs | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  useEffect(() => {
    let alive = true;
    api.docs().then((r) => { if (!alive) return; if (r.ok) setData(r); else setToast(r.error); });
    return () => { alive = false; };
  }, []);
  const entries = useMemo(() => (data ? toc(data.docs, status.hosted) : []), [data, status.hosted]);
  return (
    <>
      {bare && <header className="top"><div className="top-row"><div className="brand">bmpl</div></div></header>}
      <div className="admin-title">
        <a href="/" className="muted" style={{ fontSize: 13 }}>← back to lookups</a>
        <h1>Help</h1>
        <span className="muted" style={{ fontSize: 12 }}>what is analysed, how every number is computed, and why some are not</span>
      </div>
      {!data && <div className="muted" style={{ padding: 24 }}><span className="spinner" /> loading…</div>}
      {data && (
        <div className="help-layout">
          <HelpToc entries={entries} />
          <div className="help-body">
            <What data={data} />
            <Verdict data={data} />
            <Axes />
            {AXIS_ORDER.map((key) => <AxisSection key={key} axisKey={key} doc={data.docs.axes[key]} config={data.config} />)}
            <LevelScale data={data} />
            <ExpectedIlvl data={data} />
            <Runs data={data} />
            <section className="card help-card" id="peers"><h2>Peers</h2><p className="help-p">{data.docs.peers}</p></section>
            <DeepDive data={data} />
            <Reading />
            <Faq entries={faqEntries(data.docs, status.hosted)} />
          </div>
        </div>
      )}
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}

const Blocks = ({ items }: { items: TextBlock[] }) => (
  <ul className="help-ul">{items.map((b) => <li key={b.title}><b>{b.title}</b> — {b.text}</li>)}</ul>
);

function What({ data }: { data: Docs }) {
  return (
    <section className="card help-card" id="what">
      <h2>What bmpl looks at</h2>
      <ul className="help-ul">
        {data.docs.sources.map((s) => <li key={s.title}><b>{s.title}</b> — {s.text} <span className="faint">{s.freshness}</span></li>)}
      </ul>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>All of it is public data: anyone can open the same logs on warcraftlogs.com and count the same deaths.</p>
    </section>
  );
}

function Verdict({ data }: { data: Docs }) {
  const v = data.docs.verdict;
  const t = fmtThresholds(data.config.verdict, data.config.confidence);
  const informational = AXIS_ORDER.filter((k) => axisIsInformational(data.config.axisWeights, k)).map((k) => data.docs.axes[k].title);
  return (
    <section className="card help-card" id="verdict">
      <h2>The verdict</h2>
      <p className="help-p">{v.summary}</p>
      <p className="help-p">{v.role}</p>
      <p className="help-p">{v.global}</p>
      <p className="help-p">{v.thresholds} <b>INVITE</b> from <span className="mono">{t.invite}</span>, <b>MAYBE</b> from <span className="mono">{t.maybe}</span>, <b>PASS</b> below.</p>
      <p className="help-p">{v.confidence} <b>high</b> from <span className="mono">{t.high}</span>, <b>medium</b> from <span className="mono">{t.medium}</span>, <b>low</b> below.</p>
      <p className="help-p">{v.insufficient} Minimum: <span className="mono">{t.minRuns}</span>.</p>
      <div className="curve" style={{ marginTop: 4 }}>
        <div className="label-caps">axis weights by role (effective config, version {data.config.version})</div>
        <table>
          <thead><tr><td />{AXIS_ORDER.map((k) => <td key={k} className="k">{k}</td>)}</tr></thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role}><td className="k">{role}</td>{AXIS_ORDER.map((k) => <td key={k}>{data.config.axisWeights[role][k]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {informational.length > 0 && (
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          {informational.join(", ")} {informational.length === 1 ? "has" : "have"} weight 0 for every role: shown, never counted. Timed vs depleted is shown in the run list and never scored.
        </p>
      )}
    </section>
  );
}

function Axes() {
  return (
    <section className="card help-card" id="axes">
      <h2>The six axes</h2>
      <p className="help-p">
        Each axis scores 0–100. A sub-signal's value goes through its curve — printed beside it, linear between the points and clamped outside them — into a
        0–100 score; the axis is the mean of those scores weighted by the player's role (the chips under each curve), rounded. A sub-signal that is n/a, or whose
        weight for the role is 0, is left out. Each evidence line on an axis row is that sub-signal's share of the distance from 50, in axis points.
      </p>
    </section>
  );
}

function LevelScale({ data }: { data: Docs }) {
  const points = data.config.levelScale;
  const yMax = Math.max(...points.map(([, f]) => f));
  return (
    <section className="card help-row" id="level-scale">
      <div className="help-card" style={{ flex: 1 }}>
        <h2>Key-level scaling</h2>
        <p className="help-p">{data.docs.levelScale}</p>
      </div>
      <div className="curve">
        <div className="label-caps">key level → factor</div>
        <CurveChart points={points} yMax={yMax} />
        <table><tbody>{curveTable(points, "key level").map((r) => <tr key={r.x}><td className="k">{r.x}</td><td>→ ×{r.y}</td></tr>)}</tbody></table>
      </div>
    </section>
  );
}

function ExpectedIlvl({ data }: { data: Docs }) {
  const season = data.season;
  const points = season ? data.config.expectedIlvl[season] ?? null : null;
  return (
    <section className="card help-row" id="expected-ilvl">
      <div className="help-card" style={{ flex: 1 }}>
        <h2>Expected item level</h2>
        <p className="help-p">{data.docs.expectedIlvl}</p>
      </div>
      <div className="curve">
        <div className="label-caps">key level → item level{season && <> · season <span className="mono">{season}</span></>}</div>
        {points
          ? <table><tbody>{curveTable(points, "key level").map((r) => <tr key={r.x}><td className="k">{r.x}</td><td>→ {r.y}</td></tr>)}</tbody></table>
          : <span className="faint" style={{ fontSize: 12 }}>no season curve configured</span>}
      </div>
    </section>
  );
}

function Runs({ data }: { data: Docs }) {
  return (
    <section className="card help-card" id="runs">
      <h2>Per-run signals</h2>
      <p className="help-p">{data.docs.runsUsed}</p>
      <Blocks items={data.docs.runSignals} />
      <h3 className="help-h3">Shown, not scored</h3>
      <Blocks items={data.docs.notScored} />
    </section>
  );
}

function DeepDive({ data }: { data: Docs }) {
  const d = data.docs.deepdive;
  return (
    <section className="card help-card" id="deep-dive">
      <h2>Deep-dive</h2>
      <p className="help-p">{d.summary}</p>
      <p className="help-p">{d.usage}</p>
      <p className="help-p">{d.deaths}</p>
      <p className="help-p">{d.table}</p>
      <p className="help-p">{d.cost}</p>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>table version <span className="mono">{data.defensives.version}</span></p>
    </section>
  );
}

function Reading() {
  // Static prose: what each block of the lookup page shows; the numbers of the evaluation live in the sections above.
  return (
    <section className="card help-card" id="reading">
      <h2>Reading the page</h2>
      <ul className="help-ul">
        <li><b>Verdict</b> — the badge with the global score and the confidence; the radar has one point per axis, an n/a axis sits hollow at the centre rather than at 0; each axis row expands to its evidence lines.</li>
        <li><b>Tiles</b> — Median DPS/HPS and Median parse (rankings), Timed (shown) as timed / enriched runs, Avg deaths (with the wipe share), Δ DTPS vs peers, Avoidable vs peers and Kicks vs peers (per-run medians), ilvl, RIO recent timed (last 10 Raider.IO runs) and Prev season (previous-season Raider.IO score). A dash means the data is missing, not zero.</li>
        <li><b>Runs</b> — one row per shown run: key level, timed / depleted, parse, deaths, DTPS and avoidable vs peers, kicks, dispels, with a link to the Warcraft Logs report. Each row has an Analyze button for the deep-dive.</li>
        <li><b>Deep-dive panel</b> — usage vs capacity per defensive and one line per death; a yellow dot marks a table correction you proposed and still pending, a blue one an entry from the shared table.</li>
        <li><b>Compare</b> — tick two or three tabs to see their radars and axes side by side.</li>
        <li><b>Stale</b> — a run older than {STALE_DAYS} days carries a stale badge. <b>Cached</b> — on a shared instance, a lookup already made by another member in the last 6 hours is reused; the tab says so and it costs nothing.</li>
      </ul>
    </section>
  );
}
