// The Live status card (mockup F-Live): the game-connected tile, the key line, the three counts, the auto toggle.
import { useT } from "../../locale.tsx";
import type { LiveView } from "../../lib/live/panel.ts";
import { OWN_CLIENT_GUIDE } from "../../lib/session.ts";

/** The monitor tile in the invite tokens (mockup F-Live). */
export function LiveIcon() {
  return (
    <span className="lv-icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" />
      </svg>
    </span>
  );
}

interface Props {
  view: LiveView;
  auto: boolean;
  autoAllowed: boolean;
  onAutoChange: (v: boolean) => void;
}

export function LiveStatus({ view, auto, autoAllowed, onAutoChange }: Props) {
  const { t } = useT();
  return (
    <section className="card lv-status">
      <div className="lv-status-id">
        <LiveIcon />
        <div className="lv-status-text">
          <span className="lv-status-title">{view.status.title}</span>
          <span className="lv-status-key">{view.status.key}</span>
        </div>
      </div>
      <div className="lv-counts">
        {view.status.counts.map((c) => (
          <div key={c.label} className="lv-count">
            <span className={"mono lv-count-value" + (c.tone === "invite" ? " invite" : "")}>{c.value}</span>
            <span className="lv-count-label">{c.label}</span>
          </div>
        ))}
      </div>
      <div className="lv-auto">
        <label className={"lv-auto-label" + (autoAllowed ? "" : " disabled")}>
          <input type="checkbox" checked={auto} disabled={!autoAllowed} onChange={(e) => onAutoChange(e.target.checked)} />
          {t("live.panel.auto")}
        </label>
        {!autoAllowed && <a className="lv-auto-guide" href={OWN_CLIENT_GUIDE.href}>{t("live.panel.autoNeedsClient")}</a>}
      </div>
    </section>
  );
}
