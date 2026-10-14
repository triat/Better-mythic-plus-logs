// Mes personnages (redesign phase 3, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md decision 11, mockup
// docs/design/redesign/F-Persos.dc.html): the characters with a season as cards two per row (the main first, in the
// member's own list order), the others as a compact group below, the filter chips, and each card's actions — Open,
// the sync with its cost, Raider.IO, and a "⋯" menu (make main, move up, remove). Battle.net rules are unchanged: hosted,
// the list only comes from Battle.net (no add field), a member may still reorder or remove. Pure: no React, no fetch.
import { classHex, className } from "@shared/wow/classes.ts";
import type { HistoryItem, MyCharacter, OwnClientView, PillarKey, SeasonView } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { fmtAge, fmtPts, realmName, signed } from "./format.ts";
import { candidateHref } from "./hostedMode.ts";
import { historyKeyFor, lookupQuery } from "./me.ts";
import { classInitials, specWords } from "./profile.ts";
import { MAX_ME, PILLAR_ORDER, syncCard, workOnRows } from "./self.ts";

export type CharsFilter = "all" | "season" | "none";
export const CHARS_FILTERS: readonly CharsFilter[] = ["all", "season", "none"];
export type CharAction = "main" | "up" | "remove";
/** A character's season request: answered, not answered yet, or failed (`useSeason`'s `loading` / `failed`). */
export type SeasonLoad = "ok" | "loading" | "failed";
/** Score bars: blue ≥ 70, neutral 50–69, orange < 50 (the 50 tick drawn by the bar); `na` without a score. */
export type BarBand = "better" | "neutral" | "worse" | "na";
export const barBand = (v: number | null): BarBand => (v === null ? "na" : v >= 70 ? "better" : v >= 50 ? "neutral" : "worse");

