import type { ReactNode } from "react";
import { useT } from "../../locale.tsx";
import { Around } from "../Around.tsx";

interface Props {
  reason: "member" | "local";
  handle: string | null;
  /** Override the "Admins only" copy: /settings in local mode reuses the screen with its own title and text. */
  title?: string;
  text?: ReactNode;
}

/** /admin for a member (server answers 403 on every /api/admin/* anyway) or in local mode; also /settings in local mode. */
export function Forbidden({ reason, handle, title, text }: Props) {
  const { t } = useT();
  return (
    <main className="forbidden">
      <h1>{title ?? t("admin.forbidden.title")}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {text ?? (reason === "local"
          ? t("admin.forbidden.local")
          : <Around message={t("admin.forbidden.member")} params={{ handle: handle ? <span className="mono">{handle}</span> : "" }} />)}
      </p>
      <a className="btn" href="/" style={{ marginTop: 6 }}>{t("common.backToLookups")}</a>
    </main>
  );
}
