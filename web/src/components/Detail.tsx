// Minimal placeholder — Task 7 rewrites this into the full detail view.
import type { LookupPayload } from "../types.ts";

export interface DetailProps { payload: LookupPayload; fetchedAt: number | null; fromCache: boolean; onRefresh: () => void }

export function Detail({ payload }: DetailProps) {
  return <div className="card">{payload.character.name} · {payload.evaluation.verdict}</div>;
}
