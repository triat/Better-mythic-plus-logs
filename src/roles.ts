export type Metric = "dps" | "hps";

export const HEALER_SPECS: ReadonlySet<string> = new Set([
  "Restoration",
  "Discipline",
  "Holy",
  "Mistweaver",
  "Preservation",
]);

export const TANK_SPECS: ReadonlySet<string> = new Set([
  "Blood",
  "Vengeance",
  "Guardian",
  "Brewmaster",
  "Protection",
]);

export const isHealerSpec = (spec: string): boolean => HEALER_SPECS.has(spec);
export const isTankSpec = (spec: string): boolean => TANK_SPECS.has(spec);

export const metricForSpec = (spec: string): Metric =>
  isHealerSpec(spec) ? "hps" : "dps";
