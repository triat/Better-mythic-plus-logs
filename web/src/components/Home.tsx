import { useT } from "../locale.tsx";

interface Props {
  envPath: string | null;
  /** The member's main character (canvas MeDetails, home card): a Look up button, run only on its click. */
  main: { name: string; detail: string; onLookUp: () => void } | null;
}
export function Home({ envPath, main }: Props) {
  const { t } = useT();
  return (
    <div className="home">
      <p className="muted">{envPath === null ? t("home.hint") : t("home.hintWatch")}</p>
      {envPath !== null && <p className="faint">{t("setup.credentials")}<span className="mono">{envPath || t("home.unknownPath")}</span></p>}
      {main && (
        <div className="card me-home">
          <span className="me-name">{main.name}</span>
          <span className="muted">{main.detail}</span>
          <div className="grow" />
          <button type="button" className="btn btn-sm" onClick={main.onLookUp}>{t("me.homeLookUp", { name: main.name })}</button>
        </div>
      )}
    </div>
  );
}
