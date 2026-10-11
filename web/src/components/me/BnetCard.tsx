import type { BnetState } from "../../api.ts";
import { linkedLine, unlinkConfirm, type BnetNotice } from "../../lib/bnet.ts";
import { useT } from "../../locale.tsx";

/** The Battle.net round trip starts with a top-level navigation (like the Discord sign-in link), allowed by the CSP. */
const START = "/auth/bnet/start";

/** Canvas BnetDetails, "after the round trip" and "removed by the 30-day check": one line, three tones. */
export function BnetNote({ notice, importAgain = false }: { notice: BnetNotice; importAgain?: boolean }) {
  const { t } = useT();
  return (
    <div className={`bnet-note bnet-note--${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
      <span>{notice.text}</span>
      {importAgain && <><div className="grow" /><a className="btn btn-sm" href={START}>{t("me.bnet.importAgain")}</a></>}
    </div>
  );
}

/** Canvas BnetDetails, "not linked yet": the card that replaces the add field in hosted mode. */
export function BnetLinkCard() {
  const { t } = useT();
  return (
    <section className="card bnet-card">
      <div className="bnet-card-head">
        <span className="chip">{t("me.bnet.brand")}</span>
        <span className="section-title">{t("me.bnet.linkTitle")}</span>
      </div>
      <span className="bnet-card-text">{t("me.bnet.linkText")}</span>
      <div className="bnet-card-head">
        <a className="btn btn-primary" href={START}>{t("me.bnet.link")}</a>
        <span className="faint" style={{ fontSize: 12 }}>{t("me.bnet.linkNote")}</span>
      </div>
    </section>
  );
}

/** Canvas BnetDetails, "linked" and "unlink · confirmation": the line above the list, or its confirmation in place. */
export function BnetLinked({ link, bnetCount, confirming, busy, onUnlink, onConfirm, onKeep }: {
  link: NonNullable<BnetState["link"]>; bnetCount: number; confirming: boolean; busy: boolean;
  onUnlink: () => void; onConfirm: () => void; onKeep: () => void;
}) {
  const { t, locale } = useT();
  if (confirming) {
    return (
      <div className="confirm me-confirm">
        <span>{unlinkConfirm(t, bnetCount)}</span>
        <div className="grow" />
        <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={onConfirm}>{t("me.bnet.unlink")}</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onKeep}>{t("me.keep")}</button>
      </div>
    );
  }
  const line = linkedLine(t, locale, link);
  return (
    <div className="bnet-linked">
      <span className="chip chip-ok">{t("me.bnet.brand")}</span>
      <span>{line.who}</span>
      <span className="faint">{line.text}</span>
      <div className="grow" />
      <a className="btn btn-sm" href={START}>{t("me.bnet.importAgain")}</a>
      <button type="button" className="btn btn-sm btn-danger" onClick={onUnlink}>{t("me.bnet.unlink")}</button>
    </div>
  );
}
