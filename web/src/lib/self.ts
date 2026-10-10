// View models of the self-review result tabs (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md;
// canvas page "self-review": SelfTabs, SelfDungeonFirst, SelfDetails). Pure: no React, no fetch.
import type {
  AxisKey, DungeonRow, Evaluation, LookupPayload, MPlusRun, MyCharacter, OwnClientView, PillarKey, PillarScore, PillarTrend,
  SeasonRunView, SeasonView, WorkOnRow,
} from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { evidenceText, formatEvidenceValue } from "./axes.ts";
import { fmtAge, fmtAmount, fmtDuration, signed } from "./format.ts";
import { AXIS_ORDER, axisTitle, verdictView } from "./verdict.ts";

/** Same order as src/evaluation/types.ts PILLAR_KEYS (the front cannot import runtime values from src/). */
export const PILLAR_ORDER: readonly PillarKey[] = ["damage", "survival", "avoidable", "interrupts", "control"];
export type ResultTab = "overview" | "dungeons" | "runs";
export const RESULT_TABS: readonly ResultTab[] = ["overview", "dungeons", "runs"];

export type Band = "good" | "mid" | "warn" | "bad" | "na";
/** Spec "Numbers (phase 1)", read off the canvas: 75 / 55 / 45. */
export const scoreBand = (s: number | null): Band => (s === null ? "na" : s >= 75 ? "good" : s >= 55 ? "mid" : s >= 45 ? "warn" : "bad");
const scoreText = (t: T, s: number | null): string => (s === null ? t("self.pillar.na") : String(s));

/** Weekly bars: 0.28 px per point, so 100 fills the 28 px row; an empty week is a 2 px stub. */
const BAR_PX_PER_POINT = 0.28;
const pct = (locale: Locale, x: number): string => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(x);

export interface TrendView { text: string; cls: "tone-good" | "tone-bad" | "muted" | "faint" }

export function trendView(t: T, tr: PillarTrend | undefined): TrendView {
  if (!tr || tr.direction === null || tr.delta === null) return { text: t("self.trend.notEnough", { count: tr?.recentRuns ?? 0 }), cls: "faint" };
  if (tr.direction === "same") return { text: t("self.trend.same"), cls: "muted" };
  return { text: t(`self.trend.${tr.direction}`, { delta: signed(tr.delta) }), cls: tr.direction === "up" ? "tone-good" : "tone-bad" };
}

export interface PillarCard {
  key: PillarKey;
  title: string;
  score: string;
  band: Band;
  trend: TrendView;
  bars: { px: number; last: boolean; empty: boolean }[];
  /** One sentence: the pillar's two strongest evidence lines. */
  sentence: string;
  /** Every evidence line, for "details". */
  lines: string[];
}

/** The window's pillars when the season has one (4 weeks, 3+ runs), else the lookup's own evaluation. */
const pillarsOf = (ev: Evaluation, season: SeasonView | null): PillarScore[] => season?.recent?.pillars ?? ev.pillars ?? [];

export function pillarCards(t: T, locale: Locale, ev: Evaluation, season: SeasonView | null): PillarCard[] {
  const source = pillarsOf(ev, season);
  return PILLAR_ORDER.map((key) => {
    const p = source.find((x) => x.key === key) ?? null;
    const score = p?.score ?? null;
    const tr = season?.trends.find((x) => x.key === key);
    const weekly = tr?.weekly ?? [];
    const lines = (p?.evidence ?? []).map((e) => evidenceText(t, locale, e));
    return {
      key,
      title: t(`self.pillars.${key}`),
      score: scoreText(t, score),
      band: scoreBand(score),
      trend: key === "control" && score === null ? { text: t("self.pillar.controlNote"), cls: "faint" } : trendView(t, tr),
      bars: weekly.map((w, i) => ({ px: w === null ? 2 : Math.max(2, Math.round(w * BAR_PX_PER_POINT)), last: i === weekly.length - 1, empty: w === null })),
      sentence: score === null ? (key === "control" ? t("self.pillar.naControl") : t("self.pillar.naGeneric")) : lines.slice(0, 2).join(" · "),
      lines,
    };
  });
}

