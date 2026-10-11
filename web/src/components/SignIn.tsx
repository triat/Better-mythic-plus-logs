import { useState } from "react";
import type { DeniedNotice } from "../lib/hostedMode.ts";
import { useT } from "../locale.tsx";
import { Icon } from "./Icon.tsx";

interface Props { notice: DeniedNotice; loginFailed: boolean; note: string }

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
      <header className="top"><div className="top-row"><a className="brand" href="/">bmpl</a></div></header>
      <main className="signin">
        <h1>{t("signin.tagline")}</h1>
        <p className="muted">{t("signin.sub")}</p>
        <a className="btn btn-discord" href="/auth/discord"><Icon name="discord" size={16} /> {t("signin.discord")}</a>
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
