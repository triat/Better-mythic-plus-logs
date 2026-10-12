// The candidate profile (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md decisions 5–6,
// mockup docs/design/redesign/F-Synthese.dc.html): its URL state and the compact profile header.
import { CLASS_NAMES, classHex } from "@shared/wow/classes.ts";
import type { LookupPayload, UiEvent } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { heroStats } from "./axes.ts";
import { realmName, rioHref } from "./format.ts";
import { verdictView } from "./verdict.ts";

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

/** Switching profile in place (Récents, the palette, a lookup): the tab stays, the run and the sheet belonged to the
 * previous profile and go. */
export const candSwitchHref = (key: string, search: string): string => candHref(key, { tab: candState(search).tab });

/** The state a profile opens with: the URL's, without a run this payload does not hold (a link from another lookup of
 * the same character, a URL left behind by a profile switch). */
export function candInitial(search: string, runKeys: readonly string[]): CandState {
  const s = candState(search);
  return s.run !== null && !runKeys.includes(s.run) ? { ...s, run: null, sheet: false } : s;
}

/** "<report code>:<fight id>", the key of a run in `CandState.run`. */
export const runKeyOf = (r: { reportCode: string; fightID: number }): string => `${r.reportCode}:${r.fightID}`;

/** The tab strip's keyboard (WAI-ARIA tabs): ← → wrap around, Home / End jump; null for any other key. */
export function tabAfter(tab: CandTab, key: string): CandTab | null {
  const i = CAND_TABS.indexOf(tab);
  const n = CAND_TABS.length;
  if (key === "ArrowRight") return CAND_TABS[(i + 1) % n]!;
  if (key === "ArrowLeft") return CAND_TABS[(i - 1 + n) % n]!;
  if (key === "Home") return CAND_TABS[0]!;
  if (key === "End") return CAND_TABS[n - 1]!;
  return null;
}

/** The usage event a tab click counts (catalogue `src/hosted/usage-catalog.ts`). */
export const CAND_TAB_EVENT = {
  synthesis: "cand_tab_synthesis", runs: "cand_tab_runs", dungeons: "cand_tab_dungeons", method: "cand_tab_method",
} as const satisfies Record<CandTab, UiEvent>;

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

export function profileHeader(t: T, _locale: Locale, p: LookupPayload): ProfileHeaderView {
  const c = p.character;
  const ev = p.evaluation;
  const v = verdictView(t, ev, p.targetAutoDetected);
  const token = classToken(c.classID);
  const klass = CLASS_NAMES[c.classID] ?? t("cand.header.unknownClass", { id: String(c.classID) });
  const rioScore = p.rio?.seasons[0]?.all;
  const scoreLabel = t("verdict.stats.score", { metric: p.metric.toUpperCase() });
  const facts: HeaderFact[] = [
    ...(typeof rioScore === "number" ? [{ label: t("cand.header.rio"), value: rioScore.toFixed(0) }] : []),
    // The WCL metric score stays on the Méthode / Runs side: the header keeps Raider.IO's, as the mockup does.
    ...heroStats(t, p).filter((s) => s.label !== scoreLabel),
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
    facts,
    links: { rio: rioHref(p.rio?.profileUrl), wcl: wclCharacterUrl(c.region, c.realmSlug, c.name) },
    meta,
    runCount: p.perDungeon.runs.length,
  };
}
