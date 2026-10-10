import { syncCard, syncProgress } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import type { SeasonState } from "../../useSeason.ts";
import type { SelfActions } from "./ResultHead.tsx";

/** Canvas SelfDetails "SYNC": the estimate before spending, the progress, the no-client guide. */
export function SyncCard({ season, self }: { season: SeasonState; self: SelfActions }) {
  const { t } = useT();
  if (season.running && season.progress) {
    const p = season.progress;
    return (
      <section className="card sync-card">
        <span className="section-title">{t("self.sync.running")}</span>
        <span className="bar2 progress"><span style={{ width: `${p.total > 0 ? Math.round((p.done / p.total) * 100) : 0}%` }} /></span>
        <span className="muted" style={{ fontSize: 12 }}>{syncProgress(t, p)}</span>
        <div><button type="button" className="btn btn-sm" onClick={season.stop}>{t("self.sync.cancel")}</button></div>
      </section>
    );
  }
  const v = syncCard(t, season.view, self.hosted, self.ownClient);
  return (
    <section className="card sync-card">
      <span className="section-title">{t("self.sync.title")}</span>
      {v.kind === "noClient" && (
        <>
          <span className="pillar-text">{v.text}</span>
          <a href="/settings" style={{ fontSize: 13 }}>{v.link}</a>
          <span className="faint" style={{ fontSize: 12 }}>{v.without}</span>
        </>
      )}
      {v.kind === "nothing" && <span className="pillar-text">{v.text}</span>}
      {v.kind === "done" && (
        <>
          <span className="pillar-text">{v.text}</span>
          {v.failed && <span className="faint" style={{ fontSize: 12 }}>{v.failed}</span>}
        </>
      )}
      {v.kind === "ready" && (
        <>
          <span className="pillar-text">{v.found}</span>
          <span className="muted" style={{ fontSize: 12 }}>{v.cost}</span>
          <div className="section-row">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void season.start()}>{v.start}</button>
            <button type="button" className="btn btn-sm" onClick={season.closeSync}>{t("self.sync.cancel")}</button>
          </div>
        </>
      )}
      {season.error && <span className="tone-bad" style={{ fontSize: 12 }}>{t("self.sync.stopped", { error: season.error })}</span>}
    </section>
  );
}
