// A run's crowd control (docs/superpowers/specs/2026-10-10-self-review-control-design.md, decision 5, "Numbers"):
// pure, recomputed from the cached events on every read.
import { playerOf } from "../../deepdive/player.ts";
import type { ControlSpell, RawRunControl, RawRunReport, RunControl } from "../types.ts";
import { CONTROL_REFERENCE, referenceFor, type ControlReference } from "./reference.ts";
import { CC_TABLE, ccIndex, type CcTable } from "./table.ts";

/** Applications of the same spell by the same player within 1 s of the use's first one are one use. */
export const USE_WINDOW_MS = 1_000;
const TEN_MINUTES_MS = 600_000;

export interface ControlPlayer { actorID: number; className: string; spec: string }

export function parseRunControl(
  raw: RawRunControl, player: ControlPlayer, durationMs: number,
  deps: { table?: CcTable; reference?: ControlReference } = {},
): RunControl {
  const table = deps.table ?? CC_TABLE;
  const index = ccIndex(table);
  const owner = new Map(raw.pets.map((p) => [p.id, p.petOwner]));
  const mine = raw.events
    .filter((e) => typeof e.sourceID === "number" && (e.sourceID === player.actorID || owner.get(e.sourceID) === player.actorID))
    .sort((a, b) => a.timestamp - b.timestamp);
  const spells = new Map<string, ControlSpell & { start: number }>();
  for (const e of mine) {
    const kind = e.type === "cast" ? "cast" : e.type === "applydebuff" ? "debuff" : null;
    if (kind === null || typeof e.abilityGameID !== "number") continue;
    const entry = index.get(`${kind}:${e.abilityGameID}`);
    if (!entry) continue;
    const key = `${kind}:${entry.id}`;
    let s = spells.get(key);
    if (!s) {
      s = { id: entry.id, name: entry.name, category: entry.category, uses: 0, enemies: 0, ...(entry.pet ? { pet: true as const } : {}), start: Number.NEGATIVE_INFINITY };
      spells.set(key, s);
    }
    if (kind === "cast" || e.timestamp - s.start >= USE_WINDOW_MS) {
      s.uses++;
      s.start = e.timestamp;
    }
    if (kind === "debuff") s.enemies++;
  }
  const list = [...spells.values()].map(({ start: _start, ...s }) => s).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  const uses = list.reduce((n, s) => n + s.uses, 0);
  const perTenMin = durationMs > 0 ? uses / (durationMs / TEN_MINUTES_MS) : 0;
  const reference = referenceFor(player.className, player.spec, deps.reference ?? CONTROL_REFERENCE, table);
  return {
    uses,
    enemies: list.reduce((n, s) => n + s.enemies, 0),
    perTenMin,
    reference,
    vsReference: reference === null ? null : ((perTenMin - reference) / reference) * 100,
    stale: raw.tableVersion !== table.version,
    spells: list,
  };
}

/** The player's crowd control in a cached run, or null when nothing was fetched or the name is not in the report. */
export function controlOf(report: RawRunReport, raw: RawRunControl | null, name: string, durationMs: number): RunControl | null {
  if (!raw) return null;
  const p = playerOf(report, name);
  return p ? parseRunControl(raw, p, durationMs) : null;
}
