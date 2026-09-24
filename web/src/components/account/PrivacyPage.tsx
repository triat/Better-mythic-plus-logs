import { useT } from "../../locale.tsx";
import { Around } from "../Around.tsx";

interface Props { operator: string; guildRequired: boolean }

/** /privacy: one static page, readable signed out (brand header only, no search). Text from the canvas "Phase2Details". */
export function PrivacyPage({ operator, guildRequired }: Props) {
  const { t } = useT();
  return (
    <>
      <header className="top"><div className="top-row"><a className="brand" href="/">bmpl</a></div></header>
      <main className="privacy">
        <a href="/" className="muted" style={{ fontSize: 13 }}>{t("common.back")}</a>
        <h1>{t("privacy.title")}</h1>
        <p><Around message={t("privacy.intro")} params={{ operator: <b>{operator}</b> }} /></p>
        <h2>{t("privacy.stored")}</h2>
        <ul>
          <li>
            <Around
              message={t("privacy.identityLine")}
              params={{
                identity: <b>{t("privacy.identity")}</b>,
                guild: guildRequired ? <span className="faint">{t("privacy.identityGuild")}</span> : "",
              }}
            />
          </li>
          <li><Around message={t("privacy.historyLine")} params={{ history: <b>{t("privacy.history")}</b> }} /></li>
          <li><Around message={t("privacy.clientLine")} params={{ client: <b>{t("privacy.client")}</b> }} /></li>
          <li><Around message={t("privacy.sessionsLine")} params={{ sessions: <b>{t("privacy.sessions")}</b> }} /></li>
          <li><Around message={t("privacy.auditLine")} params={{ audit: <b>{t("privacy.audit")}</b> }} /></li>
        </ul>
        <h2>{t("privacy.notYours")}</h2>
        <p>{t("privacy.publicData")}</p>
        <h2>{t("privacy.deleting")}</h2>
        <p><Around message={t("privacy.deleteLine")} params={{ deleteMine: <b>{t("privacy.deleteMine")}</b> }} /></p>
        <p className="faint" style={{ fontSize: 12 }}>{t("privacy.questions")}</p>
      </main>
    </>
  );
}
