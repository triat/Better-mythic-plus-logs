// The four Warcraft Logs / Raider.IO regions. Lower-case internally (Raider.IO's own casing);
// upper-cased at WCL `serverRegion` call sites.
export type Region = "eu" | "us" | "kr" | "tw";

export const REGIONS: readonly Region[] = ["eu", "us", "kr", "tw"];

export const REGION_LABELS: Record<Region, string> = {
  eu: "Europe",
  us: "Americas & Oceania",
  kr: "Korea",
  tw: "Taiwan",
};

export const isRegion = (v: unknown): v is Region =>
  typeof v === "string" && (REGIONS as readonly string[]).includes(v);

/** Case-insensitive; null when not a region. */
export const parseRegion = (v: string | undefined | null): Region | null => {
  const s = (v ?? "").trim().toLowerCase();
  return isRegion(s) ? s : null;
};