export const basisText = (t: T, ev: Evaluation, season: SeasonView | null): string =>
  season?.recent ? t("self.basis.recent", { count: season.recent.runs }) : t("self.basis.lookup", { count: ev.runsUsed });

export interface WorkOnView {
  n: number;
  title: string;
  pillar: string;
  detail: string;
  impact: string;
  past: { text: string; cls: "tone-good" | "tone-bad" | "muted" };
}

/** The pillar an evidence source belongs to, read off the evaluation itself (no copy of the mapping in the front). */
const pillarOfSource = (ev: Evaluation, source: string): PillarKey | null =>
  ev.pillars?.find((p) => p.evidence.some((e) => e.source === source))?.key ?? null;

/** `ev` is null on the personal page, which has no lookup payload: only the season's window counts there. */
export function workOnRows(t: T, locale: Locale, ev: Evaluation | null, season: SeasonView | null, titleOf: (source: string) => string): WorkOnView[] {
  const rows: WorkOnRow[] = season?.recent
    ? season.workOn
    : !ev ? [] : (ev.drivers ?? []).filter((d) => d.impact < 0).slice(0, 3).map((d) => ({
        source: d.source, pillar: pillarOfSource(ev, d.source), impact: d.impact, value: d.value, reference: d.reference, label: d.label, past: null,
      }));
  return rows.map((w, i) => ({
    n: i + 1,
    title: titleOf(w.source),
    pillar: w.pillar ? t(`self.pillars.${w.pillar}`) : "",
    detail: evidenceText(t, locale, { label: w.label, delta: 0, source: w.source, value: w.value }),
    impact: t("self.workOn.impact", { value: signed(w.impact) }),
    past: w.past === null
      ? { text: t("self.workOn.noPast"), cls: "muted" }
      : w.past.change === "same"
        ? { text: t("self.workOn.same"), cls: "muted" }
        : { text: t(`self.workOn.${w.past.change}`, { value: formatEvidenceValue(locale, w.source, w.past.value) }), cls: w.past.change === "better" ? "tone-good" : "tone-bad" },
  }));
}

/** "Verdict for a group leader: INVITE 72 · context: …": the verdict as today, the context axes beside it. */
export function verdictLine(t: T, ev: Evaluation, informational: (key: AxisKey) => boolean): { badge: ReturnType<typeof verdictView>; context: string } {
  const items = AXIS_ORDER.filter((k) => k === "preparation" || k === "consistency" || k === "experience").flatMap((k) => {
    const a = ev.axes.find((x) => x.key === k);
    if (!a || a.score === null) return [];
    const item = t("self.contextItem", { name: axisTitle(t, k).toLocaleLowerCase(), score: a.score });
    return [informational(k) ? t("self.informational", { item }) : item];
  });
  return { badge: verdictView(t, ev), context: items.length > 0 ? t("self.context", { list: items.join(" · ") }) : "" };
}

export const headLine = (t: T, season: SeasonView, now = Date.now()): string =>
  t("self.head.runs", { count: season.state.runs }) + (season.checkedAt !== null ? t("self.head.checked", { age: fmtAge(t, season.checkedAt, now) }) : "");

export interface GridCell { text: string; band: Band; trend?: string }

export function seasonHeader(t: T, season: SeasonView): { cells: GridCell[]; overall: GridCell; runs: string } {
  const pillars = season.season?.pillars ?? [];
  return {
    cells: PILLAR_ORDER.map((key) => {
      const s = pillars.find((p) => p.key === key)?.score ?? null;
      const tr = trendView(t, season.trends.find((x) => x.key === key));
      // The grid's cells are narrow: "too few runs" instead of the cards' longer sentence.
      const trend = key === "control" && s === null ? t("self.pillar.controlNote") : tr.cls === "faint" ? t("self.trend.few") : tr.text;
      return { text: scoreText(t, s), band: scoreBand(s), trend };
    }),
    overall: { text: scoreText(t, season.season?.overall ?? null), band: scoreBand(season.season?.overall ?? null) },
    runs: String(season.state.runs),
  };
}

