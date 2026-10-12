// The Live page's view model (mockup F-Live): the status card, the role chips, the applicants grouped by role,
// "Ton groupe", plus the auto-lookup queue and the head-row menus. Pure; tested (panel.test.ts).
import { CLASS_NAMES, classHex } from "@shared/wow/classes.ts";
import type { T } from "../../i18n/t.ts";
import type { Locale } from "../locale.ts";
import { fmtShortAge } from "../admin.ts";
import { LOOKUP_PTS } from "../help.ts";
import { classInitials, specWords } from "../profile.ts";
import { LIVE_ROLES, LIVE_SORTS, filterApplicants, sortApplicants } from "./roster.ts";
import type { CachedVerdict, LiveRole, LiveSort, Roster, RosterPlayer } from "./roster.ts";

export interface PanelFilter {
  liveSort: LiveSort;
  liveRoles: readonly LiveRole[];
  liveClasses: readonly string[];
}

export type LiveAction = { kind: "open" | "evaluate"; label: string } | null;

export interface LiveRowView {
  /** `${kind}:${index}` — unique across applicants and party (someone can be in both). */
  id: string;
  character: string;
  name: string;
  realm: string;
  classColor: string;
  initials: string;
  /** "—" when unknown; the spec in English (redesign phase 2 note 7). */
  spec: string;
  ilvl: string;
  rio: string;
  verdict: { cls: string; label: string; score: string | null } | null;
  /** "2 d ago", from the cached verdict's fetch time. */
  age: string | null;
  state: "vetted" | "queued" | "unvetted" | "self";
  action: LiveAction;
  /** "you · DPS" on the player's own row, null on every other. */
  you: string | null;
}

export interface LiveGroupView { role: LiveRole; label: string; count: number; rows: LiveRowView[] }

export interface LiveView {
  status: { title: string; key: string; counts: { label: string; value: string; tone: "invite" | null }[] };
  roleChips: { value: "all" | LiveRole; label: string; on: boolean }[];
  columns: { verdict: string };
  /** Tank, healer, DPS; only the non-empty groups; rows keep `sortApplicants`' order. */
  groups: LiveGroupView[];
  /** Applicants the role and class filters hide. */
  hidden: number;
  party: { line: string; members: LiveRowView[]; missing: LiveRole[] };
  note: string;
}

/** `DeathKnight` → 6 … — the roster's spacing-free names back to `CLASS_NAMES` ids, built once. */
const CLASS_ID_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(CLASS_NAMES).map(([id, name]) => [name.replace(/\s+/g, ""), Number(id)]),
);

/** One tank, one healer, three DPS: the group "Ton groupe" is measured against. */
const GROUP_SHAPE: Record<LiveRole, number> = { tank: 1, healer: 1, dps: 3 };
const GROUP_SIZE = 5;

function rowOf(t: T, o: { verdicts: Map<string, CachedVerdict>; now: number; queued: ReadonlySet<string> }, p: RosterPlayer): LiveRowView {
  // The player's own row never shows a verdict or an action, even when they once looked themselves up.
  const v = p.kind === "self" ? null : o.verdicts.get(p.character) ?? null;
  const classId = CLASS_ID_BY_NAME[p.className] ?? -1;
  const state: LiveRowView["state"] =
    p.kind === "self" ? "self" : v ? "vetted" : o.queued.has(p.character) ? "queued" : "unvetted";
  const action: LiveAction =
    state === "vetted" ? { kind: "open", label: t("live.panel.open") }
    : state === "unvetted" ? { kind: "evaluate", label: t("live.panel.evaluate", { pts: LOOKUP_PTS }) }
    : null;
  return {
    id: `${p.kind}:${p.index}`,
    character: p.character,
    name: p.name,
    realm: p.realm,
    classColor: classHex(classId),
    initials: classInitials(classId),
    spec: v?.spec ? specWords(v.spec) : "—",
    ilvl: v?.ilvl != null ? String(Math.round(v.ilvl)) : "—",
    rio: p.score > 0 ? String(p.score) : "—",
    verdict: v
      ? { cls: `badge-${v.verdict}`, label: t(`verdict.words.${v.verdict}`), score: v.score === null ? null : String(Math.round(v.score)) }
      : null,
    age: v ? fmtShortAge(t, v.fetchedAt, o.now) : null,
    state,
    action,
    you: p.kind === "self" ? t("live.panel.group.self", { role: t(`live.role.${p.role}`) }) : null,
  };
}

