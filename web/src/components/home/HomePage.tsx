import { useState } from "react";
import type { FormEvent } from "react";
import { classHex } from "@shared/wow/classes.ts";
import type { AxisKey, HistoryItem, MyCharacter, Region } from "../../types.ts";
import { realmName } from "../../lib/format.ts";
import { regionChipLabel, regionMenu } from "../../lib/header.ts";
import { LINE, candidateRows, homeSelf, progressPoints, progressText, scoreTone } from "../../lib/home.ts";
import type { HomeSelf } from "../../lib/home.ts";
import { candidateHref } from "../../lib/hostedMode.ts";
import { historyKeyFor, seasonLine } from "../../lib/me.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { useSeason } from "../../useSeason.ts";
import type { SeasonState } from "../../useSeason.ts";
import { Around } from "../Around.tsx";
import { ChipMenu } from "../ChipMenu.tsx";
import { Icon } from "../Icon.tsx";
import { KeyStepper } from "../KeyStepper.tsx";
import { SearchInput } from "../SearchInput.tsx";
import { UserMenu } from "../UserMenu.tsx";
import type { SelfActions } from "../owner/types.ts";
import { LocalAccount } from "../shell/LocalAccount.tsx";
import { Palette } from "../shell/Palette.tsx";
import { usePaletteKey } from "../shell/Shell.tsx";
import type { PaletteProps } from "../shell/Shell.tsx";
import type { SidebarProps } from "../shell/Sidebar.tsx";

type SearchProps = Pick<SidebarProps,
  "form" | "onFormChange" | "onLookup" | "busy" | "suggestions" | "onSuggest" | "region" | "instanceRegion" | "onRegionChange"
  | "yourKey" | "keyFallback" | "onKeyChange" | "sseConnected">;
type AccountProps = Pick<SidebarProps,
  "account" | "controls" | "menu" | "pendingProposals" | "onMenuOpen" | "onSignOut" | "watch" | "onWatchToggle" | "onSetup" | "onQuit">;
export type HomePageProps = SearchProps & AccountProps & {
  palette: PaletteProps;
  history: HistoryItem[];
  liveOn: boolean;
  self: SelfActions;
  /** Local mode: where the credentials live (`status.envPath`, "" when unknown); null when hosted. */
  envPath: string | null;
};

/**
 * The connected home page, outside the frame (redesign spec decision 2, mockup F-Accueil): a slim top bar, the split
 * hero (search, "You this week"), "Your progress" beside "Your candidates", then the other characters. It reads only
 * (history, the main character's season: 0 pts); a lookup starts from its search field alone, through `onLookup`.
 */
export function HomePage(p: HomePageProps) {
  const [palette, setPalette] = useState(false);
  usePaletteKey(palette, setPalette);
  const main = p.self.characters[0] ?? null;
  return (
    <div className="home-page">
      <TopBar {...p} />
      <main className="home-main">
        {main
          ? <MainSeason key={`${main.region}|${main.realm}|${main.name}`} main={main} p={p} />
          : <HomeBody p={p} main={null} season={null} />}
      </main>
      {palette && <Palette {...p.palette} onClose={() => setPalette(false)} />}
    </div>
  );
}

function TopBar(p: HomePageProps) {
  const { t } = useT();
  return (
    <header className="home-top">
      <div className="home-top-row">
        <a className="home-logo" href="/">bmpl</a>
        <nav className="home-top-nav" aria-label={t("home.nav")}>
          <a href="/me" className="home-top-a">{t("shell.nav.me")}</a>
          <a href="/live" className="home-top-a"><span className={"nav-dot " + (p.liveOn ? "on" : "off")} aria-hidden="true" />{t("shell.nav.live")}</a>
          <a href="/help" className="home-top-a">{t("shell.nav.help")}</a>
          {p.controls.signOut && p.menu ? (
            <UserMenu m={p.menu} lines={p.account.lines} pendingProposals={p.pendingProposals} onOpen={p.onMenuOpen} onSignOut={p.onSignOut} compact />
          ) : (
            <LocalAccount title={p.account.title} controls={p.controls} watch={p.watch} onWatchToggle={p.onWatchToggle} onSetup={p.onSetup} onQuit={p.onQuit} compact />
          )}
        </nav>
      </div>
    </header>
  );
}

