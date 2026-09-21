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

/**
 * Reads `flag` out of a CLI argv array. `region` is set when the value is a valid region
 * (case-insensitive); `invalid` carries the raw value when the flag is present but not a
 * region (including "" when the flag is the last argument). Both null when the flag is absent.
 */
export function regionFlag(args: string[], flag = "--region"): { region: Region | null; invalid: string | null } {
  const i = args.indexOf(flag);
  if (i === -1) return { region: null, invalid: null };
  const raw = args[i + 1] ?? "";
  const region = parseRegion(raw);
  return region ? { region, invalid: null } : { region: null, invalid: raw };
}