/** The role chips' choice mapped onto the stored `liveRoles`: "all" → all three; a role → [role]. */
export const rolesFor = (v: "all" | LiveRole): LiveRole[] => (v === "all" ? [...LIVE_ROLES] : [v]);

/**
 * The stored `liveRoles` as the page applies it. The chips only ever store one role or all three, but an older build
 * stored free toggles: anything that is not exactly one role (none, two, all three) reads as "all", so the filter and
 * the lit chip always agree and no saved list hides rows with no chip lit.
 */
export const effectiveRoles = (roles: readonly LiveRole[]): readonly LiveRole[] =>
  roles.length === 1 && LIVE_ROLES.includes(roles[0]!) ? roles : LIVE_ROLES;

/**
 * Applicants are filtered then sorted, then grouped by role; the party (`party` and the player's own `self`
 * row) is never filtered or sorted and stays in the roster's order.
 */
export function liveView(t: T, locale: Locale, o: {
  roster: Roster;
  verdicts: Map<string, CachedVerdict>;
  settings: PanelFilter;
  now: number;
  queued: ReadonlySet<string>;
  yourKey: number | null;
}): LiveView {
  const applicants = o.roster.players.filter((p) => p.kind === "applicant");
  const partyPlayers = o.roster.players.filter((p) => p.kind === "party" || p.kind === "self");
  const byClass = filterApplicants(applicants, { roles: LIVE_ROLES, classes: o.settings.liveClasses });
  const roles = effectiveRoles(o.settings.liveRoles);
  const shown = sortApplicants(
    filterApplicants(byClass, { roles, classes: [] }),
    o.settings.liveSort,
    (character) => o.verdicts.get(character) ?? null,
  );
  const row = (p: RosterPlayer) => rowOf(t, o, p);

  const allOn = roles.length !== 1;
  const roleChips: LiveView["roleChips"] = [
    { value: "all", label: t("live.panel.all", { count: byClass.length }), on: allOn },
    ...LIVE_ROLES.map((r) => ({
      value: r,
      label: t("live.panel.roleChip", { role: t(`live.role.${r}`), count: byClass.filter((p) => p.role === r).length }),
      on: roles.length === 1 && roles[0] === r,
    })),
  ];

  const groups = LIVE_ROLES.map((role): LiveGroupView => {
    const rows = shown.filter((p) => p.role === role).map(row);
    return { role, label: t(`live.role.${role}`), count: rows.length, rows };
  }).filter((g) => g.rows.length > 0);

  const vetted = applicants.filter((p) => o.verdicts.has(p.character));
  const invites = vetted.filter((p) => o.verdicts.get(p.character)!.verdict === "invite");
  const updated = fmtShortAge(t, o.roster.at, o.now);

  // Per-role gaps against the shape, capped at the free seats: two tanks + a healer + a DPS leave one seat, not two.
  const missing = LIVE_ROLES.flatMap((role) => {
    const n = Math.max(0, GROUP_SHAPE[role] - partyPlayers.filter((p) => p.role === role).length);
    return Array.from({ length: n }, () => role);
  }).slice(0, Math.max(0, GROUP_SIZE - partyPlayers.length));
  const size = Math.min(partyPlayers.length, GROUP_SIZE);
  const parts = LIVE_ROLES.map((role) => ({ role, n: missing.filter((r) => r === role).length }))
    .filter((x) => x.n > 0)
    .map((x) => t(`live.panel.group.missing.${x.role}`, { count: x.n }));
  const line = partyPlayers.length >= GROUP_SIZE || parts.length === 0
    ? t("live.panel.group.full", { n: size, max: GROUP_SIZE })
    : t("live.panel.group.line", { n: size, max: GROUP_SIZE, list: new Intl.ListFormat(locale, { type: "conjunction" }).format(parts) });

  return {
    status: {
      title: t("live.status.title"),
      key: o.yourKey === null ? t("live.status.keyAuto") : t("live.status.key", { level: o.yourKey, age: updated }),
      counts: [
        { label: t("live.status.applicants", { count: applicants.length }), value: String(applicants.length), tone: null },
        { label: t("live.status.vetted", { count: vetted.length }), value: String(vetted.length), tone: null },
        { label: t("verdict.words.invite"), value: String(invites.length), tone: "invite" },
      ],
    },
    roleChips,
    columns: { verdict: o.yourKey === null ? t("live.panel.columns.verdict") : t("live.panel.columns.verdictAt", { level: o.yourKey }) },
    groups,
    hidden: applicants.length - shown.length,
    party: {
      line,
      members: partyPlayers.map(row),
      missing,
    },
    note: t("live.panel.note"),
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
