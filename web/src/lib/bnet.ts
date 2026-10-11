// Battle.net linking on /me (spec docs/superpowers/specs/2026-10-11-battlenet-linking-design.md; canvas page "bnet":
// picker A — BnetPickA — and BnetDetails). Pure: no React, no fetch.
import type { BnetCallbackCode, BnetCandidate, MyCharacter, Region } from "../types.ts";
import type { ApiFailureCode } from "../api.ts";
import type { T } from "../i18n/t.ts";
import { realmName } from "./format.ts";
import { fmtDayMonth, type Locale } from "./locale.ts";
import { regionLabel } from "./regions.ts";
import { MAX_ME } from "./self.ts";

export type BnetCode = BnetCallbackCode;
/** The server's `BnetCallbackCode` values (src/server/routes-bnet.ts); bnet.test.ts pins the two to the same set. */
export const BNET_CODES = ["pick", "cancelled", "state", "scope", "taken", "empty", "down"] as const satisfies readonly BnetCode[];

/** `?bnet=` as the callback's redirect sets it; read at module level, before the boot effect erases the query. */
export function bnetCodeOf(search: string): BnetCode | null {
  const v = new URLSearchParams(search).get("bnet");
  return (BNET_CODES as readonly string[]).includes(v ?? "") ? (v as BnetCode) : null;
}

export type BnetTone = "bad" | "warn" | "muted";
export interface BnetNotice { text: string; tone: BnetTone }

/** The spec's "Error handling" wording; `expired` is the pick's 410 (an import older than one hour). */
export function bnetNotice(t: T, code: BnetCode | "expired"): BnetNotice | null {
  if (code === "pick") return null;
  return { text: t(`me.bnet.notice.${code}`), tone: code === "cancelled" ? "muted" : "bad" };
}

/** A refused pick: the 410 gets the dictionary's wording, anything else keeps the server's message. */
export const pickFailureNotice = (t: T, f: { error: string; code: ApiFailureCode }): BnetNotice =>
  f.code === "bnet_import_expired" ? bnetNotice(t, "expired")! : { text: f.error, tone: "bad" };

/** A candidate's identity in the picker: Blizzard ids are per region. */
export const pickKey = (c: { region: Region; bnetId: number }): string => `${c.region}|${c.bnetId}`;

/** Ticks or unticks `key`; the order is the tick order (the first is the main). Null when full and `key` is new. */
export function togglePick(picked: string[], key: string, max = MAX_ME): string[] | null {
  if (picked.includes(key)) return picked.filter((k) => k !== key);
  if (picked.length >= max) return null;
  return [...picked, key];
}

/** "make main" on a ticked row: it moves first. An unticked key changes nothing. */
export const makeMainPick = (picked: string[], key: string): string[] =>
  picked.includes(key) ? [key, ...picked.filter((k) => k !== key)] : picked;

export interface PickerRow {
  key: string; name: string; realm: string; region: string; level: number; classID: number | null;
  checked: boolean; main: boolean;
  /** Unticked while 20 are ticked. */
  disabled: boolean;
}

/** One row per candidate, in the import's order (highest level first, then name — the server's sort). */
export function pickerRows(candidates: BnetCandidate[], picked: string[], max = MAX_ME): PickerRow[] {
  const full = picked.length >= max;
  return candidates.map((c) => {
    const key = pickKey(c);
    const checked = picked.includes(key);
    return {
      key, name: c.name, realm: c.realmName, region: regionLabel(c.region), level: c.level, classID: c.classID,
      checked, main: picked[0] === key, disabled: !checked && full,
    };
  });
}

/** "from Tomr#2147 · 10 characters in 2 regions · highest level first". */
export const pickHeader = (t: T, battletag: string | null, candidates: BnetCandidate[]): string =>
  t("me.bnet.pickFrom", {
    who: battletag ?? t("me.bnet.yourAccount"),
    count: candidates.length,
    regions: new Set(candidates.map((c) => c.region)).size,
  });

/** The picker's footer: "3 of 20 ticked · the main is the first you ticked". */
export const pickCount = (t: T, picked: string[]): string => t("me.bnet.ticked", { n: picked.length, max: MAX_ME });

export const saveLabel = (t: T, count: number): string => t("me.bnet.save", { count });

/** PUT /api/bnet/characters's `picks`, in tick order; a key the import does not hold is skipped. */
export function picksBody(candidates: BnetCandidate[], picked: string[]): { region: Region; bnetId: number }[] {
  const byKey = new Map(candidates.map((c) => [pickKey(c), c]));
  return picked.flatMap((k) => {
    const c = byKey.get(k);
    return c ? [{ region: c.region, bnetId: c.bnetId }] : [];
  });
}

/** "Import again" opens the picker with the list's Battle.net characters still in the import ticked, in list order. */
export function picksFromList(candidates: BnetCandidate[], chars: MyCharacter[]): string[] {
  const keys = new Set(candidates.map(pickKey));
  return chars.flatMap((c) => (c.source === "bnet" && c.bnetId !== undefined && keys.has(pickKey({ region: c.region, bnetId: c.bnetId }))
    ? [pickKey({ region: c.region, bnetId: c.bnetId })] : []));
}

/** The linked line: the BattleTag (or "your Battle.net account"), then "· linked 11 Oct · characters re-checked every 30 days". */
export const linkedLine = (t: T, locale: Locale, link: { battletag: string | null; linkedAt: number }): { who: string; text: string } =>
  ({ who: link.battletag ?? t("me.bnet.yourAccount"), text: t("me.bnet.linked", { date: fmtDayMonth(locale, link.linkedAt) }) });

/** The Unlink confirmation; `count` is the list's Battle.net characters, the ones that leave. */
export const unlinkConfirm = (t: T, count: number): string =>
  count === 0 ? t("me.bnet.unlinkConfirmEmpty") : t("me.bnet.unlinkConfirm", { count });

/** "Name-realm" (the check round's labels) → "Name (Realm)". */
const labelText = (label: string): string => {
  const i = label.indexOf("-");
  return i < 0 ? label : `${label.slice(0, i)} (${realmName(label.slice(i + 1))})`;
};

/** The removal notice of the 30-day check, shown until the next pick or unlink; null when nothing was removed. */
export function removedNotice(t: T, removed: string[]): BnetNotice | null {
  if (removed.length === 0) return null;
  return { text: t("me.bnet.removed", { names: removed.map(labelText).join(", "), count: removed.length }), tone: "warn" };
}
