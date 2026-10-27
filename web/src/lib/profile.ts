// The candidate profile (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md decisions 5–6,
// mockup docs/design/redesign/F-Synthese.dc.html): its URL state and the compact profile header.
import { CLASS_NAMES, classHex } from "@shared/wow/classes.ts";
import type { LookupPayload, SeasonView, UiEvent } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { heroStats } from "./axes.ts";
import { realmName, rioHref } from "./format.ts";
import { headLine } from "./self.ts";
import { verdictView } from "./verdict.ts";
import { isLowReliability, type Thresholds } from "./reliability.ts";

export type CandTab = "synthesis" | "runs" | "dungeons" | "method";
export const CAND_TABS: readonly CandTab[] = ["synthesis", "runs", "dungeons", "method"];
/** `run` is "<report code>:<fight id>"; `sheet` (the wide run sheet) only ever goes with a run. */
export interface CandState { tab: CandTab; run: string | null; sheet: boolean }

const isTab = (v: string | null): v is CandTab => v !== null && (CAND_TABS as readonly string[]).includes(v);
const RUN = /^[^:]+:\d+$/;

/** The profile's state read from a query string: an unknown tab is the Synthèse, a malformed run none, a sheet without run closed. */
export function candState(search: string): CandState {
  const p = new URLSearchParams(search);
  const tab = p.get("tab");
  const raw = p.get("run");
  const run = raw !== null && RUN.test(raw) ? raw : null;
  return { tab: isTab(tab) ? tab : "synthesis", run, sheet: run !== null && p.get("sheet") === "1" };
}

/** `/candidate?open=<key>[&tab=…][&run=…][&sheet=1]`, defaults left out. */
export function candHref(key: string, s: Partial<CandState>): string {
  const p = new URLSearchParams({ open: key });
  if (s.tab && s.tab !== "synthesis") p.set("tab", s.tab);
  if (s.run) {
    p.set("run", s.run);
    if (s.sheet) p.set("sheet", "1");
  }
  return `/candidate?${p}`;
}

/** The history key the URL names (`open`), or null. */
export const candOpen = (search: string): string | null => new URLSearchParams(search).get("open");

/**
 * Landing on the profile `key` in place (Récents, the palette, a lookup, Refresh): the same profile keeps the whole
 * state, run and sheet included; another one keeps the tab, and the run and sheet only when `sameCharacter` (a
 * re-evaluation of this character for another key level: `candInitial` then drops a run the new payload lacks).
 * Written before the new key is shown, so the profile that mounts reads its own URL.
 */
export function candSwitchHref(key: string, search: string, sameCharacter = false): string {
  const s = candState(search);
  if (candOpen(search) === key || sameCharacter) {
    // The owner page's "form" tab reads as the default here, and "form" is the owner page's default too; `as=vetting`
    // stays on the same profile (Refresh while a member looks at their own vetting profile) and on the same character's
    // new key (re-evaluating their own vetting profile at another key level).
    const href = candHref(key, s);
    return isVetting(search) ? `${href}&${VETTING}` : href;
  }
  return candHref(key, { tab: s.tab });
}

/** The state the profile `key` opens with: the URL's, with its run and sheet only when the URL names this profile
 * (`open`) and the payload holds that run (a link from another lookup of the same character, a URL left behind by a
 * profile switch). */
export function candInitial(search: string, key: string, runKeys: readonly string[]): CandState {
  const s = candState(search);
  return s.run !== null && (candOpen(search) !== key || !runKeys.includes(s.run)) ? { ...s, run: null, sheet: false } : s;
}

// The owner page (redesign phase 3, plan docs/superpowers/plans/2026-10-12-ui-redesign-phase-3.md task 1): the member's
// own character on the same URL, `/candidate?open=<key>&tab=form|dungeons|runs[&run=<report:fight>][&as=vetting]`.
// `as=vetting` shows the member their own vetting profile (`CandidateProfile`, whose tab is then a `CandTab` in the
// same `tab` parameter). "runs" and "dungeons" mean the same in both views; "synthesis" / "method" on an owner page
// read as "form", "form" on the vetting profile as its "synthesis".

export type OwnerTab = "form" | "dungeons" | "runs";
export const OWNER_TABS: readonly OwnerTab[] = ["form", "dungeons", "runs"];
/** `vetting`: the member looks at their own vetting profile (`as=vetting`). */
export interface OwnerState { tab: OwnerTab; run: string | null; vetting: boolean }

const VETTING = "as=vetting";
const isOwnerTab = (v: string | null): v is OwnerTab => v !== null && (OWNER_TABS as readonly string[]).includes(v);
const isVetting = (search: string): boolean => new URLSearchParams(search).get("as") === "vetting";

