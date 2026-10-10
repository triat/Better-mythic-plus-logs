import { useState } from "react";
import type { LookupPayload, OverrideEntry } from "../types.ts";
import type { ReevalHint } from "../lib/keyLevel.ts";
import type { ProposalMode } from "../lib/hostedMode.ts";
import { RESULT_TABS, resultView, type ResultTab } from "../lib/self.ts";
import { useT } from "../locale.tsx";
import { track } from "../usage.ts";
import { seasonWho, useSeason } from "../useSeason.ts";
import { DungeonRuns } from "./DungeonRuns.tsx";
import { RioSection } from "./RioSection.tsx";
import { SignalTiles } from "./SignalTiles.tsx";
import { VerdictHero } from "./VerdictHero.tsx";
import { DungeonsTab } from "./self/DungeonsTab.tsx";
import { MeChip } from "./self/MeChip.tsx";
import { Overview } from "./self/Overview.tsx";
import { ResultHead, type SelfActions } from "./self/ResultHead.tsx";
import { RunsTab } from "./self/RunsTab.tsx";
import { SyncCard } from "./self/SyncCard.tsx";

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

export interface DetailProps { payload: LookupPayload; hint: ReevalHint | null; onReevaluate: () => void; deepdive: DeepdiveActions; self: SelfActions }

/**
 * The result page. One of the member's own characters opens the self-review (canvas "self-review", variants A + C);
 * anyone else opens the vetting view the page had before phase 1, with "This is me" on the name line (canvas
 * "control", ControlVettingA). Toggling the chip switches between the two in place.
 */
export function Detail(props: DetailProps) {
  return resultView(props.self.characters, props.payload) === "owner" ? <OwnerDetail {...props} /> : <VettingDetail {...props} />;
}

function VettingDetail({ payload, hint, onReevaluate, deepdive, self }: DetailProps) {
  return (
    <>
      <VerdictHero payload={payload} hint={hint} onReevaluate={onReevaluate} identityExtra={<MeChip payload={payload} self={self} />} />
      {/* Stacked, or side by side on a wide screen: see .detail-rest in app.css. */}
      <div className="detail-rest">
        <div className="detail-tiles"><SignalTiles payload={payload} /></div>
        <div className="detail-runs"><DungeonRuns payload={payload} deepdive={deepdive} /></div>
        <div className="detail-rio"><RioSection payload={payload} /></div>
      </div>
    </>
  );
}

/** Header, three tabs; the season (GET /api/season) is loaded only here. */
function OwnerDetail({ payload, hint, onReevaluate, deepdive, self }: DetailProps) {
  const { t } = useT();
  const [tab, setTab] = useState<ResultTab>("overview");
  const [runsOf, setRunsOf] = useState<number | null>(null);
  const season = useSeason(seasonWho(payload), self, payload);
  const pick = (next: ResultTab) => {
    if (next === "dungeons") track("self_tab_dungeons");
    if (next === "runs") track("self_tab_runs");
    setTab(next);
  };
  return (
    <>
      <ResultHead payload={payload} season={season} self={self} />
      {season.syncOpen && <SyncCard season={season} self={self} />}
      <div className="rtabs" role="tablist">
        {RESULT_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={"rtab" + (tab === k ? " on" : "")} onClick={() => pick(k)}>
            {t(`self.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview payload={payload} season={season.view} hint={hint} onReevaluate={onReevaluate} />}
      {tab === "dungeons" && (
        <DungeonsTab payload={payload} season={season.view} loading={season.loading} onRuns={(id) => { setRunsOf(id); pick("runs"); }} />
      )}
      {tab === "runs" && (
        <RunsTab payload={payload} season={season.view} deepdive={deepdive} encounterID={runsOf} onClearFilter={() => setRunsOf(null)} />
      )}
    </>
  );
}
