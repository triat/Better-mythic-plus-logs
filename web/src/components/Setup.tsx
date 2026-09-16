import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api.ts";

interface Props { envPath: string; hasCredentials: boolean; onDone: () => void }

export function Setup({ envPath, hasCredentials, onDone }: Props) {
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
      <h1>bmpl · setup</h1>
      {hasCredentials && <p><a href="/">← Back to lookups</a></p>}
      <p className="muted">Paste your Warcraft Logs API credentials. They are saved locally to <code className="mono">{envPath}</code> and used only to talk to the WCL API.</p>
      {hasCredentials && <p className="tone-warn">⚠ Credentials are already set; saving will replace them.</p>}
      <div className="card">
        <ol>
          <li>Log in at <a href="https://www.warcraftlogs.com/" target="_blank" rel="noopener">warcraftlogs.com</a></li>
          <li>Open <a href="https://www.warcraftlogs.com/api/clients/" target="_blank" rel="noopener">Clients</a> → <strong>Create Client</strong></li>
          <li>Any name. Redirect URL: <code className="mono">http://localhost</code>. Leave <em>Public Client</em> unchecked.</li>
          <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> below.</li>
        </ol>
        <form onSubmit={submit} className="setup-form">
          <label>Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required /></label>
          <label>Client Secret<input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" required /></label>
          <button className="btn btn-primary" disabled={state.kind === "saving"}>Save &amp; continue</button>
        </form>
        {state.kind === "saving" && <p className="muted">Saving…</p>}
        {state.kind === "saved" && <p className="tone-good">✓ saved</p>}
        {state.kind === "error" && <p className="err">✗ {state.error}</p>}
      </div>
    </main>
  );
}
