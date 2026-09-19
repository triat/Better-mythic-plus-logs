import { useState } from "react";
import type { DeniedNotice } from "../lib/hostedMode.ts";

interface Props { notice: DeniedNotice; loginFailed: boolean; note: string }

/** The three refusals that carry no id (canvas "Phase2Details", sign-in variants): title + explanation in the same inset as the invite notice. */
const REFUSALS = {
  guild: { title: "Members of the guild's Discord only", text: "Your account is not in that server. Join it, then sign in again." },
  banned: { title: "Account banned", text: "This account cannot sign in here. Contact the admin on Discord." },
  rate: { title: "Too many new accounts", text: "Too many sign-ups from your network in the last hour — try again later." },
} as const;

const DiscordMark = () => (
  <svg width="20" height="16" viewBox="0 0 127 96" fill="currentColor" aria-hidden="true">
    <path d="M107.7 8.1A105.2 105.2 0 0 0 81.5 0c-1.1 2-2.4 4.7-3.3 6.8a97.7 97.7 0 0 0-29.1 0C48.2 4.7 46.9 2 45.7 0a105 105 0 0 0-26.2 8.1C2.9 33.2-1.6 57.6.6 81.7a106 106 0 0 0 32.2 16.2c2.6-3.5 4.9-7.3 6.9-11.2a68.6 68.6 0 0 1-10.9-5.2c.9-.7 1.8-1.4 2.7-2.1a75.6 75.6 0 0 0 64.6 0c.9.7 1.8 1.4 2.7 2.1-3.5 2.1-7.1 3.8-10.9 5.2 2 3.9 4.3 7.7 6.9 11.2a105.8 105.8 0 0 0 32.2-16.2c2.6-27.9-4.5-52.1-18.9-73.6zM42.5 66.9c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5.1 12.9-11.5 12.9zm42.5 0c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5 12.9-11.5 12.9z" />
  </svg>
);

/** Hosted-mode gate (GET /api/me → 401). Design: canvas page "Hosted", sign-in A + denied notice 2; "Phase2Details" for the mode note and the other refusals. */
export function SignIn({ notice, loginFailed, note }: Props) {
  const [copied, setCopied] = useState(false);
  const deniedDiscordId = notice?.kind === "invite" ? notice.discordId : null;
  const refusal = notice && notice.kind !== "invite" ? REFUSALS[notice.kind] : null;
  const copy = async () => {
    if (!deniedDiscordId) return;
    try { await navigator.clipboard.writeText(deniedDiscordId); setCopied(true); } catch { /* no clipboard access: the id is plain text, selectable */ }
  };
  return (
    <>
      <header className="top"><div className="top-row"><div className="brand">bmpl</div></div></header>
      <main className="signin">
        <h1>Who applied to your key?</h1>
        <p className="muted">Vet a Mythic+ applicant from their Warcraft Logs and Raider.IO history.</p>
        <a className="btn btn-discord" href="/auth/discord"><DiscordMark /> Sign in with Discord</a>
        {loginFailed && <p style={{ color: "var(--red)", fontSize: 13 }}>✗ Sign-in failed — Discord did not complete the login. Try again.</p>}
        {deniedDiscordId && (
          <div className="inset signin-denied">
            <div className="label-caps">Invitation required</div>
            <div>Your Discord account signed in fine, but it is not invited. Send your id to the admin:</div>
            <div className="signin-id">
              <span className="mono">{deniedDiscordId}</span>
              <button type="button" className="chip" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>Then sign in again — no need to reload.</div>
          </div>
        )}
        {refusal && (
          <div className="inset signin-denied">
            <div className="label-caps">{refusal.title}</div>
            <div>{refusal.text}</div>
          </div>
        )}
        <p className="signin-note">{note} <a href="/privacy" className="faint">Privacy</a></p>
      </main>
    </>
  );
}
