// Self-review view models shared by the owner pages, "My characters" and the home page
// (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md): trends, points to work on, the dungeon panel, a
// season run's detail and control, the sync card, "This is me". Pure: no React, no fetch.
import type {
  CcCategory, DungeonRow, Evaluation, LookupPayload, MPlusRun, MyCharacter, OwnClientView, PillarKey, PillarTrend,
  RunControl, SeasonRunView, SeasonView, WorkOnRow,
} from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { evidenceText, formatEvidenceValue } from "./axes.ts";
import { fmtAge, fmtAmount, fmtDuration, signed } from "./format.ts";

/** Same order as src/evaluation/types.ts PILLAR_KEYS (the front cannot import runtime values from src/). */
export const PILLAR_ORDER: readonly PillarKey[] = ["damage", "survival", "avoidable", "interrupts", "control"];

const pct = (locale: Locale, x: number): string => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(x);

/** `missing`: no trend yet (under 3 scored runs on a side), what the grid's short "too few runs" stands for;
 *  `hint` then explains the rule (the trend line's tooltip). */
export interface TrendView { text: string; cls: "tone-good" | "tone-bad" | "muted" | "faint"; missing?: true; hint?: string }

export function trendView(t: T, tr: PillarTrend | undefined): TrendView {
  if (!tr || tr.direction === null || tr.delta === null) {
    return { text: t("self.trend.notEnough", { recent: tr?.recentRuns ?? 0, before: tr?.beforeRuns ?? 0 }), cls: "faint", missing: true, hint: t("self.trend.rule") };
  }
  if (tr.direction === "same") return { text: t("self.trend.same"), cls: "muted" };
  return { text: t(`self.trend.${tr.direction}`, { delta: signed(tr.delta) }), cls: tr.direction === "up" ? "tone-good" : "tone-bad" };
}

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

/** The points to work on: the season window's when it has one, else the lookup's first three costs (no past then).
 * `ev` is null on the personal page, which has no lookup payload: only the season's window counts there. */
export const workOnSource = (ev: Evaluation | null, season: SeasonView | null): WorkOnRow[] =>
  season?.recent
    ? season.workOn
    : !ev ? [] : (ev.drivers ?? []).filter((d) => d.impact < 0).slice(0, 3).map((d) => ({
        source: d.source, pillar: pillarOfSource(ev, d.source), impact: d.impact, value: d.value, reference: d.reference, label: d.label, past: null,
      }));

