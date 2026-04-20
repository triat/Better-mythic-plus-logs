#!/usr/bin/env bun
import { gql } from "./wcl/client.ts";
import {
  CHARACTER_BASIC_QUERY,
  CHARACTER_ENCOUNTER_RANKINGS_QUERY,
  CHARACTER_ZONE_RANKINGS_QUERY,
  PING_QUERY,
  ZONES_QUERY,
} from "./wcl/queries.ts";
import type {
  CharacterBasic,
  CharacterEncounterRankings,
  CharacterZoneRankings,
  RateLimitData,
  ZonesData,
} from "./wcl/types.ts";
import { classColor, classNames, dim, err, heading, ok } from "./format.ts";
import { config } from "./config.ts";
import {
  analyzeLookup,
  enrichLookupResult,
  fetchMplusData,
  filterBySpec,
  inferTargetLevel,
  uniqueSpecs,
} from "./mplus.ts";
import type { Metric } from "./roles.ts";
import { renderLookup, renderSummary } from "./format-mplus.ts";
import { parseNameRealm, realmToSlug } from "./util.ts";
import { runServer } from "./server.ts";
import { runWatch } from "./watch.ts";

const USAGE = `bmpl — Better Mythic+ Logs (Warcraft Logs analyzer)

Usage:
  bmpl lookup <Name-Realm> | <name> <realm>  [--level <N>] [--spec X] [--metric dps|hps] [--json]
                                     Vet a player for a +N key: best run at +N-1
                                     + per-dungeon profile. Omit --level to auto-
                                     detect target from highest key run. Metric
                                     auto-selects (hps for healers, dps else).
  bmpl mplus  <Name-Realm> | <name> <realm>  [--spec X] [--metric dps|hps] [--json]
                                     Full M+ summary for current season.
  bmpl watch  [--level <N>] [--spec X] [--metric dps|hps] [--interval <ms>]
                                     Poll the clipboard; runs lookup whenever a
                                     Name-Realm string is copied. Omit --level
                                     to auto-detect per character. Ctrl+C to quit.
  bmpl serve  [--port <N>] [--no-open]
                                     Start the local web UI at http://localhost:<port>
                                     (default 3000) and auto-open your browser.
                                     First run shows a setup page for creds.
  bmpl char <name> <realm>           Basic character info.
  bmpl ping                          Verify API auth + show rate-limit budget.
  bmpl zones [--mplus]               List WCL zones (M+ filter available).
  bmpl help                          Show this help.

Debug:
  bmpl raw-rankings <name> <realm> --zone <id> [--partition <n>] [--by-bracket]
  bmpl raw-encounter <name> <realm> --encounter <id> [--partition <n>] [--by-bracket]
`;

async function cmdPing(): Promise<void> {
  const data = await gql<RateLimitData>(PING_QUERY);
  const { limitPerHour, pointsSpentThisHour, pointsResetIn } = data.rateLimitData;
  const remaining = limitPerHour - pointsSpentThisHour;
  console.log(ok("✓ auth ok"));
  console.log(
    `  budget: ${remaining.toFixed(2)} / ${limitPerHour} pts remaining ` +
      dim(`(resets in ${Math.round(pointsResetIn / 60)}m)`),
  );
}

async function cmdChar(name: string, realm: string): Promise<void> {
  const serverSlug = realmToSlug(realm);
  const data = await gql<CharacterBasic>(CHARACTER_BASIC_QUERY, {
    name,
    serverSlug,
    serverRegion: config.region,
  });
  const c = data.characterData.character;
  if (!c) {
    console.error(err(`Character not found: ${name}-${realm} (slug: ${serverSlug}, region: ${config.region})`));
    process.exit(1);
  }
  const className = classNames[c.classID] ?? `class #${c.classID}`;
  console.log(heading(`${c.name}-${c.server.name}`) + dim(` · ${c.server.region.slug.toUpperCase()}`));
  console.log(`  ${classColor(c.classID, className)} ${dim(`· faction: ${c.faction.name}`)}`);
  console.log(dim(`  wcl id: ${c.id}  ·  slug: ${c.server.slug}`));
}

