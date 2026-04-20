import { config } from "./config.ts";
import { type Metric, isHealerSpec, metricForSpec } from "./roles.ts";
import { realmToSlug } from "./util.ts";
import { gql } from "./wcl/client.ts";
import {
  CHARACTER_METRIC_PROBE_QUERY,
  ZONES_QUERY,
} from "./wcl/queries.ts";
import type { ZonesData } from "./wcl/types.ts";

export interface MPlusRun {
  encounterID: number;
  encounterName: string;
  keyLevel: number;
  amount: number;
  parsePercent: number;
  spec: string;
  affixes: number[];
  reportCode: string;
  fightID: number;
  startTime: number;
  score: number;
}

export interface CharacterIdentity {
  id: number;
  name: string;
  classID: number;
  spec: string | null;
  scoreTop: {
    spec: string;
    rankPercent: number;
    points: number;
    regionRank: number;
    serverRank: number;
  } | null;
}

export interface SeasonDungeon {
  id: number;
  name: string;
}

export interface MPlusData {
  zoneID: number;
  zoneName: string;
  partition: number;
  metric: Metric;
  metricAutoSelected: boolean;
  alternateMetricHasData: boolean;
  character: CharacterIdentity;
  runs: MPlusRun[];
  seasonDungeons: SeasonDungeon[];
  specFilter: string | null;
}

export interface CurrentMplusZone {
  id: number;
  name: string;
  partition: number;
}

interface AllStar {
  partition: number;
  spec: string;
  points: number;
  rank: number;
  regionRank: number;
  serverRank: number;
  rankPercent: number;
}

interface ZoneRankingEncounter {
  encounter: { id: number; name: string };
  bestSpec: string;
  bestAmount: number;
  rankPercent: number;
}

interface ZoneRankingsJson {
  zone: number;
  partition: number;
  bestPerformanceAverage: number;
  medianPerformanceAverage: number;
  allStars: AllStar[];
  rankings: ZoneRankingEncounter[];
}

interface EncounterRank {
  rankPercent: number;
  amount: number;
  bracketData: number;
  spec: string;
  affixes: number[];
  score: number;
  startTime: number;
  report: { code: string; fightID: number; startTime: number };
}

interface EncounterRankingsJson {
  ranks: EncounterRank[];
  totalKills: number;
}

export const filterBySpec = (
  runs: MPlusRun[],
  spec: string | null,
): MPlusRun[] => {
  if (!spec) return runs;
  const target = spec.trim().toLowerCase();
  return runs.filter((r) => r.spec.toLowerCase() === target);
};

export const uniqueSpecs = (runs: MPlusRun[]): string[] => {
  const seen = new Set<string>();
  for (const r of runs) seen.add(r.spec);
  return [...seen].sort();
};

export async function getCurrentMplusZone(): Promise<CurrentMplusZone> {
  const data = await gql<ZonesData>(ZONES_QUERY);
  const mplus = data.worldData.zones.filter((z) => /^Mythic\+/.test(z.name));
  const current = mplus.find((z) => !z.frozen);
  if (!current) {
    throw new Error(
      "No active (non-frozen) Mythic+ zone found. Run `bmpl zones --mplus` to inspect.",
    );
  }
  const defaultPart =
    current.partitions?.find((p) => p.default) ?? current.partitions?.[0];
  return {
    id: current.id,
    name: current.name,
    partition: defaultPart?.id ?? 1,
  };
}

function buildMultiEncounterQuery(encounterIDs: number[]): string {
  const aliases = encounterIDs
    .map(
      (id, i) =>
        `        e${i}: encounterRankings(encounterID: ${id}, partition: $partition, metric: $metric, byBracket: true)`,
    )
    .join("\n");

  return /* GraphQL */ `
    query CharMplusAll(
      $name: String!
      $serverSlug: String!
      $serverRegion: String!
      $partition: Int
      $metric: CharacterRankingMetricType!
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
${aliases}
        }
      }
    }
  `;
}

interface ProbeResult {
  character: { id: number; name: string; classID: number } | null;
  dps: ZoneRankingsJson | null;
  hps: ZoneRankingsJson | null;
}

