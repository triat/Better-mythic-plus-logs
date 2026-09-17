interface Props { envPath: string | null }
export function Home({ envPath }: Props) {
  return (
    <div className="home">
      <p className="muted">{envPath === null ? "Paste a Raider.IO URL or a Name-Realm above." : "Paste a Raider.IO URL or a Name-Realm above, or turn on clipboard watch and copy one from anywhere."}</p>
      {envPath !== null && <p className="faint">Credentials: <span className="mono">{envPath || "unknown"}</span></p>}
    </div>
  );
}
