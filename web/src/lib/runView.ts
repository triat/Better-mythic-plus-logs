// The selected run of the candidate profile (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 7): the panel under the run list (mockup docs/design/redesign/F-Runs.dc.html) and the wide run sheet
// (F-Run.dc.html). The figures are the run rows' own (`runs.ts`, `runList.ts`); the timeline is `timeline.ts`.
import { CLASS_NAMES } from "@shared/wow/classes.ts";
import type { LookupPayload, MPlusRun, RunDefensives, RunSignals } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { fmtAge, fmtAmount, higherTone, lowerTone, wclUrl } from "./format.ts";
import type { ParseTier, Tone } from "./format.ts";
import { specWords } from "./profile.ts";
import { dispelsPart, kickFigures, kicksPart, vsPeers } from "./runs.ts";
import { clearTime, parseCell, signedPct, upgradeOf } from "./runList.ts";

export interface RunStat { key: string; label: string; value: string; tone: "pass" | "better" | "worse" | "neutral" | `tier-${ParseTier}` }
/** `used` "10/15" with `pct` the bar; a count without a capacity (potions) has `pct` null and no bar. `id` null: no spell. */
export interface DefRow { name: string; id: number | null; used: string; pct: number | null }
export interface RunDetail {
  title: string;
  /** "+20". */
  key: string;
  upgrade: { text: string; timed: boolean } | null;
  time: string;
  when: string;
  /** "Elemental Shaman". */
  spec: string;
  stats: RunStat[];
  defensives: DefRow[];
  /** "Aussi sur ce run : kicks 37/146 (pairs 32 %) · dispels 8 · DTPS +14 % vs pairs"; null without signals. */
  also: string | null;
  /** "Ce qui l'a tué": the killing hits summed over the run's deaths, largest first. */
  killers: { id: number | null; name: string; share: string }[];
  /**
   * Enemy spells of the run (`signals.interrupts.enemyCasts`, unfiltered): the five that went through most, "passés 4 / 12
   * · tes kicks 3"; null when not measured.
   */
  enemySpells: { id: number; name: string; text: string }[] | null;
  /** The avoidable abilities that hit the player, "other" last (`id` null); null when not measured. */
  avoidable: { id: number | null; name: string; amount: string }[] | null;
  /** "Déjà connu : 3 morts · parse 72,2 %" for a run with signals and no analysis. */
  notAnalysed: string | null;
  wcl: string;
}

const MAX_KILLERS = 5;
const MAX_ENEMY_SPELLS = 5;

const toDelta = (t: Tone): "better" | "worse" | "neutral" => (t === "good" ? "better" : t === "neutral" ? "neutral" : "worse");

function statsOf(t: T, locale: Locale, s: RunSignals | undefined, healer: boolean, parsePct: number): RunStat[] {
  const parse = parseCell(t, locale, parsePct);
  const parseStat: RunStat = { key: "parse", label: t("cand.run.stat.parse"), value: parse.text, tone: parse.tier ? `tier-${parse.tier}` : "neutral" };
  if (!s) return [parseStat];
  const stats: RunStat[] = [
    { key: "deaths", label: t("cand.run.stat.deaths"), value: String(s.deaths.count), tone: s.deaths.count > 0 ? "pass" : "neutral" },
  ];
  const dd = vsPeers(s.damageTaken.dtps, s.damageTaken.peer);
  stats.push({ key: "dtps", label: t("cand.run.stat.dtps"), value: dd !== null ? signedPct(t, dd) : fmtAmount(s.damageTaken.dtps), tone: dd !== null ? toDelta(lowerTone(dd)) : "neutral" });
  const a = s.avoidableDamage;
  if (a) {
    const ad = vsPeers(a.perMinute, a.peer);
    stats.push({
      key: "avoidable", label: t("cand.run.stat.avoidable"),
      value: ad !== null ? signedPct(t, ad) : t("cand.run.perMin", { v: fmtAmount(a.perMinute) }),
      tone: ad !== null ? toDelta(lowerTone(ad)) : "neutral",
    });
  }
  if (!healer) {
    const k = kickFigures(s.interrupts);
    stats.push({
      key: "kicks", label: t("cand.run.stat.kicks"), value: k.cap !== null ? `${k.count}/${k.cap}` : String(k.count),
      tone: k.deltaPts !== null ? toDelta(higherTone(k.deltaPts)) : "neutral",
    });
  }
  stats.push({ key: "dispels", label: t("cand.run.stat.dispels"), value: String(s.dispels.count), tone: "neutral" });
  stats.push(parseStat);
  return stats;
}

