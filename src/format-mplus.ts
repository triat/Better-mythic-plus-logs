import pc from "picocolors";
import type { AxisKey, Evaluation } from "./evaluation/types.ts";
import type { LookupResult, MPlusData, MPlusRun } from "./mplus.ts";
import type { Metric } from "./roles.ts";
import {
  classColor,
  classNames,
  dim,
  heading,
  percentileColor,
} from "./format.ts";
import type { SignalSummary } from "./signals/summary.ts";
import type { RioProfile, RunSignals } from "./signals/types.ts";
import { ageInDays, formatAge, formatDps, formatDuration, wclReportUrl } from "./util.ts";

const STALE_DAYS = 14;

const metricLabel = (m: Metric): string => m;

const deathsText = (s: RunSignals): string => {
  const n = s.deaths.count;
  const wipes = s.deaths.events.filter((e) => e.inWipe).length;
  const label = `${n} death${n === 1 ? "" : "s"}` + (wipes > 0 ? ` (${wipes} in wipe)` : "");
  if (n === 0) return pc.green(label);
  if (n <= 2) return pc.yellow(label);
  return pc.red(pc.bold(label));
};

const lowerIsBetter = (deltaPct: number, label: string): string => {
  if (deltaPct <= -10) return pc.green(label);
  if (deltaPct <= 10) return dim(label);
  if (deltaPct <= 30) return pc.yellow(label);
  return pc.red(pc.bold(label));
};

const dtpsText = (s: RunSignals): string => {
  const base = `${formatDps(s.damageTaken.dtps)} dtps`;
  const p = s.damageTaken.peer;
  if (!p || p.median <= 0) return base;
  const delta = ((s.damageTaken.dtps - p.median) / p.median) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${base} ${lowerIsBetter(delta, `${sign}${delta.toFixed(0)}% vs ${p.count} dps peer${p.count === 1 ? "" : "s"}`)}`;
};

const avoidableText = (s: RunSignals): string | null => {
  const a = s.avoidableDamage;
  if (!a) return null;
  const base = `avoidable ${formatDps(a.perMinute)}/min`;
  if (!a.peer || a.peer.median <= 0) return base;
  const delta = ((a.perMinute - a.peer.median) / a.peer.median) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${base} ${lowerIsBetter(delta, `(${sign}${delta.toFixed(0)}%)`)}`;
};

const kicksText = (s: RunSignals): string => {
  const i = s.interrupts;
  if (i.kickCooldownS === null) return dim(`kicks ${i.count} (no kick on spec)`);
  if (i.capacity === null || i.usage === null) return `kicks ${i.count}`;
  const base = `kicks ${i.count}/${Math.round(i.capacity)}`;
  if (!i.peer) return base;
  const peerPct = `(peer ${Math.round(i.peer.median * 100)}%)`;
  const delta = (i.usage - i.peer.median) * 100;
  const colored = delta >= 0 ? pc.green(peerPct) : delta < -25 ? pc.red(peerPct) : dim(peerPct);
  return `${base} ${colored}`;
};

export const renderRunSignals = (s: RunSignals): string => {
  const parts = [deathsText(s), dtpsText(s)];
  const av = avoidableText(s);
  if (av) parts.push(av);
  parts.push(kicksText(s), `dispels ${s.dispels.count}`);
  return parts.join(`  ${dim("·")}  `);
};

const keyBadge = (r: MPlusRun): string => {
  const level = pc.bold(`+${r.keyLevel}`);
  const s = r.signals;
  if (!s || s.partial) return level;
  return s.keystone.timed
    ? `${level} ${pc.green(`✓+${s.keystone.chests} ${formatDuration(s.keystone.timeMs)}`)}`
    : `${level} ${pc.red(`✗ depleted ${formatDuration(s.keystone.timeMs)}`)}`;
};

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

const renderRun = (r: MPlusRun, metric: Metric, indent = "    "): string => {
  const amount = formatDps(r.amount);
  const parse = percentileColor(r.parsePercent);
  const level = keyBadge(r);
  const url = dim(wclReportUrl(r.reportCode, r.fightID));
  const ageText = formatAge(r.startTime);
  const ageTag =
    ageInDays(r.startTime) >= STALE_DAYS
      ? pc.yellow(ageText)
      : dim(ageText);
  const mainLine = `${indent}${level} ${r.encounterName.padEnd(24)} ${amount.padStart(6)} ${metricLabel(metric)}  ${parse.padStart(4)}%  ${dim(r.spec)}  ${ageTag}`;
  const quality = r.signals ? renderRunSignals(r.signals) : "";
  const qualityLine = quality ? `\n${indent}   ${quality}` : "";
  return `${mainLine}${qualityLine}\n${indent}${dim("  → ")}${url}`;
};

