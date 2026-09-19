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
  onBan: (id: number) => Promise<void>;
  onUnban: (id: number) => Promise<void>;
}
type Confirm = { id: number; kind: "role" | "revoke" | "ban" } | null;

/** Everyone who signed in at least once: role toggle, session revocation and ban (each confirmed inline), unban (canvas "Users", "Phase2Details" for ban). */
export function Users({ users, selfId, limitPerUser, onRole, onRevoke, onBan, onUnban }: Props) {
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
          <div key={r.id} className={"inset admin-row admin-row-user" + (r.banned ? " row-banned" : "")}>
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
            {asking === "ban" && (
              <span className="inset confirm" style={{ gridColumn: "3 / -1" }}>
                <span>Ban <b>{r.name}</b>? Their sessions end now, they cannot sign in again (open signup or invite), their data stays until they delete it or you do.</span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void run(onBan(r.id))}>Ban</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            )}
            {!asking && (
              <>
                <span>
                  {r.banned
                    ? <span className="chip" style={{ color: "var(--red)", borderColor: "var(--red-border)" }}>banned</span>
                    : <>
                        <span className={"chip" + (r.role === "admin" ? " chip-admin" : "")}>{r.role}</span>
                        {r.roleNote && <span className="faint" style={{ fontSize: 11, marginLeft: 4 }}>{r.roleNote}</span>}
                        {r.toggle && <button type="button" className="chip" style={{ marginLeft: 4 }} onClick={() => setConfirm({ id: r.id, kind: "role" })}>{r.toggle}</button>}
                      </>}
                </span>
                <span className="muted">{r.lastSeen}</span>
                <span className={"mono " + (u.ownClient ? "faint" : r.pointsHourTone)}>{r.pointsCell}</span>
                <span className="mono">{r.points24h}</span>
                <span className="mono faint">{r.discordId}</span>
                <span>
                  {r.canRevoke && <button type="button" className="btn btn-sm" onClick={() => setConfirm({ id: r.id, kind: "revoke" })}>Revoke sessions</button>}
                  {r.ban === "ban" && <button type="button" className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => setConfirm({ id: r.id, kind: "ban" })}>Ban</button>}
                  {r.ban === "unban" && <button type="button" className="btn btn-sm" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void run(onUnban(r.id))}>Unban</button>}
                </span>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
