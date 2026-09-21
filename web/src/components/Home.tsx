import { useT } from "../locale.tsx";

interface Props { envPath: string | null }
export function Home({ envPath }: Props) {
  const { t } = useT();
  return (
    <div className="home">
      <p className="muted">{envPath === null ? t("home.hint") : t("home.hintWatch")}</p>
      {envPath !== null && <p className="faint">{t("setup.credentials")}<span className="mono">{envPath || t("home.unknownPath")}</span></p>}
    </div>
  );
}
