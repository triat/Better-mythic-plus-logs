// The run timeline (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md "The run timeline",
// mockups docs/design/redesign/F-Runs.dc.html and F-Run.dc.html): a track from 0 to the fight's duration, one lane per
// layer the reader ticks, a callout for the selected death and the "Moments clés" list. Deaths come from the run's
// signals; the defensive layers need the run's deep-dive analysis. The mockup's "nouvelle donnée" layers are not built.
import type { DeathAnalysis, DeathEvent, DefensiveUse, MPlusRun, RunDefensives } from "../types.ts";
import type { MessageKey, T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { mmss } from "./deepdive.ts";

export type LayerKey = "deaths" | "dispo" | "cd" | "casts" | "control";
export const LAYER_ORDER: readonly LayerKey[] = ["deaths", "dispo", "cd", "casts", "control"];
export const DEFAULT_LAYERS: Record<LayerKey, boolean> = { deaths: true, dispo: true, cd: true, casts: false, control: false };

/** One layer of the checklist. `disabled` is the reason (the chip's tooltip); `analyse`: offer "Analyser · 3 pts". */
export interface LayerChip { key: LayerKey; label: string; count: string; on: boolean; disabled: string | null; analyse: boolean }
/** `id` is the death's id (`d<i>`) on the deaths and dispo lanes, so a click on either selects that death. */
export interface Marker { id: string; leftPct: number; kind: "death" | "death-bad" | "dispo" | "none" | "cast"; title: string }
export interface Bar { leftPct: number; widthPct: number; title: string }
export interface Lane { key: LayerKey; label: string; markers: Marker[]; bars: Bar[] }
export interface Callout { id: string; time: string; title: string; hits: string; state: string; bad: boolean }
/** `id` null for a run-level line (no death to select). */
export interface Moment { id: string | null; time: string; text: string; bad: boolean }
export interface TimelineView {
  durationMs: number;
  ticks: { leftPct: number; label: string }[];
  chips: LayerChip[];
  lanes: Lane[];
  /** Death ids in time order: arrow keys walk them. */
  events: string[];
  callout: Callout | null;
  moments: Moment[];
  /** The sheet's header sentence; null without deaths. */
  summary: string | null;
}

const TICK_MS = 5 * 60_000;
const round2 = (x: number): number => Math.round(x * 100) / 100;
const clampPct = (x: number): number => round2(Math.min(100, Math.max(0, x)));

/** A death of the signals with its analysis counterpart (same fight-relative ms), when the run is analysed. */
interface Death { id: string; ev: DeathEvent; a: DeathAnalysis | null; bad: boolean; majors: string[] }

const BAD: ReadonlySet<DeathAnalysis["verdict"]> = new Set(["immunity available", "defensive available"]);

/** Fight-relative ms of each cast: an analysis saved before castsAtMs existed has none (re-analyse to get them). */
const hasCastTimes = (a: RunDefensives): boolean =>
  a.defensives.length === 0 || a.defensives.some((d) => Array.isArray((d as Partial<DefensiveUse>).castsAtMs));

function matchAnalysis(ev: DeathEvent, deaths: DeathAnalysis[]): DeathAnalysis | null {
  // analyzeRun matches on the exact atMs; a 1 s tolerance covers rounding in older payloads.
  let best: DeathAnalysis | null = null;
  for (const d of deaths) {
    const gap = Math.abs(d.atMs - ev.atMs);
    if (gap <= 1000 && (best === null || gap < Math.abs(best.atMs - ev.atMs))) best = d;
  }
  return best;
}

export function timelineView(
  t: T, _locale: Locale, run: MPlusRun, analysis: RunDefensives | null, own: boolean,
  layers: Record<LayerKey, boolean>, selected: string | null,
): TimelineView | null {
  const s = run.signals;
  if (!s || !(s.fightDurationMs > 0)) return null;
  const dur = s.fightDurationMs;
  const pct = (ms: number) => clampPct((ms / dur) * 100);
  const kindOf = new Map<string, DefensiveUse["kind"]>((analysis?.defensives ?? []).map((d) => [d.name, d.kind]));
  const isMajor = (name: string) => { const k = kindOf.get(name); return k === "major" || k === "immunity"; };

  const deaths: Death[] = [...s.deaths.events].sort((x, y) => x.atMs - y.atMs).map((ev, i) => {
    const a = analysis ? matchAnalysis(ev, analysis.deaths) : null;
    const bad = a !== null && BAD.has(a.verdict);
    // A name missing from the defensives list (table edited since) still counts when the verdict says it was available.
    const majors = a ? a.available.filter(isMajor) : [];
    return { id: `d${i}`, ev, a, bad, majors: bad && majors.length === 0 ? a!.available : majors };
  });
  const causeOf = (d: Death): string => d.ev.cause ?? d.a?.killingBlow ?? t("cand.timeline.unknownCause");
  const titleOf = (d: Death): string => t(d.bad ? "cand.timeline.deathBad" : "cand.timeline.death", { cause: causeOf(d) });
  const analysed = deaths.filter((d) => d.a !== null);

  // Layer data.
  const castsOk = analysis !== null && hasCastTimes(analysis);
  const casts = castsOk
    ? analysis!.defensives.flatMap((d) => (d.castsAtMs ?? []).map((ms) => ({ ms, name: d.name }))).sort((x, y) => x.ms - y.ms)
    : [];
  const cdBars: Bar[] = analysed.flatMap((d) =>
    d.a!.onCooldown.filter((c) => isMajor(c.name)).map((c) => {
      const left = pct(d.ev.atMs);
      return {
        leftPct: left,
        widthPct: round2(Math.min(100 - left, (c.readyInS * 1000 / dur) * 100)),
        title: t("cand.timeline.onCd", { name: c.name, s: String(c.readyInS), time: mmss(d.ev.atMs) }),
      };
    }));

  const needs = analysis === null ? t("cand.timeline.reason.analyse") : null;
  const reasons: Record<LayerKey, string | null> = {
    deaths: null,
    dispo: needs,
    cd: needs,
    casts: needs ?? (castsOk ? null : t("cand.timeline.reason.castsMissing")),
    control: t(own ? "cand.timeline.reason.controlOwn" : "cand.timeline.reason.controlCandidate"),
  };
  const counts: Record<LayerKey, string> = {
    deaths: String(deaths.length),
    dispo: analysis ? `${analysed.filter((d) => d.majors.length > 0).length}/${analysed.length}` : "—",
    cd: analysis ? String(cdBars.length) : "—",
    casts: castsOk ? String(casts.length) : "—",
    control: "—",
  };
  const chips: LayerChip[] = LAYER_ORDER.map((key) => ({
    key,
    label: t(`cand.timeline.layer.${key}` as MessageKey),
    count: counts[key],
    on: layers[key] && reasons[key] === null,
    disabled: reasons[key],
    analyse: key !== "deaths" && key !== "control" && analysis === null,
  }));
  const isOn = (k: LayerKey) => chips.find((c) => c.key === k)!.on;

  const lanes: Lane[] = [];
  const lane = (key: Exclude<LayerKey, "control">, markers: Marker[], bars: Bar[] = []) =>
    lanes.push({ key, label: t(`cand.timeline.lane.${key}`), markers, bars });
  if (isOn("deaths")) {
    lane("deaths", deaths.map((d) => ({
      id: d.id, leftPct: pct(d.ev.atMs), kind: d.bad ? "death-bad" : "death",
      title: t("cand.timeline.at", { time: mmss(d.ev.atMs), name: causeOf(d) }),
    })));
  }
  if (isOn("dispo")) {
    lane("dispo", analysed.map((d) => ({
      id: d.id, leftPct: pct(d.ev.atMs), kind: d.majors.length > 0 ? "dispo" : "none",
      title: d.majors.length > 0 ? t("cand.timeline.available", { names: d.majors.join(", ") }) : t("cand.timeline.noneAvailable"),
    })));
  }
  if (isOn("cd")) lane("cd", [], cdBars);
  if (isOn("casts")) {
    lane("casts", casts.map((c, i) => ({ id: `c${i}`, leftPct: pct(c.ms), kind: "cast", title: t("cand.timeline.at", { time: mmss(c.ms), name: c.name }) })));
  }

  const ticks: TimelineView["ticks"] = [];
  for (let ms = 0; ms <= dur; ms += TICK_MS) ticks.push({ leftPct: pct(ms), label: mmss(ms) });

  const sel = deaths.find((d) => d.id === selected) ?? null;
  const callout: Callout | null = sel === null ? null : {
    id: sel.id,
    time: mmss(sel.ev.atMs),
    title: titleOf(sel),
    hits: hitsText(t, sel),
    state: sel.a ? stateText(t, sel.a, isMajor) : t("cand.timeline.state.analyse"),
    bad: sel.bad,
  };

  const moments: Moment[] = deaths.map((d) => ({
    id: d.id,
    time: mmss(d.ev.atMs),
    text: d.a === null
      ? titleOf(d)
      : t("cand.timeline.moment.line", {
          title: titleOf(d),
          detail: d.majors.length > 0
            ? t("cand.timeline.moment.wasAvailable", { names: d.majors.join(", "), count: d.majors.length })
            : t("cand.timeline.moment.noneAvailable"),
        }),
    bad: d.bad,
  }));
  if (s.consumables?.potions === 0) moments.push({ id: null, time: t("cand.timeline.moment.run"), text: t("cand.timeline.moment.noPotion"), bad: false });

  return { durationMs: dur, ticks, chips, lanes, events: deaths.map((d) => d.id), callout, moments, summary: summaryText(t, deaths, analysis !== null) };
}

function hitsText(t: T, d: Death): string {
  if (d.a && d.a.killingHits.length > 0) {
    return d.a.killingHits.map((h) => t("cand.timeline.hit", { name: h.name, pct: Math.round(h.share * 100) })).join(" · ");
  }
  const names = (d.ev.killingHits ?? []).map((h) => h.ability).filter((n): n is string => n !== null);
  if (names.length > 0) return [...new Set(names)].join(" · ");
  return d.ev.cause ?? "";
}

function stateText(t: T, a: DeathAnalysis, isMajor: (name: string) => boolean): string {
  const majors = a.available.filter(isMajor);
  const minors = a.available.filter((n) => !isMajor(n));
  const parts = [
    ...(a.active.length > 0 ? [t("cand.timeline.state.active", { names: a.active.join(", ") })] : []),
    ...(majors.length > 0 ? [t("cand.timeline.state.unused", { names: majors.join(", ") })] : []),
    ...a.onCooldown.map((c) => t("cand.timeline.state.onCd", { name: c.name, s: String(c.readyInS) })),
    ...(minors.length > 0 ? [t("cand.timeline.state.minor", { names: minors.join(", ") })] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : t("cand.timeline.state.nothing");
}

function summaryText(t: T, deaths: Death[], analysed: boolean): string | null {
  const count = deaths.length;
  if (count === 0) return null;
  if (!analysed) return t("runs.deaths", { count });
  const bad = deaths.filter((d) => d.bad);
  if (bad.length === 0) return t("cand.timeline.summary.none", { count });
  if (bad.length > 1) return t("cand.timeline.summary.many", { count, bad: bad.length });
  const b = bad[0]!;
  const params = { count, time: mmss(b.ev.atMs), names: b.majors.join(", "), n: b.majors.length };
  return t(count === 1 ? "cand.timeline.summary.single" : "cand.timeline.summary.one", params);
}
