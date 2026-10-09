import { fmtPts } from "../../lib/format.ts";
import { syncCard, syncProgress } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import type { SeasonState } from "../../useSeason.ts";
import type { SelfActions } from "../self/ResultHead.tsx";

/**
 * The sync, in the main card or a row; the estimate is on the button, so pressing it is the confirmation. A row
 * (`compact`) says nothing when there is nothing to sync: its season line already does (canvas MeMainFirst).
 */
export function SyncButton({ season, self, compact = false }: { season: SeasonState; self: SelfActions; compact?: boolean }) {
  const { t } = useT();
  if (season.running && season.progress) return <span className="muted" style={{ fontSize: 12 }}>{syncProgress(t, season.progress)}</span>;
  const v = syncCard(t, season.view, self.hosted, self.ownClient);
  if (v.kind === "noClient") return <a href="/settings" style={{ fontSize: 12 }}>{v.link}</a>;
  if (compact && (v.kind === "nothing" || v.kind === "done")) return null;
  if (v.kind === "nothing") return <span className="faint" style={{ fontSize: 12 }}>{t("me.lookupFirst")}</span>;
  if (v.kind === "done") return <span className="faint" style={{ fontSize: 12 }}>{t("me.upToDate")}</span>;
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => void season.start()}>{t("me.syncCost", { start: v.start, pts: fmtPts(season.view!.state.estimate) })}</button>
      {season.error && <span className="tone-bad" style={{ fontSize: 12 }}>{t("self.sync.stopped", { error: season.error })}</span>}
    </>
  );
}
