import type { MeResult, MeUser } from "../api.ts";
import type { T } from "../i18n/t.ts";
import type { Region } from "../types.ts";

// What the UI may show depending on the server mode (GET /api/status).
export interface StatusInfo {
  hosted: boolean;
  hasCredentials: boolean;
  envPath: string | null;
  /** Hosted flags (issue #11): open signup, Discord guild gate, own WCL clients enabled, who runs the instance. */
  openSignup: boolean;
  guildRequired: boolean;
  wclClients: boolean;
  operator: string;
  /** The instance default region — the region a fresh lookup uses until the member picks (and saves) their own. */
  region: Region;
}
export interface UiControls { setup: boolean; quit: boolean; watch: boolean; envPath: boolean; signOut: boolean }
export type BootScreen = "setup" | "main" | "signin";
/** No router: the pathname picks the page rendered inside `Main` (or, for /privacy and /help, before the sign-in wall). */
export type Page = "main" | "admin" | "settings" | "privacy" | "help";

/** Used when /api/status itself fails: behave like today's local UI. */
export const LOCAL_STATUS: StatusInfo = { hosted: false, hasCredentials: true, envPath: null, openSignup: false, guildRequired: false, wclClients: false, operator: "", region: "eu" };

const PAGES: Record<string, Page> = { "/admin": "admin", "/settings": "settings", "/privacy": "privacy", "/help": "help" };
export const pageOf = (pathname: string): Page => PAGES[pathname] ?? "main";

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

/**
 * The sign-in callback's `?denied=<discordId>|banned|guild|rate` (canvas "Phase2Details", sign-in variants).
 * The three id-less refusals carry their title and explanation already localized — `SignIn.tsx` just renders them.
 */
export type DeniedNotice = { kind: "invite"; discordId: string } | { kind: "guild" | "banned" | "rate"; title: string; text: string } | null;
export function deniedNotice(t: T, search: string): DeniedNotice {
  const v = new URLSearchParams(search).get("denied");
  if (!v) return null;
  if (/^\d{17,20}$/.test(v)) return { kind: "invite", discordId: v };
  if (v === "guild") return { kind: "guild", title: t("signin.denied.guild.title"), text: t("signin.denied.guild.text") };
  if (v === "banned") return { kind: "banned", title: t("signin.denied.banned.title"), text: t("signin.denied.banned.text") };
  if (v === "rate") return { kind: "rate", title: t("signin.denied.rate.title"), text: t("signin.denied.rate.text") };
  return null;
}

/** The faint line under the Discord button: who may sign in and what sign-in reads, per instance mode. */
export function signInNote(t: T, status: StatusInfo): string {
  if (status.guildRequired) return t("signin.note.guild");
  if (status.openSignup) return t("signin.note.open");
  return t("signin.note.invite");
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

/** Who may see /settings: any signed-in hosted user; anonymous hosted visitors get the sign-in wall; local mode has no account. */
export type AccountAccess = "ok" | "signin" | "local";
export function accountAccess(status: StatusInfo, me: MeUser | null): AccountAccess {
  if (!status.hosted) return "local";
  return me ? "ok" : "signin";
}
