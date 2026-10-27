import { useState } from "react";
import type { ReactNode } from "react";
import type { ReevalHint } from "../../lib/keyLevel.ts";
import type { ProfileHeaderView } from "../../lib/profile.ts";
import { fmtAge } from "../../lib/format.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import { Icon } from "../Icon.tsx";

/** Where the profile came from and how to fetch it again (the candidate page's former `cand-bar`). */
export interface ProfileFetch {
  /** When the shown result was fetched; null when unknown (no history row yet). */
  fetchedAt: number | null;
  cached: boolean;
  onRefresh: () => void;
  /** A lookup is running: Refresh waits. */
  busy: boolean;
}

/** The compact profile header (mockup F-Synthese): class icon, name, verdict, facts, the links and Refresh. */
export function ProfileHeader({ view, hint, onReevaluate, fetch, compareHref, meChip }: {
  view: ProfileHeaderView;
  hint: ReevalHint | null;
  onReevaluate: () => void;
  fetch: ProfileFetch;
  compareHref: string | null;
  meChip: ReactNode;
}) {
  const { t } = useT();
  const v = view.verdict;
  return (
    <section className="cand-head">
      <div className="cand-id">
        <ClassIcon view={view} />
        <div className="cand-id-text">
          <div className="cand-name-row">
            {/* The class colour is data from src/wow/classes.ts, as on every result view. */}
            <h1 className="cand-name" style={{ color: view.classColor }}>{view.name}</h1>
            <span className={"cand-pill " + v.cls}>
              {v.label}{v.score !== null && <span className="mono">{v.score}</span>}
            </span>
            <span className="cand-target">{v.target}</span>
            {view.lowReliability && (
              <span className="cand-rel"><Icon name="warn" size={13} />{view.lowReliability}</span>
            )}
            {meChip}
          </div>
          <span className="cand-line">{view.line}</span>
        </div>
        <div className="cand-actions">
          {compareHref && <a className="btn" href={compareHref} title={t("cand.header.compareTitle")}>{t("cand.header.compare")}</a>}
          {view.links.rio && (
            <a className="btn" href={view.links.rio} target="_blank" rel="noopener" onClick={() => track("external_rio")}>{t("cand.header.rioLink")}</a>
          )}
          <a className="btn" href={view.links.wcl} target="_blank" rel="noopener" onClick={() => track("external_log")}>{t("cand.header.wclLink")}</a>
        </div>
      </div>
      {view.facts.length > 0 && (
        <div className="cand-facts">
          {view.facts.map((f) => (
            <span key={f.label}><b className="mono">{f.value}</b> {f.label}{f.sub && <span className="faint"> {f.sub}</span>}</span>
          ))}
        </div>
      )}
      <div className="cand-meta">
        <span className="faint">
          {view.meta}
          {fetch.fetchedAt !== null && ` · ${t("shell.candidate.fetched", { age: fmtAge(t, fetch.fetchedAt) })}`}
          {fetch.fetchedAt !== null && fetch.cached && ` · ${t("shell.candidate.cached")}`}
        </span>
        <button type="button" className="btn" onClick={fetch.onRefresh} disabled={fetch.busy} title={t("shell.candidate.refreshTitle")}>
          {t("shell.candidate.refresh")}
        </button>
      </div>
      {hint && (
        <div className="reeval">
          {/* biome-ignore lint/a11y/useValidAnchor: styled as the surrounding text link; a button would change the look. */}
          {hint.label} — <a href="#" onClick={(e) => { e.preventDefault(); onReevaluate(); }}>{hint.action}</a>
          <span className="faint">{t("verdict.replaces")}</span>
        </div>
      )}
    </section>
  );
}

/** Wowhead's class icon, the 2-letter tile when it does not load (blocked, offline, unknown class). */
export function ClassIcon({ view }: { view: Pick<ProfileHeaderView, "iconUrl" | "classColor" | "initials"> }) {
  const [failed, setFailed] = useState(false);
  if (view.iconUrl && !failed) {
    return <img className="cand-icon" src={view.iconUrl} width={40} height={40} alt="" onError={() => setFailed(true)} />;
  }
  return <span className="cand-icon cand-icon-tile" style={{ color: view.classColor }} aria-hidden="true">{view.initials}</span>;
}
