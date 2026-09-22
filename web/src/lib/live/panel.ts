// The Live panel's view model: the roster turned into rows the component renders (filtered, sorted,
// verdict/age attached) plus the auto-lookup queue. Pure; tested (panel.test.ts).
import type { T } from "../../i18n/t.ts";
import { fmtShortAge } from "../admin.ts";
import { LIVE_SORTS, filterApplicants, sortApplicants } from "./roster.ts";
import type { CachedVerdict, LiveRole, LiveSort, Roster, RosterPlayer } from "./roster.ts";

export interface PanelRow {
  player: RosterPlayer;
  verdict: CachedVerdict | null;
  /** `null` when there is no cached verdict yet — the row shows "not vetted yet" / "queued" / "you" instead. */
  ageLabel: string | null;
}

export interface PanelView {
  applicants: PanelRow[];
  party: PanelRow[];
  /** "showing {shown} of {total}" — `total` counts every applicant before the role/class filter. */
  countLine: string;
  hiddenCount: number;
}

interface PanelFilter {
  liveSort: LiveSort;
  liveRoles: readonly LiveRole[];
  liveClasses: readonly string[];
}

const toRow = (t: T, verdicts: Map<string, CachedVerdict>, now: number, player: RosterPlayer): PanelRow => {
  const verdict = verdicts.get(player.character) ?? null;
  return { player, verdict, ageLabel: verdict ? t("live.panel.vetted", { age: fmtShortAge(t, verdict.fetchedAt, now) }) : null };
};

/**
 * `applicants` is filtered then sorted (so `countLine` reports the filtered count); `party` — `kind ===
 * "party"` and the player's own `"self"` row together — is never filtered or sorted: it stays in the
 * roster's own order (the addon lists your group, not applicants).
 */
export function panelView(t: T, o: { roster: Roster; verdicts: Map<string, CachedVerdict>; settings: PanelFilter; now: number }): PanelView {
  const applicants = o.roster.players.filter((p) => p.kind === "applicant");
  const party = o.roster.players.filter((p) => p.kind === "party" || p.kind === "self");
  const filtered = filterApplicants(applicants, { roles: o.settings.liveRoles, classes: o.settings.liveClasses });
  const sorted = sortApplicants(filtered, o.settings.liveSort, (character) => o.verdicts.get(character) ?? null);
  return {
    applicants: sorted.map((p) => toRow(t, o.verdicts, o.now, p)),
    party: party.map((p) => toRow(t, o.verdicts, o.now, p)),
    countLine: t("live.panel.count", { shown: sorted.length, total: applicants.length }),
    hiddenCount: applicants.length - sorted.length,
  };
}

/**
 * The characters an auto-lookup should fetch next, oldest first (lowest roster index — see
 * `RosterPlayer.index`). Never a party member or the player's own `"self"` row (kept safe even when
 * `applicants` is the whole roster), never one already cached, never one `alreadyQueued` (the in-flight
 * lookup, so the caller never bursts).
 */
export function autoQueue(applicants: readonly RosterPlayer[], verdicts: Map<string, CachedVerdict>, alreadyQueued: Set<string>): string[] {
  return applicants
    .filter((p) => p.kind === "applicant" && !verdicts.has(p.character) && !alreadyQueued.has(p.character))
    .sort((a, b) => a.index - b.index)
    .map((p) => p.character);
}

/**
 * The scope a cached verdict is valid in. `CachedVerdict` is computed against one key level and one
 * region (`cacheKey()` embeds both server-side), so the moment either changes every entry in the
 * verdict map is stale: leaving it up would badge an applicant "invite 78" for a level they were never
 * evaluated at, and `autoQueue` would skip them (`verdicts.has(character)`), silently preventing the
 * re-vetting the member just asked for. `App.tsx` keeps the last scope and empties the map when this
 * string changes. `null` — "auto", the level resolved per character server-side — is a scope of its own.
 */
export const verdictScope = (level: number | null, region: string): string => `${level ?? "auto"}|${region}`;

// --- Head-row menus (role toggles are plain buttons in the component; sort and class are ChipMenus) ---
// Shaped like `header.ts`'s `MenuItem` (value/label/hint/on) so the component hands them to the same
// `ChipMenu` the region and spec chips use, with no adapter mapping.

export interface PanelMenuItem { value: string; label: string; hint: string | null; on: boolean }

/** "Sort · verdict ▾" menu rows: arrival, verdict, Raider.IO score, role, class. */
export const sortMenu = (t: T, current: LiveSort): PanelMenuItem[] =>
  LIVE_SORTS.map((s) => ({ value: s, label: t(`live.sort.${s}`), hint: null, on: s === current }));

/** "Class · all ▾": "all" (empty filter) plus one row per class actually present among the applicants. */
export function classMenu(t: T, classLabel: (name: string) => string, applicants: readonly RosterPlayer[], current: readonly string[]): PanelMenuItem[] {
  const present = [...new Set(applicants.map((p) => p.className))].sort();
  return [
    { value: "", label: t("live.class.all"), hint: null, on: current.length === 0 },
    ...present.map((c) => ({ value: c, label: classLabel(c), hint: null, on: current.includes(c) })),
  ];
}