export const renderSummaryLine = (summary: SignalSummary): string => {
  const fmtDelta = (v: number | null, unit: "%" | "pts", lowerBetter: boolean): string => {
    if (v === null) return dim("—");
    const label = `${v >= 0 ? "+" : ""}${v.toFixed(0)}${unit}`;
    const good = lowerBetter ? v <= -10 : v >= 0;
    const bad = lowerBetter ? v > 30 : v < -25;
    return good ? pc.green(label) : bad ? pc.red(label) : dim(label);
  };
  const tiles: string[] = [];
  tiles.push(`timed ${summary.timedShown === null ? dim("—") : `${summary.timedShown}/${summary.runsWithSignals}`}`);
  tiles.push(`avg deaths ${summary.avgDeaths === null ? dim("—") : summary.avgDeaths.toFixed(1)}${summary.deathsInWipes ? dim(` (${summary.deathsInWipes} in wipes)`) : ""}`);
  tiles.push(`Δdtps ${fmtDelta(summary.dtpsDeltaPct, "%", true)}`);
  tiles.push(`avoidable ${fmtDelta(summary.avoidableDeltaPct, "%", true)}`);
  tiles.push(`kicks ${fmtDelta(summary.kicksDeltaPts, "pts", false)}`);
  tiles.push(`ilvl ${summary.ilvl ?? dim("—")}`);
  tiles.push(`RIO recent timed ${summary.recentTotal === null ? dim("—") : `${summary.recentTimed}/${summary.recentTotal}`}`);
  tiles.push(`prev season ${summary.prevSeason ? `${summary.prevSeason.all.toFixed(0)} (${summary.prevSeason.best.role})` : dim("— no data (reroll?)")}`);
  return dim("  ") + tiles.join(dim("  ·  "));
};

const AXIS_LABEL: Record<AxisKey, string> = {
  survival: "Survival", utility: "Utility", throughput: "Throughput",
  consistency: "Consistency", preparation: "Preparation", experience: "Experience",
};
const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;

export const renderEvaluation = (ev: Evaluation): string => {
  const runs = `${ev.runsUsed} run${ev.runsUsed === 1 ? "" : "s"}`;
  const g = ev.global === null ? null : Math.round(ev.global);
  let verdict: string;
  switch (ev.verdict) {
    case "invite": verdict = pc.green(pc.bold(`INVITE ${g}`)); break;
    case "maybe": verdict = pc.yellow(pc.bold(`MAYBE ${g}`)); break;
    case "pass": verdict = pc.red(pc.bold(`PASS ${g}`)); break;
    default: verdict = dim(`INSUFFICIENT DATA (${runs}${g === null ? "" : `, ${g}`})`);
  }
  const scored = ev.axes.filter((a) => a.score !== null);
  const minConf = scored.length === 0 ? "low" : scored.reduce((m, a) => (CONF_RANK[a.confidence] < CONF_RANK[m] ? a.confidence : m), "high" as Evaluation["axes"][number]["confidence"]);
  const axisPart = ev.axes.map((a) => `${AXIS_LABEL[a.key]} ${a.score === null ? dim("n/a") : pc.bold(String(Math.round(a.score)))}`).join("  ");
  const lines = [`${heading("Verdict:")} ${verdict}  ${dim("·")}  ${axisPart}  ${dim(`(${minConf} confidence, ${runs})`)}`];
  for (const a of ev.axes) {
    if (a.evidence.length === 0) continue;
    const ev2 = a.evidence.slice(0, 2).map((e) => {
      const d = Math.round(e.delta);
      const tag = `${d >= 0 ? "+" : "-"}${Math.abs(d)}`;
      return `${d >= 0 ? pc.green(tag) : pc.red(tag)} ${e.label}`;
    });
    lines.push(`  ${AXIS_LABEL[a.key].padEnd(12)} ${ev2.join(`  ${dim("·")}  `)}`);
  }
  return lines.join("\n");
};

export const renderLookup = (
  data: MPlusData,
  result: LookupResult,
  rio: RioProfile | null,
  rioError: string | undefined,
  summary: SignalSummary,
  evaluation: Evaluation,
): string => {
  const lines: string[] = [];
  lines.push(renderHeader(data));
  lines.push("");

  lines.push(renderSummaryLine(summary));
  lines.push("");
  lines.push(renderEvaluation(evaluation));

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

  lines.push("");
  if (rio) {
    lines.push(heading("Recent (Raider.IO)") + dim(`  · ${rio.profileUrl}`));
    for (const r of rio.recentRuns.slice(0, 10)) {
      const timed = r.chests > 0 ? pc.green(`✓+${r.chests}`) : pc.red("✗");
      lines.push(`    ${pc.bold(`+${r.level}`)} ${r.dungeon.padEnd(24)} ${timed} ${formatDuration(r.clearMs)}/${formatDuration(r.parMs)}  ${dim(formatAge(r.completedAt))}`);
    }
    if (rio.recentRuns.length === 0) lines.push(dim("    (no recent runs on Raider.IO)"));
  } else {
    lines.push(dim(`  Raider.IO: ${rioError ?? "no data"}`));
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
