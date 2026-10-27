import type { T } from "../i18n/t.ts";
import type { HistoryItem, LookupPayload } from "../types.ts";
import type { MenuItem } from "./header.ts";
import { spreadOf, unprovenOf } from "./reliability.ts";

export const MAX_COMPARE = 5;

/**
 * `/compare?pick=a&pick=b…`: every `pick` param in order, each kept only once and only when it is a history key, capped
 * at MAX_COMPARE. The profile header's Compare (`?pick=<key>`) is the one-key case.
 */
export function compareKeys(search: string, existingKeys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of new URLSearchParams(search).getAll("pick")) {
    if (out.length >= MAX_COMPARE) break;
    if (existingKeys.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** "?pick=a&pick=b", or "" for an empty selection (URLSearchParams, so JSON keys are encoded). */
export function compareSearch(keys: readonly string[]): string {
  if (keys.length === 0) return "";
  const params = new URLSearchParams();
  for (const k of keys) params.append("pick", k);
  return `?${params}`;
}

/** Appends a key unless it is already there or the selection is full (then unchanged). */
export function addPick(selected: readonly string[], key: string): string[] {
  if (selected.includes(key) || selected.length >= MAX_COMPARE) return [...selected];
  return [...selected, key];
}

/** The "+ Add a candidate" menu: the history entries not selected, newest first (hint "+18 · 77"). */
export function pickMenu(t: T, items: readonly HistoryItem[], selected: readonly string[]): MenuItem[] {
  return items
    .filter((it) => !selected.includes(it.key))
    .map((it, i) => ({ it, i }))
    .sort((a, b) => b.it.fetchedAt - a.it.fetchedAt || a.i - b.i)
    .map(({ it }) => ({
      value: it.key,
      label: it.label,
      hint: it.score === null
        ? t("compare.pick.itemLevel", { level: it.targetLevel })
        : t("compare.pick.itemHint", { level: it.targetLevel, score: Math.round(it.score) }),
      on: false,
    }));
}

export const pruneSelection = (selected: string[], existingKeys: string[]): string[] =>
  selected.filter((k) => existingKeys.includes(k));

/**
 * The history list with the entry `key` carrying the verdict and score of its loaded payload. The server re-evaluates
 * a history entry on read with today's rules (and updates its row), so Récents follows without a reload. Same array
 * when nothing changes.
 */
export function withPayloadSummary(items: HistoryItem[], key: string, payload: Pick<LookupPayload, "evaluation">): HistoryItem[] {
  const ev = payload.evaluation;
  const verdict = ev.verdict === "insufficient" ? null : ev.verdict;
  const score = ev.global;
  const spread = spreadOf(ev);
  const unproven = unprovenOf(ev);
  const i = items.findIndex((it) => it.key === key);
  const it = items[i];
  if (!it || (it.verdict === verdict && it.score === score && (it.spread ?? null) === spread && (it.unproven ?? null) === unproven)) return items;
  return items.map((x, j) => (j === i ? { ...x, verdict, score, spread, unproven } : x));
}
