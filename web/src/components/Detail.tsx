import type { LookupPayload, OverrideEntry } from "../types.ts";
import type { ReevalHint } from "../lib/keyLevel.ts";
import type { ProposalMode } from "../lib/hostedMode.ts";
import { resultView } from "../lib/self.ts";
import { CandidateProfile } from "./candidate/CandidateProfile.tsx";
import type { ProfileFetch } from "./candidate/ProfileHeader.tsx";
import { OwnerProfile } from "./owner/OwnerProfile.tsx";
import type { SelfActions } from "./self/ResultHead.tsx";

/** Deep-dive callbacks owned by App (they touch the payload cache). */
export interface DeepdiveActions {
  /** `reportCode:fightID` of the run being analyzed, or null. */
  analyzing: string | null;
  /** "Analyzing 2/8…" while a batch runs, else null. */
  progress: string | null;
  analyze: (run: { reportCode: string; fightID: number }, force?: boolean) => Promise<void>;
  /** Analyses `runs` one by one (the candidate Runs list's own runs), else every displayed run not analysed yet
   * (`unanalyzedRuns`, the owner's view, which also shows the previous level's best). */
  analyzeAll: (runs?: readonly { reportCode: string; fightID: number }[]) => Promise<void>;
  patch: (className: string, spec: string, patch: OverrideEntry) => Promise<void>;
  /** Whether analysing `runs` more runs fits in the hourly quota (always true locally). */
  canAfford: (runs: number) => boolean;
  /** Tooltip of a disabled Analyze button: "Hourly quota reached · resets in N min". */
  quotaTooltip: string;
  /** Local file edits, member proposals, or admin corrections — decides the panel's wording and footer. */
  mode: ProposalMode;
}

export interface DetailProps {
  payload: LookupPayload;
  hint: ReevalHint | null;
  onReevaluate: () => void;
  deepdive: DeepdiveActions;
  self: SelfActions;
  /** The candidate profile's header: fetch time, cache, Refresh. */
  fetch: ProfileFetch;
  compareHref: string | null;
  /** The candidate page's history key (the profile's tab / run / sheet live in the URL); null on the Live page. */
  urlKey: string | null;
}

/**
 * The result page. One of the member's own characters opens the owner page (redesign phase 3: header, Ma forme ·
 * Donjons · Runs); anyone else opens the candidate profile (redesign phase 2: header, Synthèse · Runs · Donjons ·
 * Méthode), with "This is me" in its header (canvas "control", ControlVettingA). Toggling the chip switches between the
 * two in place.
 */
export function Detail(props: DetailProps) {
  return resultView(props.self.characters, props.payload) === "owner" ? <OwnerProfile {...props} /> : <CandidateProfile {...props} />;
}