export interface GridRow { encounterID: number; name: string; cells: GridCell[]; overall: GridCell; runs: string }

export const dungeonRows = (t: T, season: SeasonView): GridRow[] =>
  season.dungeons.map((d) => ({
    encounterID: d.encounterID,
    name: d.name,
    cells: PILLAR_ORDER.map((k) => ({ text: scoreText(t, d.pillars[k]), band: scoreBand(d.pillars[k]) })),
    overall: { text: scoreText(t, d.overall), band: scoreBand(d.overall) },
    runs: String(d.runs),
  }));

export interface PanelView {
  title: string;
  sub: string;
  avoidable: { id: number; name: string; pct: string; width: number }[];
  other: { pct: string; width: number } | null;
  killers: { ability: string; deaths: string }[];
  casts: { id: number; name: string; ofText: string; mine: string }[];
  runsLink: string;
  empty: boolean;
}

export function dungeonPanel(t: T, locale: Locale, row: DungeonRow): PanelView {
  const d = row.details;
  const share = (v: number): number => (d.avoidableTotal > 0 ? v / d.avoidableTotal : 0);
  const best = row.best ? t("self.panel.best", { level: row.best.level, result: t(row.best.timed === false ? "self.panel.depleted" : "self.panel.timed") }) : "";
  return {
    title: row.name,
    sub: t("self.panel.sub", { count: row.runs, best }),
    avoidable: d.avoidable.map((a) => ({ id: a.id, name: a.name, pct: pct(locale, share(a.total)), width: Math.round(share(a.total) * 100) })),
    other: d.avoidableOther > 0 ? { pct: pct(locale, share(d.avoidableOther)), width: Math.round(share(d.avoidableOther) * 100) } : null,
    killers: d.killers.map((k) => ({ ability: k.ability, deaths: t("self.panel.deaths", { count: k.deaths }) })),
    casts: d.casts.map((c) => ({ id: c.id, name: c.name, ofText: t("self.panel.castOf", { completed: c.completed, attempts: c.attempts }), mine: c.mine > 0 ? t("self.panel.mine", { n: c.mine }) : "" })),
    runsLink: t("self.panel.runsLink", { count: row.runs, name: row.name }),
    empty: row.analysed === 0,
  };
}

/** A season run as the run list's `MPlusRun` (`rowOf` in runs.ts renders both). */
export const runOf = (v: SeasonRunView): MPlusRun => ({
  encounterID: v.encounterID, encounterName: v.encounterName, keyLevel: v.keyLevel, amount: v.amount, parsePercent: v.parse,
  spec: v.spec, affixes: v.affixes, reportCode: v.reportCode, fightID: v.fightID, startTime: v.startTime, score: v.score,
  ...(v.signals ? { signals: v.signals } : {}),
});

export interface RunDetailView {
  deaths: { title: string; hits: { ability: string; share: string }[] }[];
  avoidable: { key: string; name: string; amount: string }[];
  casts: { id: number; name: string; ofText: string }[];
  kicked: string | null;
}

export function runDetail(t: T, locale: Locale, v: SeasonRunView): RunDetailView | null {
  const s = v.signals;
  if (!s) return null;
  const deaths = s.deaths.events.map((d) => {
    const hits = d.killingHits ?? [];
    const sum = hits.reduce((a, h) => a + h.amount, 0);
    return {
      title: t("self.detail.deathAt", { at: fmtDuration(d.atMs) }),
      hits: hits.map((h) => {
        const name = h.ability ?? "?";
        return { ability: h.friendly ? t("self.detail.self", { ability: name }) : name, share: t("self.detail.ofHits", { pct: pct(locale, sum > 0 ? h.amount / sum : 0) }) };
      }),
    };
  });
  const a = s.avoidableDamage;
  const avoidable = [
    ...(a?.abilities ?? []).map((x) => ({ key: String(x.id), name: x.name, amount: fmtAmount(x.total) })),
    ...(a?.other ? [{ key: "other", name: t("self.panel.other"), amount: fmtAmount(a.other) }] : []),
  ];
  const enemy = [...(s.interrupts.enemyCasts ?? [])].sort((x, y) => y.completed - x.completed).slice(0, 5);
  const interrupted = (s.interrupts.enemyCasts ?? []).reduce((n, c) => n + c.interrupted, 0);
  const mine = (s.interrupts.enemyCasts ?? []).reduce((n, c) => n + c.mine, 0);
  return {
    deaths,
    avoidable,
    casts: enemy.map((c) => ({ id: c.id, name: c.name, ofText: t("self.panel.castOf", { completed: c.completed, attempts: c.attempts }) })),
    kicked: enemy.length > 0 ? t("self.detail.kicked", { mine, interrupted }) : null,
  };
}

