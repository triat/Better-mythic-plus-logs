// The run sheet (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md decision 7, mockup
// docs/design/redesign/F-Run.dc.html): the wide dialog over the candidate page, the run list dimmed at its left, the run's
// detail (`runView.ts`) and timeline (`timeline.ts`). Here: which runs the left list shows, the layout for a viewport
// width, the focus trap's wrap, and the two tabs under the detail.
import type { LookupPayload } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import type { ParseTier } from "./format.ts";
import { runListView } from "./runList.ts";

export interface SheetRunRow {
  /** "<report code>:<fight id>". */
  key: string;
  abbr: string;
  name: string;
  level: string;
  /** "3 deaths": `pass` from two deaths (mockup), `dim` with none or without signals. */
  deaths: { text: string; tone: "pass" | "neutral" | "dim" };
  parse: { text: string; tier: ParseTier | null };
  on: boolean;
}

/** The left list: the Runs tab's default view (best run per dungeon, best parse first), the shown run marked. */
export function sheetRuns(t: T, locale: Locale, p: LookupPayload, selected: string | null, now = Date.now()): SheetRunRow[] {
  const byKey = new Map(p.perDungeon.runs.map((r) => [`${r.reportCode}:${r.fightID}`, r]));
  return runListView(t, locale, p, "best", "parse", now).rows.map((row) => {
    const n = byKey.get(row.key)?.signals?.deaths.count ?? null;
    return {
      key: row.key, abbr: row.abbr, name: row.dungeon, level: row.level, parse: row.parse, on: row.key === selected,
      deaths: n === null
        ? { text: "—", tone: "dim" }
        : { text: t("runs.deaths", { count: n }), tone: n >= 2 ? "pass" : n === 1 ? "neutral" : "dim" },
    };
  });
}

/** Panel width: `min(100vw, max(960px, 72vw))` (spec decision 7). */
export const SHEET_MIN_PX = 960;
export const SHEET_SHARE = 0.72;
/** The dimmed run list needs at least this much room at the left of the panel. */
export const SHEET_LIST_MIN_PX = 240;

/** `panel` in px; `list`: the dimmed run list fits at its left; `full`: the panel takes the whole width. */
export function sheetLayout(viewport: number): { panel: number; list: boolean; full: boolean } {
  const panel = Math.min(viewport, Math.max(SHEET_MIN_PX, Math.round(viewport * SHEET_SHARE)));
  return { panel, list: viewport - panel >= SHEET_LIST_MIN_PX, full: panel >= viewport };
}

/**
 * The focus trap's wrap: `index` of the focused element among the dialog's `count` focusable ones (-1: focus is
 * outside). Returns the index to move to, or null to let the browser's own Tab order run.
 */
export function trapFocus(index: number, count: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (index < 0) return shift ? count - 1 : 0;
  if (!shift && index === count - 1) return 0;
  if (shift && index === 0) return count - 1;
  return null;
}

/** Where the keyboard is while the sheet is open: inside it, on nothing (the page's body — a click on plain text), or
 * in something else (another dialog over it, such as the palette). */
export type SheetFocus = "inside" | "none" | "outside";

/**
 * What the sheet does with a key it hears on the document: Escape closes it, or, while a field inside is being edited
 * (`editing`: a table edit in progress), only leaves that field; Tab wraps; null for anything else or when another
 * dialog holds the focus.
 */
export function sheetKey(key: string, focus: SheetFocus, editing: boolean): "close" | "leave-field" | "trap" | null {
  if (focus === "outside") return null;
  if (key === "Escape") return focus === "inside" && editing ? "leave-field" : "close";
  if (key === "Tab") return "trap";
  return null;
}

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"]);
/** A text field, a text area or a list box (an `<input>` that takes typing, not a checkbox or a button). */
export const isEditingField = (tag: string, type: string | null): boolean => {
  const t = tag.toUpperCase();
  return t === "TEXTAREA" || t === "SELECT" || (t === "INPUT" && !NOT_TEXT.has((type ?? "text").toLowerCase()));
};

export type SheetTab = "spells" | "avoidable";
export const SHEET_TABS: readonly SheetTab[] = ["spells", "avoidable"];

/** ← → (Home / End) on the sheet's tab strip; null: not a tab key. */
export function sheetTabAfter(tab: SheetTab, key: string): SheetTab | null {
  const i = SHEET_TABS.indexOf(tab);
  const n = SHEET_TABS.length;
  if (key === "ArrowRight") return SHEET_TABS[(i + 1) % n]!;
  if (key === "ArrowLeft") return SHEET_TABS[(i - 1 + n) % n]!;
  if (key === "Home") return SHEET_TABS[0]!;
  if (key === "End") return SHEET_TABS[n - 1]!;
  return null;
}
