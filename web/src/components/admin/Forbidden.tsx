import type { ReactNode } from "react";

interface Props {
  reason: "member" | "local";
  handle: string | null;
  /** Override the "Admins only" copy: /settings in local mode reuses the screen with its own title and text. */
  title?: string;
  text?: ReactNode;
}

/** /admin for a member (server answers 403 on every /api/admin/* anyway) or in local mode; also /settings in local mode. */
export function Forbidden({ reason, handle, title, text }: Props) {
  return (
    <main className="forbidden">
      <h1>{title ?? "Admins only"}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {text ?? (reason === "local"
          ? "The admin page exists in hosted mode only."
          : <>This page is for the people who run this instance. Your account ({handle && <span className="mono">{handle}</span>}) is a member.</>)}
      </p>
      <a className="btn" href="/" style={{ marginTop: 6 }}>← back to lookups</a>
    </main>
  );
}