export function workOnRows(t: T, locale: Locale, ev: Evaluation | null, season: SeasonView | null, titleOf: (source: string) => string): WorkOnView[] {
  return workOnSource(ev, season).map((w, i) => ({
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

export const headLine = (t: T, season: SeasonView, now = Date.now()): string =>
  t("self.head.runs", { count: season.state.runs }) + (season.checkedAt !== null ? t("self.head.checked", { age: fmtAge(t, season.checkedAt, now) }) : "");

export interface PanelView {
  title: string;
  sub: string;
  avoidable: { id: number; name: string; pct: string; width: number }[];
  other: { pct: string; width: number } | null;
  killers: { id: number | null; ability: string; deaths: string }[];
  casts: { id: number; name: string; ofText: string; mine: string }[];
  /** "Crowd control here" (canvas control, dungeon panel): most uses first. */
  control: { id: number; name: string; uses: string; enemies: string }[];
  controlNote: string;
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
    killers: d.killers.map((k) => ({ id: k.id, ability: k.ability, deaths: t("self.panel.deaths", { count: k.deaths }) })),
    casts: d.casts.map((c) => ({ id: c.id, name: c.name, ofText: t("self.panel.castOf", { completed: c.completed, attempts: c.attempts }), mine: c.mine > 0 ? t("self.panel.mine", { n: c.mine }) : "" })),
    control: d.control.map((c) => ({ id: c.id, name: c.name, uses: t("self.control.uses", { count: c.uses }), enemies: c.enemies > 0 ? t("self.control.enemies", { count: c.enemies }) : "" })),
    controlNote: d.controlRuns === 0
      ? t("self.panel.controlNone")
      : t("self.panel.controlOver", { runs: d.controlRuns }) + (row.analysed > d.controlRuns ? t("self.panel.controlMissing", { count: row.analysed - d.controlRuns }) : ""),
    runsLink: t("self.panel.runsLink", { count: row.runs, name: row.name }),
    empty: row.analysed === 0,
  };
}

/** A season run as the run list's `MPlusRun` (the owner and candidate run views render both). */
export const runOf = (v: SeasonRunView): MPlusRun => ({
  encounterID: v.encounterID, encounterName: v.encounterName, keyLevel: v.keyLevel, amount: v.amount, parsePercent: v.parse,
  spec: v.spec, affixes: v.affixes, reportCode: v.reportCode, fightID: v.fightID, startTime: v.startTime, score: v.score,
  ...(v.signals ? { signals: v.signals } : {}),
});

export interface RunDetailView {
  deaths: { title: string; hits: { id: number | null; ability: string; share: string }[] }[];
  /** The avoidable abilities that hit the player, "other" last (`id` null). */
  avoidable: { key: string; id: number | null; name: string; amount: string }[];
  casts: { id: number; name: string; ofText: string }[];
  kicked: string | null;
  control: ControlView;
}

/** Same order as src/signals/control/table.ts CC_CATEGORIES (the front cannot import runtime values from src/). */
const CC_ORDER: readonly CcCategory[] = ["stun", "incapacitate", "disorient", "fear", "silence", "knock"];

export interface ControlView {
  /** Uses per 10 minutes, one decimal; null when the run was not measured. */
  rate: string | null;
  /** "per 10 min · median of the spec 3.9 ·" and the signed gap, coloured. */
  line: { text: string; delta: string; cls: "tone-good" | "tone-bad" | "" };
  /** Spells grouped by category, in the table's category order (canvas control, run detail B). */
  groups: { label: string; rows: { id: number; name: string; pet: string; uses: string; enemies: string }[] }[];
  note: string | null;
}

export function controlView(t: T, locale: Locale, c: RunControl | undefined): ControlView {
  if (!c) return { rate: null, line: { text: "", delta: "", cls: "" }, groups: [], note: t("self.control.notMeasured") };
  const one = (x: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
  const line: ControlView["line"] = c.reference === null || c.vsReference === null
    ? { text: t("self.control.noReference"), delta: "", cls: "" }
    : {
        text: t("self.control.vsMedian", { median: one(c.reference) }),
        delta: t("self.control.delta", { value: signed(c.vsReference) }),
        cls: c.vsReference > 0 ? "tone-good" : c.vsReference < 0 ? "tone-bad" : "",
      };
  const groups = CC_ORDER.flatMap((cat) => {
    const rows = c.spells.filter((s) => s.category === cat).map((s) => ({
      id: s.id, name: s.name, pet: s.pet ? t("self.control.pet") : "",
      uses: t("self.control.uses", { count: s.uses }),
      enemies: s.enemies > 0 ? t("self.control.enemies", { count: s.enemies }) : "",
    }));
    return rows.length > 0 ? [{ label: t(`self.control.cat.${cat}`), rows }] : [];
  });
  const note = c.stale ? t("self.control.stale") : c.uses === 0 ? t("self.control.none") : null;
  return { rate: one(c.perTenMin), line, groups, note };
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
        return { id: h.ability ? h.abilityId : null, ability: h.friendly ? t("self.detail.self", { ability: name }) : name, share: t("self.detail.ofHits", { pct: pct(locale, sum > 0 ? h.amount / sum : 0) }) };
      }),
    };
  });
  const a = s.avoidableDamage;
  const avoidable = [
    ...(a?.abilities ?? []).map((x) => ({ key: String(x.id), id: x.id, name: x.name, amount: fmtAmount(x.total) })),
    ...(a?.other ? [{ key: "other", id: null, name: t("self.panel.other"), amount: fmtAmount(a.other) }] : []),
  ];
  const enemy = [...(s.interrupts.enemyCasts ?? [])].sort((x, y) => y.completed - x.completed).slice(0, 5);
  const interrupted = (s.interrupts.enemyCasts ?? []).reduce((n, c) => n + c.interrupted, 0);
  const mine = (s.interrupts.enemyCasts ?? []).reduce((n, c) => n + c.mine, 0);
  return {
    deaths,
    avoidable,
    casts: enemy.map((c) => ({ id: c.id, name: c.name, ofText: t("self.panel.castOf", { completed: c.completed, attempts: c.attempts }) })),
    kicked: enemy.length > 0 ? t("self.detail.kicked", { mine, interrupted }) : null,
    control: controlView(t, locale, s.control),
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

export const MAX_ME = 20;
const sameCharacter = (c: MyCharacter, p: LookupPayload): boolean =>
  c.region === p.character.region && c.realm.toLowerCase() === p.character.realmSlug.toLowerCase() && c.name.toLowerCase() === p.character.name.toLowerCase();
export const isMe = (chars: MyCharacter[], p: LookupPayload): boolean => chars.some((c) => sameCharacter(c, p));

/** Phase-2 spec, decision 6: the member's own characters open the self-review tabs, anyone else the vetting view the
 * result page had before phase 1. "Own" means "in My characters" (from Battle.net only when hosted). */
export const resultView = (chars: MyCharacter[], p: LookupPayload): "owner" | "vetting" => (isMe(chars, p) ? "owner" : "vetting");

/** Adds or removes the payload's character; null when the list is full and it is not in it. Hosted, characters come
 * from Battle.net only (Battle.net spec, decision 7): the toggle can only remove, so an addition is null too. */
export function toggleMe(chars: MyCharacter[], p: LookupPayload, hosted: boolean): MyCharacter[] | null {
  if (isMe(chars, p)) return chars.filter((c) => !sameCharacter(c, p));
  if (hosted || chars.length >= MAX_ME) return null;
  return [...chars, { name: p.character.name, realm: p.character.realmSlug, region: p.character.region, source: "manual" }];
}

/** "This is me". Hosted, a character not on the list gets no chip at all (canvas "bnet", choice 1). */
export function meChip(t: T, chars: MyCharacter[], p: LookupPayload, hosted: boolean): { label: string; on: boolean; disabled: boolean; title?: string } | null {
  if (isMe(chars, p)) return { label: t("self.head.meOn"), on: true, disabled: false };
  if (hosted) return null;
  if (chars.length >= MAX_ME) return { label: t("self.head.me"), on: false, disabled: true, title: t("self.head.meFull", { max: MAX_ME }) };
  return { label: t("self.head.me"), on: false, disabled: false };
}
