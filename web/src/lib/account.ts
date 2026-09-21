// Settings page view models (issue #11): the member's own WCL client card, the typed-word delete, the stored-data sentence. Pure; tested.
import type { OwnClientView } from "../types.ts";
import type { T } from "../i18n/t.ts";
import { fmtAge, fmtPts } from "./format.ts";

export type ClientCardState = "disabled" | "none" | "set" | "stale";
export interface ClientCardModel { state: ClientCardState; status: string; dot: "dot-none" | "dot-approved"; showForm: boolean }

/** `fmtAge` writes "2h ago"; the canvas card reads "Verified 2 h ago" — same buckets, a space before the unit (French already has it). */
const spacedAge = (t: T, ms: number, now: number): string => fmtAge(t, ms, now).replace(/^(\d+)([a-z]+) ago$/, "$1 $2 ago");

/** Canvas "Phase2SettingsA" (none) and "Phase2Details" (verified): the header dot + status line and whether the id/secret form shows. */
export function clientCard(t: T, enabled: boolean, client: OwnClientView | null, limitPerUser: number | null, now = Date.now()): ClientCardModel {
  if (!enabled) return { state: "disabled", status: t("account.client.disabled"), dot: "dot-none", showForm: false };
  if (!client) {
    const budget = limitPerUser === null ? t("header.quota.none") : t("account.client.perHour", { n: limitPerUser });
    return { state: "none", status: t("account.client.none", { budget }), dot: "dot-none", showForm: true };
  }
  if (!client.usable) return { state: "stale", status: t("account.client.stale"), dot: "dot-none", showForm: true };
  const when = client.verifiedAt === null
    ? t("account.client.saved", { age: spacedAge(t, client.updatedAt, now) })
    : t("account.client.verified", { age: spacedAge(t, client.verifiedAt, now) });
  const spent = client.snapshot ? ` · ${fmtPts(client.snapshot.pointsSpentThisHour)} / ${fmtPts(client.snapshot.limitPerHour)} pts` : "";
  return { state: "set", status: `${when} · ${client.clientId}${spent}`, dot: "dot-approved", showForm: false };
}

export const DELETE_WORD = "delete";
/** The account deletion asks for the word typed, trimmed and case-insensitive. */
export const canDelete = (typed: string): boolean => typed.trim().toLowerCase() === DELETE_WORD;

/** The Account card's paragraph: everything a row of the hosted database can hold about the member, and what is not theirs. */
export const storedDataText = (t: T): string => t("account.stored");
