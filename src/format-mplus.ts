import pc from "picocolors";
import type { LookupResult, MPlusData, MPlusRun } from "./mplus.ts";
import type { Metric } from "./roles.ts";
import {
  classColor,
  classNames,
  dim,
  heading,
  percentileColor,
} from "./format.ts";
import { ageInDays, formatAge, formatDps, wclReportUrl } from "./util.ts";

const STALE_DAYS = 14;

const metricLabel = (m: Metric): string => m;

export const renderHeader = (data: MPlusData): string => {
  const c = data.character;
  const className = classNames[c.classID] ?? `class #${c.classID}`;
  const specLabel = c.spec ? `${c.spec} ${className}` : className;
  const lines: string[] = [];
  lines.push(
    `${heading(c.name)} ${dim(`· ${classColor(c.classID, specLabel)}`)}`,
  );
  if (c.scoreTop) {
    const t = c.scoreTop;
    lines.push(
      dim(
        `  ${data.metric.toUpperCase()} score: ${t.points.toFixed(1)}  ·  region rank ${t.regionRank}  ·  server rank ${t.serverRank}  ·  ${t.spec}`,
      ),
    );
  }
  lines.push(
    `${dim(`  Zone: ${data.zoneName} (id ${data.zoneID}, partition ${data.partition})  ·  Metric: ${data.metric}  ·  Runs indexed:`)} ${pc.bold(String(data.runs.length))}`,
  );
  if (data.metricAutoSelected && data.alternateMetricHasData) {
    const other = data.metric === "hps" ? "dps" : "hps";
    lines.push(
      dim(`  (auto-selected ${data.metric}; also has ${other} data — use --metric ${other} to switch)`),
    );
  }
  if (data.specFilter) {
    lines.push(pc.yellow(`  [filtered to spec: ${data.specFilter}]`));
  }
  return lines.join("\n");
};

const deathColor = (n: number): string => {
  const label = `${n} death${n === 1 ? "" : "s"}`;
  if (n === 0) return pc.green(label);
  if (n <= 2) return pc.yellow(label);
  return pc.red(pc.bold(label));
};

const renderQuality = (r: MPlusRun): string => {
  if (!r.quality) return "";
  const dtps = formatDps(r.quality.dtps);
  return `${deathColor(r.quality.deaths)}  ${dim("·")}  ${dtps} dtps`;
};

const renderRun = (r: MPlusRun, metric: Metric, indent = "    "): string => {
  const amount = formatDps(r.amount);
  const parse = percentileColor(r.parsePercent);
  const level = pc.bold(`+${r.keyLevel}`);
  const url = dim(wclReportUrl(r.reportCode, r.fightID));
  const ageText = formatAge(r.startTime);
  const ageTag =
    ageInDays(r.startTime) >= STALE_DAYS
      ? pc.yellow(ageText)
      : dim(ageText);
  const mainLine = `${indent}${level} ${r.encounterName.padEnd(24)} ${amount.padStart(6)} ${metricLabel(metric)}  ${parse.padStart(4)}%  ${dim(r.spec)}  ${ageTag}`;
  const quality = renderQuality(r);
  const qualityLine = quality ? `\n${indent}   ${quality}` : "";
  return `${mainLine}${qualityLine}\n${indent}${dim("  → ")}${url}`;
};

