// How far the verdict holds for the vetted key (validity spec docs/superpowers/specs/2026-10-27-evaluation-validity-design.md,
// decisions 5 and 6; canvas "bmpl · Verdict à ton niveau", variant C): the Synthèse tab's Fiabilité block, the header's
// "low reliability" chip, and the compact marks of Récents, Live and Compare. Nothing here changes a score or a verdict.
import type { Evaluation, LookupPayload } from "../types.ts";
import type { T } from "../i18n/t.ts";

export type Band = "invite" | "maybe" | "pass";
export interface Thresholds { invite: number; maybe: number; minRuns: number }

/** The widest side of the leave-one-run-out range around the score; null without a range (the server's `summaryOf`). */
export const spreadOf = (ev: Pick<Evaluation, "global" | "range">): number | null =>
  ev.global === null || !ev.range ? null : Math.max(ev.global - ev.range.low, ev.range.high - ev.global, 0);

/** The vetted key's level is not proven; null on an evaluation from before the level proof. */
export const unprovenOf = (ev: Pick<Evaluation, "level">): boolean | null => (ev.level ? !ev.level.proven : null);

export const bandOf = (score: number, th: Thresholds): Band => (score >= th.invite ? "invite" : score >= th.maybe ? "maybe" : "pass");

/** The threshold the range straddles (INVITE first), or null when every run left out gives the same verdict. */
export function crossedThreshold(ev: Pick<Evaluation, "range">, th: Thresholds): "invite" | "maybe" | null {
  const r = ev.range;
  if (!r) return null;
  if (r.low < th.invite && r.high >= th.invite) return "invite";
  if (r.low < th.maybe && r.high >= th.maybe) return "maybe";
  return null;
}

/** The header chip: the level is not proven, or one run decides the verdict. */
export const isLowReliability = (ev: Evaluation, th: Thresholds): boolean =>
  ev.verdict !== "insufficient" && (ev.level?.proven === false || crossedThreshold(ev, th) !== null);

export interface ReliabilityView {
  title: string;
  level: { label: string; ok: boolean; strong: string; detail: string };
  stability: { label: string; strong: string | null; detail: string };
  /** One dot per run left out, at its score (0–100). Empty without a range. */
  dots: { key: string; at: number; band: Band }[];
  ticks: { at: number; label: string; band: Band }[];
  /** "One dot = …", then the run that moves the score most; null without dots. */
  note: string | null;
}

/** The Fiabilité block; null for INSUFFICIENT DATA or an evaluation from before the level proof. */
export function reliabilityView(t: T, ev: Evaluation, payload: Pick<LookupPayload, "perDungeon" | "prevLevelBest">, th: Thresholds): ReliabilityView | null {
  if (ev.verdict === "insufficient" || ev.global === null || !ev.level) return null;
  const lv = ev.level;
  const key = String(ev.targetLevel);
  const level = lv.proven
    ? {
        label: t("cand.rel.level"), ok: true, strong: t("cand.rel.proven", { level: key }),
        detail: lv.atTarget > 0 ? t("cand.rel.provenAt", { count: lv.atTarget, level: key }) : t("cand.rel.provenNear", { best: String(lv.best ?? "") }),
      }
    : {
        label: t("cand.rel.level"), ok: false, strong: t("cand.rel.unproven", { level: key }),
        detail: lv.best === null ? t("cand.rel.noRun") : t("cand.rel.unprovenWhy", { best: String(lv.best), floor: String(lv.floor) }),
      };

  const r = ev.range ?? null;
  const crossed = crossedThreshold(ev, th);
  const stability = r
    ? {
        label: t("cand.rel.stability"), strong: `${r.low}–${r.high}`,
        detail: crossed ? t("cand.rel.crosses", { verdict: t(`verdict.words.${crossed}`) }) : t("cand.rel.stable"),
      }
    : { label: t("cand.rel.stability"), strong: null, detail: t("cand.rel.tooFew", { min: th.minRuns + 1 }) };

  const dots = (r?.without ?? []).map((w) => ({ key: `${w.reportCode}:${w.fightID}`, at: Math.max(0, Math.min(100, w.score)), band: bandOf(w.score, th) }));
  let note: string | null = null;
  if (r && r.without.length > 0) {
    note = t("cand.rel.dotsNote", { count: r.without.length });
    // The run whose removal moves the score most; on a tie, the one that costs the player points (its removal scores higher).
    const farthest = [...r.without].sort((a, b) => Math.abs(b.score - ev.global!) - Math.abs(a.score - ev.global!) || b.score - a.score)[0]!;
    const runs = [...payload.perDungeon.runs, ...(payload.prevLevelBest ? [payload.prevLevelBest.best] : [])];
    const run = runs.find((x) => x.reportCode === farthest.reportCode && x.fightID === farthest.fightID);
    if (run && farthest.score !== ev.global) {
      note += ` ${t("cand.rel.decisive", { dungeon: run.encounterName, level: String(run.keyLevel), score: String(farthest.score) })}`;
    }
  }
  return {
    title: t("cand.rel.title"),
    level,
    stability,
    dots,
    ticks: [
      { at: th.maybe, label: `${t("verdict.words.maybe")} ${th.maybe}`, band: "maybe" },
      { at: th.invite, label: `${t("verdict.words.invite")} ${th.invite}`, band: "invite" },
    ],
    note,
  };
}

/** Récents and Live: "±8" and the unproven mark; both absent when unknown. */
export function compactReliability(t: T, item: { spread?: number | null; unproven?: boolean | null }): { spread: string | null; unproven: string | null } {
  return {
    spread: typeof item.spread === "number" ? `±${Math.round(item.spread)}` : null,
    unproven: item.unproven === true ? t("cand.rel.unprovenMark") : null,
  };
}

/** Compare's line under a verdict: "Level ✗ best +16 · Stability 58–74"; null when nothing is known. */
export function reliabilityLine(t: T, ev: Evaluation): string | null {
  if (ev.verdict === "insufficient" || !ev.level) return null;
  const level = ev.level.proven ? t("cand.rel.levelOk") : t("cand.rel.levelNo", { best: ev.level.best === null ? "—" : `+${ev.level.best}` });
  const stability = ev.range ? t("cand.rel.stabilityRange", { range: `${ev.range.low}–${ev.range.high}` }) : t("cand.rel.stabilityNone");
  return `${level} · ${stability}`;
}
