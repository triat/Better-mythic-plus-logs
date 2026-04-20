export const PING_QUERY = /* GraphQL */ `
  query Ping {
    rateLimitData {
      limitPerHour
      pointsSpentThisHour
      pointsResetIn
    }
  }
`;

export const ZONES_QUERY = /* GraphQL */ `
  query Zones {
    worldData {
      zones {
        id
        name
        frozen
        expansion {
          id
          name
        }
        partitions {
          id
          name
          compactName
          default
        }
      }
    }
  }
`;

export const CHARACTER_ZONE_RANKINGS_QUERY = /* GraphQL */ `
  query CharacterZoneRankings(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
    $zoneID: Int!
    $partition: Int
    $byBracket: Boolean
    $metric: CharacterPageRankingMetricType
  ) {
    characterData {
      character(
        name: $name
        serverSlug: $serverSlug
        serverRegion: $serverRegion
      ) {
        id
        name
        classID
        zoneRankings(
          zoneID: $zoneID
          partition: $partition
          metric: $metric
          byBracket: $byBracket
        )
      }
    }
  }
`;

export const CHARACTER_METRIC_PROBE_QUERY = /* GraphQL */ `
  query CharacterMetricProbe(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
    $zoneID: Int!
    $partition: Int
  ) {
    characterData {
      character(
        name: $name
        serverSlug: $serverSlug
        serverRegion: $serverRegion
      ) {
        id
        name
        classID
        dps: zoneRankings(zoneID: $zoneID, partition: $partition, metric: dps)
        hps: zoneRankings(zoneID: $zoneID, partition: $partition, metric: hps)
      }
    }
  }
`;

export const CHARACTER_ENCOUNTER_RANKINGS_QUERY = /* GraphQL */ `
  query CharacterEncounterRankings(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
    $encounterID: Int!
    $partition: Int
    $byBracket: Boolean
    $metric: CharacterRankingMetricType
  ) {
    characterData {
      character(
        name: $name
        serverSlug: $serverSlug
        serverRegion: $serverRegion
      ) {
        id
        name
        classID
        encounterRankings(
          encounterID: $encounterID
          partition: $partition
          metric: $metric
          byBracket: $byBracket
        )
      }
    }
  }
`;

export const CHARACTER_BASIC_QUERY = /* GraphQL */ `
  query CharacterBasic(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
  ) {
    characterData {
      character(
        name: $name
        serverSlug: $serverSlug
        serverRegion: $serverRegion
      ) {
        id
        name
        classID
        faction {
          id
          name
        }
        server {
          name
          slug
          region {
            slug
          }
        }
      }
    }
  }
`;
