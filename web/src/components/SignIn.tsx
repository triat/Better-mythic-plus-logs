import { useState } from "react";
import type { DeniedNotice } from "../lib/hostedMode.ts";
import { useT } from "../locale.tsx";

interface Props { notice: DeniedNotice; loginFailed: boolean; note: string }

const DiscordMark = () => (
  <svg width="20" height="16" viewBox="0 0 127 96" fill="currentColor" aria-hidden="true">
    <path d="M107.7 8.1A105.2 105.2 0 0 0 81.5 0c-1.1 2-2.4 4.7-3.3 6.8a97.7 97.7 0 0 0-29.1 0C48.2 4.7 46.9 2 45.7 0a105 105 0 0 0-26.2 8.1C2.9 33.2-1.6 57.6.6 81.7a106 106 0 0 0 32.2 16.2c2.6-3.5 4.9-7.3 6.9-11.2a68.6 68.6 0 0 1-10.9-5.2c.9-.7 1.8-1.4 2.7-2.1a75.6 75.6 0 0 0 64.6 0c.9.7 1.8 1.4 2.7 2.1-3.5 2.1-7.1 3.8-10.9 5.2 2 3.9 4.3 7.7 6.9 11.2a105.8 105.8 0 0 0 32.2-16.2c2.6-27.9-4.5-52.1-18.9-73.6zM42.5 66.9c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5.1 12.9-11.5 12.9zm42.5 0c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5 12.9-11.5 12.9z" />
  </svg>
);

/** Hosted-mode gate (GET /api/me → 401). Design: canvas page "Hosted", sign-in A + denied notice 2; "Phase2Details" for the mode note and the other refusals. */
export function SignIn({ notice, loginFailed, note }: Props) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const deniedDiscordId = notice?.kind === "invite" ? notice.discordId : null;
  const refusal = notice && notice.kind !== "invite" ? notice : null;
  const copy = async () => {
    if (!deniedDiscordId) return;
    try { await navigator.clipboard.writeText(deniedDiscordId); setCopied(true); } catch { /* no clipboard access: the id is plain text, selectable */ }
  };
  return (
    <>
      <header className="top"><div className="top-row"><div className="brand">bmpl</div></div></header>
      <main className="signin">
        <h1>{t("signin.tagline")}</h1>
        <p className="muted">{t("signin.sub")}</p>
        <a className="btn btn-discord" href="/auth/discord"><DiscordMark /> {t("signin.discord")}</a>
        {loginFailed && <p style={{ color: "var(--red)", fontSize: 13 }}>{t("signin.failed")}</p>}
        {deniedDiscordId && (
          <div className="inset signin-denied">
            <div className="label-caps">{t("signin.invite.title")}</div>
            <div>{t("signin.invite.body")}</div>
            <div className="signin-id">
              <span className="mono">{deniedDiscordId}</span>
              <button type="button" className="chip" onClick={() => void copy()}>{copied ? t("signin.copied") : t("signin.copy")}</button>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>{t("signin.invite.then")}</div>
          </div>
        )}
        {refusal && (
          <div className="inset signin-denied">
            <div className="label-caps">{refusal.title}</div>
            <div>{refusal.text}</div>
          </div>
        )}
        <p className="signin-note">{note} <a href="/privacy" className="faint">{t("common.privacy")}</a></p>
      </main>
    </>
  );
}
