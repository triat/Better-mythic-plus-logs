#!/usr/bin/env bun
import pc from "picocolors";
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
import { getDefensives, loadDefensives, specDefensives } from "./deepdive/table.ts";
import type { RunDefensives } from "./deepdive/types.ts";
import { runDeepdive } from "./deepdive/run.ts";
import { estimateDeepdiveCost } from "./deepdive/wcl.ts";
import { getEvalConfig } from "./evaluation/config.ts";
import { evaluate } from "./evaluation/evaluate.ts";
import type { EvalPayload } from "./evaluation/inputs.ts";
import { fetchMplusData, filterBySpec, uniqueSpecs } from "./mplus.ts";
import type { MPlusRun } from "./mplus.ts";
import type { Metric } from "./roles.ts";
import { renderDeepdive, renderEvaluation, renderLookup, renderSummary } from "./format-mplus.ts";
import { buildLookupPayload, performLookup } from "./lookup.ts";
import { displayedRuns } from "./signals/enrich.ts";
import { closeStore, getStore } from "./signals/store.ts";
import { parseNameRealm, parseRaiderIOUrl, realmToSlug } from "./util.ts";
import { runServer } from "./server.ts";
import { DISCORD_ID, resolveMode, validateHostedEnv } from "./hosted/config.ts";
import type { HostedConfig } from "./hosted/config.ts";
import { openHosted } from "./hosted/db.ts";
import { runWatch } from "./watch.ts";

