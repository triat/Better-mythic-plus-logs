import type { PanelView } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { SpellLink } from "../SpellLink.tsx";

/** Canvas SelfDungeonFirst, right-hand panel: what hits, what kills, what went through, the crowd control landed there
 * (canvas "control"), the link to the runs. */
export function DungeonPanel({ v, onRuns }: { v: PanelView; onRuns: () => void }) {
  const { t } = useT();
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="section-row">
        <span className="section-title">{v.title}</span>
        <span className="muted" style={{ fontSize: 12 }}>{v.sub}</span>
      </div>
      {v.empty ? <div className="muted">{t("self.panel.empty")}</div> : (
        <>
          <div className="label-caps">{t("self.panel.avoidable")}</div>
          {v.avoidable.map((a) => (
            <div key={a.id} className="ab-row"><SpellLink id={a.id} name={a.name} /><span className="bar2"><span style={{ width: `${a.width}%` }} /></span><span className="mono">{a.pct}</span></div>
          ))}
          {v.other && (
            <div className="ab-row"><span className="faint">{t("self.panel.other")}</span><span className="bar2"><span style={{ width: `${v.other.width}%` }} /></span><span className="mono">{v.other.pct}</span></div>
          )}
          <div className="label-caps" style={{ marginTop: 6 }}>{t("self.panel.killers")}</div>
          {v.killers.map((k) => <div key={k.ability} className="ab-row"><span>{k.ability}</span><span className="faint">{k.deaths}</span><span /></div>)}
          <div className="label-caps" style={{ marginTop: 6 }}>{t("self.panel.casts")}</div>
          <div className="faint" style={{ fontSize: 12 }}>{t("self.panel.castsNote")}</div>
          {v.casts.map((c) => <div key={c.id} className="ab-row"><SpellLink id={c.id} name={c.name} /><span className="faint">{c.ofText}</span><span className="mono">{c.mine}</span></div>)}
          <div className="label-caps" style={{ marginTop: 6 }}>{t("self.panel.control")}</div>
          {v.control.map((c) => <div key={c.id} className="ab-row"><SpellLink id={c.id} name={c.name} /><span className="faint">{c.uses}</span><span className="faint">{c.enemies}</span></div>)}
          <div className="faint" style={{ fontSize: 12 }}>{v.controlNote}</div>
        </>
      )}
      <button type="button" className="link-btn" onClick={onRuns}>{v.runsLink}</button>
    </section>
  );
}
