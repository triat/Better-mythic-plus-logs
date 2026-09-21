import type { AdminUsage, AdminUser } from "../../types.ts";
import { gaugeModel, hourBars, topConsumers } from "../../lib/admin.ts";
import { fmtPts } from "../../lib/format.ts";
import { useT } from "../../locale.tsx";
import { Avatar } from "../Avatar.tsx";

interface Props { usage: AdminUsage | null; users: AdminUser[] }

const hh = (ms: number): string => String(new Date(ms).getHours()).padStart(2, "0");

/** Shared WCL budget this hour, who spent it, and the last 24 hourly totals (canvas "Budget" card). */
export function Gauge({ usage, users }: Props) {
  const { t } = useT();
  const g = gaugeModel(t, usage);
  const consumers = topConsumers(t, usage, users);
  const bars = hourBars(usage);
  const peak = bars.reduce<typeof bars[number] | null>((best, b) => (b.points > 0 && (!best || b.points > best.points) ? b : best), null);
  return (
    <section id="budget" className="card gauge">
      <div>
        <div className="label-caps">{t("admin.gauge.title")}</div>
        <div className="gauge-big">{g.used} <span className="muted">{t("admin.gauge.limit", { limit: g.limit })}</span></div>
        <span className={"gauge-bar " + g.tone} aria-hidden="true"><span style={{ width: `${g.pct}%` }} /></span>
        <div className="muted" style={{ fontSize: 12 }}>{g.sub}</div>
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 6 }}>{t("admin.gauge.top")}</div>
        {consumers.length === 0 && <div className="faint" style={{ fontSize: 13 }}>{t("admin.gauge.noPoints")}</div>}
        {consumers.map((c) => (
          <div key={c.userId} className="consumer">
            <Avatar src={c.avatarUrl} initials={c.initials} size={24} />
            <span className="consumer-name">{c.name}{c.isAdmin && <span className="chip chip-admin" style={{ marginLeft: 4 }}>{t("admin.gauge.adminChip")}</span>}</span>
            <span className={"gauge-bar " + c.tone} aria-hidden="true"><span style={{ width: `${c.pct}%` }} /></span>
            <span className="mono">{c.text}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 6 }}>{t("admin.gauge.last24")}</div>
        <div className="hours">
          {bars.map((b) => (
            <span key={b.hourStart} title={t("admin.gauge.barTitle", { hour: hh(b.hourStart), pts: fmtPts(b.points) })} style={{ height: `${b.pct}%` }} className={b.current ? "current" : ""} />
          ))}
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
          {peak ? t("admin.gauge.peak", { pts: fmtPts(peak.points), hour: hh(peak.hourStart) }) : t("admin.gauge.noPoints24")}
        </div>
      </div>
    </section>
  );
}
