// The Ctrl K command palette (redesign spec decision 1, mockup F-Palette). Pure: no React, no fetch. Every row comes
// from what the page already holds (history, My characters, the search suggestions): opening the palette costs nothing,
// and a lookup row never shows a point estimate (the cost is not known before the fetch).
import type { T } from "../i18n/t.ts";
import type { HistoryItem, MyCharacter, Region } from "../types.ts";
import { realmName } from "./format.ts";
import { historyKeyFor, parseEntry, slugOf } from "./me.ts";
import { regionLabel } from "./regions.ts";
import { classLine, matchSuggestions, type Suggestion } from "./suggest.ts";

export type PaletteAction = { kind: "open"; historyKey: string } | { kind: "lookup"; fill: string; region: Region } | { kind: "go"; href: string };
export interface PaletteRow {
  /** Unique across sections (React key). */
  id: string;
  label: string;
  detail: string;
  /** The right-hand text: "INVITE 77" for a recent candidate, "Open · 0 pts" / "Look up" for a character, "" for an action. */
  hint: string;
  /** Colours the hint and the dot; null for a character never evaluated and for actions. */
  verdict: "invite" | "maybe" | "pass" | null;
  /** The class colour of the row's avatar; null when unknown and for actions. */
  classId: number | null;
  action: PaletteAction;
}
export interface PaletteSection { title: string; rows: PaletteRow[] }
export interface PaletteSources {
  /** `suggestionsOf(characters, history, known)`: one row per character, best first. */
  suggestions: Suggestion[];
  /** My characters, the main first. */
  mine: MyCharacter[];
  /** History, newest first (`GET /api/history`). */
  history: HistoryItem[];
  /** The region a typed Name-Realm is looked up in (the region chip's). */
  region: Region;
}

export const PALETTE_RECENT_MAX = 5;
export const PALETTE_MINE_MAX = 5;

const ACTIONS = [
  { key: "compare", href: "/compare" },
  { key: "live", href: "/live" },
  { key: "help", href: "/help" },
  { key: "me", href: "/me" },
] as const;

const fold = (s: string): string => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const where = (realm: string, region: Region): string => `${realm} (${regionLabel(region)})`;
const join = (...parts: string[]): string => parts.filter(Boolean).join(" · ");

function characterRow(t: T, prefix: string, s: Suggestion): PaletteRow {
  return {
    id: `${prefix}:${s.id}`,
    label: s.name,
    detail: join(where(s.realm, s.region), classLine(s)),
    hint: s.historyKey ? t("palette.open") : t("palette.lookup"),
    verdict: null,
    classId: s.charClass,
    action: s.historyKey ? { kind: "open", historyKey: s.historyKey } : { kind: "lookup", fill: s.fill, region: s.region },
  };
}

function actionRows(t: T): PaletteRow[] {
  return ACTIONS.map((a) => ({
    id: `action:${a.key}`, label: t(`palette.actions.${a.key}`), detail: "", hint: "", verdict: null, classId: null,
    action: { kind: "go", href: a.href },
  }));
}

/** History, newest first, one row per character (its newest tab), with the verdict and score it got. */
function recentRows(t: T, s: PaletteSources): PaletteRow[] {
  const rows: PaletteRow[] = [];
  for (const h of s.history) {
    const sug = s.suggestions.find((x) => x.historyKey === h.key);
    if (!sug) continue;
    const word = h.verdict ? t(`verdict.words.${h.verdict}`) : null;
    rows.push({
      ...characterRow(t, "recent", sug),
      hint: word === null ? t("palette.open") : h.score === null ? word : `${word} ${Math.round(h.score)}`,
      verdict: h.verdict,
    });
    if (rows.length === PALETTE_RECENT_MAX) break;
  }
  return rows;
}

function mineRows(t: T, s: PaletteSources): PaletteRow[] {
  return s.mine.slice(0, PALETTE_MINE_MAX).map((c, i) => {
    const key = historyKeyFor(s.history, c);
    const sug = s.suggestions.find((x) => x.id === `${c.region}|${slugOf(c.realm)}|${c.name.toLowerCase()}`);
    const realm = sug?.realm ?? realmName(c.realm);
    return {
      id: `mine:${c.region}|${c.realm}|${c.name.toLowerCase()}`,
      label: c.name,
      detail: join(i === 0 ? t("palette.main") : "", where(realm, c.region)),
      hint: key ? t("palette.open") : t("palette.lookup"),
      verdict: null,
      classId: sug?.charClass ?? null,
      action: key ? { kind: "open", historyKey: key } : { kind: "lookup", fill: `${c.name}-${realmName(c.realm)}`, region: c.region },
    };
  });
}

/** The free-text fallback: a typed Name-Realm (the chip's region) or a Raider.IO link (its own region). */
function typedRow(t: T, q: string, s: PaletteSources): PaletteRow | null {
  const c = parseEntry(q, s.region);
  if (!c) return null;
  // matchSuggestions lists nothing once the field holds the full Name-Realm of a known character: open it if we can.
  const known = s.suggestions.find((x) => x.id === `${c.region}|${c.realm}|${c.name.toLowerCase()}`);
  if (known) return characterRow(t, "result", known);
  const realm = realmName(c.realm);
  return {
    id: `result:${c.region}|${c.realm}|${c.name.toLowerCase()}`,
    label: c.name,
    detail: where(realm, c.region),
    hint: t("palette.lookup"),
    verdict: null,
    classId: null,
    action: { kind: "lookup", fill: `${c.name}-${realm}`, region: c.region },
  };
}

/**
 * Empty query: recent characters (5), My characters (5, main first), the actions. Typed: one "Results" section — the
 * search suggestions that match (the field's own rule), else the typed Name-Realm / Raider.IO link as a lookup — then
 * the actions whose label starts with what is typed. No section is ever empty.
 */
export function paletteSections(t: T, q: string, s: PaletteSources): PaletteSection[] {
  const typed = q.trim();
  const sections: PaletteSection[] = [];
  if (!typed) {
    sections.push({ title: t("palette.recent"), rows: recentRows(t, s) });
    sections.push({ title: t("palette.mine"), rows: mineRows(t, s) });
    sections.push({ title: t("palette.actionsTitle"), rows: actionRows(t) });
  } else {
    const hits = matchSuggestions(s.suggestions, typed).map((x) => characterRow(t, "result", x));
    const fallback = hits.length === 0 ? typedRow(t, typed, s) : null;
    sections.push({ title: t("palette.results"), rows: fallback ? [fallback] : hits });
    const f = fold(typed);
    sections.push({ title: t("palette.actionsTitle"), rows: actionRows(t).filter((r) => fold(r.label).startsWith(f)) });
  }
  return sections.filter((x) => x.rows.length > 0);
}

const rowCount = (sections: PaletteSection[]): number => sections.reduce((n, x) => n + x.rows.length, 0);

/** The highlighted row after ↑ / ↓, over every row of every section, wrapping at both ends; 0 when there is none. */
export function moveIndex(sections: PaletteSection[], index: number, delta: 1 | -1): number {
  const n = rowCount(sections);
  return n === 0 ? 0 : (((index + delta) % n) + n) % n;
}

/** The row at a flat index across sections; null out of range. */
export function rowAt(sections: PaletteSection[], index: number): PaletteRow | null {
  if (index < 0) return null;
  let i = index;
  for (const x of sections) {
    if (i < x.rows.length) return x.rows[i]!;
    i -= x.rows.length;
  }
  return null;
}
