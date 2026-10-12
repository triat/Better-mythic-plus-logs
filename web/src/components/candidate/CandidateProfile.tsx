import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { LookupPayload } from "../../types.ts";
import type { ReevalHint } from "../../lib/keyLevel.ts";
import { CAND_TABS, CAND_TAB_EVENT, candHref, candInitial, profileHeader, runKeyOf, tabAfter } from "../../lib/profile.ts";
import type { CandState, CandTab } from "../../lib/profile.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import type { DeepdiveActions } from "../Detail.tsx";
import { SignalTiles } from "../SignalTiles.tsx";
import { VerdictHero } from "../VerdictHero.tsx";
import { MeChip } from "../self/MeChip.tsx";
import type { SelfActions } from "../self/ResultHead.tsx";
import { ProfileHeader } from "./ProfileHeader.tsx";
import { RunsTab } from "./RunsTab.tsx";
import type { ProfileFetch } from "./ProfileHeader.tsx";
import { SynthesisTab } from "./SynthesisTab.tsx";

export interface CandidateProfileProps {
  payload: LookupPayload;
  hint: ReevalHint | null;
  onReevaluate: () => void;
  deepdive: DeepdiveActions;
  self: SelfActions;
  fetch: ProfileFetch;
  /** `/compare?pick=<key>`; null when the profile has no history entry. */
  compareHref: string | null;
  /** The candidate page: the history key the URL names, and the tab / run / sheet are mirrored into the URL. Null on
   * the Live page, where the state lives in memory only and the URL is never touched. */
  urlKey: string | null;
}

const CLOSED: CandState = { tab: "synthesis", run: null, sheet: false };

/** The candidate profile (redesign phase 2, mockup F-Synthese): the header, four tabs, the tab shown. */
export function CandidateProfile({ payload, hint, onReevaluate, deepdive, self, fetch, compareHref, urlKey }: CandidateProfileProps) {
  const { t, locale } = useT();
  const [state, setState] = useState<CandState>(() =>
    urlKey === null ? CLOSED : candInitial(location.search, payload.perDungeon.runs.map(runKeyOf)));
  useEffect(() => {
    if (urlKey !== null) history.replaceState({}, "", candHref(urlKey, state));
  }, [urlKey, state]);
  const header = useMemo(() => profileHeader(t, locale, payload), [t, locale, payload]);
  const tabRefs = useRef(new Map<CandTab, HTMLButtonElement>());

  const pick = (tab: CandTab) => {
    if (tab === state.tab) return;
    track(CAND_TAB_EVENT[tab]);
    setState((s) => ({ ...s, tab }));
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabAfter(state.tab, e.key);
    if (!next) return;
    e.preventDefault();
    pick(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="cand">
      <ProfileHeader
        view={header} hint={hint} onReevaluate={onReevaluate} fetch={fetch} compareHref={compareHref}
        meChip={<MeChip payload={payload} self={self} />}
      />
      <div className="cand-tabs" role="tablist" aria-label={t("cand.tabs.label")}>
        {CAND_TABS.map((k) => (
          <button
            key={k} id={`cand-tab-${k}`} type="button" role="tab" aria-selected={state.tab === k} aria-controls="cand-panel"
            tabIndex={state.tab === k ? 0 : -1} className={"cand-tab" + (state.tab === k ? " on" : "")}
            ref={(el) => { if (el) tabRefs.current.set(k, el); else tabRefs.current.delete(k); }}
            onClick={() => pick(k)} onKeyDown={onTabKey}
          >
            {t(`cand.tabs.${k}`)}
            {k === "runs" && <span className="cand-tab-count mono">{header.runCount}</span>}
          </button>
        ))}
      </div>
      <div id="cand-panel" role="tabpanel" aria-labelledby={`cand-tab-${state.tab}`} className="cand-panel">
        {state.tab === "synthesis" && <SynthesisTab payload={payload} />}
        {state.tab === "runs" && (
          <RunsTab
            payload={payload} deepdive={deepdive} run={state.run}
            onRun={(run) => setState((s) => ({ ...s, run }))}
            onSheet={(run) => setState((s) => ({ ...s, run, sheet: true }))}
          />
        )}
        {/* Until their own views land (phase 2, tasks 13–14), the other tabs show the vetting view's pieces. */}
        {state.tab === "dungeons" && <SignalTiles payload={payload} />}
        {state.tab === "method" && <VerdictHero payload={payload} hint={null} onReevaluate={onReevaluate} />}
      </div>
    </div>
  );
}
