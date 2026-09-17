// What the UI may show depending on the server mode (GET /api/status).
export interface StatusInfo { hosted: boolean; hasCredentials: boolean; envPath: string | null }
export interface UiControls { setup: boolean; quit: boolean; watch: boolean; envPath: boolean }

/** Used when /api/status itself fails: behave like today's local UI. */
export const LOCAL_STATUS: StatusInfo = { hosted: false, hasCredentials: true, envPath: null };

export function uiControls(status: StatusInfo): UiControls {
  const local = !status.hosted;
  return { setup: local, quit: local, watch: local, envPath: local };
}

/** Hosted credentials are a deployment concern, never a browser one: the setup screen is local-only. */
export function initialScreen(status: StatusInfo, pathname: string): "setup" | "main" {
  if (status.hosted) return "main";
  return !status.hasCredentials || pathname === "/setup" ? "setup" : "main";
}
