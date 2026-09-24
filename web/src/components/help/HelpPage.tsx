import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api.ts";
import type { StatusInfo } from "../../lib/hostedMode.ts";
import type { DocsResponse, TextBlock } from "../../types.ts";
import { axisIsInformational, curveTable, faqEntries, fmtThresholds, toc } from "../../lib/help.ts";
import { AXIS_ORDER } from "../../lib/verdict.ts";
import { STALE_DAYS } from "../../lib/format.ts";
import { useT } from "../../locale.tsx";
import type { T } from "../../i18n/t.ts";
import { Around } from "../Around.tsx";
import { Toast } from "../Toast.tsx";
import { AxisSection } from "./AxisSection.tsx";
import { CurveChart } from "./CurveChart.tsx";
import { Faq } from "./Faq.tsx";
import { HelpToc } from "./HelpToc.tsx";
import { LiveAddonGuide } from "./LiveAddonGuide.tsx";
import { WclClientGuide } from "./WclClientGuide.tsx";

type Docs = Omit<DocsResponse, "ok">;
const ROLES = ["dps", "healer", "tank"] as const;

interface Props {
  status: StatusInfo;
  /** Anonymous hosted visitor: no app header above, so the page draws the brand line itself (like /privacy). */
  bare?: boolean;
}

/**
 * /help, layout A of the canvas ("HelpA" + "HelpDetails"): sticky TOC and one long page. Every number comes from
 * GET /api/docs (0 WCL pts), fetched in the UI language and again when it changes — the previous language's page
 * stays up until the next one arrives.
 */
export function HelpPage({ status, bare = false }: Props) {
  const { t, locale } = useT();
  const [data, setData] = useState<Docs | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  useEffect(() => {
    let alive = true;
    api.docs(locale).then((r) => { if (!alive) return; if (r.ok) setData(r); else setToast(r.error); });
    return () => { alive = false; };
  }, [locale]);
  const entries = useMemo(() => (data ? toc(t, data.docs, status.hosted) : []), [t, data, status.hosted]);
  return (
    <>
      {bare && <header className="top"><div className="top-row"><div className="brand">bmpl</div></div></header>}
      <div className="admin-title">
        <a href="/" className="muted" style={{ fontSize: 13 }}>{t("common.backToLookups")}</a>
        <h1>{t("help.title")}</h1>
        <span className="muted" style={{ fontSize: 12 }}>{t("help.sub")}</span>
      </div>
      {!data && <div className="muted" style={{ padding: 24 }}><span className="spinner" /> {t("common.loading")}</div>}
      {data && (
        <div className="help-layout">
          <HelpToc entries={entries} />
          <div className="help-body">
            <What t={t} data={data} />
            <Verdict t={t} data={data} />
            <Axes t={t} />
            {AXIS_ORDER.map((key) => <AxisSection key={key} axisKey={key} doc={data.docs.axes[key]} config={data.config} />)}
            <LevelScale t={t} data={data} />
            <ExpectedIlvl t={t} data={data} />
            <Runs t={t} data={data} />
            <section className="card help-card" id="peers"><h2>{t("help.toc.peers")}</h2><p className="help-p">{data.docs.peers}</p></section>
            <DeepDive t={t} data={data} />
            {status.hosted && <WclClientGuide doc={data.docs.wclClient} quota={data.quota} />}
            <LiveAddonGuide doc={data.docs.liveAddon} />
            <Reading t={t} />
            <Faq entries={faqEntries(data.docs, status.hosted)} />
          </div>
        </div>
      )}
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}

interface SectionProps { t: T; data: Docs }

const Blocks = ({ items }: { items: TextBlock[] }) => (
  <ul className="help-ul">{items.map((b) => <li key={b.title}><b>{b.title}</b> — {b.text}</li>)}</ul>
);

function What({ t, data }: SectionProps) {
  return (
    <section className="card help-card" id="what">
      <h2>{t("help.toc.what")}</h2>
      <ul className="help-ul">
        {data.docs.sources.map((s) => <li key={s.title}><b>{s.title}</b> — {s.text} <span className="faint">{s.freshness}</span></li>)}
      </ul>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t("help.publicData")}</p>
    </section>
  );
}

