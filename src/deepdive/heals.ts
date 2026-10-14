// Death prevention by heals (docs/superpowers/specs/2026-10-14-death-prevention-design.md): a health potion or a
// healthstone reduces no damage, it adds health. It would have prevented a death only if the player had time to react
// once in danger, and the health it adds covers the overkill. Pure.
import type { RawDeepDive, DeathHealth, HealAtDeath, HealRules, HealTool } from "./types.ts";

/** The start of the last stretch at or under the danger line before the death; null when never in danger. */
export function dangerStart(h: DeathHealth, line: number): number | null {
  let t: number | null = null;
  for (const p of h.curve) {
    if (p.ts >= h.deathTs) break;
    if (p.hp <= line) t ??= p.ts;
    else t = null;
  }
  return t;
}

/** Health at `ts` (after the last event at or before it, the killing hit excluded); full health without an event. */
export function hpAt(h: DeathHealth, ts: number, maxHp: number): number {
  let hp = maxHp;
  for (const p of h.curve) {
    if (p.ts > ts || p.ts >= h.deathTs) break;
    hp = p.hp;
  }
  return hp;
}

const healOf = (tool: HealTool, maxHp: number): number => tool.flat ?? Math.round((tool.maxHpShare ?? 0) * maxHp);

export interface HealJudgeInput {
  rules: HealRules;
  raw: RawDeepDive;
  health: DeathHealth & { maxHp: number };
  overkill: number;
  /** Class names of the group, the player included. */
  groupClasses: string[];
}

/**
 * One line per heal tool the raw row can judge (its ids were in the cast filter). `dangerMs` is the time between the
 * danger line crossing and the death.
 */
export function judgeHeals(i: HealJudgeInput): { dangerMs: number | null; heals: HealAtDeath[] } {
  const { rules, raw, health, overkill } = i;
  const maxHp = health.maxHp;
  const tDanger = dangerStart(health, rules.dangerHpShare * maxHp);
  const dangerMs = tDanger === null ? null : health.deathTs - tDanger;
  const tDrink = tDanger === null ? null : tDanger + rules.reactionMs;
  const inTime = tDrink !== null && tDrink < health.deathTs;
  const heals: HealAtDeath[] = [];
  for (const tool of rules.tools) {
    if (!tool.ids.every((id) => raw.tableIds.includes(id))) continue;
    if (tool.groupClass && !i.groupClasses.includes(tool.groupClass)) {
      heals.push({ name: tool.name, status: "not in group", heal: null });
      continue;
    }
    // Readiness when the heal would have been pressed; at the death itself when there was no time.
    const at = inTime ? tDrink! : health.deathTs;
    const last = raw.castEvents.filter((e) => tool.ids.includes(e.abilityGameID) && e.timestamp <= at).reduce<number | null>((m, e) => Math.max(m ?? 0, e.timestamp), null);
    if (last !== null && at - last < tool.cooldownS * 1000) {
      heals.push({ name: tool.name, status: "on cooldown", heal: null, readyInS: Math.round(tool.cooldownS - (at - last) / 1000) });
      continue;
    }
    if (!inTime) {
      heals.push({ name: tool.name, status: "no time", heal: null });
      continue;
    }
    const effective = Math.max(0, Math.min(healOf(tool, maxHp), maxHp - hpAt(health, tDrink!, maxHp)));
    heals.push({ name: tool.name, status: effective > overkill ? "saves" : "not enough", heal: effective });
  }
  return { dangerMs, heals };
}

/** Every heal tool id: added to the deep-dive's cast filter. */
export const healIds = (rules: HealRules): number[] => rules.tools.flatMap((t) => t.ids);
