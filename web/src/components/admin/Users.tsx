import { useState } from "react";
import type { AdminUser } from "../../types.ts";
import { userRow } from "../../lib/admin.ts";
import { useT } from "../../locale.tsx";
import { Around } from "../Around.tsx";
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
  const { t } = useT();
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
        <span style={{ fontWeight: 600 }}>{t("admin.users.title")}</span>
        <span className="muted">{t("admin.users.sub", { n: users.length })}</span>
      </div>
      <div className="admin-row admin-row-head admin-row-user label-caps">
        <span /><span>{t("admin.users.head.name")}</span><span>{t("admin.users.head.role")}</span><span>{t("admin.users.head.lastSeen")}</span>
        <span>{t("admin.users.head.ptsHour")}</span><span>{t("admin.users.head.pts24h")}</span><span>{t("admin.users.head.discordId")}</span><span />
      </div>
      {users.map((u) => {
        const r = userRow(t, u, Date.now(), selfId, limitPerUser);
        const name = <b>{r.name}</b>;
        const asking = confirm?.id === r.id ? confirm.kind : null;
        return (
          <div key={r.id} className={"inset admin-row admin-row-user" + (r.banned ? " row-banned" : "")}>
            <Avatar src={r.avatarUrl} initials={r.initials} size={24} />
            <span title={r.handle}>{r.name} <span className="faint">{r.handle}</span></span>
            {asking === "role" && r.toggle && (
              <span className="inset confirm" style={{ gridColumn: "3 / -1" }}>
                <span>
                  <Around message={t(r.toggle === "make admin" ? "admin.users.makeAdminConfirm" : "admin.users.makeMemberConfirm")} params={{ name }} />
                </span>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(onRole(r.id, r.toggle === "make admin" ? "admin" : "member"))}>
                  {t(r.toggle === "make admin" ? "admin.users.makeAdminBtn" : "admin.users.makeMemberBtn")}
                </button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
              </span>
            )}
            {asking === "revoke" && (
              <span className="inset confirm" style={{ gridColumn: "3 / -1" }}>
                <span><Around message={t("admin.users.revokeConfirm", { count: r.sessions })} params={{ name }} /></span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void run(onRevoke(r.id))}>{t("admin.users.revoke")}</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
              </span>
            )}
            {asking === "ban" && (
              <span className="inset confirm" style={{ gridColumn: "3 / -1" }}>
                <span><Around message={t("admin.users.banConfirm")} params={{ name }} /></span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void run(onBan(r.id))}>{t("admin.users.ban")}</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
              </span>
            )}
            {!asking && (
              <>
                <span>
                  {r.banned
                    ? <span className="chip" style={{ color: "var(--red)", borderColor: "var(--red-border)" }}>{t("admin.users.banned")}</span>
                    : <>
                        <span className={"chip" + (r.role === "admin" ? " chip-admin" : "")}>{t(r.role === "admin" ? "admin.users.role.admin" : "admin.users.role.member")}</span>
                        {r.roleNote && <span className="faint" style={{ fontSize: 11, marginLeft: 4 }}>{t("admin.users.env")}</span>}
                        {r.toggle && (
                          <button type="button" className="chip" style={{ marginLeft: 4 }} onClick={() => setConfirm({ id: r.id, kind: "role" })}>
                            {t(r.toggle === "make admin" ? "admin.users.makeAdmin" : "admin.users.makeMember")}
                          </button>
                        )}
                      </>}
                </span>
                <span className="muted">{r.lastSeen}</span>
                <span className={"mono " + (u.ownClient ? "faint" : r.pointsHourTone)}>{r.pointsCell}</span>
                <span className="mono">{r.points24h}</span>
                <span className="mono faint">{r.discordId}</span>
                <span>
                  {r.canRevoke && <button type="button" className="btn btn-sm" onClick={() => setConfirm({ id: r.id, kind: "revoke" })}>{t("admin.users.revokeSessions")}</button>}
                  {r.ban === "ban" && <button type="button" className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => setConfirm({ id: r.id, kind: "ban" })}>{t("admin.users.ban")}</button>}
                  {r.ban === "unban" && <button type="button" className="btn btn-sm" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void run(onUnban(r.id))}>{t("admin.users.unban")}</button>}
                </span>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
