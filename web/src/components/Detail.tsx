import type { LookupPayload } from "../types.ts";
import { VerdictHero } from "./VerdictHero.tsx";

export interface DetailProps { payload: LookupPayload; fetchedAt: number | null; fromCache: boolean; onRefresh: () => void }

export function Detail({ payload }: DetailProps) {
  return (
    <>
      <VerdictHero payload={payload} />
      {/* Task 8 adds SignalTiles, DungeonRuns, RioSection here. */}
    </>
  );
}
