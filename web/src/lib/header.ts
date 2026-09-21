// The two chips inside the search field (design: canvas "RegionSpec", option B): the region menu and
// the spec picker; plus the EN / FR chip at the right of the local header (canvas "Locale", option A).
// Pure — the Header component maps these rows to `.menu-item`s.
import type { MessageKey, T } from "../i18n/t.ts";
import type { LookupPayload, Region } from "../types.ts";
import { LOCALES, LOCALE_LABELS, LOCALE_NAMES } from "./locale.ts";
import type { Locale } from "./locale.ts";
import { REGIONS, regionLabel } from "./regions.ts";

export interface MenuItem {
  value: string;
  label: string;
  /** Right-aligned secondary text (`.n`), null for none. */
  hint: string | null;
  /** The current choice. */
  on: boolean;
}

const REGION_HINT_KEY: Record<Region, MessageKey> = {
  eu: "header.region.eu",
  us: "header.region.us",
  kr: "header.region.kr",
  tw: "header.region.tw",
};

/** The region menu: four rows; `on` = the effective region. The hints are the region names, from the dictionary. */
export const regionMenu = (t: T, effective: Region): MenuItem[] =>
  REGIONS.map((r) => ({ value: r, label: regionLabel(r), hint: t(REGION_HINT_KEY[r]), on: r === effective }));

/**
 * The EN / FR chip menu (local mode header): two rows, `on` = the effective locale. The hints are the
 * languages' own names, so a reader who cannot read the current one still finds theirs; the component passes
 * `t("common.locale.remembered")` as the menu head. `t` is here for the view-model convention (prose models take it first).
 */
export const localeMenu = (_t: T, current: Locale): MenuItem[] =>
  LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l], hint: LOCALE_NAMES[l], on: l === current }));

/** Picking this value reveals the free-text spec input instead of setting a spec. */
export const OTHER_SPEC = "other";

/**
 * The spec menu: "any" (with the run total), one row per spec seen on the loaded payload (null before any
 * tab) with its run count and the metric it implies, then "Other…" for a free-text name. `current` is the
 * form's spec filter ("" = any).
 */
export function specMenu(t: T, payload: Pick<LookupPayload, "specsSeen" | "runsIndexed"> | null, current: string): MenuItem[] {
  const seen = payload?.specsSeen ?? [];
  const runsText = (n: number) => t("header.spec.runs", { count: n });
  // `runsIndexed` is the filtered count when the lookup carried a spec; the unfiltered total is the sum.
  const total = seen.length ? seen.reduce((n, s) => n + s.runs, 0) : payload?.runsIndexed ?? null;
  return [
    { value: "", label: t("header.spec.any"), hint: total === null ? null : runsText(total), on: current === "" },
    ...seen.map((s) => ({ value: s.spec, label: s.spec, hint: `${runsText(s.runs)} · ${s.metric}`, on: s.spec === current })),
    { value: OTHER_SPEC, label: t("header.spec.other"), hint: t("header.spec.typeName"), on: false },
  ];
}

export const specChipLabel = (t: T, spec: string): string => (spec ? t("header.spec.chip", { spec }) : t("header.spec.chipAny"));
export const regionChipLabel = (r: Region): string => `${regionLabel(r)} ▾`;