function applySpecFilter(
  data: ReturnType<typeof fetchMplusData> extends Promise<infer T> ? T : never,
  spec: string | null,
  json: boolean,
): typeof data {
  if (!spec) return data;
  const filtered = filterBySpec(data.runs, spec);
  if (filtered.length === 0) {
    const available = uniqueSpecs(data.runs);
    const msg =
      `No runs found for spec "${spec}". ` +
      (available.length > 0
        ? `Specs seen on this character: ${available.join(", ")}.`
        : `This character has no runs this season.`);
    if (json) {
      console.error(msg);
    } else {
      console.error(err("✗ " + msg));
    }
    process.exit(1);
  }
  return { ...data, runs: filtered, specFilter: spec };
}

function resolveTarget(positional: string[]):
  | { name: string; realm: string }
  | null {
  if (positional.length === 1) {
    return parseNameRealm(positional[0]!);
  }
  if (positional.length >= 2) {
    return {
      name: positional[0]!,
      realm: positional.slice(1).join(" "),
    };
  }
  return null;
}

function parseMetric(raw: string | undefined): Metric | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "dps" || v === "hps") return v;
  console.error(err(`Invalid --metric value: "${raw}" (expected dps or hps)`));
  process.exit(2);
}

async function cmdLookup(
  name: string,
  realm: string,
  targetLevel: number | null,
  spec: string | null,
  metric: Metric | undefined,
  enrich: boolean,
  json: boolean,
): Promise<void> {
  let data = await fetchMplusData(name, realm, {
    metric,
    specFilter: spec,
  });
  data = applySpecFilter(data, spec, json);
  const inferred = inferTargetLevel(data.runs);
  const effective = targetLevel ?? inferred;
  if (effective === null) {
    console.error(
      err(
        "✗ cannot auto-detect --level: no runs found for this character. Pass --level <N> explicitly.",
      ),
    );
    process.exit(1);
  }
  const result = analyzeLookup(
    data.runs,
    effective,
    data.seasonDungeons,
    targetLevel === null,
  );
  if (enrich) await enrichLookupResult(data, result);
  if (json) {
    console.log(
      JSON.stringify(
        {
          character: {
            ...data.character,
            realmSlug: realmToSlug(realm),
            region: config.region,
          },
          zone: {
            id: data.zoneID,
            name: data.zoneName,
            partition: data.partition,
          },
          metric: data.metric,
          metricAutoSelected: data.metricAutoSelected,
          specFilter: data.specFilter,
          runsIndexed: data.runs.length,
          seasonDungeons: data.seasonDungeons,
          targetLevel: result.targetLevel,
          atOrAboveTargetCount: result.atOrAboveTarget.length,
          prevLevelBest: result.prevLevelBest,
          perDungeon: result.perDungeon,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(renderLookup(data, result));
}

async function cmdMplus(
  name: string,
  realm: string,
  spec: string | null,
  metric: Metric | undefined,
  json: boolean,
): Promise<void> {
  let data = await fetchMplusData(name, realm, {
    metric,
    specFilter: spec,
  });
  data = applySpecFilter(data, spec, json);
  if (json) {
    const byLevel: Record<
      number,
      { count: number; bestParse: number; bestAmount: number }
    > = {};
    for (const r of data.runs) {
      const entry = byLevel[r.keyLevel] ?? {
        count: 0,
        bestParse: 0,
        bestAmount: 0,
      };
      entry.count += 1;
      entry.bestParse = Math.max(entry.bestParse, r.parsePercent);
      entry.bestAmount = Math.max(entry.bestAmount, r.amount);
      byLevel[r.keyLevel] = entry;
    }
    console.log(
      JSON.stringify(
        {
          character: {
            ...data.character,
            realmSlug: realmToSlug(realm),
            region: config.region,
          },
          zone: {
            id: data.zoneID,
            name: data.zoneName,
            partition: data.partition,
          },
          byLevel,
          runs: data.runs,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(renderSummary(data));
}

async function cmdZones(filterMplus: boolean): Promise<void> {
  const data = await gql<ZonesData>(ZONES_QUERY);
  const zones = data.worldData.zones;
  const filtered = filterMplus
    ? zones.filter((z) => /mythic\+|mythic plus|m\+/i.test(z.name))
    : zones;

  for (const z of filtered) {
    const frozenTag = z.frozen ? dim(" (frozen)") : "";
    console.log(
      `${heading(z.id.toString().padStart(4))} ${z.name}${frozenTag} ${dim(
        `— ${z.expansion.name}`,
      )}`,
    );
    if (z.partitions && z.partitions.length > 0) {
      for (const p of z.partitions) {
        const def = p.default ? ok(" [default]") : "";
        console.log(
          dim(`        partition ${p.id}: ${p.name} (${p.compactName})`) + def,
        );
      }
    }
  }
}

async function cmdRawRankings(
  name: string,
  realm: string,
  zoneID: number,
  partition: number | undefined,
  byBracket: boolean,
): Promise<void> {
  const serverSlug = realmToSlug(realm);
  const data = await gql<CharacterZoneRankings>(
    CHARACTER_ZONE_RANKINGS_QUERY,
    {
      name,
      serverSlug,
      serverRegion: config.region,
      zoneID,
      partition: partition ?? null,
      byBracket,
    },
  );
  const c = data.characterData.character;
  if (!c) {
    console.error(err(`Character not found: ${name}-${realm}`));
    process.exit(1);
  }
  console.log(JSON.stringify(c.zoneRankings, null, 2));
}

async function cmdRawEncounter(
  name: string,
  realm: string,
  encounterID: number,
  partition: number | undefined,
  byBracket: boolean,
): Promise<void> {
  const serverSlug = realmToSlug(realm);
  const data = await gql<CharacterEncounterRankings>(
    CHARACTER_ENCOUNTER_RANKINGS_QUERY,
    {
      name,
      serverSlug,
      serverRegion: config.region,
      encounterID,
      partition: partition ?? null,
      byBracket,
    },
  );
  const c = data.characterData.character;
  if (!c) {
    console.error(err(`Character not found: ${name}-${realm}`));
    process.exit(1);
  }
  console.log(JSON.stringify(c.encounterRankings, null, 2));
}

function parseFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function stripFlags(args: string[], flagsWithValues: string[], booleanFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flagsWithValues.includes(a)) {
      i++;
      continue;
    }
    if (booleanFlags.includes(a)) continue;
    out.push(a);
  }
  return out;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;

  try {
    switch (cmd) {
      case "ping":
        await cmdPing();
        break;
      case "char": {
        const target = resolveTarget(rest);
        if (!target) {
          console.error(
            err("Usage: bmpl char <name> <realm>   OR   bmpl char <Name-Realm>"),
          );
          process.exit(2);
        }
        await cmdChar(target.name, target.realm);
        break;
      }
      case "lookup": {
        const lvlStr = parseFlag(rest, "--level");
        const spec = parseFlag(rest, "--spec") ?? null;
        const metric = parseMetric(parseFlag(rest, "--metric"));
        const json = hasFlag(rest, "--json");
        const enrich = !hasFlag(rest, "--no-stats");
        const positional = stripFlags(
          rest,
          ["--level", "--spec", "--metric"],
          ["--json", "--no-stats"],
        );
        const target = resolveTarget(positional);
        if (!target) {
          console.error(
            err(
              "Usage: bmpl lookup <name> <realm> [--level <N>] [--spec X] [--metric dps|hps] [--no-stats] [--json]\n" +
                "       bmpl lookup <Name-Realm> ...\n" +
                "       (omit --level to auto-detect target from the character's highest run)",
            ),
          );
          process.exit(2);
        }
        let lvl: number | null = null;
        if (lvlStr) {
          lvl = Number.parseInt(lvlStr, 10);
          if (!Number.isFinite(lvl) || lvl < 2) {
            console.error(err(`Invalid --level value: ${lvlStr}`));
            process.exit(2);
          }
        }
        await cmdLookup(
          target.name,
          target.realm,
          lvl,
          spec,
          metric,
          enrich,
          json,
        );
        break;
      }
      case "mplus": {
        const spec = parseFlag(rest, "--spec") ?? null;
        const metric = parseMetric(parseFlag(rest, "--metric"));
        const json = hasFlag(rest, "--json");
        const positional = stripFlags(rest, ["--spec", "--metric"], ["--json"]);
        const target = resolveTarget(positional);
        if (!target) {
          console.error(
            err(
              "Usage: bmpl mplus <name> <realm> [--spec <name>] [--metric dps|hps] [--json]\n" +
                "       bmpl mplus <Name-Realm> ...",
            ),
          );
          process.exit(2);
        }
        await cmdMplus(target.name, target.realm, spec, metric, json);
        break;
      }
      case "serve": {
        const portStr = parseFlag(rest, "--port");
        const port = portStr ? Number.parseInt(portStr, 10) : 3000;
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
          console.error(err(`Invalid --port value: ${portStr}`));
          process.exit(2);
        }
        const open = !hasFlag(rest, "--no-open");
        await runServer({ port, open });
        // Bun.serve keeps the process alive; do not return.
        return;
      }
      case "watch": {
        const lvlStr = parseFlag(rest, "--level");
        let lvl: number | null = null;
        if (lvlStr) {
          lvl = Number.parseInt(lvlStr, 10);
          if (!Number.isFinite(lvl) || lvl < 2) {
            console.error(err(`Invalid --level value: ${lvlStr}`));
            process.exit(2);
          }
        }
        const spec = parseFlag(rest, "--spec") ?? null;
        const metric = parseMetric(parseFlag(rest, "--metric"));
        const intervalStr = parseFlag(rest, "--interval");
        const intervalMs = intervalStr ? Number.parseInt(intervalStr, 10) : 750;
        if (!Number.isFinite(intervalMs) || intervalMs < 100) {
          console.error(
            err(`Invalid --interval value: ${intervalStr} (min 100ms)`),
          );
          process.exit(2);
        }
        const enrich = !hasFlag(rest, "--no-stats");
        await runWatch({ level: lvl, spec, metric, intervalMs, enrich });
        break;
      }
      case "zones":
        await cmdZones(hasFlag(rest, "--mplus"));
        break;
      case "raw-encounter": {
        const encStr = parseFlag(rest, "--encounter");
        if (!encStr) {
          console.error(err("Missing --encounter <id>"));
          process.exit(2);
        }
        const partStr = parseFlag(rest, "--partition");
        const byBracket = hasFlag(rest, "--by-bracket");
        const positional = stripFlags(
          rest,
          ["--encounter", "--partition"],
          ["--by-bracket"],
        );
        if (positional.length < 2) {
          console.error(
            err("Usage: bmpl raw-encounter <name> <realm> --encounter <id> [--partition <n>] [--by-bracket]"),
          );
          process.exit(2);
        }
        await cmdRawEncounter(
          positional[0]!,
          positional.slice(1).join(" "),
          Number.parseInt(encStr, 10),
          partStr ? Number.parseInt(partStr, 10) : undefined,
          byBracket,
        );
        break;
      }
      case "raw-rankings": {
        const zoneStr = parseFlag(rest, "--zone");
        if (!zoneStr) {
          console.error(err("Missing --zone <id>"));
          process.exit(2);
        }
        const partStr = parseFlag(rest, "--partition");
        const byBracket = hasFlag(rest, "--by-bracket");
        const positional = stripFlags(
          rest,
          ["--zone", "--partition"],
          ["--by-bracket"],
        );
        if (positional.length < 2) {
          console.error(
            err("Usage: bmpl raw-rankings <name> <realm> --zone <id> [--partition <n>] [--by-bracket]"),
          );
          process.exit(2);
        }
        await cmdRawRankings(
          positional[0]!,
          positional.slice(1).join(" "),
          Number.parseInt(zoneStr, 10),
          partStr ? Number.parseInt(partStr, 10) : undefined,
          byBracket,
        );
        break;
      }
      case undefined:
      case "help":
      case "-h":
      case "--help":
        console.log(USAGE);
        break;
      default:
        console.error(err(`Unknown command: ${cmd}`));
        console.error(USAGE);
        process.exit(2);
    }
  } catch (e) {
    console.error(err("✗ " + (e instanceof Error ? e.message : String(e))));
    process.exit(1);
  }
}

main();