/** The owner page's state for the profile `key`: an unknown or candidate-only tab is "form"; the run follows
 * `candInitial`'s rule (kept only when `open` is `key` and `runKeys` — the season's runs — holds it). */
export function ownerState(search: string, key: string, runKeys: readonly string[]): OwnerState {
  const p = new URLSearchParams(search);
  const tab = p.get("tab");
  const raw = p.get("run");
  const run = raw !== null && RUN.test(raw) && candOpen(search) === key && runKeys.includes(raw) ? raw : null;
  return { tab: isOwnerTab(tab) ? tab : "form", run, vetting: isVetting(search) };
}

/** `/candidate?open=<key>[&tab=…][&run=…][&as=vetting]`, defaults left out. With `vetting`, a "form" tab is left out
 * (the vetting profile then opens on its Synthèse). */
export function ownerHref(key: string, s: Partial<OwnerState>): string {
  const p = new URLSearchParams({ open: key });
  if (s.tab && s.tab !== "form") p.set("tab", s.tab);
  if (s.run) p.set("run", s.run);
  if (s.vetting) p.set("as", "vetting");
  return `/candidate?${p}`;
}

/** The member's own vetting profile's URL (`CandidateProfile` writing its state while `as=vetting`). */
export const vettingHref = (key: string, s: Partial<CandState>): string => `${candHref(key, s)}&${VETTING}`;

/** Switching between the owner view and its vetting profile (`toVetting`): the tab is kept when the target view has
 * it ("runs", "dungeons"), else that view's default; the run and the sheet are dropped. */
export function viewSwitchHref(key: string, search: string, toVetting: boolean): string {
  const tab = new URLSearchParams(search).get("tab");
  if (toVetting) return vettingHref(key, { tab: isTab(tab) ? tab : "synthesis" });
  return ownerHref(key, { tab: isOwnerTab(tab) ? tab : "form" });
}

/** The owner tab strip's keyboard: ← → wrap around, Home / End jump; null for any other key. */
export const ownerTabAfter = (tab: OwnerTab, key: string): OwnerTab | null => stepTab(OWNER_TABS, tab, key);

/** "<report code>:<fight id>", the key of a run in `CandState.run`. */
export const runKeyOf = (r: { reportCode: string; fightID: number }): string => `${r.reportCode}:${r.fightID}`;

/** A tab strip's keyboard (WAI-ARIA tabs) over `tabs`: ← → wrap around, Home / End jump; null for any other key. */
function stepTab<K extends string>(tabs: readonly K[], tab: K, key: string): K | null {
  const i = tabs.indexOf(tab);
  const n = tabs.length;
  if (key === "ArrowRight") return tabs[(i + 1) % n]!;
  if (key === "ArrowLeft") return tabs[(i - 1 + n) % n]!;
  if (key === "Home") return tabs[0]!;
  if (key === "End") return tabs[n - 1]!;
  return null;
}

/** The candidate tab strip's keyboard: ← → wrap around, Home / End jump; null for any other key. */
export const tabAfter = (tab: CandTab, key: string): CandTab | null => stepTab(CAND_TABS, tab, key);

/** The usage event a tab click counts (catalogue `src/hosted/usage-catalog.ts`). */
export const CAND_TAB_EVENT = {
  synthesis: "cand_tab_synthesis", runs: "cand_tab_runs", dungeons: "cand_tab_dungeons", method: "cand_tab_method",
} as const satisfies Record<CandTab, UiEvent>;

/** The usage event an owner tab click counts (catalogue `src/hosted/usage-catalog.ts`). */
export const OWNER_TAB_EVENT = {
  form: "owner_tab_form", dungeons: "owner_tab_dungeons", runs: "owner_tab_runs",
} as const satisfies Record<OwnerTab, UiEvent>;

/** The compare page with this profile ticked. */
export const compareHref = (key: string): string => `/compare?${new URLSearchParams({ pick: key })}`;

export interface HeaderFact { label: string; value: string; sub?: string }
export interface ProfileHeaderView {
  name: string;
  classId: number;
  classColor: string;
  /** Wowhead's class icon; null for an unknown class. The component falls back to `initials` when it fails to load. */
  iconUrl: string | null;
  initials: string;
  /** "Devourer Demon Hunter · DPS · Hyjal (EU)". */
  line: string;
  verdict: { cls: string; label: string; score: string | null; target: string };
  /** "low reliability" (canvas "bmpl · Verdict à ton niveau", C): the level is unproven or one run decides; null otherwise. */
  lowReliability: string | null;
  facts: HeaderFact[];
  links: { rio: string | null; wcl: string };
  /** Zone · runs indexed · metric auto-selected · spec filter (the old VerdictHero metaline). */
  meta: string;
  runCount: number;
}

