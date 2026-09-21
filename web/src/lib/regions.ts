// The front's own copy of src/wow/regions.ts's values (types-only import rule — see AGENTS.md).
import type { Region } from "../types.ts";

export const REGIONS: readonly Region[] = ["eu", "us", "kr", "tw"];

export const REGION_LABELS: Record<Region, string> = {
  eu: "Europe",
  us: "Americas & Oceania",
  kr: "Korea",
  tw: "Taiwan",
};

export const isRegion = (v: unknown): v is Region => typeof v === "string" && (REGIONS as readonly string[]).includes(v);

export const regionLabel = (r: Region): string => r.toUpperCase();

/** The region a lookup uses: the saved one, else the instance default. */
export const effectiveRegion = (saved: Region | null, instanceDefault: Region): Region => saved ?? instanceDefault;
