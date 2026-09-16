import type { RawRunReport } from "../signals/types.ts";

export interface RunPlayer { actorID: number; className: string; spec: string }

/** The character's actor id / class / spec, from the cached run's Summary composition. */
export function playerOf(report: RawRunReport | null | undefined, character: string): RunPlayer | null {
  const p = report?.summary?.data?.composition?.find((c) => c.name === character);
  if (!p || typeof p.id !== "number") return null;
  return { actorID: p.id, className: p.type ?? "", spec: p.specs?.[0]?.spec ?? "" };
}
