import type { HistoryItem, Region } from "../types.ts";
import { regionLabel } from "./regions.ts";

export const MAX_COMPARE = 3;

export function toggleSelection(selected: string[], key: string): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  const next = [...selected, key];
  return next.length > MAX_COMPARE ? next.slice(next.length - MAX_COMPARE) : next;
}

export const pruneSelection = (selected: string[], existingKeys: string[]): string[] =>
  selected.filter((k) => existingKeys.includes(k));

/** "US · " when the tab's region is not the instance default, else nothing (design: canvas "RegionSpec", tabs row). */
const regionPrefix = (item: HistoryItem, instanceRegion: Region): string =>
  item.request.region !== instanceRegion ? `${regionLabel(item.request.region)} · ` : "";

/** The visible level on the tab: "+18", or "US · +18" off the instance region. */
export const tabLevel = (item: HistoryItem, instanceRegion: Region): string =>
  `${regionPrefix(item, instanceRegion)}+${item.targetLevel}`;

export const tabSubtitle = (item: HistoryItem, instanceRegion: Region): string =>
  `${tabLevel(item, instanceRegion)}${item.targetAutoDetected ? " auto" : ""}${item.spec ? ` · ${item.spec}` : ""}`;