export type SyncCardView =
  | { kind: "nothing"; text: string }
  | { kind: "noClient"; text: string; link: string; without: string }
  | { kind: "ready"; found: string; cost: string; start: string }
  | { kind: "done"; text: string; failed: string | null };

/** Decision 3: hosted needs a usable own client; the estimate is stated before any point is spent. */
export function syncCard(t: T, season: SeasonView | null, hosted: boolean, ownClient: OwnClientView | null): SyncCardView {
  if (hosted && !ownClient?.usable) return { kind: "noClient", text: t("self.sync.noClient"), link: t("self.sync.addClient"), without: t("self.sync.without") };
  if (!season) return { kind: "nothing", text: t("self.sync.nothing") };
  const s = season.state;
  if (s.pending === 0) {
    return { kind: "done", text: t("self.sync.done", { analysed: s.analysed, runs: s.runs }), failed: s.failed > 0 ? t("self.sync.failed", { count: s.failed }) : null };
  }
  // Runs synced before crowd control existed only need it (~3 pts each): say so rather than "not analysed".
  const notAnalysed = s.pending - s.controlOnly;
  const found = notAnalysed === 0
    ? t("self.sync.foundControl", { runs: s.runs, count: s.controlOnly })
    : s.controlOnly > 0
      ? t("self.sync.foundMixed", { runs: s.runs, pending: notAnalysed, control: s.controlOnly })
      : t("self.sync.found", { runs: s.runs, pending: s.pending });
  return {
    kind: "ready",
    found,
    cost: t(hosted ? "self.sync.cost" : "self.sync.costLocal", { pts: s.estimate }),
    start: notAnalysed === 0 ? t("self.sync.controlOnly", { count: s.controlOnly }) : t("self.sync.start", { count: s.pending }),
  };
}

export const syncProgress = (t: T, p: { done: number; total: number; pts: number }): string => t("self.sync.progress", p);

export const MAX_ME = 5;
const sameCharacter = (c: MyCharacter, p: LookupPayload): boolean =>
  c.region === p.character.region && c.realm.toLowerCase() === p.character.realmSlug.toLowerCase() && c.name.toLowerCase() === p.character.name.toLowerCase();
export const isMe = (chars: MyCharacter[], p: LookupPayload): boolean => chars.some((c) => sameCharacter(c, p));

/** Phase-2 spec, decision 6: the member's own characters open the self-review tabs, anyone else the vetting view the
 * result page had before phase 1. Until Battle.net linking, "own" means "in My characters". */
export const resultView = (chars: MyCharacter[], p: LookupPayload): "owner" | "vetting" => (isMe(chars, p) ? "owner" : "vetting");

/** Adds or removes the payload's character; null when the list is full and it is not in it. */
export function toggleMe(chars: MyCharacter[], p: LookupPayload): MyCharacter[] | null {
  if (isMe(chars, p)) return chars.filter((c) => !sameCharacter(c, p));
  if (chars.length >= MAX_ME) return null;
  return [...chars, { name: p.character.name, realm: p.character.realmSlug, region: p.character.region, source: "manual" }];
}

export function meChip(t: T, chars: MyCharacter[], p: LookupPayload): { label: string; on: boolean; disabled: boolean; title?: string } {
  if (isMe(chars, p)) return { label: t("self.head.meOn"), on: true, disabled: false };
  if (chars.length >= MAX_ME) return { label: t("self.head.me"), on: false, disabled: true, title: t("self.head.meFull", { max: MAX_ME }) };
  return { label: t("self.head.me"), on: false, disabled: false };
}
