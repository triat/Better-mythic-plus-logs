import type {
  DeathAnalysis,
  DefensiveKind,
  DefensiveUse,
  EntryOrigin,
  LookupPayload,
  MPlusRun,
  OverrideEntry,
  ProposalSummary,
  RunDefensives,
} from "../types.ts";
import type { ProposalMode } from "./hostedMode.ts";
import type { MessageKey, T } from "../i18n/t.ts";
import { fmtAge, fmtAmount } from "./format.ts";

export const POINTS_PER_RUN = 4;
export const costText = (t: T, runs: number): string => t("runs.cost", { pts: runs * POINTS_PER_RUN });

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
export interface DeathLine {
  time: string; verdict: string; cls: string; wipe: boolean; hits: (SpellRef & { text: string })[]; blow: string | null;
  states: (SpellRef & { text: string; cls: string })[];
  /** The health facts ("48.3k health before a 169.7k hit (771.1k max) · in danger 1.5 s before the death"); null without health data. */
  health: string | null;
  /** One line per heal tool the analysis judged (potion, healthstone). */
  heals: { text: string; cls: string }[];
}
export interface PanelModel {
  title: string; meta: string; notice: string | null;
  usage: UsageRow[]; majorsText: string | null;
  deathsHeadline: string; deaths: DeathLine[];
  unlisted: { id: number; name: string; text: string }[];
  specClass: string; tableParts: TablePart[];
}

/** Fight-relative ms as "m:ss", seconds floored (the deep-dive panel's death times). */
export const mmss = (ms: number): string => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const usageTone = (pct: number): string => (pct >= 70 ? "tone-good" : pct >= 40 ? "tone-warn" : "tone-bad");
const verdictTone = (v: DeathAnalysis["verdict"]): string =>
  v === "immunity available" ? "tone-bad" : v === "defensive available" || v === "heal available" ? "tone-warn" : v === "unpreventable" ? "faint" : "tone-good";

/** DeathAnalysis.verdict is already the display text in English — but it must be translated for the UI. */
const VERDICT_KEY: Record<DeathAnalysis["verdict"], MessageKey> = {
  "immunity available": "deepdive.verdict.immunity",
  "defensive available": "deepdive.verdict.defensive",
  "heal available": "deepdive.verdict.heal",
  covered: "deepdive.verdict.covered",
  "nothing available": "deepdive.verdict.nothing",
  unpreventable: "deepdive.verdict.unpreventable",
};

/** The heal tools' names from the shipped table, translated; any other name (an edited table) as is. */
const HEAL_TOOL_KEY: Record<string, MessageKey> = { "Health potion": "deepdive.healTool.potion", Healthstone: "deepdive.healTool.healthstone" };
export const healToolName = (t: T, name: string): string => (HEAL_TOOL_KEY[name] ? t(HEAL_TOOL_KEY[name]) : name);

/** Why nothing would have prevented the death ("one-shot: a 1.20m hit, 1.00m max health"); null when it was preventable. */
export function unpreventableWhy(t: T, a: DeathAnalysis): string | null {
  if (a.verdict !== "unpreventable") return null;
  if (a.health?.oneShot) return t("deepdive.health.oneShot", { hit: fmtAmount(a.health.killingHit), max: fmtAmount(a.health.maxHp) });
  return t("deepdive.health.instakill");
}

/** The health facts of a death, joined with " · "; null without health data. */
export function healthText(t: T, a: DeathAnalysis): string | null {
  const why = unpreventableWhy(t, a);
  if (why) return why;
  const h = a.health;
  if (!h) return null;
  return [
    t("deepdive.health.hit", { hp: fmtAmount(h.hpBefore), hit: fmtAmount(h.killingHit), max: fmtAmount(h.maxHp) }),
    h.dangerMs === null ? t("deepdive.health.noDanger") : t("deepdive.health.danger", { s: (h.dangerMs / 1000).toFixed(1) }),
  ].join(" · ");
}

/** One line per judged heal tool; a tool the group could not offer (no Warlock) is left out. */
export function healLines(t: T, a: DeathAnalysis): { text: string; cls: string; saves: boolean }[] {
  if (a.verdict === "unpreventable" || !a.health) return [];
  const overkill = fmtAmount(a.health.overkill);
  return (a.heals ?? []).flatMap((x): { text: string; cls: string; saves: boolean }[] => {
    const name = healToolName(t, x.name);
    switch (x.status) {
      case "saves": return [{ text: t("deepdive.health.saves", { name, heal: fmtAmount(x.heal ?? 0), overkill }), cls: "tone-bad", saves: true }];
      case "not enough": return [{ text: t("deepdive.health.notEnough", { name, heal: fmtAmount(x.heal ?? 0), overkill }), cls: "faint", saves: false }];
      case "no time": return [{ text: t("deepdive.health.noTime", { name }), cls: "faint", saves: false }];
      case "on cooldown": return [{ text: t("deepdive.health.onCd", { name, s: String(x.readyInS ?? 0) }), cls: "faint", saves: false }];
      default: return [];
    }
  });
}