/** The main character's season (GET /api/season, 0 pts): read here once for the hero card and "Your progress". */
function MainSeason({ main, p }: { main: MyCharacter; p: HomePageProps }) {
  const season = useSeason({ name: main.name, realm: main.realm, region: main.region, level: null }, p.self);
  return <HomeBody p={p} main={main} season={season} />;
}

function HomeBody({ p, main, season }: { p: HomePageProps; main: MyCharacter | null; season: SeasonState | null }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const view = season?.view ?? null;
  const model = view && view.runs.length > 0 ? homeSelf(t, locale, view, titleOf) : null;
  const mainKey = main ? historyKeyFor(p.history, main) : null;
  const mainItem = mainKey ? p.history.find((i) => i.key === mainKey) ?? null : null;
  // "My form" (phase 3) is the main character's own result page until then; /me without a history row.
  const mainHref = mainKey ? candidateHref(mainKey) : "/me";
  return (
    <div className="home-col">
      <section className="home-hero">
        <Search {...p} />
        {!main ? (
          <EmptyCard title={t("home.self.addTitle")} text={t("home.self.addText")} href="/me" action={t("home.self.addAction")} />
        ) : season?.loading ? (
          <div className="card home-self"><span className="muted"><span className="spinner" /> {t("common.loading")}</span></div>
        ) : model === null ? (
          <EmptyCard title={t("home.self.syncTitle")} text={t("home.self.syncText", { name: main.name })} href={mainHref} action={t("home.self.syncAction", { name: main.name })} />
        ) : (
          <SelfCard main={main} item={mainItem} model={model} line={seasonLine(t, view)} spec={view?.runs[0]?.spec ?? null} href={mainHref} />
        )}
      </section>
      <section className="home-pair">
        <Progress model={model} href={mainHref} />
        <Candidates history={p.history} liveOn={p.liveOn} />
      </section>
      {p.self.characters.length > 1 && <Others chars={p.self.characters.slice(1)} />}
    </div>
  );
}

function Search(p: HomePageProps) {
  const { t } = useT();
  const submit = (e: FormEvent) => { e.preventDefault(); if (p.form.character.trim() && !p.busy) p.onLookup(); };
  return (
    <div className="home-hero-left">
      <h1 className="home-title">{t("home.hero.title")}<br /><span className="muted">{t("home.hero.sub")}</span></h1>
      <form className="home-search" role="search" aria-label={t("shell.search.label")} onSubmit={submit}>
        <div className="search-box">
          <Icon name="search" size={20} />
          <SearchInput
            value={p.form.character}
            onChange={(v) => p.onFormChange({ ...p.form, character: v })}
            placeholder={t("header.searchPlaceholder")}
            suggestions={p.suggestions}
            onPick={p.onSuggest}
          />
          <ChipMenu
            label={regionChipLabel(p.region)}
            className={"chip" + (p.region !== p.instanceRegion ? " chip-on" : "")}
            head={t("header.region.remembered")}
            items={regionMenu(t, p.region)}
            onPick={(v) => p.onRegionChange(v as Region)}
            title={t("header.region.title")}
          />
          <button type="submit" className="btn btn-primary home-go" disabled={!!p.busy || !p.form.character.trim()}>
            {p.busy ? <span className="spinner" /> : t("home.hero.submit")}
          </button>
        </div>
      </form>
      <div className="home-search-foot">
        <KeyStepper value={p.yourKey} fallback={p.keyFallback} onChange={p.onKeyChange} />
        <span className="home-hint">{t("home.hero.hint")}</span>
      </div>
      {p.busy && <div className="muted home-hint"><span className="spinner" /> {p.busy}</div>}
      {!p.sseConnected && <div className="faint home-hint" title={t("header.reconnecting")}>{t("header.liveDisconnected")}</div>}
      {p.envPath !== null && (
        <p className="faint home-hint home-local">
          {p.controls.watch && <>{t("home.local.watch")}<br /></>}
          <Around message={t("home.local.credentials")} params={{ path: <span className="mono">{p.envPath || t("home.local.unknownPath")}</span> }} />
        </p>
      )}
    </div>
  );
}

function EmptyCard({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <section className="card home-self home-empty">
      <h2 className="home-h2">{title}</h2>
      <p className="muted">{text}</p>
      <a href={href} className="home-more">{action}</a>
    </section>
  );
}