/** Identity of a character in the list (the server's `characterKey`): region, then realm and name, case-insensitive. */
export const charKey = (c: { name: string; realm: string; region: string }): string =>
  `${c.region}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;

export interface CharLink { href: string; label: string; /** Why it costs nothing, or that a lookup spends points (the title). */ hint: string }
export interface CharMenuItem { action: CharAction; label: string; danger: boolean }

export interface CharCard {
  key: string;
  /** Position in the member's list: what `makeMain` / `moveUp` / `removeAt` take. */
  index: number;
  name: string;
  /** "Elemental Shaman · Hyjal EU"; the class and spec come from the character's newest history entry. */
  sub: string;
  initials: string;
  /** The class colour; null when no history entry tells the class. */
  classColor: string | null;
  main: boolean;
  /** The window's overall (last 4 weeks, else the season), "—" without one. */
  global: string;
  bars: { key: PillarKey; label: string; value: number | null; text: string; band: BarBand }[];
  /** "94 runs this season · up to date" / "33 runs · 25 not analysed · checked 7h ago". */
  line: string;
  /** The first point to work on with its cost; else what the pillars are computed on. */
  /** `hint`: the point to work on's plain-language explanation, for the `title` tooltip (null otherwise). */
  note: { text: string; tone: "worse" | "neutral"; hint: string | null };
  open: CharLink;
  /** "Sync 25 runs · ~335 pts"; null when nothing is pending, or hosted without a usable own client. */
  sync: string | null;
  /** Hosted without a usable own client: the sync needs one (the page links to Settings). */
  noClient: boolean;
  rio: string;
  /** The last `GET /api/season` failed: the card shows the season it had and says the reload failed; null otherwise. */
  status: string | null;
  menu: CharMenuItem[];
}

export interface CharCompact {
  key: string;
  index: number;
  name: string;
  /** "Nerzhul EU". */
  realm: string;
  initials: string;
  classColor: string | null;
  main: boolean;
  /** Open (history entry, 0 pts) or Look up (fills the search field). */
  search: CharLink;
  /** Its season is still loading, or could not be loaded: said on the row instead of "no season yet"; null otherwise. */
  status: string | null;
  menu: CharMenuItem[];
}

export interface CharactersView {
  withSeason: CharCard[];
  without: CharCompact[];
  counts: { all: number; season: number; none: number };
  filters: { id: CharsFilter; label: string; n: number }[];
  /** "13 / 20 characters tracked". */
  tracked: string;
  /** "With a season · 2". */
  seasonTitle: string;
  /** "No season yet · 11" and its hint. */
  noneTitle: string;
  noneHint: string;
  /** Local mode only, below the limit: the manual add field. Hosted, characters come from Battle.net. */
  canAdd: boolean;
}

export interface CharactersInput {
  list: MyCharacter[];
  /** Each character's season (`GET /api/season`, 0 pts), null when none is stored or it is not loaded. */
  seasonOf: (c: MyCharacter, index: number) => SeasonView | null;
  /** Where its `GET /api/season` stands; "ok" when omitted. */
  loadOf?: (c: MyCharacter, index: number) => SeasonLoad;
  history: HistoryItem[];
  hosted: boolean;
  ownClient: OwnClientView | null;
  /**
   * A sub-signal's name (`sourceTitleOf(t, docs)`), null to leave it out: the note then never prints the raw source
   * key ("survival.wipeDeaths").
   */
  titleOf: ((source: string) => string) | null;
  now?: number;
}

function menuOf(t: T, index: number): CharMenuItem[] {
  // The main is never removed (make another character main first), as on the /me page before the redesign.
  const actions: CharAction[] = index === 0 ? [] : index === 1 ? ["main", "remove"] : ["main", "up", "remove"];
  return actions.map((action) => ({ action, label: t(`chars.menu.${action}`), danger: action === "remove" }));
}

function openOf(t: T, c: MyCharacter, history: HistoryItem[]): CharLink {
  const key = historyKeyFor(history, c);
  return key
    ? { href: candidateHref(key), label: t("chars.open"), hint: t("chars.fromHistory") }
    : { href: `/?q=${encodeURIComponent(lookupQuery(c))}`, label: t("chars.lookUp"), hint: t("chars.notInHistory") };
}

const realmLine = (c: MyCharacter): string => `${realmName(c.realm)} ${c.region.toUpperCase()}`;

function lineOf(t: T, season: SeasonView, now: number): string {
  const s = season.state;
  if (s.pending === 0) return t("chars.line.upToDate", { count: s.runs });
  return t("chars.line.pending", { count: s.runs, pending: s.pending })
    + (season.checkedAt !== null ? t("chars.line.checked", { age: fmtAge(t, season.checkedAt, now) }) : "");
}

function noteOf(t: T, locale: Locale, season: SeasonView, titleOf: ((source: string) => string) | null): CharCard["note"] {
  // A title equal to its source is the resolver's "unknown" fallback: never shown either.
  const known = (source: string): string => {
    const title = titleOf?.(source) ?? "";
    return title === source ? "" : title;
  };
  const first = workOnRows(t, locale, null, season, known)[0];
  const w = season.workOn[0];
  if (first && w) {
    const vars = { title: first.title, detail: first.detail, impact: signed(w.impact) };
    return { text: t(first.title ? "chars.note.workOn" : "chars.note.workOnUntitled", vars), tone: "worse", hint: first.title ? first.hint : null };
  }
  const window = season.recent ?? season.season;
  return { text: window ? t("chars.note.basis", { count: window.runs }) : t("chars.note.few"), tone: "neutral", hint: null };
}

export function characterCards(t: T, locale: Locale, input: CharactersInput): CharactersView {
  const { list, history, hosted, ownClient, titleOf } = input;
  const now = input.now ?? Date.now();
  const withSeason: CharCard[] = [];
  const without: CharCompact[] = [];
  list.forEach((c, index) => {
    const key = historyKeyFor(history, c);
    const item = key ? history.find((h) => h.key === key) ?? null : null;
    const classID = item?.charClass ?? null;
    const base = {
      key: charKey(c),
      index,
      name: c.name,
      initials: classID !== null ? classInitials(classID) : c.name.slice(0, 2),
      classColor: classID !== null ? classHex(classID) : null,
      main: index === 0,
      menu: menuOf(t, index),
    };
    const season = input.seasonOf(c, index);
    const load = input.loadOf?.(c, index) ?? "ok";
    const status = load === "ok" ? null : t(`chars.status.${load}`);
    if (!season || season.runs.length === 0) {
      // A season that failed or is still loading is not "no season yet": the row says so instead.
      without.push({ ...base, realm: realmLine(c), search: openOf(t, c, history), status: season ? null : status });
      return;
    }
    const window = season.recent ?? season.season;
    const sync = syncCard(t, season, hosted, ownClient);
    const who = classID !== null ? [item?.spec ? specWords(item.spec) : null, className(classID)].filter(Boolean).join(" ") : null;
    withSeason.push({
      ...base,
      sub: [who, realmLine(c)].filter(Boolean).join(" · "),
      global: window?.overall != null ? String(window.overall) : "—",
      bars: PILLAR_ORDER.map((k) => {
        const value = window?.pillars.find((p) => p.key === k)?.score ?? null;
        return { key: k, label: t(`self.pillars.${k}`), value, text: value === null ? "—" : String(value), band: barBand(value) };
      }),
      line: lineOf(t, season, now),
      note: noteOf(t, locale, season, titleOf),
      open: openOf(t, c, history),
      sync: sync.kind === "ready" ? t("chars.sync", { start: sync.start, pts: fmtPts(season.state.estimate) }) : null,
      noClient: sync.kind === "noClient",
      rio: lookupQuery(c),
      status: load === "failed" ? status : null,
    });
  });
  const counts = { all: list.length, season: withSeason.length, none: without.filter((x) => x.status === null).length };
  return {
    withSeason,
    without,
    counts,
    filters: CHARS_FILTERS.map((id) => ({ id, label: t(`chars.filter.${id}`), n: counts[id] })),
    tracked: t("chars.tracked", { n: list.length, max: MAX_ME }),
    seasonTitle: t("chars.group.season", { n: counts.season }),
    noneTitle: t("chars.group.none", { n: counts.none }),
    noneHint: t("chars.group.noneHint"),
    canAdd: !hosted && list.length < MAX_ME,
  };
}

/** The filter chips: "with a season" hides the compact group, "without" hides the cards. The order is the list's. */
export const filterCards = (v: CharactersView, filter: CharsFilter): { withSeason: CharCard[]; without: CharCompact[] } => ({
  withSeason: filter === "none" ? [] : v.withSeason,
  without: filter === "season" ? [] : v.without,
});

/**
 * Whether every character's season answer is in (`GET /api/season`, 0 pts): until then the page shows a loading line
 * rather than groups, since a character whose season is not loaded yet would sit in the compact group and then jump.
 */
export const seasonsLoaded = (list: MyCharacter[], loaded: (key: string) => boolean): boolean =>
  list.every((c) => loaded(charKey(c)));

/** Only the first load hides the list: once shown, a character added later (or a Battle.net pick) loads in its row
 * while the other cards stay. */
export const listShown = (shownBefore: boolean, loaded: boolean): boolean => shownBefore || loaded;

/** The "⋯" menu's arrow keys: ↓ / ↑ wrap, Home / End jump; null for any other key. */
export function menuStep(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
