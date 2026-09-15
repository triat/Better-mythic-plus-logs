import seasonMn2 from "./season-mn-2.json";

export interface AvoidableSeasonList {
  season: string;
  source: string;
  importedAt: string;
  spells: Record<string, string>;
  dungeons: Record<string, number[]>;
}

const SEASONS: AvoidableSeasonList[] = [seasonMn2 as AvoidableSeasonList];

/** Spell IDs Blizzard flags as avoidable for this dungeon, or null if we have no list for it. */
export const avoidableSpellIdsFor = (encounterID: number): number[] | null => {
  for (const s of SEASONS) {
    const ids = s.dungeons[String(encounterID)];
    if (ids && ids.length > 0) return ids;
  }
  return null;
};

export const avoidableFilterExpression = (ids: number[]): string =>
  `ability.id in (${[...ids].sort((a, b) => a - b).join(",")})`;
