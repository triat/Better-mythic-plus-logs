import type { LookupPayload } from "../types.ts";
import { DungeonRuns } from "./DungeonRuns.tsx";
import { RioSection } from "./RioSection.tsx";
import { SignalTiles } from "./SignalTiles.tsx";
import { VerdictHero } from "./VerdictHero.tsx";

export interface DetailProps { payload: LookupPayload; fetchedAt: number | null; fromCache: boolean; onRefresh: () => void }

export function Detail({ payload }: DetailProps) {
  return (
    <>
      <VerdictHero payload={payload} />
      <SignalTiles payload={payload} />
      <DungeonRuns payload={payload} />
      <RioSection payload={payload} />
    </>
  );
}