export const renderLookup = (
  data: MPlusData,
  result: LookupResult,
): string => {
  const lines: string[] = [];
  lines.push(renderHeader(data));
  lines.push("");
  const autoTag = result.targetAutoDetected
    ? dim(" (auto — highest key run)")
    : "";
  lines.push(heading(`Target key level: +${result.targetLevel}`) + autoTag);

  if (result.atOrAboveTarget.length > 0) {
    lines.push(
      pc.green(
        `  ✓ has ${result.atOrAboveTarget.length} run(s) at or above +${result.targetLevel}`,
      ),
    );
  }

  lines.push("");
  if (result.prevLevelBest) {
    const { level, best, runsAtLevel } = result.prevLevelBest;
    const gap = result.targetLevel - level;
    const label =
      gap === 1
        ? `Best run at previous level (+${level})`
        : pc.yellow(`Best run at closest available level (+${level}, ${gap} below target)`);
    lines.push(
      `  ${label}  ${dim(`· ${runsAtLevel} run(s) indexed at +${level}`)}`,
    );
    lines.push(renderRun(best, data.metric));
  } else if (result.atOrAboveTarget.length > 0) {
    lines.push(
      dim(
        `  (no runs below +${result.targetLevel} — player only has runs at or above target)`,
      ),
    );
  } else {
    lines.push(
      dim(`  (no runs found at all — character has no M+ data this season)`),
    );
  }

  lines.push("");
  const pd = result.perDungeon;
  if (pd.runs.length > 0) {
    const coverage = `${pd.dungeonsCovered}/${pd.totalDungeonsInSeason} dungeons`;
    const atTargetPart =
      pd.dungeonsAtOrAboveTarget > 0
        ? `  ·  ${pc.green(`${pd.dungeonsAtOrAboveTarget}/${pd.totalDungeonsInSeason} at or above +${result.targetLevel}`)}`
        : "";
    const ages = pd.runs.map((r) => ageInDays(r.startTime)).sort((a, b) => a - b);
    const medianAgeDays = Math.round(
      ages.length % 2 === 0
        ? (ages[ages.length / 2 - 1]! + ages[ages.length / 2]!) / 2
        : ages[Math.floor(ages.length / 2)]!,
    );
    const ageTag =
      medianAgeDays >= STALE_DAYS
        ? pc.yellow(`median age ${medianAgeDays}d`)
        : dim(`median age ${medianAgeDays}d`);
    lines.push(
      heading("Best run per dungeon") +
        dim(
          `  · ${coverage}  ·  median: +${pd.medianLevel}, ${formatDps(pd.medianAmount)} ${data.metric}, ${percentileColor(pd.medianParse)}%`,
        ) +
        atTargetPart +
        `  ·  ${ageTag}`,
    );
    for (const r of pd.runs) lines.push(renderRun(r, data.metric));

    // Note any missing dungeons so user can see gaps in the profile.
    if (pd.dungeonsCovered < pd.totalDungeonsInSeason) {
      const coveredIDs = new Set(pd.runs.map((r) => r.encounterID));
      const missing = data.seasonDungeons
        .filter((d) => !coveredIDs.has(d.id))
        .map((d) => d.name);
      if (missing.length > 0) {
        lines.push(dim(`    (no runs in: ${missing.join(", ")})`));
      }
    }
  }

  return lines.join("\n");
};

export const renderSummary = (data: MPlusData): string => {
  const lines: string[] = [];
  lines.push(renderHeader(data));
  lines.push("");

  if (data.runs.length === 0) {
    lines.push(
      dim("  No M+ runs found for this character in the current season."),
    );
    return lines.join("\n");
  }

  const byLevel = new Map<number, MPlusRun[]>();
  for (const r of data.runs) {
    const arr = byLevel.get(r.keyLevel) ?? [];
    arr.push(r);
    byLevel.set(r.keyLevel, arr);
  }
  const levels = [...byLevel.keys()].sort((a, b) => b - a);

  lines.push(heading("Runs by key level"));
  for (const lvl of levels) {
    const arr = byLevel.get(lvl)!;
    const bestParse = Math.max(...arr.map((r) => r.parsePercent));
    const bestAmount = Math.max(...arr.map((r) => r.amount));
    lines.push(
      `  ${pc.bold(`+${String(lvl).padStart(2)}`)}  ${String(arr.length).padStart(3)} run${arr.length === 1 ? " " : "s"}  ${dim("·")} best parse ${percentileColor(bestParse)}%  ${dim("·")} best ${data.metric} ${formatDps(bestAmount)}`,
    );
  }

  return lines.join("\n");
};
