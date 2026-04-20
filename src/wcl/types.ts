export interface RateLimitData {
  rateLimitData: {
    limitPerHour: number;
    pointsSpentThisHour: number;
    pointsResetIn: number;
  };
}

export interface ZonesData {
  worldData: {
    zones: Array<{
      id: number;
      name: string;
      frozen: boolean;
      expansion: { id: number; name: string };
      partitions: Array<{
        id: number;
        name: string;
        compactName: string;
        default: boolean;
      }> | null;
    }>;
  };
}

export interface CharacterZoneRankings {
  characterData: {
    character: {
      id: number;
      name: string;
      classID: number;
      zoneRankings: unknown;
    } | null;
  };
}

export interface CharacterEncounterRankings {
  characterData: {
    character: {
      id: number;
      name: string;
      classID: number;
      encounterRankings: unknown;
    } | null;
  };
}

export interface CharacterBasic {
  characterData: {
    character: {
      id: number;
      name: string;
      classID: number;
      faction: { id: number; name: string };
      server: {
        name: string;
        slug: string;
        region: { slug: string };
      };
    } | null;
  };
}