async function probe(
  name: string,
  realm: string,
  zone: CurrentMplusZone,
): Promise<ProbeResult> {
  const serverSlug = realmToSlug(realm);
  const data = await gql<{
    characterData: {
      character:
        | {
            id: number;
            name: string;
            classID: number;
            dps: ZoneRankingsJson | null;
            hps: ZoneRankingsJson | null;
          }
        | null;
    };
  }>(CHARACTER_METRIC_PROBE_QUERY, {
    name,
    serverSlug,
    serverRegion: config.region,
    zoneID: zone.id,
    partition: zone.partition,
  });
  const c = data.characterData.character;
  if (!c) return { character: null, dps: null, hps: null };
  return {
    character: { id: c.id, name: c.name, classID: c.classID },
    dps: c.dps,
    hps: c.hps,
  };
}

const topAllStarPoints = (z: ZoneRankingsJson | null): number =>
  z?.allStars?.[0]?.points ?? 0;

const hasScoredSpec = (z: ZoneRankingsJson | null): boolean =>
  (z?.allStars?.length ?? 0) > 0;

export interface FetchOptions {
  metric?: Metric;
  specFilter?: string | null;
  zone?: CurrentMplusZone;
}

export async function fetchMplusData(
  name: string,
  realm: string,
  opts: FetchOptions = {},
): Promise<MPlusData> {
  const serverSlug = realmToSlug(realm);
  const activeZone = opts.zone ?? (await getCurrentMplusZone());

  const probed = await probe(name, realm, activeZone);
  if (!probed.character) {
    throw new Error(
      `Character not found: ${name}-${realm} (slug: ${serverSlug}, region: ${config.region})`,
    );
  }

  // Decide metric.
  const dpsHas = hasScoredSpec(probed.dps);
  const hpsHas = hasScoredSpec(probed.hps);
  let metric: Metric;
  let autoSelected = false;
  if (opts.metric) {
    metric = opts.metric;
  } else if (opts.specFilter && isHealerSpec(opts.specFilter)) {
    metric = metricForSpec(opts.specFilter);
    autoSelected = true;
  } else if (hpsHas && !dpsHas) {
    metric = "hps";
    autoSelected = true;
  } else if (dpsHas && !hpsHas) {
    metric = "dps";
    autoSelected = true;
  } else {
    // Both exist — pick based on top all-stars points.
    metric = topAllStarPoints(probed.hps) > topAllStarPoints(probed.dps) ? "hps" : "dps";
    autoSelected = true;
  }

  const zoneJson = metric === "hps" ? probed.hps : probed.dps;
  const alternate = metric === "hps" ? probed.dps : probed.hps;
  const alternateMetricHasData = hasScoredSpec(alternate);

  const identity = toIdentity(probed.character, zoneJson);

  const seasonDungeons: SeasonDungeon[] =
    zoneJson?.rankings.map((r) => ({
      id: r.encounter.id,
      name: r.encounter.name,
    })) ?? [];

  if (!zoneJson || zoneJson.rankings.length === 0) {
    return {
      zoneID: activeZone.id,
      zoneName: activeZone.name,
      partition: activeZone.partition,
      metric,
      metricAutoSelected: autoSelected,
      alternateMetricHasData,
      character: identity,
      runs: [],
      seasonDungeons,
      specFilter: opts.specFilter ?? null,
    };
  }

  const encounterIDs = seasonDungeons.map((d) => d.id);
  const encounterNameByID = new Map(
    seasonDungeons.map((d) => [d.id, d.name]),
  );

  const multiQuery = buildMultiEncounterQuery(encounterIDs);
  const multi = await gql<{
    characterData: {
      character:
        | ({ id: number; name: string; classID: number } & Record<
            string,
            EncounterRankingsJson | unknown
          >)
        | null;
    };
  }>(multiQuery, {
    name,
    serverSlug,
    serverRegion: config.region,
    partition: activeZone.partition,
    metric,
  });

  const multiChar = multi.characterData.character;
  if (!multiChar) {
    throw new Error("Character vanished between queries (shouldn't happen)");
  }

  const runs: MPlusRun[] = [];
  encounterIDs.forEach((id, i) => {
    const alias = `e${i}`;
    const data = multiChar[alias] as EncounterRankingsJson | null;
    if (!data || !Array.isArray(data.ranks)) return;
    for (const r of data.ranks) {
      runs.push({
        encounterID: id,
        encounterName: encounterNameByID.get(id) ?? `Encounter ${id}`,
        keyLevel: r.bracketData,
        amount: r.amount,
        parsePercent: r.rankPercent,
        spec: r.spec,
        affixes: r.affixes,
        reportCode: r.report.code,
        fightID: r.report.fightID,
        startTime: r.startTime,
        score: r.score,
      });
    }
  });

  return {
    zoneID: activeZone.id,
    zoneName: activeZone.name,
    partition: activeZone.partition,
    metric,
    metricAutoSelected: autoSelected,
    alternateMetricHasData,
    character: identity,
    runs,
    seasonDungeons,
    specFilter: opts.specFilter ?? null,
  };
}

