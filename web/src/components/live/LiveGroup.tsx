// "Your group" (mockup F-Live): the party in roster order — the player's own chip, the other members (a click runs
// the same lookup as a row), then a dashed slot per missing role and the note on where spec and ilvl come from.
import { useT } from "../../locale.tsx";
import type { LiveView } from "../../lib/live/panel.ts";

export function LiveGroup({ view, onSelect }: { view: LiveView; onSelect: (character: string) => void }) {
  const { t } = useT();
  return (
    <section className="lv-party">
      <div className="lv-party-head">
        <h2>{t("live.panel.group.title")}</h2>
        <span className="lv-party-line">{view.party.line}</span>
      </div>
      <div className="lv-party-chips">
        {view.party.members.map((m) =>
          m.you !== null ? (
            <span key={m.id} className="lv-member self" style={{ color: m.classColor }}>
              <span className="lv-member-dot" aria-hidden="true" />{m.name} <span className="lv-member-sub">{m.you}</span>
            </span>
          ) : (
            <button key={m.id} type="button" className="lv-member" onClick={() => onSelect(m.character)} title={m.action?.label}>
              <span className="lv-member-name" style={{ color: m.classColor }}>{m.name}</span>
              {m.verdict
                ? <span className={"cand-pill " + m.verdict.cls}>{m.verdict.label}{m.verdict.score !== null && <span className="mono">{m.verdict.score}</span>}</span>
                : <span className="lv-member-sub">{m.state === "queued" ? t("live.panel.queued") : t("live.panel.notVetted")}</span>}
            </button>
          ),
        )}
        {view.party.missing.map((role, i) => (
          <span key={`${role}:${i}`} className="lv-member slot">{t(`live.role.${role}`)}</span>
        ))}
      </div>
      <p className="lv-note">{view.note}</p>
    </section>
  );
}
