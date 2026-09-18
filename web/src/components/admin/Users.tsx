import { useState } from "react";
import type { AdminUser } from "../../types.ts";
import { userRow } from "../../lib/admin.ts";
import { Avatar } from "../Avatar.tsx";

interface Props {
  users: AdminUser[];
  selfId: number;
  limitPerUser: number;
  onRole: (id: number, role: "member" | "admin") => Promise<void>;
  onRevoke: (id: number) => Promise<void>;
}
type Confirm = { id: number; kind: "role" | "revoke" } | null;

/** Everyone who signed in at least once: role toggle and session revocation, each confirmed inline (canvas "Users"). */
export function Users({ users, selfId, limitPerUser, onRole, onRevoke }: Props) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<void>) => {
    setBusy(true);
    await p;
    setBusy(false);
    setConfirm(null);
  };
  return (
    <section id="users" className="card admin-section">
      <div className="admin-section-head">
        <span style={{ fontWeight: 600 }}>Users</span>
        <span className="muted">{users.length} · signed in at least once</span>
      </div>
      <div className="admin-row admin-row-head admin-row-user label-caps">
        <span /><span>name</span><span>role</span><span>last seen</span><span>pts · hour</span><span>pts · 24 h</span><span>discord id</span><span />
      </div>
      {users.map((u) => {
        const r = userRow(u, Date.now(), selfId, limitPerUser);
        const asking = confirm?.id === r.id ? confirm.kind : null;
        return (
          <div key={r.id} className="inset admin-row admin-row-user">
            <Avatar src={r.avatarUrl} initials={r.initials} size={24} />
            <span title={r.handle}>{r.name} <span className="faint">{r.handle}</span></span>
            {asking === "role" && r.toggle && (
              <span className="inset confirm" style={{ gridColumn: "3 / -1" }}>
                <span>
                  {r.toggle === "make admin"
                    ? <>Make <b>{r.name}</b> an admin? They get the Admin page, no quota, and can approve proposals.</>
                    : <>Make <b>{r.name}</b> a member? They lose the Admin page and get the hourly quota.</>}
                </span>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(onRole(r.id, r.toggle === "make admin" ? "admin" : "member"))}>
                  {r.toggle === "make admin" ? "Make admin" : "Make member"}
                </button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            )}
            {asking === "revoke" && (
              <span className="inset confirm" style={{ gridColumn: "3 / -1" }}>
                <span>Revoke <b>{r.name}</b>'s sessions? {r.sessions} session{r.sessions === 1 ? " ends" : "s end"} now.</span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void run(onRevoke(r.id))}>Revoke</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            )}
            {!asking && (
              <>
                <span>
                  <span className={"chip" + (r.role === "admin" ? " chip-admin" : "")}>{r.role}</span>
                  {r.roleNote && <span className="faint" style={{ fontSize: 11, marginLeft: 4 }}>{r.roleNote}</span>}
                  {r.toggle && <button type="button" className="chip" style={{ marginLeft: 4 }} onClick={() => setConfirm({ id: r.id, kind: "role" })}>{r.toggle}</button>}
                </span>
                <span className="muted">{r.lastSeen}</span>
                <span className={"mono " + r.pointsHourTone}>{r.pointsHour}</span>
                <span className="mono">{r.points24h}</span>
                <span className="mono faint">{r.discordId}</span>
                <span>{r.canRevoke && <button type="button" className="btn btn-sm" onClick={() => setConfirm({ id: r.id, kind: "revoke" })}>Revoke sessions</button>}</span>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
