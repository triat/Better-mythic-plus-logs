import type { DeathAnalysis, DefensiveUse, LookupPayload, MPlusRun, RunDefensives } from "../types.ts";
import { fmtAge } from "./format.ts";

export const POINTS_PER_RUN = 3;
export const costText = (runs: number): string => `~${runs * POINTS_PER_RUN} pts`;

const runKey = (r: { reportCode: string; fightID: number }) => `${r.reportCode}:${r.fightID}`;

export const analysisFor = (p: LookupPayload, run: { reportCode: string; fightID: number }): RunDefensives | null =>
  p.deepdive.find((d) => runKey(d) === runKey(run)) ?? null;

/** Displayed runs that have signals (so a deep-dive is possible) and no analysis yet. */
export function unanalyzedRuns(p: LookupPayload): MPlusRun[] {
  const done = new Set(p.deepdive.map(runKey));
  const all: MPlusRun[] = [...(p.prevLevelBest ? [p.prevLevelBest.best] : []), ...p.perDungeon.runs];
  const seen = new Set<string>();
  return all.filter((r) => { const k = runKey(r); if (seen.has(k) || !r.signals || done.has(k)) return false; seen.add(k); return true; });
}

export interface UsageRow { id: number; name: string; kind: DefensiveUse["kind"]; counts: string; pct: number; pctText: string; cls: string; cd: string; mismatch: boolean; origin: DefensiveUse["origin"]; countsUsage: boolean }
/** A spell mention: `id` null when WCL gave no guid (no Wowhead link then). */
export interface SpellRef { id: number | null; name: string }
export interface DeathLine { time: string; verdict: DeathAnalysis["verdict"]; cls: string; wipe: boolean; hits: (SpellRef & { text: string })[]; blow: string | null; states: (SpellRef & { text: string; cls: string })[] }
export interface PanelModel {
  title: string; meta: string; notice: string | null;
  usage: UsageRow[]; majorsText: string | null;
  deathsHeadline: string; deaths: DeathLine[];
  unlisted: { id: number; name: string; text: string }[]; tableUsed: string;
}

const mmss = (ms: number): string => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const usageTone = (pct: number): string => (pct >= 70 ? "tone-good" : pct >= 40 ? "tone-warn" : "tone-bad");
const verdictTone = (v: DeathAnalysis["verdict"]): string => (v === "immunity available" ? "tone-bad" : v === "defensive available" ? "tone-warn" : "tone-good");

const usageRow = (u: DefensiveUse): UsageRow => {
  const pct = Math.round(u.usage * 100);
  const countsUsage = u.kind !== "minor";
  return {
    id: u.id, name: u.name, kind: u.kind, counts: `${u.casts} / ${u.capacity}`, pct,
    pctText: countsUsage ? `${pct}%` : "—", cls: countsUsage ? usageTone(pct) : "faint",
    cd: `cd ${u.cooldownS} s${u.observedMinIntervalS !== null ? ` · seen ${u.observedMinIntervalS} s` : ""}`,
    mismatch: u.cdMismatch, origin: u.origin, countsUsage,
  };
};

const deathLine = (x: DeathAnalysis, idOf: (name: string) => number | null): DeathLine => ({
  time: mmss(x.atMs), verdict: x.verdict, cls: verdictTone(x.verdict), wipe: x.inWipe,
  hits: x.killingHits.map((h) => ({ id: h.id, name: h.name, text: `${Math.round(h.share * 100)}%` })),
  blow: x.killingBlow ? `killing blow: ${x.killingBlow}` : null,
  states: [
    ...x.active.map((n) => ({ id: idOf(n), name: n, text: "active", cls: "tone-good" })),
    ...x.available.map((n) => ({ id: idOf(n), name: n, text: "available", cls: "tone-bad" })),
    ...x.onCooldown.map((c) => ({ id: idOf(c.name), name: c.name, text: `on cd · ${c.readyInS} s left`, cls: "faint" })),
  ],
});

/** The table-override load error (payload.deepdiveSummary.tableWarning) as a UI line; null when the file is fine or absent. */
export const tableWarningText = (warning: string | null | undefined): string | null =>
  warning ? `Your defensives.json is ignored: ${warning}` : null;

export function panelModel(d: RunDefensives, now = Date.now(), tableWarning?: string | null): PanelModel {
  const specClass = `${d.spec} ${d.className}`;
  const overrides = d.defensives.filter((u) => u.origin === "override").length;
  // Precedence: an ignored override file (the run was analyzed against the shipped table) beats every per-run notice.
  let notice: string | null = null;
  const warning = tableWarningText(tableWarning);
  if (warning) notice = warning;
  else if (d.tableMissing) notice = `No defensives table for ${specClass} yet — add entries from the audit below.`;
  else if (d.staleTable) notice = "The table changed since this run was analyzed — re-analyze to include the new entries.";
  else if (d.truncated) notice = "Cast events were truncated (more than 5 pages) — counts may be low.";
  return {
    title: `Defensives · ${specClass}`,
    meta: `analyzed ${fmtAge(d.fetchedAt, now)}${d.pointsSpent !== null ? ` · ${d.pointsSpent} pts` : ""}`,
    notice,
    usage: d.defensives.map(usageRow),
    majorsText: d.majorUsage === null ? null : `majors used ${Math.round(d.majorUsage * 100)}% of possible`,
    deathsHeadline: d.deaths.length === 0 ? "No deaths" : `${d.avoidableDeaths}/${d.countedDeaths} deaths with a defensive available`,
    deaths: d.deaths.map((x) => deathLine(x, (name) => d.defensives.find((u) => u.name === name)?.id ?? null)),
    unlisted: d.unlisted.map((u) => ({ id: u.id, name: u.name, text: ` · ${u.casts}× · ${u.uptimeS} s up` })),
    tableUsed: `Table used: ${specClass} · ${d.defensives.length} entries · ${overrides} from your override`,
  };
}

/** Compare-table cell. */
export function defensivesCell(p: LookupPayload): { text: string; value: number | null } {
  const s = p.deepdiveSummary;
  if (s.analyzedRuns === 0 || s.majorUsage === null) return { text: "—", value: null };
  const deaths = s.countedDeaths === 0 ? "no deaths" : `${s.avoidableDeaths}/${s.countedDeaths} avoidable`;
  return { text: `${Math.round(s.majorUsage * 100)}% · ${deaths}`, value: s.majorUsage };
}