const PAST_CLASS = { "tone-good": "home-better", "tone-bad": "home-worse", muted: "faint" } as const;

function SelfCard({ main, item, model, line, spec, href }: { main: MyCharacter; item: HistoryItem | null; model: HomeSelf; line: string; spec: string | null; href: string }) {
  const { t } = useT();
  const w = model.week;
  return (
    <section className="card home-self" aria-labelledby="home-self-title">
      <div className="home-self-head">
        <h2 className="side-label home-label" id="home-self-title">{t("home.self.title")}</h2>
        <a href={href} className="home-more">{t("home.self.open")}</a>
      </div>
      <div className="home-who">
        <span className="home-who-name" style={item ? { color: classHex(item.charClass) } : undefined}>{main.name}</span>
        <span className="home-sub">{[spec, realmName(main.realm), line].filter(Boolean).join(" · ")}</span>
      </div>
      {w && (
        <div className="home-tiles">
          <div className="home-tile"><span className="mono home-tile-n">{w.runs}</span><span className="home-sub">{t("home.self.runs", { when: w.label })}</span></div>
          <div className="home-tile"><span className="mono home-tile-n">{w.bestTimed === null ? "—" : `+${w.bestTimed}`}</span><span className="home-sub">{t("home.self.bestTimed")}</span></div>
          <div className="home-tile"><span className="mono home-tile-n">{w.scored === 0 ? "—" : `${w.timed}/${w.scored}`}</span><span className="home-sub">{t("home.self.timed")}</span></div>
        </div>
      )}
      {model.workOn.length > 0 && (
        <div className="home-work">
          <span className="home-work-title">{t("home.self.workOn")}</span>
          {model.workOn.map((r) => (
            <div key={r.n} className="home-work-row">
              <span className="home-work-name">{r.title} <span className="home-sub">{r.detail}</span></span>
              <span className="mono home-worse">{r.impact}</span>
              <span className={"home-work-past " + PAST_CLASS[r.past.cls]}>{r.past.text}</span>
            </div>
          ))}
        </div>
      )}
      {item?.verdict && (
        <div className="home-chef">
          <span className={"recent-dot " + item.verdict} aria-hidden="true" />
          <span>
            <Around
              message={t("home.self.chef")}
              params={{
                verdict: <strong className={"home-verdict " + item.verdict}>{t(`verdict.words.${item.verdict}`)}{item.score !== null && <> <span className="mono">{Math.round(item.score)}</span></>}</strong>,
                level: <span className="mono">{item.targetLevel}</span>,
              }}
            />
          </span>
        </div>
      )}
    </section>
  );
}

