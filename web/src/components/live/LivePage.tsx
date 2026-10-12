// The /live page (mockup F-Live): the page header with the connection chip, then the status card, the Group Finder
// roster and "Your group" while a roster is on screen; the selected profile below. App owns every piece of state.
import type { ReactNode } from "react";
import { useT } from "../../locale.tsx";
import { liveView } from "../../lib/live/panel.ts";
import type { CachedVerdict, LiveRole, LiveSort, Roster } from "../../lib/live/roster.ts";
import type { LiveState } from "../../lib/live/useWowCapture.ts";
import { LiveChip } from "../LiveChip.tsx";
import { LiveGroup } from "./LiveGroup.tsx";
import { LiveRoster } from "./LiveRoster.tsx";
import { LiveIcon, LiveStatus } from "./LiveStatus.tsx";

export interface LivePageProps {
  state: LiveState;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Null when there is none or it went stale (`useWowCapture`). */
  roster: Roster | null;
  verdicts: Map<string, CachedVerdict>;
  yourKey: number | null;
  sort: LiveSort;
  roles: readonly LiveRole[];
  classes: readonly string[];
  onSortChange: (v: LiveSort) => void;
  onRolesChange: (v: LiveRole[]) => void;
  onClassesChange: (v: string[]) => void;
  /** "Open profile", "Evaluate" and a party member's chip: the same lookup the search runs (a cache hit costs 0 pts). */
  onSelect: (character: string) => void;
  auto: boolean;
  /** The member's own WCL client is usable (hosted) or this is local mode. */
  autoAllowed: boolean;
  onAutoChange: (v: boolean) => void;
  /** The auto queue's in-flight character. */
  queued: ReadonlySet<string>;
  now: number;
  /** The selected profile, shown under the roster. */
  result: ReactNode;
}

export function LivePage(p: LivePageProps) {
  const { t, locale } = useT();
  const view = p.roster
    ? liveView(t, locale, {
      roster: p.roster, verdicts: p.verdicts, now: p.now, queued: p.queued, yourKey: p.yourKey,
      settings: { liveSort: p.sort, liveRoles: p.roles, liveClasses: p.classes },
    })
    : null;
  return (
    <div className={"content lv" + (p.result ? " content-result" : "")}>
      <div className="page-head lv-head">
        <h1>{t("shell.live.title")}</h1>
        <LiveChip state={p.state} connect={p.connect} />
        {p.state.kind !== "off" && (
          <button type="button" className="btn lv-btn lv-disconnect" onClick={p.disconnect}>{t("live.panel.disconnect")}</button>
        )}
      </div>
      {view && p.roster ? (
        <>
          <LiveStatus view={view} auto={p.auto} autoAllowed={p.autoAllowed} onAutoChange={p.onAutoChange} />
          <LiveRoster
            view={view} roster={p.roster} classes={p.classes} sort={p.sort}
            onSortChange={p.onSortChange} onRolesChange={p.onRolesChange} onClassesChange={p.onClassesChange} onSelect={p.onSelect}
          />
          <LiveGroup view={view} onSelect={p.onSelect} />
        </>
      ) : p.state.kind === "off" ? (
        <p className="muted live-intro">{t("shell.live.sub")}</p>
      ) : (
        <section className="card lv-status">
          <div className="lv-status-id">
            <LiveIcon />
            <div className="lv-status-text">
              <span className="lv-status-title">{t("live.status.waiting")}</span>
              <span className="lv-status-key">{t("shell.live.sub")}</span>
            </div>
          </div>
        </section>
      )}
      {p.result}
    </div>
  );
}
