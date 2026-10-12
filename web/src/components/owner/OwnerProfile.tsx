import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { OWNER_TABS, OWNER_TAB_EVENT, ownerHeader, ownerHref, ownerState, ownerTabAfter, runKeyOf, viewSwitchHref } from "../../lib/profile.ts";
import type { OwnerState, OwnerTab } from "../../lib/profile.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import { seasonWho, useSeason } from "../../useSeason.ts";
import { CandidateProfile } from "../candidate/CandidateProfile.tsx";
import type { DetailProps } from "../Detail.tsx";
import { DungeonsTab } from "../self/DungeonsTab.tsx";
import { RunsTab } from "../self/RunsTab.tsx";
import { SyncCard } from "../self/SyncCard.tsx";
import { FormTab } from "./FormTab.tsx";
import { OwnerHeader } from "./OwnerHeader.tsx";

const START: OwnerState = { tab: "form", run: null, vetting: false };

/**
 * The owner page (redesign phase 3): one of the member's own characters. The header, the sync card, three tabs — Ma
 * forme · Donjons · Runs — over the season (GET /api/season, 0 pts); `as=vetting` shows the member their own vetting
 * profile instead. The state lives in the URL on the candidate page (`urlKey`), in memory on the Live page.
 */
export function OwnerProfile(props: DetailProps) {
  const { payload, hint, onReevaluate, self, fetch, urlKey } = props;
  const { t, locale } = useT();
  const season = useSeason(seasonWho(payload), self, payload);
  const [state, setState] = useState<OwnerState>(() => {
    if (urlKey === null) return START;
    // The season is not loaded yet: keep the URL's run for now, checked against the season once it arrives.
    const raw = new URLSearchParams(location.search).get("run");
    return ownerState(location.search, urlKey, raw === null ? [] : [raw]);
  });
  const runKeys = useMemo(() => (season.loading ? null : (season.view?.runs.map(runKeyOf) ?? [])), [season.loading, season.view]);
  useEffect(() => {
    if (runKeys !== null && state.run !== null && !runKeys.includes(state.run)) setState((s) => ({ ...s, run: null }));
  }, [runKeys, state.run]);
  // The vetting profile writes its own URL (`vettingHref`).
  useEffect(() => {
    if (urlKey !== null && !state.vetting) history.replaceState({}, "", ownerHref(urlKey, state));
  }, [urlKey, state]);
  const header = useMemo(() => ownerHeader(t, locale, payload, season.view), [t, locale, payload, season.view]);
  const tabRefs = useRef(new Map<OwnerTab, HTMLButtonElement>());

  const switchView = (vetting: boolean) => {
    if (urlKey === null) { setState((s) => ({ ...s, run: null, vetting })); return; }
    const href = viewSwitchHref(urlKey, location.search, vetting);
    history.replaceState({}, "", href);
    setState(vetting ? (s) => ({ ...s, run: null, vetting: true }) : ownerState(new URL(href, location.href).search, urlKey, []));
  };
  const pick = (tab: OwnerTab) => {
    if (tab === state.tab) return;
    track(OWNER_TAB_EVENT[tab]);
    setState((s) => ({ ...s, tab }));
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = ownerTabAfter(state.tab, e.key);
    if (!next) return;
    e.preventDefault();
    pick(next);
    tabRefs.current.get(next)?.focus();
  };

  if (state.vetting) {
    return (
      <div className="cand">
        <div className="owner-vetting-bar">
          <span>{t("owner.vetting.bar")}</span>
          <button type="button" className="btn" onClick={() => switchView(false)}>{t("owner.vetting.back")}</button>
        </div>
        <CandidateProfile {...props} vetting />
      </div>
    );
  }

  const v = season.view;
  const empty = v !== null && v.runs.length === 0;
  return (
    <div className="cand owner">
      <OwnerHeader view={header} payload={payload} self={self} season={season} fetch={fetch} hint={hint} onReevaluate={onReevaluate} />
      {season.syncOpen && <SyncCard season={season} self={self} />}
      <div className="cand-tabs" role="tablist" aria-label={t("owner.tabs.label")}>
        {OWNER_TABS.map((k) => (
          <button
            key={k} id={`owner-tab-${k}`} type="button" role="tab" aria-selected={state.tab === k} aria-controls="owner-panel"
            tabIndex={state.tab === k ? 0 : -1} className={"cand-tab" + (state.tab === k ? " on" : "")}
            ref={(el) => { if (el) tabRefs.current.set(k, el); else tabRefs.current.delete(k); }}
            onClick={() => pick(k)} onKeyDown={onTabKey}
          >
            {t(`owner.tabs.${k}`)}
            {k === "runs" && header.runCount !== null && <span className="cand-tab-count mono">{header.runCount}</span>}
          </button>
        ))}
      </div>
      <div id="owner-panel" role="tabpanel" aria-labelledby={`owner-tab-${state.tab}`} className="cand-panel">
        {v === null && <p className="muted">{season.loading ? t("self.loading") : t("self.sync.nothing")}</p>}
        {empty && (
          <div className="owner-empty">
            <span>{t("owner.empty")}</span>
            <button type="button" className="btn" onClick={() => switchView(true)}>{t("owner.form.chef.vetting")}</button>
          </div>
        )}
        {v !== null && state.tab === "form" && (
          <FormTab evaluation={payload.evaluation} season={v} historyKey={urlKey ?? ""} onVetting={() => switchView(true)} />
        )}
        {v !== null && state.tab === "dungeons" && (
          <DungeonsTab payload={payload} season={v} loading={false} onRuns={() => pick("runs")} />
        )}
        {state.tab === "runs" && <RunsTab payload={payload} season={v} deepdive={props.deepdive} encounterID={null} onClearFilter={() => {}} />}
      </div>
    </div>
  );
}