function toIdentity(
  char: { id: number; name: string; classID: number },
  zoneJson: ZoneRankingsJson | null,
): CharacterIdentity {
  const top = zoneJson?.allStars?.[0] ?? null;
  return {
    id: char.id,
    name: char.name,
    classID: char.classID,
    spec: top?.spec ?? null,
    scoreTop: top
      ? {
          spec: top.spec,
          rankPercent: top.rankPercent,
          points: top.points,
          regionRank: top.regionRank,
          serverRank: top.serverRank,
        }
      : null,
  };
}

export interface LookupResult {
  targetLevel: number;
  targetAutoDetected: boolean;
  atOrAboveTarget: MPlusRun[];
  prevLevelBest: {
    level: number;
    best: MPlusRun;
    runsAtLevel: number;
  } | null;
  perDungeon: {
    // One entry per dungeon the character has run (their best by key level, tie-break by parse).
    runs: MPlusRun[];
    // How many of the season's dungeons have at least one run from this character.
    dungeonsCovered: number;
    totalDungeonsInSeason: number;
    // How many dungeons have at least one run at or above the target level.
    dungeonsAtOrAboveTarget: number;
    medianLevel: number;
    medianAmount: number;
    medianParse: number;
  };
}

const median = (nums: number[]): number => {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
};

export const inferTargetLevel = (runs: MPlusRun[]): number | null => {
  if (runs.length === 0) return null;
  return Math.max(...runs.map((r) => r.keyLevel));
};

export function analyzeLookup(
  runs: MPlusRun[],
  targetLevel: number,
  seasonDungeons: SeasonDungeon[],
  targetAutoDetected = false,
): LookupResult {
  const atOrAbove = runs.filter((r) => r.keyLevel >= targetLevel);

  let prevLevelBest: LookupResult["prevLevelBest"] = null;
  for (let lvl = targetLevel - 1; lvl >= 2; lvl--) {
    const atLevel = runs.filter((r) => r.keyLevel === lvl);
    if (atLevel.length > 0) {
      const best = atLevel.reduce((a, b) =>
        b.parsePercent > a.parsePercent ? b : a,
      );
      prevLevelBest = { level: lvl, best, runsAtLevel: atLevel.length };
      break;
    }
  }

  // One best run per dungeon (highest key level; tie-break by parse %).
  const bestByDungeon = new Map<number, MPlusRun>();
  for (const r of runs) {
    const cur = bestByDungeon.get(r.encounterID);
    if (
      !cur ||
      r.keyLevel > cur.keyLevel ||
      (r.keyLevel === cur.keyLevel && r.parsePercent > cur.parsePercent)
    ) {
      bestByDungeon.set(r.encounterID, r);
    }
  }
  const perDungeonRuns = [...bestByDungeon.values()].sort(
    (a, b) => b.keyLevel - a.keyLevel || b.parsePercent - a.parsePercent,
  );
  const dungeonsAtOrAboveTarget = perDungeonRuns.filter(
    (r) => r.keyLevel >= targetLevel,
  ).length;

  return {
    targetLevel,
    targetAutoDetected,
    atOrAboveTarget: atOrAbove,
    prevLevelBest,
    perDungeon: {
      runs: perDungeonRuns,
      dungeonsCovered: perDungeonRuns.length,
      totalDungeonsInSeason: seasonDungeons.length,
      dungeonsAtOrAboveTarget,
      medianLevel: median(perDungeonRuns.map((r) => r.keyLevel)),
      medianAmount: median(perDungeonRuns.map((r) => r.amount)),
      medianParse: median(perDungeonRuns.map((r) => r.parsePercent)),
    },
  };
}
