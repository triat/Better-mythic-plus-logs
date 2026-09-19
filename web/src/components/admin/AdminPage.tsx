import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { MeUser } from "../../api.ts";
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser, AuditKind } from "../../types.ts";
import { Toast } from "../Toast.tsx";
import { Audit } from "./Audit.tsx";
import { Gauge } from "./Gauge.tsx";
import { Instance } from "./Instance.tsx";
import { Invites } from "./Invites.tsx";
import { Queue } from "./Queue.tsx";
import { Users } from "./Users.tsx";

export interface AdminData { usage: AdminUsage | null; users: AdminUser[]; invites: AdminInvite[]; pending: AdminProposal[]; decided: AdminProposal[]; instance: AdminInstance | null; errors24h: number }
const EMPTY: AdminData = { usage: null, users: [], invites: [], pending: [], decided: [], instance: null, errors24h: 0 };

/** Layout B of the canvas: every section stacked, anchor sub-nav. All data is 0 WCL pts (SQLite + the meter's last snapshot). */
export function AdminPage({ me }: { me: MeUser }) {
  const [data, setData] = useState<AdminData>(EMPTY);
  const [toast, setToast] = useState<string | null>(null);
  const [auditKind, setAuditKind] = useState<AuditKind | "all">("all");
  const closeToast = useCallback(() => setToast(null), []);
  const reload = useCallback(async () => {
    const [usage, users, invites, pending, approved, rejected, instance, audit] = await Promise.all([
      api.admin.usage(), api.admin.users(), api.admin.invites(), api.admin.proposals("pending"), api.admin.proposals("approved"), api.admin.proposals("rejected"), api.admin.instance(),
      api.admin.audit({ kind: "error", limit: 1 }),
    ]);
    const firstError = [usage, users, invites, pending, approved, rejected, instance, audit].find((r) => !r.ok);
    if (firstError && !firstError.ok) setToast(firstError.error);
    const decided = [...(approved.ok ? approved.proposals : []), ...(rejected.ok ? rejected.proposals : [])]
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).slice(0, 50);
    setData({
      usage: usage.ok ? usage : null, users: users.ok ? users.users : [], invites: invites.ok ? invites.invites : [],
      pending: pending.ok ? pending.proposals : [], decided, instance: instance.ok ? instance : null, errors24h: audit.ok ? audit.errors24h : 0,
    });
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  /** Runs an admin action, shows its error, reloads everything (the sections are small; one round trip keeps them consistent). */
  const act = useCallback(async (r: Promise<{ ok: boolean; error?: string }>) => {
    const res = await r;
    if (!res.ok) setToast(res.error ?? "Request failed");
    await reload();
  }, [reload]);
  return (
    <>
      <div className="admin-title">
        <a href="/" className="muted" style={{ fontSize: 13 }}>← back to lookups</a>
        <h1>Admin</h1>
        <span className="muted" style={{ fontSize: 12 }}>invites, users, proposals, budget, instance</span>
      </div>
      <nav className="admin-nav">
        <a href="#budget">Budget</a>
        <a href="#proposals">Proposals{data.pending.length > 0 && <span className="chip chip-warn" style={{ marginLeft: 4 }}>{data.pending.length}</span>}</a>
        <a href="#users">Users</a>
        <a href="#invites">Invites</a>
        <a href="#instance">Instance</a>
        <a href="#audit" onClick={() => { if (data.errors24h > 0) setAuditKind("error"); }}>
          Audit{data.errors24h > 0 && <span className="chip" style={{ marginLeft: 4, color: "var(--red)" }}>{data.errors24h} errors</span>}
        </a>
      </nav>
      <main className="content content-home">
        <Gauge usage={data.usage} users={data.users} />
        <Queue pending={data.pending} decided={data.decided} onDecide={(id, d, note) => act(api.admin.decide(id, d, note))} />
        <Users
          users={data.users} selfId={me.id} limitPerUser={data.usage?.limitPerUser ?? 300}
          onRole={(id, role) => act(api.admin.setRole(id, role))} onRevoke={(id) => act(api.admin.revokeSessions(id))}
          onBan={(id) => act(api.admin.ban(id))} onUnban={(id) => act(api.admin.unban(id))}
        />
        <Invites invites={data.invites} users={data.users} onAdd={(id, note) => act(api.admin.addInvite(id, note))} onRemove={(id) => act(api.admin.removeInvite(id))} />
        <Instance instance={data.instance} usage={data.usage} />
        <Audit kind={auditKind} onKind={setAuditKind} />
      </main>
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