const usageRow = (t: T, u: DefensiveUse): UsageRow => {
  const pct = Math.round(u.usage * 100);
  const countsUsage = u.kind !== "minor";
  return {
    id: u.id, name: u.name, kind: u.kind, counts: `${u.casts} / ${u.capacity}`, pct,
    pctText: countsUsage ? `${pct}%` : "—", cls: countsUsage ? usageTone(pct) : "faint",
    cd: t("deepdive.cdOf", { cd: String(u.cooldownS) }) + (u.observedMinIntervalS !== null ? t("deepdive.seenMin", { s: String(u.observedMinIntervalS) }) : ""),
    mismatch: u.cdMismatch, origin: u.origin, countsUsage,
  };
};

const deathLine = (t: T, x: DeathAnalysis, idOf: (name: string) => number | null): DeathLine => ({
  time: mmss(x.atMs), verdict: t(VERDICT_KEY[x.verdict]), cls: verdictTone(x.verdict), wipe: x.inWipe,
  hits: x.killingHits.map((h) => ({ id: h.id, name: h.name, text: `${Math.round(h.share * 100)}%` })),
  blow: x.killingBlow ? t("deepdive.killingBlow", { spell: x.killingBlow }) : null,
  states: [
    ...x.active.map((n) => ({ id: idOf(n), name: n, text: t("deepdive.active"), cls: "tone-good" })),
    ...x.available.map((n) => ({ id: idOf(n), name: n, text: t("deepdive.available"), cls: "tone-bad" })),
    ...x.onCooldown.map((c) => ({ id: idOf(c.name), name: c.name, text: t("deepdive.onCd", { s: String(c.readyInS) }), cls: "faint" })),
  ],
  health: healthText(t, x),
  heals: healLines(t, x).map(({ text, cls }) => ({ text, cls })),
});

/** The table-override load error (payload.deepdiveSummary.tableWarning) as a UI line; null when the file is fine or absent. */
export const tableWarningText = (t: T, warning: string | null | undefined): string | null =>
  warning ? t("deepdive.ignoredWarning", { warning }) : null;

/** Suffix shown next to an entry that is not from the shipped table; null for shipped. */
export function originLabel(t: T, origin: EntryOrigin): string | null {
  switch (origin) {
    case "override": return t("deepdive.origin.override");
    case "shared": return t("deepdive.origin.shared");
    case "pending": return t("deepdive.origin.pending");
    default: return null;
  }
}

/** "Table used: …" line: the local override count, or the hosted shared/pending counts. */
export const tableUsedText = (t: T, defensives: Array<{ origin: EntryOrigin }>, specClass: string): string =>
  tableUsedParts(t, defensives, specClass).map((p) => p.text).join(" · ");

export interface ActionLabels { add: (kind: DefensiveKind) => string; ignore: string; editCd: string; remove: string; addSubmit: (kind: DefensiveKind) => string; save: string }
/** Members propose; local mode and admins edit the table directly (an admin's correction is approved on the spot). */
export function actionLabels(t: T, mode: ProposalMode): ActionLabels {
  const p = mode === "propose";
  return {
    add: (kind) => t(p ? "deepdive.actions.propose.add" : "deepdive.actions.local.add", { kind }),
    ignore: t(p ? "deepdive.actions.propose.ignore" : "deepdive.actions.local.ignore"),
    editCd: t(p ? "deepdive.actions.propose.cd" : "deepdive.actions.local.cd"),
    remove: t(p ? "deepdive.actions.propose.remove" : "deepdive.actions.local.remove"),
    addSubmit: (kind) => t(p ? "deepdive.actions.propose.addAs" : "deepdive.actions.local.addAs", { kind }),
    save: t(p ? "deepdive.actions.propose.save" : "deepdive.actions.local.save"),
  };
}

export type OriginDot = "dot-shared" | "dot-pending";
/** Colour dot before an entry name: blue for the shared layer, yellow while pending; null for shipped and local override entries. */
export const originDot = (origin: EntryOrigin): OriginDot | null => (origin === "shared" ? "dot-shared" : origin === "pending" ? "dot-pending" : null);
/** Text suffix (" · override") for the origins that have no dot. */
export const originSuffix = (t: T, origin: EntryOrigin): string | null => (originDot(origin) ? null : originLabel(t, origin));