const USAGE = `bmpl — Better Mythic+ Logs (Warcraft Logs analyzer)

Usage:
  bmpl lookup <Name-Realm> | <name> <realm>  [--level <N>] [--spec X] [--metric dps|hps] [--json]
                                     Vet a player for a +N key: best run at +N-1
                                     + per-dungeon profile. Omit --level to auto-
                                     detect target (median of best runs). Metric
                                     auto-selects (hps for healers, dps else).
  bmpl mplus  <Name-Realm> | <name> <realm>  [--spec X] [--metric dps|hps] [--json]
                                     Full M+ summary for current season.
  bmpl watch  [--level <N>] [--spec X] [--metric dps|hps] [--interval <ms>]
                                     Poll the clipboard; runs lookup whenever a
                                     Name-Realm string is copied. Omit --level
                                     to auto-detect per character. Ctrl+C to quit.
  bmpl serve  [--port <N>] [--no-open] [--hosted]
                                     Start the web UI at http://localhost:<port>
                                     (default 3000) and auto-open your browser.
                                     First run shows a setup page for creds.
                                     --hosted (or BMPL_MODE=hosted): multi-user
                                     deployment behind a reverse proxy — needs the
                                     BMPL_* variables from .env.hosted.example.
  bmpl evaluate <payload.json> [--json]
                                     Re-run the evaluation model on a saved lookup
                                     (--json output). Uses evaluation.json next to
                                     .env if present.
  bmpl analyze <Name-Realm> [--run <code>:<fight>]... [--all] [--force] [--yes] [--level <N>] [--spec X] [--json]
                                     Deep-dive the defensive cooldowns of shown runs
                                     (~3 WCL pts per run, cached forever). Without
                                     --run/--all: lists the runs and their status.
                                     --json requires --yes to fetch runs (no prompt).
  bmpl defensives <Class> <Spec> | --check
                                     Show the effective defensives table for a spec
                                     (shipped + your defensives.json), or validate the file.
  bmpl invite <discord-id> [--note "…"] | --list | --remove <discord-id>
                                     Hosted mode: allow a Discord user to sign in
                                     (writes the invites table in bmpl.db).
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
    const rio = parseRaiderIOUrl(positional[0]!);
    if (rio) return { name: rio.name, realm: rio.realm };
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
  const o = await performLookup({ name, realm, level: targetLevel, spec, metric, enrich });
  if (!o.ok) {
    console.error(json ? o.error : err("✗ " + o.error));
    closeStore();
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify(buildLookupPayload(o, realm), null, 2));
    closeStore();
    return;
  }
  console.log(renderLookup(o.data, o.result, o.rio, o.rioError, o.summary, o.evaluation, o.deepdive));
  closeStore();
}

/** Structural check only — enough to catch "wrong file" without re-validating the whole shape. */
function looksLikeEvalPayload(v: unknown): v is EvalPayload {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.targetLevel !== "number") return false;
  if (typeof o.summary !== "object" || o.summary === null) return false;
  const perDungeon = o.perDungeon as Record<string, unknown> | undefined;
  if (typeof perDungeon !== "object" || perDungeon === null || !Array.isArray(perDungeon.runs)) return false;
  return true;
}

async function cmdEvaluate(file: string, json: boolean): Promise<void> {
  const f = Bun.file(file);
  if (!(await f.exists())) {
    console.error(err(`✗ file not found: ${file}`));
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await f.text());
  } catch {
    console.error(err(`✗ not a bmpl lookup --json payload: ${file}`));
    process.exit(1);
  }
  if (!looksLikeEvalPayload(parsed)) {
    console.error(err(`✗ not a bmpl lookup --json payload: ${file}`));
    process.exit(1);
  }
  const ev = evaluate(parsed as EvalPayload, await getEvalConfig());
  if (json) console.log(JSON.stringify(ev, null, 2));
  else console.log(renderEvaluation(ev));
}

/** Which shown runs `bmpl analyze` reports (`wanted`) and which of them cost a fetch (`toFetch`); `unknown` = --run keys not among the shown runs. Pure. */
export function selectRuns<R extends { reportCode: string; fightID: number }>(
  shown: R[], analyzedKeys: Set<string>, runKeys: string[], all: boolean, force: boolean,
): { wanted: R[]; toFetch: R[]; unknown: string[] } {
  const key = (r: R) => `${r.reportCode}:${r.fightID}`;
  const wanted = shown.filter((r) => all || runKeys.includes(key(r)));
  const toFetch = wanted.filter((r) => force || !analyzedKeys.has(key(r)));
  const unknown = runKeys.filter((k) => !shown.some((r) => key(r) === k));
  return { wanted, toFetch, unknown };
}

async function cmdAnalyze(
  name: string, realm: string, targetLevel: number | null, spec: string | null,
  runKeys: string[], all: boolean, force: boolean, yes: boolean, json: boolean,
): Promise<void> {
  if (json && !yes && (all || runKeys.length > 0)) {
    console.error(err("✗ --json needs --yes to fetch runs"));
    closeStore();
    process.exit(2);
  }
  const o = await performLookup({ name, realm, level: targetLevel, spec, enrich: true });
  if (!o.ok) { console.error(json ? o.error : err("✗ " + o.error)); closeStore(); process.exit(1); }
  const shown = displayedRuns(o.result);
  const analyzed = new Set(o.deepdive.map((d) => `${d.reportCode}:${d.fightID}`));
  const key = (r: MPlusRun) => `${r.reportCode}:${r.fightID}`;
  if (!all && runKeys.length === 0) {
    console.log(heading(`${o.data.character.name}-${realm}`) + dim("  runs shown by lookup — pass --run <code>:<fight> or --all"));
    for (const r of shown) console.log(`  ${analyzed.has(key(r)) ? ok("✓") : dim("·")} ${key(r).padEnd(24)} +${r.keyLevel} ${r.encounterName}`);
    closeStore();
    return;
  }
  // Already-analyzed runs are shown from the cache (0 pts); only `toFetch` costs points and needs the confirmation.
  const { wanted, toFetch, unknown } = selectRuns(shown, analyzed, runKeys, all, force);
  if (unknown.length > 0) { console.error(err(`✗ not among the shown runs: ${unknown.join(", ")}`)); closeStore(); process.exit(2); }
  if (toFetch.length > 0 && !yes && !json) {
    const go = confirm(`Analyze ${toFetch.length} run${toFetch.length === 1 ? "" : "s"} for ~${toFetch.length * estimateDeepdiveCost()} WCL pts?`);
    if (!go) { closeStore(); process.exit(0); }
  }
  const [store, tables] = await Promise.all([getStore(), getDefensives()]);
  const results: RunDefensives[] = [];
  for (const r of wanted) {
    const res = await runDeepdive({ reportCode: r.reportCode, fightID: r.fightID, character: o.data.character.name, force }, { store, tables });
    if (!res.ok) { console.error(err(`✗ ${key(r)}: ${res.error}`)); if (res.status === 402) break; continue; }
    results.push(res.result);
    if (!json) {
      console.log(`\n+${r.keyLevel} ${r.encounterName}  ${dim(res.fromCache ? "cached · 0 pts" : `${res.pointsSpent ?? "~3"} pts`)}`);
      console.log(renderDeepdive(res.result));
    }
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  closeStore();
}

async function cmdDefensives(className: string | undefined, spec: string | undefined, check: boolean): Promise<void> {
  const t = await loadDefensives();
  if (check) {
    if (t.warning) { console.error(err(`✗ ${t.warning}`)); process.exit(1); }
    console.log(ok(`✓ ${t.overridePath}: ${Object.keys(t.override).length} spec key(s)`));
    return;
  }
  if (!className || !spec) { console.error(err("Usage: bmpl defensives <Class> <Spec> | --check")); process.exit(2); }
  const d = specDefensives(t.shipped, t.override, className, spec);
  console.log(heading(`${d.key}`) + dim(`  override: ${t.overridePath}${t.warning ? "  (ignored: invalid)" : ""}`));
  if (d.tableMissing) console.log(pc.yellow("  no table for this spec — add entries to your defensives.json"));
  for (const e of d.entries) console.log(`  ${String(e.id).padStart(8)}  ${e.name.padEnd(28)} ${e.kind.padEnd(8)} cd ${String(e.cooldownS).padStart(3)}s  dur ${String(e.durationS).padStart(3)}s  ${e.origin === "override" ? pc.cyan("override") : dim("shipped")}`);
  if (d.ignored.length > 0) console.log(dim(`  ignored: ${d.ignored.join(", ")}`));
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
    closeStore();
    return;
  }
  console.log(renderSummary(data));
  closeStore();
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

/** Pure `serve` argument/env resolution — the command prints `error` and exits 2 on failure. */
export function planServe(args: string[], env: Record<string, string | undefined>):
  | { ok: true; port: number; open: false; hosted: true; hostedConfig: HostedConfig }
  | { ok: true; port: number; open: boolean; hosted: false }
  | { ok: false; error: string } {
  const portStr = parseFlag(args, "--port");
  const port = portStr ? Number.parseInt(portStr, 10) : 3000;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return { ok: false, error: `Invalid --port value: ${portStr}` };
  const mode = resolveMode(hasFlag(args, "--hosted"), env);
  if (!mode.ok) return { ok: false, error: mode.error };
  if (mode.mode === "hosted") {
    const v = validateHostedEnv(env);
    if (!v.ok) {
      const parts = [
        v.missing.length ? `missing: ${v.missing.join(", ")}` : "",
        v.invalid.length ? `invalid: ${v.invalid.join("; ")}` : "",
      ].filter(Boolean);
      return { ok: false, error: `Hosted mode needs a complete environment — ${parts.join(" — ")}. See .env.hosted.example.` };
    }
    return { ok: true, port, open: false, hosted: true, hostedConfig: v.config };
  }
  return { ok: true, port, open: !hasFlag(args, "--no-open"), hosted: false };
}

function parseFlags(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1] !== undefined) out.push(args[i + 1]!);
  return out;
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

/** Pure `invite` argument parsing. */
export function planInvite(args: string[]):
  | { ok: true; action: "add"; discordId: string; note: string | null }
  | { ok: true; action: "list" }
  | { ok: true; action: "remove"; discordId: string }
  | { ok: false; error: string } {
  if (hasFlag(args, "--list")) return { ok: true, action: "list" };
  const usage = "Usage: bmpl invite <discord-id> [--note \"…\"] | --list | --remove <discord-id>";
  const remove = parseFlag(args, "--remove");
  if (args.includes("--remove")) {
    if (!remove || !DISCORD_ID.test(remove)) return { ok: false, error: `${usage}\nDiscord ids are 17–20 digit numbers (Discord → Settings → Advanced → Developer Mode, then right-click a user → Copy User ID).` };
    return { ok: true, action: "remove", discordId: remove };
  }
  const positional = stripFlags(args, ["--note"], []);
  const discordId = positional[0];
  if (!discordId || !DISCORD_ID.test(discordId)) return { ok: false, error: `${usage}\nDiscord ids are 17–20 digit numbers (Discord → Settings → Advanced → Developer Mode, then right-click a user → Copy User ID).` };
  return { ok: true, action: "add", discordId, note: parseFlag(args, "--note") ?? null };
}

async function cmdInvite(args: string[]): Promise<void> {
  const plan = planInvite(args);
  if (!plan.ok) { console.error(err(plan.error)); process.exit(2); }
  const db = openHosted((await getStore())._db);
  if (plan.action === "list") {
    const rows = db.invites.list();
    if (rows.length === 0) { console.log(dim("no invites")); return; }
    for (const r of rows) console.log(`${r.discordId}  ${dim(new Date(r.createdAt).toISOString().slice(0, 10))}  ${dim(r.invitedBy)}${r.note ? "  " + r.note : ""}`);
    return;
  }
  if (plan.action === "remove") { console.log(db.invites.remove(plan.discordId) ? ok(`removed ${plan.discordId}`) : err(`${plan.discordId} was not invited`)); return; }
  const row = db.invites.add(plan.discordId, "cli", plan.note, Date.now());
  console.log(ok(`invited ${row.discordId}${row.note ? ` (${row.note})` : ""}`));
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
                "       (omit --level to auto-detect target from the level they actually play)",
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
      case "evaluate": {
        const json = hasFlag(rest, "--json");
        const positional = stripFlags(rest, [], ["--json"]);
        const file = positional[0];
        if (!file) {
          console.error(err("Usage: bmpl evaluate <payload.json> [--json]"));
          process.exit(2);
        }
        await cmdEvaluate(file, json);
        break;
      }
      case "analyze": {
        const lvlStr = parseFlag(rest, "--level");
        const spec = parseFlag(rest, "--spec") ?? null;
        const runs = parseFlags(rest, "--run");
        const positional = stripFlags(rest, ["--level", "--spec", "--run"], ["--all", "--force", "--yes", "--json"]);
        const target = resolveTarget(positional);
        if (!target) { console.error(err("Usage: bmpl analyze <Name-Realm> [--run <code>:<fight>]... [--all] [--force] [--yes] [--level <N>] [--spec X] [--json]")); process.exit(2); }
        let lvl: number | null = null;
        if (lvlStr) { lvl = Number.parseInt(lvlStr, 10); if (!Number.isFinite(lvl) || lvl < 2) { console.error(err(`Invalid --level value: ${lvlStr}`)); process.exit(2); } }
        await cmdAnalyze(target.name, target.realm, lvl, spec, runs, hasFlag(rest, "--all"), hasFlag(rest, "--force"), hasFlag(rest, "--yes"), hasFlag(rest, "--json"));
        break;
      }
      case "defensives": {
        const positional = stripFlags(rest, [], ["--check"]);
        await cmdDefensives(positional[0], positional[1], hasFlag(rest, "--check"));
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
        const plan = planServe(rest, process.env);
        if (!plan.ok) {
          console.error(err(plan.error));
          process.exit(2);
        }
        await runServer({ port: plan.port, open: plan.open, hosted: plan.hosted, hostedConfig: plan.hosted ? plan.hostedConfig : undefined });
        // Bun.serve keeps the process alive; do not return.
        return;
      }
      case "invite": {
        await cmdInvite(rest);
        closeStore();
        break;
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

if (import.meta.main) main();
