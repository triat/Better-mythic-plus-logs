// The run timeline (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md "The run timeline",
// mockups docs/design/redesign/F-Runs.dc.html and F-Run.dc.html): a track from 0 to the fight's duration, one lane per
// layer the reader ticks, a callout for the selected death and the "Moments clés" list. Deaths come from the run's
// signals; the defensive layers need the run's deep-dive analysis. The mockup's "nouvelle donnée" layers are not built.
import type { DeathAnalysis, DeathEvent, DefensiveUse, MPlusRun, RunDefensives } from "../types.ts";
import type { MessageKey, T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { healLines, healToolName, healthText, mmss, unpreventableWhy } from "./deepdive.ts";

export type LayerKey = "deaths" | "dispo" | "cd" | "casts" | "control";
export const LAYER_ORDER: readonly LayerKey[] = ["deaths", "dispo", "cd", "casts", "control"];
export const DEFAULT_LAYERS: Record<LayerKey, boolean> = { deaths: true, dispo: true, cd: true, casts: false, control: false };

/** One layer of the checklist. `disabled` is the reason (the chip's tooltip); `analyse`: offer "Analyser · 4 pts". */
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

/**
 * A death of the signals with its analysis counterpart (same fight-relative ms), when the run is analysed. `bad`: the
 * analysis' verdict is "defensive available" or "immunity available" (an avoidable death); `majors` the defensives
 * that make it so — empty for any other verdict, so the dispo lane, its count and the moments say what the verdict says
 * (a "covered" death had a defensive up: it is not "available", whatever else was off cooldown).
 */
interface Death { id: string; ev: DeathEvent; a: DeathAnalysis | null; bad: boolean; majors: string[] }

const BAD: ReadonlySet<DeathAnalysis["verdict"]> = new Set(["immunity available", "defensive available", "heal available"]);

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
    // A heal verdict names the heal tools that would have saved; a defensive verdict its majors. A name missing from
    // the defensives list (table edited since) still counts when the verdict says it was available.
    const majors = !bad ? []
      : a!.verdict === "heal available" ? (a!.heals ?? []).filter((h) => h.status === "saves").map((h) => healToolName(t, h.name))
      : a!.available.filter(isMajor);
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
    dispo: analysis ? `${analysed.filter((d) => d.bad).length}/${analysed.length}` : "—",
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
      id: d.id, leftPct: pct(d.ev.atMs), kind: d.bad ? "dispo" : "none",
      title: d.bad ? t("cand.timeline.available", { names: d.majors.join(", "), count: d.majors.length })
        : d.a!.verdict === "unpreventable" ? t("cand.timeline.unpreventable", { why: unpreventableWhy(t, d.a!)! })
        : d.a!.verdict === "covered" ? t("cand.timeline.covered", { names: d.a!.active.join(", ") })
        : t("cand.timeline.noneAvailable"),
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
    state: sel.a ? stateText(t, sel.a, sel.majors) : t("cand.timeline.state.analyse"),
    bad: sel.bad,
  };

  const moments: Moment[] = deaths.map((d) => ({
    id: d.id,
    time: mmss(d.ev.atMs),
    text: d.a === null
      ? titleOf(d)
      : t("cand.timeline.moment.line", {
          title: titleOf(d),
          detail: d.bad
            ? t("cand.timeline.moment.wasAvailable", { names: d.majors.join(", "), count: d.majors.length })
            : d.a.verdict === "unpreventable" ? t("cand.timeline.moment.unpreventable", { why: unpreventableWhy(t, d.a)! })
            : d.a.verdict === "covered" ? t("cand.timeline.moment.covered", { names: d.a.active.join(", ") })
            : t("cand.timeline.moment.noneAvailable"),
        }),
    bad: d.bad,
  }));

  return { durationMs: dur, ticks, chips, lanes, events: deaths.map((d) => d.id), callout, moments, summary: summaryText(t, deaths) };
}

