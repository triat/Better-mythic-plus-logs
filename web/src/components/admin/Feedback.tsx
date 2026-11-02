import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { feedbackLine } from "../../lib/feedback.ts";
import { fmtStamp } from "../../lib/format.ts";
import { useT } from "../../locale.tsx";
import type { FeedbackRow } from "../../types.ts";

/** Members' feedback (canvas "bmpl · Retours"): newest first, unread marked; owns its data like Audit and Usage. */
export function Feedback({ onUnread }: { onUnread: (n: number) => void }) {
  const { t } = useT();
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    void api.admin.feedback().then((r) => {
      if (!r.ok) { setFailed(true); return; }
      setFailed(false);
      setRows(r.rows);
      setUnread(r.unread);
      onUnread(r.unread);
    });
  }, [onUnread]);
  useEffect(load, [load]);
  const read = async (id: number) => {
    const r = await api.admin.feedbackRead(id);
    if (!r.ok) return;
    setRows((rs) => rs?.map((x) => (x.id === id ? { ...x, readAt: Date.now() } : x)) ?? null);
    setUnread(r.unread);
    onUnread(r.unread);
  };
  return (
    <section id="feedback" className="card admin-section">
      <div className="admin-section-head">
        <span style={{ fontWeight: 600 }}>{t("admin.feedback.title")}</span>
        <span className="muted">{t("admin.feedback.sub", { count: unread })}</span>
      </div>
      {failed && <div className="faint" style={{ fontSize: 13 }}>{t("admin.feedback.failed")}</div>}
      {rows && rows.length === 0 && <div className="faint" style={{ fontSize: 13 }}>{t("admin.feedback.empty")}</div>}
      {rows?.map((r) => {
        const l = feedbackLine(t, r);
        return (
          <div key={l.id} className={"inset fb-row" + (l.unread ? " unread" : "")}>
            <div className="fb-row-head">
              {l.unread && <span className="dot dot-pending" aria-hidden="true" />}
              <span className="chip">{l.kind}</span>
              <span className="mono faint">{fmtStamp(l.at)}</span>
              <span className="faint">{l.who}</span>
              <div className="grow" />
              {l.unread && <button type="button" className="btn btn-sm" onClick={() => void read(l.id)}>{t("admin.feedback.markRead")}</button>}
            </div>
            {l.context && <span className="text-soft">{l.context}</span>}
            {l.message && <p className="fb-row-msg">{l.message}</p>}
          </div>
        );
      })}
    </section>
  );
}
