interface Props { envPath: string }
export function Home({ envPath }: Props) {
  return (
    <div className="home">
      <p className="muted">Paste a Raider.IO URL or a Name-Realm above, or turn on clipboard watch and copy one from anywhere.</p>
      <p className="faint">Credentials: <span className="mono">{envPath || "unknown"}</span></p>
    </div>
  );
}
