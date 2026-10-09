// The closed catalogue of feature-usage events (spec 2026-10-09-feature-usage-dashboard-design.md).
// One source of truth for the server (which records `api` events itself and accepts only `ui` names
// from `POST /api/usage/events`) and for the front (`import type { UiEvent }`). Names are final once
// shipped: renaming one splits its history.

export type UsageCategory = "lookup" | "result" | "deepdive" | "history" | "live" | "help" | "account" | "admin";
export type UsageSource = "api" | "ui";

export const USAGE_CATEGORIES: readonly UsageCategory[] = ["lookup", "result", "deepdive", "history", "live", "help", "account", "admin"];

export const USAGE_CATALOG = {
  // Lookup
  lookup: { category: "lookup", source: "api" },
  lookup_cached: { category: "lookup", source: "api" },
  lookup_refresh: { category: "lookup", source: "api" },
  reevaluate: { category: "lookup", source: "ui" },
  key_level_change: { category: "lookup", source: "ui" },
  region_change: { category: "lookup", source: "ui" },
  spec_pick: { category: "lookup", source: "ui" },
  metric_pick: { category: "lookup", source: "ui" },
  // Result
  page_main_result: { category: "result", source: "ui" },
  axis_expand: { category: "result", source: "ui" },
  legend_toggle: { category: "result", source: "ui" },
  runs_toggle: { category: "result", source: "ui" },
  rio_toggle: { category: "result", source: "ui" },
  external_log: { category: "result", source: "ui" },
  external_rio: { category: "result", source: "ui" },
  // Deep-dive
  deepdive: { category: "deepdive", source: "api" },
  deepdive_reanalyze: { category: "deepdive", source: "api" },
  defensives_correction: { category: "deepdive", source: "api" },
  deepdive_panel_open: { category: "deepdive", source: "ui" },
  analyze_all: { category: "deepdive", source: "ui" },
  // History & compare
  history_open: { category: "history", source: "api" },
  history_close: { category: "history", source: "api" },
  history_clear: { category: "history", source: "api" },
  compare_open: { category: "history", source: "ui" },
  // Live
  live_roster: { category: "live", source: "api" },
  live_connect: { category: "live", source: "ui" },
  live_check: { category: "live", source: "ui" },
  live_auto_toggle: { category: "live", source: "ui" },
  live_filter: { category: "live", source: "ui" },
  // Help
  page_help: { category: "help", source: "ui" },
  help_link: { category: "help", source: "ui" },
  // Account
  wcl_client_set: { category: "account", source: "api" },
  wcl_client_verify: { category: "account", source: "api" },
  wcl_client_remove: { category: "account", source: "api" },
  settings_save: { category: "account", source: "api" },
  page_settings: { category: "account", source: "ui" },
  page_privacy: { category: "account", source: "ui" },
  locale_switch: { category: "account", source: "ui" },
  toast_own_client: { category: "account", source: "ui" },
  // Admin
  page_admin: { category: "admin", source: "ui" },
} as const satisfies Record<string, { category: UsageCategory; source: UsageSource }>;

export type UsageEvent = keyof typeof USAGE_CATALOG;
type Of<S extends UsageSource> = { [K in UsageEvent]: (typeof USAGE_CATALOG)[K]["source"] extends S ? K : never }[UsageEvent];
/** Recorded by the server after a successful handler. */
export type ApiEvent = Of<"api">;
/** Sent by the front in batches to `POST /api/usage/events`. */
export type UiEvent = Of<"ui">;

export const USAGE_EVENTS = Object.keys(USAGE_CATALOG) as UsageEvent[];
export const isUiEvent = (s: string): s is UiEvent =>
  Object.hasOwn(USAGE_CATALOG, s) && USAGE_CATALOG[s as UsageEvent].source === "ui";

/** `POST /api/usage/events` bounds: names per batch and the count per name. */
export const USAGE_BATCH_MAX_NAMES = 40;
export const USAGE_BATCH_MAX_COUNT = 50;
/** Rows older than this are purged with the audit log (same retention). */
export const USAGE_RETENTION_DAYS = 90;
export const DAY_MS = 86_400_000;
/** UTC midnight of `at`. */
export const dayStart = (at: number): number => Math.floor(at / DAY_MS) * DAY_MS;
