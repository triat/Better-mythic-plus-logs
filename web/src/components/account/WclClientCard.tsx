import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../api.ts";
import type { OwnClientView } from "../../types.ts";
import { clientCard } from "../../lib/account.ts";

interface Props {
  enabled: boolean;
  client: OwnClientView | null;
  limitPerUser: number | null;
  onChange: (client: OwnClientView | null) => void;
  onError: (message: string) => void;
}

const CLIENTS_URL = "https://www.warcraftlogs.com/api/clients";

/** "Your Warcraft Logs client": none (id/secret form), set (Verify again / Replace / Remove), disabled. Canvas "Phase2SettingsA" + "Phase2Details". */
export function WclClientCard({ enabled, client, limitPerUser, onChange, onError }: Props) {
  const m = clientCard(enabled, client, limitPerUser);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const showForm = m.showForm || (m.state === "set" && replacing);
  // The typed secret lives in state only while the form is open: leaving it (Cancel, Remove) clears both fields.
  const clearForm = () => { setClientId(""); setClientSecret(""); setReplacing(false); };
  // The verified line reads "Verified 2 h ago" in soft, the id and counter in faint (canvas): split at the first separator.
  const sep = m.status.indexOf(" · ");
  const [head, tail] = m.state === "set" && sep > 0 ? [m.status.slice(0, sep), m.status.slice(sep)] : [m.status, ""];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !clientId.trim() || !clientSecret) return;
    setBusy(true);
    const r = await api.account.saveWclClient(clientId.trim(), clientSecret);
    setBusy(false);
    if (!r.ok) { onError(r.error); return; } // fields kept for a retry
    clearForm();
    onChange(r.client);
  };
  const verify = async () => {
    setBusy(true);
    const r = await api.account.verifyWclClient();
    setBusy(false);
    if (!r.ok) { onError(r.error); return; }
    onChange(r.client);
  };
  const remove = async () => {
    setBusy(true);
    const r = await api.account.removeWclClient();
    setBusy(false);
    setConfirmRemove(false);
    if (!r.ok) { onError(r.error); return; }
    clearForm();
    onChange(null);
  };

  return (
    <section className="card settings-card">
      <div className="settings-head">
        <span className="section-title">Your Warcraft Logs client</span>
        <span style={{ flex: 1 }} />
        <span className={"dot " + m.dot} />
        <span className={m.state === "set" ? "" : "muted"}>{head}{tail && <span className="faint">{tail}</span>}</span>
      </div>
      {m.state === "set" && !showForm && (
        <div className="settings-actions">
          {confirmRemove ? (
            <span className="inset confirm">
              <span>Remove your client? Your lookups go back to the shared budget.</span>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>Remove</button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
            </span>
          ) : (
            <>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void verify()}>Verify again</button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setReplacing(true)}>Replace</button>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
              <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>No shared quota.</span>
            </>
          )}
        </div>
      )}
      {showForm && (
        <form onSubmit={(e) => void save(e)}>
          <div className="settings-grid">
            <label className="field">
              <span className="lab">Client id</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="from warcraftlogs.com/api/clients" autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span className="lab">Client secret</span>
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••••••••••••••••••" autoComplete="off" />
            </label>
            <span className="settings-submit">
              <button type="submit" className="btn btn-primary" disabled={busy || !clientId.trim() || !clientSecret}>Save and verify</button>
              {replacing && <button type="button" className="btn" disabled={busy} onClick={clearForm}>Cancel</button>}
            </span>
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Create a client at <a href={CLIENTS_URL} target="_blank" rel="noreferrer">warcraftlogs.com/api/clients</a> (any name, no redirect URL).
            The secret is stored encrypted and never shown again; saving sends one PING to check it.
          </div>
        </form>
      )}
    </section>
  );
}
