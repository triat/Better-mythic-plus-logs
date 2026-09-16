import type { LookupPayload } from "../types.ts";
import type { ReevalHint } from "../lib/keyLevel.ts";
import { DungeonRuns } from "./DungeonRuns.tsx";
import { RioSection } from "./RioSection.tsx";
import { SignalTiles } from "./SignalTiles.tsx";
import { VerdictHero } from "./VerdictHero.tsx";

export interface DetailProps { payload: LookupPayload; hint: ReevalHint | null; onReevaluate: () => void }

export function Detail({ payload, hint, onReevaluate }: DetailProps) {
  return (
    <>
      <VerdictHero payload={payload} hint={hint} onReevaluate={onReevaluate} />
      <SignalTiles payload={payload} />
      <DungeonRuns payload={payload} />
      <RioSection payload={payload} />
    </>
  );
}
