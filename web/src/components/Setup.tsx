import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api.ts";
import { useT } from "../locale.tsx";
import { Around } from "./Around.tsx";

interface Props { envPath: string; hasCredentials: boolean; onDone: () => void }

export function Setup({ envPath, hasCredentials, onDone }: Props) {
  const { t } = useT();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; error: string } | { kind: "saved" }>({ kind: "idle" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ kind: "saving" });
    const r = await api.setup(clientId.trim(), clientSecret.trim());
    if (!r.ok) { setState({ kind: "error", error: r.error }); return; }
    setState({ kind: "saved" });
    setTimeout(onDone, 400);
  };
  return (
    <main className="setup">
      <h1>{t("setup.title")}</h1>
      {hasCredentials && <p><a href="/">{t("setup.back")}</a></p>}
      <p className="muted">
        <Around message={t("setup.intro")} params={{ path: <code className="mono">{envPath}</code> }} />
      </p>
      {hasCredentials && <p className="tone-warn">{t("setup.replace")}</p>}
      <div className="card">
        <ol>
          <li><Around message={t("setup.step1")} params={{ site: <a href="https://www.warcraftlogs.com/" target="_blank" rel="noopener">warcraftlogs.com</a> }} /></li>
          <li>
            <Around
              message={t("setup.step2")}
              params={{
                clients: <a href="https://www.warcraftlogs.com/api/clients/" target="_blank" rel="noopener">Clients</a>,
                createClient: <strong>Create Client</strong>,
              }}
            />
          </li>
          <li>
            <Around
              message={t("setup.step3")}
              params={{ url: <code className="mono">http://localhost</code>, publicClient: <em>Public Client</em> }}
            />
          </li>
          <li>
            <Around
              message={t("setup.step4")}
              params={{ clientId: <strong>{t("setup.clientId")}</strong>, clientSecret: <strong>{t("setup.clientSecret")}</strong> }}
            />
          </li>
        </ol>
        <form onSubmit={submit} className="setup-form">
          <label>{t("setup.clientId")}<input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required /></label>
          <label>{t("setup.clientSecret")}<input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" required /></label>
          <button className="btn btn-primary" disabled={state.kind === "saving"}>{t("setup.save")}</button>
        </form>
        {state.kind === "saving" && <p className="muted">{t("setup.saving")}</p>}
        {state.kind === "saved" && <p className="tone-good">{t("setup.saved")}</p>}
        {state.kind === "error" && <p className="err">✗ {state.error}</p>}
      </div>
    </main>
  );
}