function Progress({ model, href }: { model: HomeSelf | null; href: string }) {
  const { t } = useT();
  return (
    <section className="card home-card home-progress" aria-labelledby="home-progress-title">
      <div className="home-card-head">
        <h2 className="home-h2" id="home-progress-title">{t("home.progress.title")}</h2>
        {model && <a href={href} className="btn">{t("home.progress.open")}</a>}
      </div>
      {!model ? <p className="muted home-p">{t("home.progress.empty")}</p> : (
        <>
          <div className="home-line">
            <ProgressLine best={model.bestPerWeek} />
            <span className="home-line-text">{progressText(t, model.bestPerWeek)}</span>
          </div>
          <div className="home-points">
            <PointList title={t("home.progress.good")} tone="better" points={model.strengths} />
            <PointList title={t("home.progress.bad")} tone="worse" points={model.costs} />
          </div>
          <div className="home-pillars">
            {model.pillars.map((pl) => (
              <div key={pl.key} className="home-pillar">
                <span className="home-pillar-track"><span className={"home-pillar-bar " + scoreTone(pl.score)} style={{ height: `${pl.score ?? 0}%` }} /></span>
                <span className="home-pillar-label" title={pl.label}>{t(`me.cells.${pl.key}`)} <span className="mono">{pl.score ?? "—"}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ProgressLine({ best }: { best: HomeSelf["bestPerWeek"] }) {
  const { t } = useT();
  const pts = progressPoints(best);
  const levels = best.map((b) => (b.level === null ? "—" : `+${b.level}`)).join(", ");
  return (
    <svg className="home-spark" viewBox={`0 0 ${LINE.width} ${LINE.height}`} role="img" aria-label={t("home.progress.chart", { levels })}>
      <line x1={10} y1={52} x2={230} y2={52} className="home-spark-axis" />
      {pts.length > 1 && <polyline points={pts.map((q) => `${q.x},${q.y}`).join(" ")} className="home-spark-line" />}
      {pts.map((q, i) => <circle key={q.x} cx={q.x} cy={q.y} r={i === pts.length - 1 ? 5 : 4} className="home-spark-dot" />)}
      {pts.map((q) => <text key={`l${q.x}`} x={q.x} y={q.y - 8} className="home-spark-text">+{q.level}</text>)}
      <text x={LINE.left} y={63} className="home-spark-text">{t("home.progress.weeksAgo", { n: best.length - 1 })}</text>
      <text x={LINE.right} y={63} className="home-spark-text">{t("home.self.thisWeek")}</text>
    </svg>
  );
}

function PointList({ title, tone, points }: { title: string; tone: "better" | "worse"; points: HomeSelf["strengths"] }) {
  const { t } = useT();
  return (
    <div className="home-point-list">
      <span className={"home-point-title home-" + tone}>{title}</span>
      {points.length === 0 && <span className="faint">{t("home.progress.nothing")}</span>}
      {points.map((pt) => (
        <div key={`${pt.kind}|${pt.label}|${pt.detail}`} className="home-point">
          <span className="home-point-name">{pt.label}{pt.detail && <span className="home-sub">{pt.kind === "dungeon" ? `, ${pt.detail}` : ` (${pt.detail})`}</span>}</span>
          <span className={"mono home-point-v home-" + tone}>{pt.score}</span>
        </div>
      ))}
    </div>
  );
}

function Candidates({ history, liveOn }: { history: HistoryItem[]; liveOn: boolean }) {
  const { t } = useT();
  const rows = candidateRows(history);
  return (
    <section className="card home-card home-cands" aria-labelledby="home-cands-title">
      <div className="home-card-head home-pad">
        <h2 className="home-h2" id="home-cands-title">{t("home.candidates.title")}</h2>
        {history.length >= 2 && <a href="/compare" className="home-more">{t("home.candidates.compare")}</a>}
      </div>
      <a href="/live" className={"home-live" + (liveOn ? " on" : "")}>
        <span className={"nav-dot " + (liveOn ? "on" : "off")} aria-hidden="true" />
        <span className="home-live-title">{liveOn ? t("home.candidates.liveOn") : t("home.candidates.liveOff")}</span>
        <span className="home-sub">{t("home.candidates.liveSub")}</span>
        <span className="home-more home-live-open">{t("home.candidates.liveOpen")}</span>
      </a>
      {rows.length === 0 ? <p className="muted home-p home-pad">{t("home.candidates.empty")}</p> : (
        <div className="home-crows">
          {rows.map((r) => (
            <a key={r.key} href={r.href} className="home-crow">
              <span className="home-crow-who">
                <span className="home-crow-name" style={{ color: classHex(r.classId) }}>{r.name}</span>
                <span className="home-sub home-ellipsis">{r.sub}</span>
              </span>
              <span className="mono home-crow-level">{r.level}</span>
              <span className={"home-verdict home-crow-v " + (r.verdict ?? "none")}>
                {r.verdict ? t(`verdict.words.${r.verdict}`) : ""} <span className="mono">{r.score}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

const OTHERS_SHOWN = 6;

function Others({ chars }: { chars: MyCharacter[] }) {
  const { t } = useT();
  return (
    <section className="card home-others" aria-labelledby="home-others-title">
      <h2 className="side-label home-label" id="home-others-title">{t("home.others.title")}</h2>
      {chars.slice(0, OTHERS_SHOWN).map((c) => (
        <a key={`${c.region}|${c.realm}|${c.name}`} href="/me" className="home-other">
          <span className="home-other-name">{c.name}</span>
          <span className="home-sub">{realmName(c.realm)} · {c.region.toUpperCase()}</span>
        </a>
      ))}
      {chars.length > OTHERS_SHOWN && <span className="muted">{t("home.others.more", { n: chars.length - OTHERS_SHOWN })}</span>}
      <a href="/me" className="btn home-others-all">{t("home.others.all", { n: chars.length + 1 })}</a>
    </section>
  );
}
