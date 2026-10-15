import { Fragment, useState } from "react";
import type { AdminInstance, AdminUsage } from "../../types.ts";
import { grafanaLinks, instanceModel, instanceWcl } from "../../lib/admin.ts";
import { useT } from "../../locale.tsx";

interface Props { instance: AdminInstance | null; usage: AdminUsage | null }

/** One line (version, uptime, database, backup, WCL), the Grafana dashboards, the effective environment folded (canvas "Admin allégée" B). */
export function Instance({ instance, usage }: Props) {
  const { t } = useT();
  const [envOpen, setEnvOpen] = useState(false);
  const m = instance ? instanceModel(t, instance) : null;
  const wcl = instanceWcl(t, usage);
  return (
    <section id="instance" className="card admin-instance">
      <div className="admin-instance-line">
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t("admin.instance.title")}</span>
        {!m && <span className="muted">{t("common.loading")}</span>}
        {m && (
          <>
            <span><span className="muted">{t("admin.instance.version")}</span><span className="mono">{m.version}</span></span>
            <span><span className="muted">{t("admin.instance.uptime")}</span>{m.uptime}</span>
            <span title={m.dbPath}><span className="muted">{t("admin.instance.database")}</span><span className="mono">{m.dbSize}</span></span>
            <span title={t("admin.instance.backupHint")}><span className="muted">{t("admin.instance.lastBackup")}</span>{m.backup}</span>
            <span title={wcl.title}><span className="muted">{t("admin.instance.wclClient")}</span>{wcl.text}</span>
            <div className="grow" />
            {instance && grafanaLinks(t, instance.logsUrl).map((l) => (
              <a key={l.key} className="admin-dash" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
            ))}
          </>
        )}
      </div>
      {m && (
        <button type="button" className="admin-env-toggle" aria-expanded={envOpen} aria-controls="instance-env" onClick={() => setEnvOpen((o) => !o)}>
          {envOpen ? "▾" : "▸"} {m.envSummary}
        </button>
      )}
      {m && envOpen && (
        <div id="instance-env" className="kv mono" style={{ fontSize: 12 }}>
          {m.env.map((row) => (
            <Fragment key={row.key}>
              <span className="kv-key">{row.key}</span><span className={row.secret ? "faint" : ""}>{row.value}</span>
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
