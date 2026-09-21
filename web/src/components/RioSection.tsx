import { useState } from "react";
import type { LookupPayload } from "../types.ts";
import { fmtAge, fmtDuration, rioHref } from "../lib/format.ts";
import { useT } from "../locale.tsx";

export function RioSection({ payload }: { payload: LookupPayload }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const rio = payload.rio;
  if (!rio) return <section className="card muted">{t("rio.error", { text: payload.rioError ?? t("rio.noData") })}</section>;
  const profile = rioHref(rio.profileUrl);
  const recent = rio.recentRuns.slice(0, 10);
  const last = rio.derived.lastRunAt;
  const current = rio.seasons[0];
  return (
    <section className="card section">
      <div className="section-head">
        <button type="button" className="section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={"chev" + (open ? " open" : "")}>›</span>
          <span className="section-title">{t("rio.title")}</span>
          <span className="muted">
            {t("rio.summary", { total: rio.derived.recentTotal, timed: rio.derived.recentTimed })}
            {last ? t("rio.last", { age: fmtAge(t, last) }) : ""}
            {current && current.all > 0 ? t("rio.score", { score: current.all.toFixed(0) }) : ""}
          </span>
        </button>
        <div className="grow" />
        {profile ? <a href={profile} target="_blank" rel="noopener" style={{ fontSize: 12 }}>{t("rio.profile")} ↗</a> : <span className="faint">{t("rio.profile")}</span>}
      </div>
      {open && (
        <div className="runs">
          {recent.length === 0 && <div className="faint">{t("rio.none")}</div>}
          {recent.map((r) => {
            const href = rioHref(r.url);
            return (
              <div key={r.url + r.completedAt} className="run run-rio inset">
                <span className="mono level">+{r.level}</span>
                <span>{r.dungeon}</span>
                <span className={r.chests > 0 ? "tone-good" : "tone-bad"}>{r.chests > 0 ? t("rio.timed", { chests: r.chests }) : t("rio.depleted")}</span>
                <span className="muted mono">{fmtDuration(r.clearMs)} / {fmtDuration(r.parMs)}</span>
                <span className="muted">{fmtAge(t, r.completedAt)}</span>
                {href ? <a href={href} target="_blank" rel="noopener" title={t("rio.open")}>↗</a> : <span />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
