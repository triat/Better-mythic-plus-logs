import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminInvite, AdminUser } from "../../types.ts";
import { inviteRow } from "../../lib/admin.ts";

interface Props {
  invites: AdminInvite[];
  users: AdminUser[];
  onAdd: (discordId: string, note: string | null) => Promise<void>;
  onRemove: (discordId: string) => Promise<void>;
}

const ID_RE = /^\d{17,20}$/;

/** `inviteRow` says "admin #N"; the admin's display name is known here (the users list). */
const withAdminName = (added: string, users: AdminUser[]): string =>
  added.replace(/admin #(\d+)/, (_, n: string) => {
    const u = users.find((x) => x.id === Number(n));
    return u?.globalName ?? u?.username ?? `admin #${n}`;
  });

/** Who may sign in: add a Discord id with a note, remove one (inline confirmation; canvas "Invites"). */
export function Invites({ invites, users, onAdd, onRemove }: Props) {
  const [id, setId] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = ID_RE.test(id);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    await onAdd(id, note.trim() || null);
    setBusy(false);
    setId("");
    setNote("");
  };
  const remove = async (discordId: string) => {
    setBusy(true);
    await onRemove(discordId);
    setBusy(false);
    setConfirm(null);
  };
  return (
    <section id="invites" className="card admin-section">
      <div className="admin-section-head">
        <span style={{ fontWeight: 600 }}>Invites</span>
        <span className="muted">{invites.length} · a Discord id may sign in once it is listed here (admins from the env are implicit)</span>
      </div>
      <form className="admin-form" onSubmit={(e) => void submit(e)}>
        <input className="mono" placeholder="Discord id (17–20 digits)" value={id} maxLength={20} onChange={(e) => setId(e.target.value.trim())} autoComplete="off" spellCheck={false} />
        <input placeholder="Note (guild mate, alt of…)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>Invite</button>
        <span className="faint" style={{ fontSize: 12 }}>Developer Mode → Copy User ID</span>
      </form>
      <div className="admin-row admin-row-head admin-row-invite label-caps">
        <span>discord id</span><span>note</span><span>added</span><span>status</span><span />
      </div>
      {invites.map((i) => {
        const r = inviteRow(i);
        const asking = confirm === r.discordId;
        return (
          <div key={r.discordId} className="inset admin-row admin-row-invite">
            <span className="mono">{r.discordId}</span>
            {asking ? (
              <span className="inset confirm" style={{ gridColumn: "2 / -1" }}>
                <span>Remove the invite for <b>{r.discordId}</b>? {r.signedIn ? "They are signed out and cannot sign in again." : "They will not be able to sign in."}</span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove(r.discordId)}>Remove</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            ) : (
              <>
                <span className={r.note === "—" ? "faint" : "muted"} title={r.note}>{r.note}</span>
                <span className="muted">{withAdminName(r.added, users)}</span>
                <span><span className={"chip" + (r.signedIn ? " chip-ok" : "")}>{r.status}</span></span>
                <span><button type="button" className="btn btn-sm" onClick={() => setConfirm(r.discordId)}>Remove</button></span>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
