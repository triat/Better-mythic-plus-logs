import { Fragment } from "react";
import type { AdminInstance, AdminUsage } from "../../types.ts";
import { fmtShortAge, instanceModel } from "../../lib/admin.ts";
import { fmtPts } from "../../lib/format.ts";

interface Props { instance: AdminInstance | null; usage: AdminUsage | null }

/** Version, uptime, database, backup, WCL client, and the effective environment with secrets masked (canvas "Instance"). */
export function Instance({ instance, usage }: Props) {
  const m = instance ? instanceModel(instance) : null;
  const wcl = usage?.instance ? `rateLimitData ${fmtShortAge(usage.instance.observedAt)} · ${fmtPts(usage.instance.limitPerHour)} pts/h` : "no WCL call observed yet";
  return (
    <section id="instance" className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Instance</div>
        {!m && <div className="muted">loading…</div>}
        {m && (
          <div className="kv">
            <span className="kv-key">version</span><span className="mono">{m.version}</span>
            <span className="kv-key">uptime</span><span>{m.uptime}</span>
            <span className="kv-key">database</span><span className="mono" title={m.dbPath}>{m.db}</span>
            <span className="kv-key">last backup</span><span>{m.backup} <span className="faint">· last-backup next to .env</span></span>
            <span className="kv-key">WCL client</span><span>{wcl}</span>
          </div>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Effective environment <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>secrets masked</span></div>
        {!m && <div className="muted">loading…</div>}
        {m && (
          <div className="kv mono" style={{ fontSize: 12 }}>
            {m.env.map((row) => (
              <Fragment key={row.key}>
                <span className="kv-key">{row.key}</span><span className={row.secret ? "faint" : ""}>{row.value}</span>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