function Verdict({ t, data }: SectionProps) {
  const v = data.docs.verdict;
  const th = fmtThresholds(t, data.config.verdict, data.config.confidence);
  const mono = (s: string) => <span className="mono">{s}</span>;
  const informational = AXIS_ORDER.filter((k) => axisIsInformational(data.config.axisWeights, k)).map((k) => data.docs.axes[k].title);
  return (
    <section className="card help-card" id="verdict">
      <h2>{t("help.toc.verdict")}</h2>
      <p className="help-p">{v.summary}</p>
      <p className="help-p">{v.role}</p>
      <p className="help-p">{v.global}</p>
      <p className="help-p" id="drivers">{v.drivers}</p>
      <p className="help-p">
        {v.thresholds}{" "}
        <Around
          message={t("help.thresholds.verdict")}
          params={{
            invite: <b>{t("verdict.words.invite")}</b>, inviteAt: mono(th.invite),
            maybe: <b>{t("verdict.words.maybe")}</b>, maybeAt: mono(th.maybe),
            pass: <b>{t("verdict.words.pass")}</b>,
          }}
        />
      </p>
      <p className="help-p">
        {v.confidence}{" "}
        <Around
          message={t("help.thresholds.confidence")}
          params={{
            high: <b>{t("verdict.confidence.high")}</b>, highAt: mono(th.high),
            medium: <b>{t("verdict.confidence.medium")}</b>, mediumAt: mono(th.medium),
            low: <b>{t("verdict.confidence.low")}</b>,
          }}
        />
      </p>
      <p className="help-p">{v.insufficient} <Around message={t("help.thresholds.minimum")} params={{ minRuns: mono(th.minRuns) }} /></p>
      <div className="curve" style={{ marginTop: 4 }}>
        <div className="label-caps">{t("help.weightsCaption", { version: data.config.version })}</div>
        <table>
          <thead><tr><td />{AXIS_ORDER.map((k) => <td key={k} className="k">{k}</td>)}</tr></thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role}><td className="k">{t(`verdict.role.${role}`)}</td>{AXIS_ORDER.map((k) => <td key={k}>{data.config.axisWeights[role][k]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {informational.length > 0 && (
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          {t("help.informational", { list: informational.join(", "), count: informational.length })}
        </p>
      )}
    </section>
  );
}

function Axes({ t }: { t: T }) {
  return (
    <section className="card help-card" id="axes">
      <h2>{t("help.toc.axes")}</h2>
      <p className="help-p">{t("help.axesIntro")}</p>
    </section>
  );
}

function LevelScale({ t, data }: SectionProps) {
  const points = data.config.levelScale;
  const yMax = Math.max(...points.map(([, f]) => f));
  return (
    <section className="card help-row" id="level-scale">
      <div className="help-card" style={{ flex: 1 }}>
        <h2>{t("help.toc.levelScale")}</h2>
        <p className="help-p">{data.docs.levelScale}</p>
      </div>
      <div className="curve">
        <div className="label-caps">{t("help.curve.keyToFactor")}</div>
        <CurveChart points={points} yMax={yMax} />
        <table><tbody>{curveTable(points, "key level").map((r) => <tr key={r.x}><td className="k">{r.x}</td><td>→ ×{r.y}</td></tr>)}</tbody></table>
      </div>
    </section>
  );
}

function ExpectedIlvl({ t, data }: SectionProps) {
  const season = data.season;
  const points = season ? data.config.expectedIlvl[season] ?? null : null;
  return (
    <section className="card help-row" id="expected-ilvl">
      <div className="help-card" style={{ flex: 1 }}>
        <h2>{t("help.toc.expectedIlvl")}</h2>
        <p className="help-p">{data.docs.expectedIlvl}</p>
      </div>
      <div className="curve">
        <div className="label-caps">{t("help.curve.keyToIlvl")}{season && <>{t("help.curve.season")}<span className="mono">{season}</span></>}</div>
        {points
          ? <table><tbody>{curveTable(points, "key level").map((r) => <tr key={r.x}><td className="k">{r.x}</td><td>→ {r.y}</td></tr>)}</tbody></table>
          : <span className="faint" style={{ fontSize: 12 }}>{t("help.curve.noSeason")}</span>}
      </div>
    </section>
  );
}

function Runs({ t, data }: SectionProps) {
  return (
    <section className="card help-card" id="runs">
      <h2>{t("help.toc.runs")}</h2>
      <p className="help-p">{data.docs.runsUsed}</p>
      <Blocks items={data.docs.runSignals} />
      <h3 className="help-h3">{t("help.shownNotScored")}</h3>
      <Blocks items={data.docs.notScored} />
    </section>
  );
}

function DeepDive({ t, data }: SectionProps) {
  const d = data.docs.deepdive;
  return (
    <section className="card help-card" id="deep-dive">
      <h2>{t("help.toc.deepdive")}</h2>
      <p className="help-p">{d.summary}</p>
      <p className="help-p">{d.usage}</p>
      <p className="help-p">{d.deaths}</p>
      <p className="help-p">{d.table}</p>
      <p className="help-p">{d.cost}</p>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t("help.tableVersion")}<span className="mono">{data.defensives.version}</span></p>
    </section>
  );
}

const READING = ["verdict", "tiles", "runs", "deepdive", "compare"] as const;

function Reading({ t }: { t: T }) {
  // Static prose: what each block of the lookup page shows; the numbers of the evaluation live in the sections above.
  return (
    <section className="card help-card" id="reading">
      <h2>{t("help.toc.reading")}</h2>
      <ul className="help-ul">
        {READING.map((k) => <li key={k}><Around message={t(`help.reading.lines.${k}`)} params={{ label: <b>{t(`help.reading.labels.${k}`)}</b> }} /></li>)}
        <li>
          <Around
            message={t("help.reading.lines.stale", { days: STALE_DAYS })}
            params={{ stale: <b>{t("help.reading.labels.stale")}</b>, cached: <b>{t("help.reading.labels.cached")}</b> }}
          />
        </li>
      </ul>
    </section>
  );
}
