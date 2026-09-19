import { useState } from "react";
import { api } from "../../api.ts";
import type { MeUser } from "../../api.ts";
import { canDelete, storedDataText } from "../../lib/account.ts";

interface Props { me: MeUser; onDeleted: () => void; onError: (message: string) => void }

/** "Account": who you are, what is stored, the typed-word account deletion. Canvas "Phase2SettingsA" + "Phase2Details" (delete confirmation). */
export function AccountCard({ me, onDeleted, onError }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const cancel = () => { setConfirming(false); setTyped(""); };
  const remove = async () => {
    if (!canDelete(typed) || busy) return;
    setBusy(true);
    const r = await api.account.deleteAccount();
    setBusy(false);
    if (!r.ok) { onError(r.error); return; }
    onDeleted();
  };
  return (
    <section className="card settings-card">
      <div className="settings-head">
        <span className="section-title">Account</span>
        <span className="muted" style={{ fontSize: 12 }}>signed in with Discord as <b>@{me.username}</b> · <span className="mono">{me.discordId}</span></span>
      </div>
      <p className="settings-text">{storedDataText()} <a href="/privacy">Privacy</a>.</p>
      {confirming ? (
        <div className="settings-actions">
          <span className="inset confirm">
            <span>Delete your account? Type <b>delete</b> to confirm.</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} style={{ width: 120, height: 26 }} autoFocus autoComplete="off" spellCheck={false} />
            <button type="button" className="btn btn-sm btn-danger" disabled={busy || !canDelete(typed)} onClick={() => void remove()}>Delete</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
          </span>
        </div>
      ) : (
        <div className="settings-actions">
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirming(true)}>Delete my account</button>
          <span className="faint" style={{ fontSize: 12 }}>Removes everything above and signs you out. Approved corrections you contributed stay in the shared table, without your name.</span>
        </div>
      )}
    </section>
  );
}
