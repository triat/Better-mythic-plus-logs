// Settings page view models (issue #11): the member's own WCL client card, the typed-word delete, the stored-data sentence. Pure; tested.
import type { OwnClientView } from "../types.ts";
import { fmtAge, fmtPts } from "./format.ts";

export type ClientCardState = "disabled" | "none" | "set" | "stale";
export interface ClientCardModel { state: ClientCardState; status: string; dot: "dot-none" | "dot-approved"; showForm: boolean }

/** `fmtAge` writes "2h ago"; the canvas card reads "Verified 2 h ago" — same buckets, a space before the unit. */
const spacedAge = (ms: number, now: number): string => fmtAge(ms, now).replace(/^(\d+)([a-z]+) ago$/, "$1 $2 ago");

/** Canvas "Phase2SettingsA" (none) and "Phase2Details" (verified): the header dot + status line and whether the id/secret form shows. */
export function clientCard(enabled: boolean, client: OwnClientView | null, limitPerUser: number | null, now = Date.now()): ClientCardModel {
  if (!enabled) return { state: "disabled", status: "This instance does not store WCL clients — your lookups use the shared budget.", dot: "dot-none", showForm: false };
  if (!client) {
    const budget = limitPerUser === null ? "no quota" : `${limitPerUser} pts per hour`;
    return { state: "none", status: `No client — your lookups use the shared budget (${budget}).`, dot: "dot-none", showForm: true };
  }
  if (!client.usable) {
    return {
      state: "stale",
      status: "Stored secret cannot be decrypted (the instance key changed) — save the client again. Your lookups use the shared budget meanwhile.",
      dot: "dot-none",
      showForm: true,
    };
  }
  const when = client.verifiedAt === null ? `Saved ${spacedAge(client.updatedAt, now)}` : `Verified ${spacedAge(client.verifiedAt, now)}`;
  const spent = client.snapshot ? ` · ${fmtPts(client.snapshot.pointsSpentThisHour)} / ${fmtPts(client.snapshot.limitPerHour)} pts` : "";
  return { state: "set", status: `${when} · ${client.clientId}${spent}`, dot: "dot-approved", showForm: false };
}

export const DELETE_WORD = "delete";
/** The account deletion asks for the word typed, trimmed and case-insensitive. */
export const canDelete = (typed: string): boolean => typed.trim().toLowerCase() === DELETE_WORD;

/** The Account card's paragraph: everything a row of the hosted database can hold about the member, and what is not theirs. */
export function storedDataText(): string {
  return "What bmpl stores about you: your Discord id, username and avatar, your lookup history (20 tabs), your settings, your hourly WCL usage, "
    + "your defensives proposals and, if you added one, your WCL client (secret encrypted). "
    + "Runs and rankings fetched from Warcraft Logs are public data and are kept in the shared cache.";
}
