import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api } from "../../api.ts";
import type { AdminCharacter } from "../../types.ts";
import { lookupQuery } from "../../lib/me.ts";
import {
  NO_FILTERS, ROLES, SEARCHED_TABS, ageText, charKey, classColorOf, cloud, overview, regionsOf, searchedTable, tabOf, tabStep, verdictCounts,
  type OverviewPeriod, type RoleFilter, type SearchedFilters, type SearchedSort, type SearchedTab, type Thresholds, type VerdictFilter,
} from "../../lib/searched.ts";
import { useT } from "../../locale.tsx";
import { Icon } from "../Icon.tsx";
import { Pager } from "./Pager.tsx";

const VERDICTS: readonly VerdictFilter[] = ["all", "invite", "maybe", "pass", "none"];
const SORTS: readonly SearchedSort[] = ["recent", "score", "rio", "members"];
const PERIODS: readonly OverviewPeriod[] = [7, 30, 0];

/** A name's link: fills the search field with the character's Raider.IO link (no lookup, 0 pts). */
const fillHref = (c: AdminCharacter) => `/?q=${encodeURIComponent(lookupQuery({ name: c.displayName, realm: c.realm, region: c.region } as Parameters<typeof lookupQuery>[0]))}`;

function ClassDot({ c }: { c: AdminCharacter }) {
  const color = classColorOf(c);
  return <span className="sc-dot" style={color ? { background: color } : undefined} />;
}

function VerdictChip({ c }: { c: AdminCharacter }) {
  const { t } = useT();
  if (!c.verdict) return <span className="vchip none">{t("searched.verdict.none")}</span>;
  return <span className={`vchip ${c.verdict}`}>{t(`searched.verdict.${c.verdict}`)}</span>;
}

/**
 * /admin/characters (canvas "bmpl · Personnages recherchés", A + B + C as tabs): every character looked up on this
 * instance, from data already held (0 WCL pts); members only as a count. The tab lives in `?tab=`.
 */
