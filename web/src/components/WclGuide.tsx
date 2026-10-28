import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api.ts";
import { analyticsEvent } from "../analytics.ts";
import type { QuotaInfo } from "../api.ts";
import type { OwnClientView } from "../types.ts";
import { WCL_CLIENTS_URL, wclGuideView } from "../lib/wclGuide.ts";
import { useT } from "../locale.tsx";
import { Around } from "./Around.tsx";

interface Props {
  quota: QuotaInfo;
  /** The client the server stored and verified: App adopts it, closes the sheet and runs the refused lookup again. */
  onSaved: (client: OwnClientView) => void;
  onError: (message: string) => void;
}

/** The guided own-client sheet, shown where a lookup was refused for the member's quota (canvas "bmpl · Clé WCL
 * guidée", variant A): open WCL's API clients page, fill its form with the values to copy, paste the id and secret. */
export function WclGuide({ quota, onSaved, onError }: Props) {
  const { t } = useT();
  const m = wclGuideView(t, quota, location.origin);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => setCopied(key), () => {});
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !clientId.trim() || !clientSecret) return;
    setBusy(true);
    const r = await api.account.saveWclClient(clientId.trim(), clientSecret);
    setBusy(false);
    if (!r.ok) { onError(r.error); return; } // fields kept for a retry
    analyticsEvent("wcl_client_set");
    onSaved(r.client);
  };

  return (
    <section className="card wcl-guide" aria-label={t("wclGuide.label")}>
      <div className="wcl-guide-head">
        <span className="wcl-guide-title">{m.title}</span>
        <span className="text-soft">{m.pitch}</span>
      </div>
      <ol className="wcl-guide-steps">
        <li>
          <span className="wcl-guide-num" aria-hidden="true">1</span>
          <div className="wcl-guide-body">
            <span><Around message={t("wclGuide.step1")} params={{ create: <b>Create Client</b> }} /></span>
            <a className="btn wcl-guide-open" href={WCL_CLIENTS_URL} target="_blank" rel="noopener noreferrer">{t("wclGuide.open")}</a>
          </div>
        </li>
        <li>
          <span className="wcl-guide-num" aria-hidden="true">2</span>
          <div className="wcl-guide-body">
            <span><Around message={t("wclGuide.step2")} params={{ public: <b>Public Client</b> }} /></span>
            <div className="wcl-guide-values">
              {m.values.map((v) => (
                <div key={v.key} className="wcl-guide-value">
                  <span className="muted">{v.label}</span>
                  <span className="mono wcl-guide-chip">{v.value}</span>
                  <button type="button" className="btn btn-sm" onClick={() => copy(v.key, v.value)}>
                    {copied === v.key ? t("wclGuide.copied") : t("wclGuide.copy")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </li>
        <li>
          <span className="wcl-guide-num" aria-hidden="true">3</span>
          <form className="wcl-guide-body wcl-guide-form" onSubmit={(e) => void save(e)}>
            <span><Around message={t("wclGuide.step3")} params={{ id: <b>Client ID</b>, secret: <b>Client Secret</b> }} /></span>
            <div className="wcl-guide-fields">
              <label>
                <span>{t("account.client.clientId")}</span>
                <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
              </label>
              <label>
                <span>{t("account.client.clientSecret")}</span>
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" />
              </label>
            </div>
            <div className="wcl-guide-submit">
              <button type="submit" className="btn btn-primary" disabled={busy || !clientId.trim() || !clientSecret}>
                {busy ? t("wclGuide.saving") : t("wclGuide.save")}
              </button>
              <span className="faint">{t("wclGuide.secretNote")}</span>
            </div>
          </form>
        </li>
      </ol>
      <span className="faint wcl-guide-wait">{m.wait}</span>
    </section>
  );
}