function killersOf(t: T, s: RunSignals | undefined, analysis: RunDefensives | null): RunDetail["killers"] {
  const hits: { id: number | null; name: string; amount: number }[] = analysis
    ? analysis.deaths.flatMap((d) => d.killingHits)
    : (s?.deaths.events ?? []).flatMap((e) => (e.killingHits ?? []).filter((h) => h.ability !== null && !h.friendly)
        .map((h) => ({ id: h.abilityId, name: h.ability!, amount: h.amount })));
  const byName = new Map<string, { id: number | null; name: string; amount: number }>();
  for (const h of hits) {
    const cur = byName.get(h.name);
    if (cur) cur.amount += h.amount;
    else byName.set(h.name, { ...h });
  }
  const total = [...byName.values()].reduce((n, h) => n + h.amount, 0);
  return [...byName.values()].sort((x, y) => y.amount - x.amount).slice(0, MAX_KILLERS)
    .map((h) => ({ id: h.id, name: h.name, share: t("cand.runs.pct", { v: total > 0 ? Math.round((h.amount / total) * 100) : 0 }) }));
}

export function runDetail(t: T, locale: Locale, p: LookupPayload, run: MPlusRun, analysis: RunDefensives | null, now = Date.now()): RunDetail {
  const s = run.signals;
  const healer = (p.evaluation?.role ?? s?.role) === "healer";
  const klass = CLASS_NAMES[p.character.classID] ?? "";
  const defensives: DefRow[] = [
    ...(analysis?.defensives ?? []).filter((d) => d.kind !== "minor")
      .map((d) => ({ name: d.name, id: d.id, used: `${d.casts}/${d.capacity}`, pct: Math.round(d.usage * 100) })),
    // The signals count potions without a capacity (today's "5 pots · 1 hs"): a count, no bar.
    ...(s?.consumables ? [{ name: t("cand.run.potions"), id: null, used: String(s.consumables.potions), pct: null }] : []),
  ];
  let also: string | null = null;
  if (s) {
    const dd = vsPeers(s.damageTaken.dtps, s.damageTaken.peer);
    also = t("cand.run.also", {
      list: [
        kicksPart(t, s.interrupts).text,
        dispelsPart(t, s.dispels).text,
        ...(dd !== null ? [t("cand.run.dtpsVs", { delta: signedPct(t, dd) })] : []),
      ].join(" · "),
    });
  }
  const casts = s?.interrupts.enemyCasts;
  const a = s?.avoidableDamage;
  return {
    title: run.encounterName,
    key: `+${run.keyLevel}`,
    upgrade: upgradeOf(t, run),
    time: clearTime(run),
    when: fmtAge(t, run.startTime, now),
    spec: [specWords(run.spec), klass].filter(Boolean).join(" "),
    stats: statsOf(t, locale, s, healer, run.parsePercent),
    defensives,
    also,
    killers: killersOf(t, s, analysis),
    enemySpells: casts
      ? [...casts].sort((x, y) => y.completed - x.completed).slice(0, MAX_ENEMY_SPELLS)
          .map((c) => ({ id: c.id, name: c.name, text: t("cand.run.enemySpell", { completed: c.completed, attempts: c.attempts, mine: c.mine }) }))
      : null,
    avoidable: a?.abilities
      ? [
          ...a.abilities.map((x) => ({ id: x.id as number | null, name: x.name, amount: fmtAmount(x.total) })),
          ...(a.other ? [{ id: null, name: t("self.panel.other"), amount: fmtAmount(a.other) }] : []),
        ]
      : null,
    notAnalysed: s && !analysis
      ? t("cand.run.known", { deaths: t("runs.deaths", { count: s.deaths.count }), parse: parseCell(t, locale, run.parsePercent).text })
      : null,
    wcl: wclUrl(run.reportCode, run.fightID),
  };
}
