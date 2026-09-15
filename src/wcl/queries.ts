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

const RUN_SUMMARY_FIELDS = /* GraphQL */ `
        code
        fights(fightIDs: [$fightID]) {
          id encounterID keystoneLevel keystoneBonus keystoneTime keystoneAffixes startTime endTime
        }
        summary: table(fightIDs: [$fightID], dataType: Summary)
        damageTaken: table(fightIDs: [$fightID], dataType: DamageTaken)
        deaths: table(fightIDs: [$fightID], dataType: Deaths)
        interrupts: table(fightIDs: [$fightID], dataType: Interrupts)
        dispels: table(fightIDs: [$fightID], dataType: Dispels)
`;

export const REPORT_RUN_SUMMARY_QUERY = /* GraphQL */ `
  query ReportRunSummary($code: String!, $fightID: Int!) {
    reportData {
      report(code: $code) {
${RUN_SUMMARY_FIELDS}
      }
    }
  }
`;

// Same, plus a DamageTaken table restricted to the dungeon's avoidable
// spell list (see src/signals/avoidable). Separate query because passing
// a null filterExpression would return *all* damage taken.
export const REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY = /* GraphQL */ `
  query ReportRunSummaryWithAvoidable($code: String!, $fightID: Int!, $avoidFilter: String!) {
    reportData {
      report(code: $code) {
${RUN_SUMMARY_FIELDS}
        avoidable: table(fightIDs: [$fightID], dataType: DamageTaken, filterExpression: $avoidFilter)
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
