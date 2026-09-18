interface Props { deniedDiscordId: string | null }

/** Hosted-mode gate. Functional placeholder: the designed version is issue #7. */
export function SignIn({ deniedDiscordId }: Props) {
  return (
    <main className="home" style={{ paddingTop: 80 }}>
      <h1>bmpl</h1>
      <p className="muted">Vet a Mythic+ applicant from their Warcraft Logs and Raider.IO history.</p>
      <p><a className="btn btn-primary btn-lg" href="/auth/discord">Sign in with Discord</a></p>
      {deniedDiscordId && (
        <div className="card" style={{ display: "inline-block", marginTop: 24, textAlign: "left" }}>
          <p><strong>You need an invitation.</strong></p>
          <p className="muted">Send your Discord id to the person who runs this instance, then sign in again:</p>
          <p className="mono">{deniedDiscordId}</p>
        </div>
      )}
    </main>
  );
}
