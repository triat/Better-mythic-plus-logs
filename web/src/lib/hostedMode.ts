import type { MeResult } from "../api.ts";

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