export function SearchedPage() {
  const { t } = useT();
  const [list, setList] = useState<AdminCharacter[] | null>(null);
  const [th, setTh] = useState<Thresholds>({ invite: 70, maybe: 40 });
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<SearchedTab>(() => tabOf(location.search));
  const load = useCallback(() => {
    setFailed(false);
    void api.admin.characters().then((r) => {
      if (!r.ok) { setFailed(true); return; }
      setList(r.characters);
      setTh(r.thresholds);
    });
  }, []);
  useEffect(load, [load]);
  const pick = (k: SearchedTab) => {
    setTab(k);
    const u = new URL(location.href);
    if (k === "table") u.searchParams.delete("tab"); else u.searchParams.set("tab", k);
    history.replaceState({}, "", u.pathname + u.search);
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabStep(tab, e.key);
    if (!next) return;
    e.preventDefault();
    pick(next);
    document.getElementById(`sc-tab-${next}`)?.focus();
  };
  return (
    <>
      <div className="admin-title">
        <a href="/admin" className="muted" style={{ fontSize: 13 }}>{t("searched.back")}</a>
        <h1>{t("searched.title")}</h1>
        {list && <span className="muted" style={{ fontSize: 12 }}>{t("searched.sub", { count: list.length })}</span>}
      </div>
      <div className="content searched">
      <div className="cand-tabs" role="tablist" aria-label={t("searched.tabsLabel")}>
        {SEARCHED_TABS.map((k) => (
          <button
            key={k} id={`sc-tab-${k}`} type="button" role="tab" aria-selected={tab === k} aria-controls="sc-panel"
            tabIndex={tab === k ? 0 : -1} className={"cand-tab" + (tab === k ? " on" : "")} onClick={() => pick(k)} onKeyDown={onTabKey}
          >
            {t(`searched.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div id="sc-panel" role="tabpanel" aria-labelledby={`sc-tab-${tab}`} className="sc-panel">
        {failed && <div className="faint">{t("searched.failed")} <button type="button" className="chip" onClick={load}>{t("searched.retry")}</button></div>}
        {!failed && list === null && <div className="muted"><span className="spinner" /></div>}
        {list && list.length === 0 && <div className="faint">{t("searched.empty")}</div>}
        {list && list.length > 0 && tab === "table" && <TableTab list={list} />}
        {list && list.length > 0 && tab === "overview" && <OverviewTab list={list} th={th} />}
        {list && list.length > 0 && tab === "cloud" && <CloudTab list={list} th={th} />}
      </div>
      </div>
    </>
  );
}

function TableTab({ list }: { list: AdminCharacter[] }) {
  const { t } = useT();
  const [f, setF] = useState<SearchedFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SearchedSort>("recent");
  const [page, setPage] = useState(1);
  const set = (patch: Partial<SearchedFilters>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const counts = useMemo(() => verdictCounts(list, f), [list, f]);
  const view = searchedTable(t, list, f, sort, page);
  const regions = regionsOf(list);
  const now = Date.now();
  return (
    <section className="card admin-section">
      <div className="admin-section-head sc-chips">
        {VERDICTS.map((v) => (
          <button key={v} type="button" className={"chip" + (f.verdict === v ? " chip-on" : "")} aria-pressed={f.verdict === v} onClick={() => set({ verdict: v })}>
            {v !== "all" && v !== "none" && <span className={`sc-vdot ${v}`} />}{t(`searched.verdict.${v}`)} · {counts[v]}
          </button>
        ))}
      </div>
      <div className="admin-tools">
        <label className="admin-search">
          <Icon name="search" size={14} />
          <input type="search" value={f.query} placeholder={t("searched.search")} aria-label={t("searched.searchLabel")} onChange={(e) => set({ query: e.target.value })} />
        </label>
        <span className="muted">{t("searched.role.label")}</span>
        <span className="seg">
          {(["all", ...ROLES] as RoleFilter[]).map((r) => (
            <button key={r} type="button" className={"seg-item" + (f.role === r ? " on" : "")} aria-pressed={f.role === r} onClick={() => set({ role: r })}>{t(`searched.role.${r}`)}</button>
          ))}
        </span>
        {regions.length > 1 && (
          <>
            <span className="muted">{t("searched.region.label")}</span>
            <span className="seg">
              {["all", ...regions].map((r) => (
                <button key={r} type="button" className={"seg-item" + (f.region === r ? " on" : "")} aria-pressed={f.region === r} onClick={() => set({ region: r })}>
                  {r === "all" ? t("searched.region.all") : r.toUpperCase()}
                </button>
              ))}
            </span>
          </>
        )}
        <div className="grow" />
        <span className="muted">{t("searched.sort.label")}</span>
        <span className="seg">
          {SORTS.map((s) => (
            <button key={s} type="button" className={"seg-item" + (sort === s ? " on" : "")} aria-pressed={sort === s} onClick={() => { setSort(s); setPage(1); }}>{t(`searched.sort.${s}`)}</button>
          ))}
        </span>
      </div>
      <div className="sc-scroll">
        <div className="admin-row admin-row-head sc-row label-caps">
          <span>{t("searched.head.character")}</span><span>{t("searched.head.spec")}</span><span>{t("searched.head.verdict")}</span>
          <span>{t("searched.head.rio")}</span><span>{t("searched.head.best")}</span><span>{t("searched.head.members")}</span><span>{t("searched.head.seen")}</span>
        </div>
        {view.rows.length === 0 && <div className="faint" style={{ fontSize: 13, padding: "8px 10px" }}>{t("searched.none")}</div>}
        {view.rows.map((c) => (
          <div key={charKey(c)} className="inset admin-row sc-row">
            <span className="sc-name"><ClassDot c={c} /><a href={fillHref(c)} title={t("searched.cloud.lookup")}>{c.displayName}</a> <span className="faint">{c.displayRealm} · {c.region.toUpperCase()}</span></span>
            <span className="text-soft">{c.spec ?? t("searched.dash")}{c.role && <span className="faint"> · {t(`searched.role.${c.role}`)}</span>}</span>
            <span className="sc-verdict"><VerdictChip c={c} />{c.score !== null && <span className="mono">{c.score}</span>}{c.targetLevel !== null && c.verdict && <span className="faint">+{c.targetLevel}</span>}</span>
            <span className="mono">{c.rio ?? t("searched.dash")}</span>
            <span className="mono">{c.bestTimed !== null ? `+${c.bestTimed}` : t("searched.dash")} {c.bestDungeon && <span className="faint sc-dungeon">{c.bestDungeon}</span>}</span>
            <span className="mono text-soft">{c.members}</span>
            <span className="mono faint">{ageText(t, c.lookedUpAt, now)}</span>
          </div>
        ))}
      </div>
      <div className="pager-row">
        <span className="faint">{view.range} · {t("searched.footer")}</span>
        <div className="grow" />
        <Pager page={view.page} pages={view.pages} onPage={setPage} />
      </div>
    </section>
  );
}

function OverviewTab({ list, th }: { list: AdminCharacter[]; th: Thresholds }) {
  const { t } = useT();
  const [period, setPeriod] = useState<OverviewPeriod>(30);
  const o = overview(list, period, th, Date.now());
  const dash = t("searched.dash");
  return (
    <div className="sc-overview">
      <div className="sc-toolbar">
        <span className="seg">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={"seg-item" + (period === p ? " on" : "")} aria-pressed={period === p} onClick={() => setPeriod(p)}>{t(`searched.overview.period.${p}`)}</button>
          ))}
        </span>
      </div>
      {o.count === 0 ? <div className="faint">{t("searched.overview.noData")}</div> : (
        <>
          <div className="sc-kpis">
            <div className="card sc-kpi">
              <span className="label-caps">{t("searched.overview.characters")}</span>
              <span className="sc-kpi-value mono">{o.count}</span>
              <span className="faint">{t("searched.overview.thisWeek", { n: o.thisWeek })}</span>
            </div>
            <div className="card sc-kpi">
              <span className="label-caps">{t("searched.overview.median")}</span>
              <span className="sc-kpi-value mono">{o.median ?? dash}</span>
              <span className="faint">{t("searched.overview.medianRoles", { tank: o.medianByRole.tank ?? dash, healer: o.medianByRole.healer ?? dash, dps: o.medianByRole.dps ?? dash })}</span>
            </div>
            <div className="card sc-kpi">
              <span className="label-caps">{t("searched.overview.verdicts")}</span>
              <span className="sc-split">
                <span className="invite" style={{ width: `${o.shares.invite}%` }} /><span className="maybe" style={{ width: `${o.shares.maybe}%` }} /><span className="pass" style={{ width: `${o.shares.pass}%` }} />
              </span>
              <span className="faint">{t("searched.overview.verdictLine", { invite: o.verdicts.invite, maybe: o.verdicts.maybe, pass: o.verdicts.pass })}</span>
            </div>
            <div className="card sc-kpi">
              <span className="label-caps">{t("searched.overview.level")}</span>
              <span className="sc-kpi-value mono">{o.levelMode !== null ? `+${o.levelMode}` : dash}</span>
              {o.levelMin !== null && <span className="faint">{t("searched.overview.levelRange", { min: o.levelMin, max: o.levelMax ?? o.levelMin })}</span>}
            </div>
          </div>
          <div className="sc-two">
            <section className="card admin-section">
              <span style={{ fontWeight: 600 }}>{t("searched.overview.histogram")}</span>
              <div className="sc-hist">
                {o.bins.map((b) => (
                  <div key={b.from} className="sc-hist-col">
                    <span className="mono faint">{b.n}</span>
                    <span className={`sc-hist-bar ${b.verdict}`} style={{ height: `${b.height}%` }} />
                  </div>
                ))}
              </div>
              <div className="sc-hist-axis mono faint"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
            </section>
            <section className="card admin-section">
              <span style={{ fontWeight: 600 }}>{t("searched.overview.specs")}</span>
              {o.specs.map((s) => (
                <div key={s.spec} className="sc-spec">
                  <span className="sc-dot" style={s.color ? { background: s.color } : undefined} />
                  <span>{s.spec}</span>
                  <span className="sc-spec-track"><span style={{ width: `${s.width}%` }} /></span>
                  <span className="mono text-soft">{s.n}</span>
                </div>
              ))}
              <span className="faint" style={{ fontSize: 12 }}>{t("searched.overview.specsNote")}</span>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function CloudTab({ list, th }: { list: AdminCharacter[]; th: Thresholds }) {
  const { t } = useT();
  const [role, setRole] = useState<RoleFilter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const v = cloud(list, role, th);
  const sel = v.points.find((p) => p.key === picked)?.character ?? null;
  return (
    <section className="card admin-section">
      <div className="admin-section-head" style={{ flexWrap: "wrap" }}>
        <span className="muted">{t("searched.cloud.sub")}</span>
        <div className="grow" />
        <span className="seg">
          {(["all", ...ROLES] as RoleFilter[]).map((r) => (
            <button key={r} type="button" className={"seg-item" + (role === r ? " on" : "")} aria-pressed={role === r} onClick={() => setRole(r)}>{t(`searched.role.${r}`)}</button>
          ))}
        </span>
      </div>
      <div className="sc-cloud">
        <div className="sc-plot-wrap">
          <div className="sc-yaxis mono faint">{[...v.ticks].reverse().map((y) => <span key={y}>{y}</span>)}</div>
          <div className="sc-plot-col">
            <div className="sc-plot">
              <span className="sc-band pass" style={{ left: 0, width: `${v.maybeAt}%` }}><span>{t("searched.verdict.pass")}</span></span>
              <span className="sc-band maybe" style={{ left: `${v.maybeAt}%`, width: `${v.inviteAt - v.maybeAt}%` }}><span>{t("searched.verdict.maybe")}</span></span>
              <span className="sc-band invite" style={{ left: `${v.inviteAt}%`, right: 0 }}><span>{t("searched.verdict.invite")}</span></span>
              {v.points.map((p) => (
                <button
                  key={p.key} type="button" className={"sc-pt" + (p.key === picked ? " on" : "")} style={{ left: `${p.x}%`, top: `${p.y}%`, ...(p.color ? { background: p.color } : {}) }}
                  aria-label={t("searched.cloud.dotLabel", { name: `${p.character.displayName}-${p.character.displayRealm}`, score: p.character.score ?? 0, rio: p.character.rio ?? 0 })}
                  aria-pressed={p.key === picked} onClick={() => setPicked(p.key)}
                />
              ))}
            </div>
            <div className="sc-hist-axis mono faint"><span>0</span><span>25</span><span>50</span><span>75</span><span>100 · {t("searched.cloud.axis")}</span></div>
          </div>
        </div>
        <div className="sc-side">
          <div className="inset sc-card">
            {sel ? (
              <>
                <span className="sc-name" style={{ fontWeight: 600 }}><ClassDot c={sel} />{sel.displayName} <span className="faint" style={{ fontWeight: 400 }}>{sel.displayRealm} · {sel.region.toUpperCase()}</span></span>
                <span className="text-soft">{[sel.spec, sel.role ? t(`searched.role.${sel.role}`) : null].filter(Boolean).join(" · ")}</span>
                <span className="text-soft">{sel.members > 0 ? t("searched.cloud.members", { count: sel.members }) : t("searched.cloud.membersNone")}</span>
                <span className="sc-verdict"><VerdictChip c={sel} /><span className="mono">{sel.score}</span>{sel.targetLevel !== null && <span className="faint">+{sel.targetLevel}</span>}<span className="faint">· Raider.IO</span><span className="mono">{sel.rio}</span></span>
                <a href={fillHref(sel)}>{t("searched.cloud.lookup")} →</a>
              </>
            ) : <span className="faint">{t("searched.cloud.pick")}</span>}
          </div>
          <span className="label-caps">{t("searched.cloud.gaps")}</span>
          <span className="faint" style={{ fontSize: 12 }}>{t("searched.cloud.gapsNote")}</span>
          {v.gaps.length === 0 && <span className="faint" style={{ fontSize: 13 }}>{t("searched.cloud.noGaps")}</span>}
          {v.gaps.map((c) => (
            <button key={charKey(c)} type="button" className={"inset sc-gap" + (charKey(c) === picked ? " on" : "")} onClick={() => setPicked(charKey(c))}>
              <ClassDot c={c} />
              <span>{c.displayName} <span className="faint">{c.spec}</span></span>
              <span className="mono text-soft">{c.score} · {c.rio}</span>
            </button>
          ))}
          {v.missing > 0 && <span className="faint" style={{ fontSize: 12 }}>{t("searched.cloud.missing", { count: v.missing })}</span>}
        </div>
      </div>
    </section>
  );
}
