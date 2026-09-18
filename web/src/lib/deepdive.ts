import type { EntryOrigin } from "@shared/deepdive/types.ts";
import type { ProposalSummary } from "@shared/hosted/defensives.ts";
import type { DeathAnalysis, DefensiveKind, DefensiveUse, LookupPayload, MPlusRun, OverrideEntry, RunDefensives } from "../types.ts";
import type { ProposalMode } from "./hostedMode.ts";
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
  specClass: string; tableParts: TablePart[];
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

/** Suffix shown next to an entry that is not from the shipped table; null for shipped. */
export function originLabel(origin: EntryOrigin): string | null {
  switch (origin) {
    case "override": return "override";
    case "shared": return "shared";
    case "pending": return "pending review";
    default: return null;
  }
}

/** "Table used: …" line: the local override count, or the hosted shared/pending counts. */
export function tableUsedText(defensives: Array<{ origin: EntryOrigin }>, specClass: string): string {
  const count = (o: EntryOrigin) => defensives.filter((u) => u.origin === o).length;
  const parts = [`Table used: ${specClass} · ${defensives.length} entries`];
  const override = count("override"), shared = count("shared"), pending = count("pending");
  if (override > 0) parts.push(`${override} from your override`);
  if (shared > 0) parts.push(`${shared} shared`);
  if (pending > 0) parts.push(`${pending} pending review`);
  return parts.join(" · ");
}

export interface ActionLabels { add: (kind: DefensiveKind) => string; ignore: string; editCd: string; remove: string; addSubmit: (kind: DefensiveKind) => string; save: string }
/** Members propose; local mode and admins edit the table directly (an admin's correction is approved on the spot). */
export function actionLabels(mode: ProposalMode): ActionLabels {
  const p = mode === "propose";
  return {
    add: (kind) => (p ? `Propose + ${kind}` : `+ ${kind}`),
    ignore: p ? "Propose ignore" : "Ignore",
    editCd: p ? "Propose cd" : "Edit cd",
    remove: p ? "Propose removal" : "Remove for this spec",
    addSubmit: (kind) => (p ? `Propose as ${kind}` : `Add as ${kind}`),
    save: p ? "Propose" : "Save",
  };
}

export type OriginDot = "dot-shared" | "dot-pending";
/** Colour dot before an entry name: blue for the shared layer, yellow while pending; null for shipped and local override entries. */
export const originDot = (origin: EntryOrigin): OriginDot | null => (origin === "shared" ? "dot-shared" : origin === "pending" ? "dot-pending" : null);
/** Text suffix (" · override") for the origins that have no dot. */
export const originSuffix = (origin: EntryOrigin): string | null => (originDot(origin) ? null : originLabel(origin));

export interface TablePart { text: string; dot: OriginDot | null }
/** `tableUsedText` split into parts so the hosted counts carry their dot. Joined with " · " it equals `tableUsedText`. */
export function tableUsedParts(defensives: Array<{ origin: EntryOrigin }>, specClass: string): TablePart[] {
  const count = (o: EntryOrigin) => defensives.filter((u) => u.origin === o).length;
  const parts: TablePart[] = [{ text: `Table used: ${specClass} · ${defensives.length} entries`, dot: null }];
  const override = count("override"), shared = count("shared"), pending = count("pending");
  if (override > 0) parts.push({ text: `${override} from your override`, dot: null });
  if (shared > 0) parts.push({ text: `${shared} shared`, dot: "dot-shared" });
  if (pending > 0) parts.push({ text: `${pending} pending review`, dot: "dot-pending" });
  return parts;
}

/** What a proposal changes, as the "Your proposals" footer says it. */
export function patchText(p: OverrideEntry): string {
  if (p.ignore) return "ignore";
  const parts: string[] = [];
  if (p.kind) parts.push(`+ ${p.kind}`);
  if (p.cooldownS !== undefined) parts.push(`cd ${p.cooldownS} s`);
  if (p.durationS !== undefined && p.kind) parts.push(`${p.durationS} s`);
  return parts.length > 0 ? parts.join(", ") : "no change";
}

export interface ProposalLine { id: number; dot: "dot-pending" | "dot-rejected" | "dot-approved"; what: string; when: string }
/** The member's own proposals for this spec, newest first as the server returns them; the spell name comes from the patch, else the run's table. */
export function proposalLines(proposals: ProposalSummary[], names: Array<{ id: number; name: string }>, now = Date.now()): ProposalLine[] {
  return proposals.map((p) => {
    const name = p.patch.name ?? names.find((n) => n.id === p.spellId)?.name ?? `spell ${p.spellId}`;
    const what = `${name} · ${patchText(p.patch)}`;
    if (p.status === "pending") return { id: p.id, dot: "dot-pending" as const, what, when: `pending · ${fmtAge(p.createdAt, now)}` };
    const note = p.note ? ` — "${p.note}"` : "";
    const age = fmtAge(p.decidedAt ?? p.createdAt, now);
    return p.status === "rejected"
      ? { id: p.id, dot: "dot-rejected" as const, what, when: `rejected ${age}${note}` }
      : { id: p.id, dot: "dot-approved" as const, what, when: `approved ${age}${note}` };
  });
}

export function panelModel(d: RunDefensives, now = Date.now(), tableWarning?: string | null): PanelModel {
  const specClass = `${d.spec} ${d.className}`;
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
    tableUsed: tableUsedText(d.defensives, specClass),
    specClass,
    tableParts: tableUsedParts(d.defensives, specClass),
  };
}

/** Compare-table cell. */
export function defensivesCell(p: LookupPayload): { text: string; value: number | null } {
  const s = p.deepdiveSummary;
  if (s.analyzedRuns === 0 || s.majorUsage === null) return { text: "—", value: null };
  const deaths = s.countedDeaths === 0 ? "no deaths" : `${s.avoidableDeaths}/${s.countedDeaths} avoidable`;
  return { text: `${Math.round(s.majorUsage * 100)}% · ${deaths}`, value: s.majorUsage };
}
