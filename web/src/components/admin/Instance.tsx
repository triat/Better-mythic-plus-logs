import { Fragment } from "react";
import type { AdminInstance, AdminUsage } from "../../types.ts";
import { fmtShortAge, instanceModel } from "../../lib/admin.ts";
import { fmtPts } from "../../lib/format.ts";
import { useT } from "../../locale.tsx";

interface Props { instance: AdminInstance | null; usage: AdminUsage | null }

/** Version, uptime, database, backup, WCL client, and the effective environment with secrets masked (canvas "Instance"). */
export function Instance({ instance, usage }: Props) {
  const { t } = useT();
  const m = instance ? instanceModel(t, instance) : null;
  const wcl = usage?.instance
    ? t("admin.instance.wcl", { age: fmtShortAge(t, usage.instance.observedAt), pts: fmtPts(usage.instance.limitPerHour) })
    : t("admin.instance.noCall");
  return (
    <section id="instance" className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("admin.instance.title")}</div>
        {!m && <div className="muted">{t("common.loading")}</div>}
        {m && (
          <div className="kv">
            <span className="kv-key">{t("admin.instance.version")}</span><span className="mono">{m.version}</span>
            <span className="kv-key">{t("admin.instance.uptime")}</span><span>{m.uptime}</span>
            <span className="kv-key">{t("admin.instance.database")}</span><span className="mono" title={m.dbPath}>{m.db}</span>
            <span className="kv-key">{t("admin.instance.lastBackup")}</span><span>{m.backup} <span className="faint">{t("admin.instance.backupHint")}</span></span>
            <span className="kv-key">{t("admin.instance.wclClient")}</span><span>{wcl}</span>
          </div>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("admin.instance.env")} <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>{t("admin.instance.secretsMasked")}</span></div>
        {!m && <div className="muted">{t("common.loading")}</div>}
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