/** "Death Knight" → "deathknight", the token of Wowhead's `classicon_<token>.jpg`. */
export const classToken = (classId: number): string | null => CLASS_NAMES[classId]?.toLowerCase().replace(/\s+/g, "") ?? null;

/** "Death Knight" → "DK", "Hunter" → "Hu": the 2-letter tile behind a missing icon. */
export function classInitials(classId: number): string {
  const name = CLASS_NAMES[classId];
  if (!name) return "?";
  const words = name.split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]!).join("").slice(0, 2).toUpperCase() : name.slice(0, 2);
}

/** Warcraft Logs' character page. */
export const wclCharacterUrl = (region: string, realmSlug: string, name: string): string =>
  `https://www.warcraftlogs.com/character/${encodeURIComponent(region.toLowerCase())}/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name.toLowerCase())}`;

/** WCL's spacing-free spec names read with spaces: "BeastMastery" → "Beast Mastery". */
export const specWords = (spec: string): string => spec.replace(/([a-z])([A-Z])/g, "$1 $2");

/** `th`: the verdict thresholds from GET /api/docs; without them (docs not loaded yet) the reliability chip waits. */
export function profileHeader(t: T, _locale: Locale, p: LookupPayload, th: Thresholds | null = null): ProfileHeaderView {
  const c = p.character;
  const ev = p.evaluation;
  const v = verdictView(t, ev, p.targetAutoDetected);
  const token = classToken(c.classID);
  const klass = CLASS_NAMES[c.classID] ?? t("cand.header.unknownClass", { id: String(c.classID) });
  const rioScore = p.rio?.seasons[0]?.all;
  const ilvlLabel = t("verdict.stats.ilvl");
  const stats = heroStats(t, p);
  const facts: HeaderFact[] = [
    ...(typeof rioScore === "number" ? [{ label: t("cand.header.rio"), value: rioScore.toFixed(0) }] : []),
    // The item level first, then the WCL metric score ("DPS score") right before the region / server ranks it holds.
    ...stats.filter((s) => s.label === ilvlLabel),
    ...stats.filter((s) => s.label !== ilvlLabel),
    ...(p.rio ? [{ label: t("cand.header.last7d"), value: String(p.rio.derived.runsLast7d) }] : []),
  ];
  const other = p.metric === "hps" ? "dps" : "hps";
  const meta = [
    `${p.zone.name} · ${t("cand.header.runsIndexed", { count: p.runsIndexed })}`
      + (p.metricAutoSelected && p.alternateMetricHasData ? t("verdict.metricAuto", { other }) : ""),
    ...(p.specFilter ? [t("verdict.filter", { spec: p.specFilter })] : []),
  ].join(" · ");
  return {
    name: c.name,
    classId: c.classID,
    classColor: classHex(c.classID),
    iconUrl: token ? `https://wow.zamimg.com/images/wow/icons/medium/classicon_${token}.jpg` : null,
    initials: classInitials(c.classID),
    line: t("cand.header.line", {
      spec: c.spec ? `${specWords(c.spec)} ${klass}` : klass,
      role: t(`cand.header.role.${ev.role}`),
      realm: realmName(c.realmSlug),
      region: c.region.toUpperCase(),
    }),
    verdict: { cls: v.cls, label: v.label, score: v.score, target: t("cand.header.target", { level: String(ev.targetLevel) }) },
    lowReliability: th && isLowReliability(ev, th) ? t("cand.rel.lowChip") : null,
    facts,
    links: { rio: rioHref(p.rio?.profileUrl), wcl: wclCharacterUrl(c.region, c.realmSlug, c.name) },
    meta,
    runCount: p.perDungeon.runs.length,
  };
}

export interface OwnerHeaderView {
  /** Name, class colour, icon, links: the candidate header's. */
  head: ProfileHeaderView;
  /** "Elemental Shaman · Hyjal (EU) · 94 runs this season · checked 2 h ago" (the season part once it is loaded). */
  line: string;
  /** The Runs tab's count: the season's runs; null while the season loads. */
  runCount: number | null;
}

/** The owner page's header (redesign phase 3, mockup F-Moi-Forme): the candidate header's identity, the season line. */
export function ownerHeader(t: T, locale: Locale, p: LookupPayload, season: SeasonView | null, now = Date.now()): OwnerHeaderView {
  const head = profileHeader(t, locale, p);
  const c = p.character;
  const klass = CLASS_NAMES[c.classID] ?? t("cand.header.unknownClass", { id: String(c.classID) });
  const base = t("owner.header.line", {
    spec: c.spec ? `${specWords(c.spec)} ${klass}` : klass, realm: realmName(c.realmSlug), region: c.region.toUpperCase(),
  });
  return { head, line: season ? `${base} · ${headLine(t, season, now)}` : base, runCount: season ? season.runs.length : null };
}
