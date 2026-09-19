interface Props { operator: string; guildRequired: boolean }

/** /privacy: one static page, readable signed out (brand header only, no search). Text from the canvas "Phase2Details". */
export function PrivacyPage({ operator, guildRequired }: Props) {
  return (
    <>
      <header className="top"><div className="top-row"><div className="brand">bmpl</div></div></header>
      <main className="privacy">
        <a href="/" className="muted" style={{ fontSize: 13 }}>← back</a>
        <h1>Privacy</h1>
        <p>
          bmpl vets Mythic+ players from public Warcraft Logs and Raider.IO data. This instance is run by <b>{operator}</b> for their guild;
          it is not a Blizzard, Warcraft Logs or Discord service.
        </p>
        <h2>What is stored about you</h2>
        <ul>
          <li>
            <b>Discord id, username, global name and avatar</b> — from the "identify" scope when you sign in. Nothing else from Discord: no e-mail, no messages, no server list
            {guildRequired && <span className="faint"> (unless this instance requires membership of one server — then the check reads your server list once at sign-in and keeps nothing)</span>}.
          </li>
          <li><b>Your lookup history</b> (the 20 tabs), your settings (your key, legend), your hourly WCL usage, your defensives proposals and the admin's notes on them.</li>
          <li><b>Your Warcraft Logs client</b>, if you added one: the client id in clear, the secret encrypted with a key that only this server holds. Verified once on save; used for your lookups only.</li>
          <li><b>Sessions</b>: a random id in a cookie, your IP and browser at sign-in, for 30 days.</li>
          <li><b>Audit log</b>: sign-ins, refusals and errors with your id and IP, kept 90 days.</li>
        </ul>
        <h2>What is not yours</h2>
        <p>Runs, rankings and fight data fetched from Warcraft Logs are public and are cached for everyone; they carry the names of the players in those runs, which is how Warcraft Logs publishes them.</p>
        <h2>Deleting your account</h2>
        <p>
          Settings → <b>Delete my account</b> removes every row above and signs you out. Corrections you proposed that an admin approved stay in the shared table, without your name.
          The audit log keeps its rows (without your name) until they expire. Backups of the database are kept 30 days.
        </p>
        <p className="faint" style={{ fontSize: 12 }}>Questions: the admin of this instance on Discord.</p>
      </main>
    </>
  );
}
