import type { LookupPayload, OverrideEntry } from "../types.ts";
import type { ReevalHint } from "../lib/keyLevel.ts";
import type { ProposalMode } from "../lib/hostedMode.ts";
import { DungeonRuns } from "./DungeonRuns.tsx";
import { RioSection } from "./RioSection.tsx";
import { SignalTiles } from "./SignalTiles.tsx";
import { VerdictHero } from "./VerdictHero.tsx";

/** Deep-dive callbacks owned by App (they touch the payload cache). */
export interface DeepdiveActions {
  /** `reportCode:fightID` of the run being analyzed, or null. */
  analyzing: string | null;
  /** "Analyzing 2/8…" while a batch runs, else null. */
  progress: string | null;
  analyze: (run: { reportCode: string; fightID: number }, force?: boolean) => Promise<void>;
  analyzeAll: () => Promise<void>;
  patch: (className: string, spec: string, patch: OverrideEntry) => Promise<void>;
  /** Whether analysing `runs` more runs fits in the hourly quota (always true locally). */
  canAfford: (runs: number) => boolean;
  /** Tooltip of a disabled Analyze button: "Hourly quota reached · resets in N min". */
  quotaTooltip: string;
  /** Local file edits, member proposals, or admin corrections — decides the panel's wording and footer. */
  mode: ProposalMode;
}

export interface DetailProps { payload: LookupPayload; hint: ReevalHint | null; onReevaluate: () => void; deepdive: DeepdiveActions }

export function Detail({ payload, hint, onReevaluate, deepdive }: DetailProps) {
  return (
    <>
      <VerdictHero payload={payload} hint={hint} onReevaluate={onReevaluate} />
      <SignalTiles payload={payload} />
      <DungeonRuns payload={payload} deepdive={deepdive} />
      <RioSection payload={payload} />
    </>
  );
}
