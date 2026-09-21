import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../api.ts";
import type { OwnClientView } from "../../types.ts";
import { clientCard } from "../../lib/account.ts";
import { useT } from "../../locale.tsx";
import { Around } from "../Around.tsx";

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
  const { t } = useT();
  const m = clientCard(t, enabled, client, limitPerUser);
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
    <section className="card settings-card" id="wcl-client">
      <div className="settings-head">
        <span className="section-title">{t("account.client.title")}</span>
        <span style={{ flex: 1 }} />
        <span className={"dot " + m.dot} />
        <span className={m.state === "set" ? "" : m.state === "stale" ? "tone-warn" : "muted"}>{head}{tail && <span className="faint">{tail}</span>}</span>
      </div>
      {m.state === "set" && !showForm && (
        <div className="settings-actions">
          {confirmRemove ? (
            <span className="inset confirm">
              <span>{t("account.client.removeConfirm")}</span>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>{t("account.client.remove")}</button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirmRemove(false)}>{t("common.cancel")}</button>
            </span>
          ) : (
            <>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void verify()}>{t("account.client.verify")}</button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setReplacing(true)}>{t("account.client.replace")}</button>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>{t("account.client.remove")}</button>
              <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>{t("account.client.noQuota")}</span>
            </>
          )}
        </div>
      )}
      {showForm && (
        <form onSubmit={(e) => void save(e)}>
          <div className="settings-grid">
            <label className="field">
              <span className="lab">{t("account.client.clientId")}</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={t("account.client.idPlaceholder")} autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span className="lab">{t("account.client.clientSecret")}</span>
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••••••••••••••••••" autoComplete="off" />
            </label>
            <span className="settings-submit">
              <button type="submit" className="btn btn-primary" disabled={busy || !clientId.trim() || !clientSecret}>{t("account.client.save")}</button>
              {replacing && <button type="button" className="btn" disabled={busy} onClick={clearForm}>{t("common.cancel")}</button>}
            </span>
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            <Around
              message={t("account.client.hint")}
              params={{
                site: <a href={CLIENTS_URL} target="_blank" rel="noreferrer">warcraftlogs.com/api/clients</a>,
                guide: <a href="/help#wcl-client">{t("account.client.guideLink")}</a>,
              }}
            />
          </div>
        </form>
      )}
    </section>
  );
}