export interface TablePart { text: string; dot: OriginDot | null }
/** `tableUsedText` split into parts so the hosted counts carry their dot. Joined with " · " it equals `tableUsedText`. */
export function tableUsedParts(t: T, defensives: Array<{ origin: EntryOrigin }>, specClass: string): TablePart[] {
  const count = (o: EntryOrigin) => defensives.filter((u) => u.origin === o).length;
  const parts: TablePart[] = [{ text: t("deepdive.tableUsed", { spec: specClass, n: defensives.length }), dot: null }];
  const override = count("override"), shared = count("shared"), pending = count("pending");
  if (override > 0) parts.push({ text: t("deepdive.fromOverride", { n: override }), dot: null });
  if (shared > 0) parts.push({ text: t("deepdive.shared", { n: shared }), dot: "dot-shared" });
  if (pending > 0) parts.push({ text: t("deepdive.pendingReview", { n: pending }), dot: "dot-pending" });
  return parts;
}

/** What a proposal changes, as the "Your proposals" footer says it. */
export function patchText(t: T, p: OverrideEntry): string {
  if (p.ignore) return t("deepdive.proposals.ignore");
  const parts: string[] = [];
  if (p.kind) parts.push(t("deepdive.proposals.kind", { kind: p.kind }));
  if (p.cooldownS !== undefined) parts.push(t("deepdive.proposals.cd", { cd: String(p.cooldownS) }));
  if (p.durationS !== undefined && p.kind) parts.push(t("deepdive.proposals.duration", { s: String(p.durationS) }));
  return parts.length > 0 ? parts.join(", ") : t("deepdive.proposals.noChange");
}

export interface ProposalLine { id: number; dot: "dot-pending" | "dot-rejected" | "dot-approved"; what: string; when: string }
/** The member's own proposals for this spec, newest first as the server returns them; the spell name comes from the patch, else the run's table. */
export function proposalLines(t: T, proposals: ProposalSummary[], names: Array<{ id: number; name: string }>, now = Date.now()): ProposalLine[] {
  return proposals.map((p) => {
    // A raw string, not a number: a spell id is an identifier, never grouped like a quantity.
    const name = p.patch.name ?? names.find((n) => n.id === p.spellId)?.name ?? t("deepdive.proposals.spell", { id: String(p.spellId) });
    const what = `${name} · ${patchText(t, p.patch)}`;
    if (p.status === "pending") return { id: p.id, dot: "dot-pending" as const, what, when: t("deepdive.proposals.pending", { age: fmtAge(t, p.createdAt, now) }) };
    const note = p.note ? t("deepdive.proposals.note", { note: p.note }) : "";
    const age = fmtAge(t, p.decidedAt ?? p.createdAt, now);
    return p.status === "rejected"
      ? { id: p.id, dot: "dot-rejected" as const, what, when: t("deepdive.proposals.rejected", { age, note }) }
      : { id: p.id, dot: "dot-approved" as const, what, when: t("deepdive.proposals.approved", { age, note }) };
  });
}

export function panelModel(t: T, d: RunDefensives, now = Date.now(), tableWarning?: string | null): PanelModel {
  const specClass = `${d.spec} ${d.className}`;
  // Precedence: an ignored override file (the run was analyzed against the shipped table) beats every per-run notice.
  let notice: string | null = null;
  const warning = tableWarningText(t, tableWarning);
  if (warning) notice = warning;
  else if (d.tableMissing) notice = t("deepdive.noTable", { spec: specClass });
  else if (d.staleTable) notice = t("deepdive.tableChanged");
  else if (d.truncated) notice = t("deepdive.truncated");
  else if (d.healthMissing) notice = t("deepdive.health.missing");
  return {
    title: t("deepdive.title", { spec: specClass }),
    meta: t("deepdive.analyzedAgo", { age: fmtAge(t, d.fetchedAt, now) }) + (d.pointsSpent !== null ? t("deepdive.pointsSpent", { pts: d.pointsSpent }) : ""),
    notice,
    usage: d.defensives.map((u) => usageRow(t, u)),
    majorsText: d.majorUsage === null ? null : t("deepdive.majorsUsed", { pct: Math.round(d.majorUsage * 100) }),
    deathsHeadline: d.deaths.length === 0 ? t("deepdive.noDeaths") : t("deepdive.deathsAvailable", { n: d.avoidableDeaths, total: d.countedDeaths }),
    deaths: d.deaths.map((x) => deathLine(t, x, (name) => d.defensives.find((u) => u.name === name)?.id ?? null)),
    unlisted: d.unlisted.map((u) => ({ id: u.id, name: u.name, text: t("deepdive.uptime", { casts: String(u.casts), s: String(u.uptimeS) }) })),
    specClass,
    tableParts: tableUsedParts(t, d.defensives, specClass),
  };
}

/** Compare-table cell. */
export function defensivesCell(t: T, p: LookupPayload): { text: string; value: number | null } {
  const s = p.deepdiveSummary;
  if (s.analyzedRuns === 0 || s.majorUsage === null) return { text: "—", value: null };
  const deaths = s.countedDeaths === 0 ? t("deepdive.summaryNoDeaths") : t("deepdive.summaryAvoidable", { n: s.avoidableDeaths, total: s.countedDeaths });
  return { text: t("deepdive.summary", { pct: Math.round(s.majorUsage * 100), deaths }), value: s.majorUsage };
}
