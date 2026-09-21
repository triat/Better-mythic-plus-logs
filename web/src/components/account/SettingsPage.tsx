import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { MeUser, QuotaInfo } from "../../api.ts";
import type { StatusInfo } from "../../lib/hostedMode.ts";
import type { OwnClientView } from "../../types.ts";
import { useT } from "../../locale.tsx";
import { Toast } from "../Toast.tsx";
import { AccountCard } from "./AccountCard.tsx";
import { WclClientCard } from "./WclClientCard.tsx";

interface Props {
  me: MeUser;
  status: StatusInfo;
  quota: QuotaInfo | null;
  ownClient: OwnClientView | null;
  onOwnClientChange: (client: OwnClientView | null) => void;
  onDeleted: () => void;
}

/** /settings, layout A of the canvas ("Phase2SettingsA"): the title row, then the WCL client card and the Account card. 0 WCL pts except "Save and verify" / "Verify again" (one PING on the member's own client). */
export function SettingsPage({ me, status, quota, ownClient, onOwnClientChange, onDeleted }: Props) {
  const { t } = useT();
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  // The counter in the card is the client's last rateLimitData: re-read it on arrival so it matches the header (SQLite + memory, 0 pts).
  useEffect(() => {
    if (!status.wclClients) return;
    let alive = true;
    api.account.wclClient().then((r) => { if (alive && r.ok) onOwnClientChange(r.client); });
    return () => { alive = false; };
    // once on mount
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="admin-title">
        <a href="/" className="muted" style={{ fontSize: 13 }}>{t("common.backToLookups")}</a>
        <h1>{t("account.title")}</h1>
        <span className="muted" style={{ fontSize: 12 }}>{t("account.sub")}</span>
      </div>
      <main className="content content-home">
        <WclClientCard enabled={status.wclClients} client={ownClient} limitPerUser={quota?.limit ?? null} onChange={onOwnClientChange} onError={setToast} />
        <AccountCard me={me} onDeleted={onDeleted} onError={setToast} />
      </main>
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
