import type { LookupPayload } from "../../types.ts";
import type { ReevalHint } from "../../lib/keyLevel.ts";
import type { OwnerHeaderView } from "../../lib/profile.ts";
import { fmtAge } from "../../lib/format.ts";
import { useT } from "../../locale.tsx";
import type { SeasonState } from "../../useSeason.ts";
import { ClassIcon } from "../candidate/ProfileHeader.tsx";
import type { ProfileFetch } from "../candidate/ProfileHeader.tsx";
import { MeChip } from "../self/MeChip.tsx";
import type { SelfActions } from "./types.ts";

/** The owner page's header (mockup F-Moi-Forme): class icon, name, "This is me", the season line, Sync, Refresh. */
export function OwnerHeader({ view, payload, self, season, fetch, hint, onReevaluate }: {
  view: OwnerHeaderView;
  payload: LookupPayload;
  self: SelfActions;
  season: SeasonState;
  fetch: ProfileFetch;
  hint: ReevalHint | null;
  onReevaluate: () => void;
}) {
  const { t } = useT();
  const h = view.head;
  return (
    <section className="cand-head">
      <div className="cand-id">
        <ClassIcon view={h} />
        <div className="cand-id-text">
          <div className="cand-name-row">
            {/* The class colour is data from src/wow/classes.ts, as on every result view. */}
            <h1 className="cand-name" style={{ color: h.classColor }}>{h.name}</h1>
            <MeChip payload={payload} self={self} />
          </div>
          <span className="cand-line">{view.line}</span>
        </div>
        <div className="cand-actions">
          <button
            type="button" className="btn" aria-expanded={season.syncOpen} disabled={season.running} title={t("owner.header.syncTitle")}
            onClick={season.syncOpen ? season.closeSync : season.openSync}
          >
            {t("owner.header.sync")}
          </button>
        </div>
      </div>
      <div className="cand-meta">
        <span className="faint">
          {fetch.fetchedAt !== null && t("shell.candidate.fetched", { age: fmtAge(t, fetch.fetchedAt) })}
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