function hitsText(t: T, d: Death): string {
  if (d.a && d.a.killingHits.length > 0) {
    return d.a.killingHits.map((h) => t("cand.timeline.hit", { name: h.name, pct: Math.round(h.share * 100) })).join(" · ");
  }
  const names = (d.ev.killingHits ?? []).map((h) => h.ability).filter((n): n is string => n !== null);
  if (names.length > 0) return [...new Set(names)].join(" · ");
  return d.ev.cause ?? "";
}

/** `unused`: the defensives that make the death avoidable (empty unless the verdict says so); the rest of `available` is listed plainly. */
function stateText(t: T, a: DeathAnalysis, unused: string[]): string {
  const minors = a.available.filter((n) => !unused.includes(n));
  const health = healthText(t, a);
  // A saving heal is already named by `unused`; the heals that would not have saved say why.
  const heals = healLines(t, a).filter((h) => !h.saves).map((h) => h.text);
  const parts = [
    ...(health ? [health] : []),
    ...(a.active.length > 0 ? [t("cand.timeline.state.active", { names: a.active.join(", "), count: a.active.length })] : []),
    ...(unused.length > 0 ? [t("cand.timeline.state.unused", { names: unused.join(", "), count: unused.length })] : []),
    ...a.onCooldown.map((c) => t("cand.timeline.state.onCd", { name: c.name, s: String(c.readyInS) })),
    ...(minors.length > 0 ? [t("cand.timeline.state.minor", { names: minors.join(", ") })] : []),
    ...heals,
  ];
  return parts.length > 0 ? parts.join(" · ") : t("cand.timeline.state.nothing");
}

function summaryText(t: T, deaths: Death[]): string | null {
  const count = deaths.length;
  if (count === 0) return null;
  // "Analysed" = the analysis judged at least one of these deaths, not merely that an analysis exists.
  if (!deaths.some((d) => d.a !== null)) return t("runs.deaths", { count });
  const bad = deaths.filter((d) => d.bad);
  if (bad.length === 0) return t("cand.timeline.summary.none", { count });
  if (bad.length > 1) return t("cand.timeline.summary.many", { count, bad: bad.length });
  const b = bad[0]!;
  const params = { count, time: mmss(b.ev.atMs), names: b.majors.join(", "), n: b.majors.length };
  return t(count === 1 ? "cand.timeline.summary.single" : "cand.timeline.summary.one", params);
}

/** The death a run opens on: its first avoidable one, else its first one; null without deaths (or signals). */
export function defaultEvent(run: MPlusRun, analysis: RunDefensives | null): string | null {
  const events = [...(run.signals?.deaths.events ?? [])].sort((x, y) => x.atMs - y.atMs);
  if (events.length === 0) return null;
  const bad = analysis ? events.findIndex((ev) => { const a = matchAnalysis(ev, analysis.deaths); return a !== null && BAD.has(a.verdict); }) : -1;
  return `d${bad >= 0 ? bad : 0}`;
}

/** The death a key moves to from `current` (← → between neighbours, Home / End to the ends); null: the key is not ours. */
export function stepEvent(events: readonly string[], current: string | null, key: string): string | null {
  if (events.length === 0) return null;
  const i = current === null ? -1 : events.indexOf(current);
  if (key === "ArrowRight" || key === "ArrowDown") return events[i < 0 ? 0 : Math.min(events.length - 1, i + 1)]!;
  if (key === "ArrowLeft" || key === "ArrowUp") return events[i < 0 ? 0 : Math.max(0, i - 1)]!;
  if (key === "Home") return events[0]!;
  if (key === "End") return events[events.length - 1]!;
  return null;
}

/** A death picked by the reader, tagged with the run it was picked on. */
export interface EventPick { run: string; id: string }

/** The death shown for the run `runKey`: the reader's pick when it was made on this run, else the run's default. */
export function shownEvent(pick: EventPick | null, runKey: string, run: MPlusRun, analysis: RunDefensives | null): string | null {
  return pick !== null && pick.run === runKey ? pick.id : defaultEvent(run, analysis);
}
