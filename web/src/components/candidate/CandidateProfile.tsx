import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { LookupPayload } from "../../types.ts";
import type { ReevalHint } from "../../lib/keyLevel.ts";
import { CAND_TABS, CAND_TAB_EVENT, candHref, candInitial, profileHeader, runKeyOf, tabAfter } from "../../lib/profile.ts";
import type { CandState, CandTab } from "../../lib/profile.ts";
import { analysisFor } from "../../lib/deepdive.ts";
import { DEFAULT_LAYERS, shownEvent } from "../../lib/timeline.ts";
import type { EventPick, LayerKey } from "../../lib/timeline.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import type { DeepdiveActions } from "../Detail.tsx";
import { MeChip } from "../self/MeChip.tsx";
import type { SelfActions } from "../self/ResultHead.tsx";
import { CandDungeons } from "./CandDungeons.tsx";
import { MethodTab } from "./MethodTab.tsx";
import { ProfileHeader } from "./ProfileHeader.tsx";
import { RunSheet } from "./RunSheet.tsx";
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
  // The timeline's ticked layers and picked death: per page view, shared by the Runs tab and the run sheet.
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);
  const [eventPick, setEventPick] = useState<EventPick | null>(null);
  const toggleLayer = useCallback((k: LayerKey) => setLayers((l) => ({ ...l, [k]: !l[k] })), []);
  // The sheet opened from "Analyse détaillée" starts on its deep-dive section.
  const [sheetDd, setSheetDd] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const tabRef = useRef(state.tab);
  tabRef.current = state.tab;
  const sheetRun = state.sheet && state.run !== null ? payload.perDungeon.runs.find((r) => runKeyOf(r) === state.run) ?? null : null;
  const sheetAnalysis = sheetRun ? analysisFor(payload, sheetRun) : null;
  const closeSheet = () => {
    setState((s) => ({ ...s, sheet: false }));
    setSheetDd(false);
    // Back to "Ouvrir en grand" (the Runs tab), else the current tab (a reload with &sheet=1 on another tab).
    requestAnimationFrame(() => (openRef.current ?? tabRefs.current.get(tabRef.current))?.focus());
  };

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
            onSheet={(run, dd) => { setSheetDd(!!dd); setState((s) => ({ ...s, run, sheet: true })); }}
            layers={layers} onToggle={toggleLayer} pick={eventPick} onPick={setEventPick} openRef={openRef}
          />
        )}
        {state.tab === "dungeons" && (
          <CandDungeons payload={payload} deepdive={deepdive} onView={(run) => { track(CAND_TAB_EVENT.runs); setState((s) => ({ ...s, tab: "runs", run })); }} />
        )}
        {state.tab === "method" && <MethodTab evaluation={payload.evaluation} />}
      </div>
      {sheetRun && (
        <RunSheet
          payload={payload} run={sheetRun} analysis={sheetAnalysis} deepdive={deepdive}
          layers={layers} onToggle={toggleLayer}
          event={shownEvent(eventPick, state.run!, sheetRun, sheetAnalysis)} onSelect={(id) => setEventPick({ run: state.run!, id })}
          onRun={(run) => { setSheetDd(false); setState((s) => ({ ...s, run })); }}
          onClose={closeSheet} focusDeepdive={sheetDd}
        />
      )}
    </div>
  );
}
