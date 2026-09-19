import type { AdminUsage, AdminUser } from "../../types.ts";
import { gaugeModel, hourBars, topConsumers } from "../../lib/admin.ts";
import { fmtPts } from "../../lib/format.ts";
import { Avatar } from "../Avatar.tsx";

interface Props { usage: AdminUsage | null; users: AdminUser[] }

const hh = (ms: number): string => String(new Date(ms).getHours()).padStart(2, "0");

/** Shared WCL budget this hour, who spent it, and the last 24 hourly totals (canvas "Budget" card). */
export function Gauge({ usage, users }: Props) {
  const g = gaugeModel(usage);
  const consumers = topConsumers(usage, users);
  const bars = hourBars(usage);
  const peak = bars.reduce<typeof bars[number] | null>((best, b) => (b.points > 0 && (!best || b.points > best.points) ? b : best), null);
  return (
    <section id="budget" className="card gauge">
      <div>
        <div className="label-caps">Shared WCL budget · this hour</div>
        <div className="gauge-big">{g.used} <span className="muted">/ {g.limit} pts</span></div>
        <span className={"gauge-bar " + g.tone} aria-hidden="true"><span style={{ width: `${g.pct}%` }} /></span>
        <div className="muted" style={{ fontSize: 12 }}>{g.sub}</div>
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 6 }}>Top consumers · this hour</div>
        {consumers.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No points spent this hour.</div>}
        {consumers.map((c) => (
          <div key={c.userId} className="consumer">
            <Avatar src={c.avatarUrl} initials={c.initials} size={24} />
            <span className="consumer-name">{c.name}{c.isAdmin && <span className="chip chip-admin" style={{ marginLeft: 4 }}>admin</span>}</span>
            <span className={"gauge-bar " + c.tone} aria-hidden="true"><span style={{ width: `${c.pct}%` }} /></span>
            <span className="mono">{c.text}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 6 }}>Last 24 h · pts per hour</div>
        <div className="hours">
          {bars.map((b) => (
            <span key={b.hourStart} title={`${hh(b.hourStart)}:00 · ${fmtPts(b.points)} pts`} style={{ height: `${b.pct}%` }} className={b.current ? "current" : ""} />
          ))}
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
          {peak ? `peak ${fmtPts(peak.points)} pts at ${hh(peak.hourStart)}:00` : "no points spent in the last 24 h"}
        </div>
      </div>
    </section>
  );
}
