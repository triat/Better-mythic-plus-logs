import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { analyticsEvent } from "../../analytics.ts";
import { useFeedback } from "../../feedback.tsx";
import { FEEDBACK_MESSAGE_MAX, VERDICT_REASONS, type VerdictSubject } from "../../lib/feedback.ts";
import { useT } from "../../locale.tsx";
import type { VerdictFeedback as Saved, VerdictReason } from "../../types.ts";
import { Icon } from "../Icon.tsx";

/**
 * Under the Synthèse verdict (canvas "bmpl · Retours", Verdict): "Does this verdict seem right?" with two small buttons.
 * "Yes" is saved in one click; "No" opens an optional reason and word in place. Once answered for this character and
 * level, the answer stays shown with Edit, never asked again. Hosted and signed in only.
 */
export function VerdictFeedback({ subject }: { subject: VerdictSubject }) {
  const { t } = useT();
  const fb = useFeedback();
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<VerdictReason | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { region, realm, name, level } = subject.target;
  useEffect(() => {
    if (!fb.enabled) return;
    let live = true;
    setSaved(undefined);
    setAsking(false);
    void api.feedback.state({ region, realm, name, level }).then((r) => { if (live) setSaved(r.ok ? r.verdict : null); });
    return () => { live = false; };
  }, [fb.enabled, region, realm, name, level]);
  if (!fb.enabled || saved === undefined) return null;

  const send = async (rating: "fair" | "unfair") => {
    setBusy(true);
    const r = await api.feedback.verdict({
      ...subject.target, rating, reason: rating === "unfair" ? reason : null, message: rating === "unfair" ? message.trim() || null : null,
      label: subject.label, verdict: subject.verdict, score: subject.score,
    });
    setBusy(false);
    if (!r.ok) return;
    analyticsEvent("feedback_verdict", { rating });
    setSaved(r.verdict);
    setAsking(false);
  };
  const edit = () => { setReason(saved?.reason ?? null); setMessage(saved?.message ?? ""); setSaved(null); };

  if (saved) {
    return (
      <div className="vf vf-done">
        <Icon name="check" size={15} />
        <span>{saved.rating === "fair" ? t("feedback.verdict.doneFair") : t("feedback.verdict.doneUnfair", { reason: t(`feedback.verdict.reasonDone.${saved.reason ?? "other"}`) })}</span>
        <button type="button" className="vf-link" onClick={edit}>{t("feedback.verdict.edit")}</button>
      </div>
    );
  }
  if (!asking) {
    return (
      <div className="vf">
        <span>{t("feedback.verdict.question")}</span>
        <button type="button" className="vf-btn" aria-label={t("feedback.verdict.fair")} title={t("feedback.verdict.fair")} disabled={busy} onClick={() => void send("fair")}>
          <Icon name="thumbUp" size={15} />
        </button>
        <button type="button" className="vf-btn" aria-label={t("feedback.verdict.unfair")} title={t("feedback.verdict.unfair")} aria-expanded={false} onClick={() => setAsking(true)}>
          <Icon name="thumbDown" size={15} />
        </button>
      </div>
    );
  }
  return (
    <div className="vf-ask">
      <span className="text-soft">{t("feedback.verdict.reasonQ")} <span className="faint">{t("feedback.verdict.optional")}</span></span>
      <div className="vf-reasons">
        {VERDICT_REASONS.map((r) => (
          <button key={r} type="button" className={"chip" + (reason === r ? " chip-on" : "")} aria-pressed={reason === r} onClick={() => setReason(reason === r ? null : r)}>
            {t(`feedback.verdict.reason.${r}`)}
          </button>
        ))}
      </div>
      <label className="vf-field">
        <span className="sr-only">{t("feedback.verdict.messageLabel")}</span>
        <textarea rows={2} maxLength={FEEDBACK_MESSAGE_MAX} placeholder={t("feedback.verdict.messagePh")} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="vf-actions">
        <button type="button" className="btn" onClick={() => setAsking(false)}>{t("feedback.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send("unfair")}>{t("feedback.send")}</button>
      </div>
    </div>
  );
}
