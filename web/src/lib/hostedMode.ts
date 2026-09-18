import type { MeResult, MeUser } from "../api.ts";

// What the UI may show depending on the server mode (GET /api/status).
export interface StatusInfo { hosted: boolean; hasCredentials: boolean; envPath: string | null }
export interface UiControls { setup: boolean; quit: boolean; watch: boolean; envPath: boolean; signOut: boolean }
export type BootScreen = "setup" | "main" | "signin";

/** Used when /api/status itself fails: behave like today's local UI. */
export const LOCAL_STATUS: StatusInfo = { hosted: false, hasCredentials: true, envPath: null };

export function uiControls(status: StatusInfo): UiControls {
  const local = !status.hosted;
  return { setup: local, quit: local, watch: local, envPath: local, signOut: !local };
}

/** Hosted credentials are a deployment concern, never a browser one: the setup screen is local-only. */
export function initialScreen(status: StatusInfo, pathname: string): "setup" | "main" {
  if (status.hosted) return "main";
  return !status.hasCredentials || pathname === "/setup" ? "setup" : "main";
}

/** Hosted: the session decides; local: the credentials decide (initialScreen). */
export function bootScreen(status: StatusInfo, me: MeResult | null, pathname: string): BootScreen {
  if (status.hosted) return me?.kind === "ok" ? "main" : "signin";
  return initialScreen(status, pathname);
}

export function deniedDiscordId(search: string): string | null {
  const v = new URLSearchParams(search).get("denied");
  return v && /^\d{17,20}$/.test(v) ? v : null;
}

/** Discord (or bmpl) failed the login round-trip: the callback sent `?login=failed`. */
export function loginFailed(search: string): boolean {
  return new URLSearchParams(search).get("login") === "failed";
}

/** Wording of the panel's table corrections: local file edits, member proposals, or admin corrections (approved on the spot). */
export type ProposalMode = "local" | "propose" | "admin";
export function proposalMode(status: StatusInfo, me: MeUser | null): ProposalMode {
  if (!status.hosted) return "local";
  return me?.role === "admin" ? "admin" : "propose";
}

/** Who may see /admin: hosted admins; members get the "Admins only" screen; local mode has no admin at all. */
export type AdminAccess = "ok" | "member" | "local";
export function adminAccess(status: StatusInfo, me: MeUser | null): AdminAccess {
  if (!status.hosted) return "local";
  return me?.role === "admin" ? "ok" : "member";
}
