import type { HistoryItem } from "../types.ts";

export const MAX_COMPARE = 3;

export function toggleSelection(selected: string[], key: string): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  const next = [...selected, key];
  return next.length > MAX_COMPARE ? next.slice(next.length - MAX_COMPARE) : next;
}

export const pruneSelection = (selected: string[], existingKeys: string[]): string[] =>
  selected.filter((k) => existingKeys.includes(k));

export const tabSubtitle = (item: HistoryItem): string =>
  `+${item.targetLevel}${item.targetAutoDetected ? " auto" : ""}${item.spec ? ` · ${item.spec}` : ""}`;
