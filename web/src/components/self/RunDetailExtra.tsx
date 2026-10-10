import type { RunDetailView } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { SpellLink } from "../SpellLink.tsx";

/** Canvas SelfDetails "RUN DETAIL": killing hits, avoidable abilities, casts that went through; canvas "control" run
 * detail B: the run's crowd control, rate first, then the spells by category. */
export function RunDetailExtra({ d }: { d: RunDetailView }) {
  const { t } = useT();
  return (
    <div className="run-detail">
      <div>
        {d.deaths.length === 0 && <div className="faint">{t("self.detail.noDeath")}</div>}
        {d.deaths.map((x, i) => (
          <div key={i}>
            <div className="label-caps" style={{ marginBottom: 4 }}>{x.title}</div>
            {x.hits.map((h, j) => <div key={j} className="ab-row"><span>{h.ability}</span><span className="faint">{h.share}</span><span /></div>)}
          </div>
        ))}
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>{t("self.detail.avoidable")}</div>
        {d.avoidable.map((a) => <div key={a.key} className="ab-row"><span>{a.name}</span><span className="faint">{a.amount}</span><span /></div>)}
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>{t("self.detail.casts")}</div>
        <div className="faint" style={{ fontSize: 12 }}>{t("self.panel.castsNote")}</div>
        {d.casts.map((c) => <div key={c.id} className="ab-row"><SpellLink id={c.id} name={c.name} /><span className="faint">{c.ofText}</span><span /></div>)}
        {d.kicked && <div className="faint" style={{ fontSize: 12 }}>{d.kicked}</div>}
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>{t("self.control.title")}</div>
        {d.control.rate !== null && (
          <div className="cc-rate">
            <span className="mono">{d.control.rate}</span>
            <span className="muted" style={{ fontSize: 12 }}>{d.control.line.text} {d.control.line.delta && <span className={d.control.line.cls}>{d.control.line.delta}</span>}</span>
          </div>
        )}
        {d.control.groups.map((g) => (
          <div key={g.label}>
            <div className="cc-cat">{g.label}</div>
            {g.rows.map((r) => (
              <div key={r.id} className="ab-row"><span><SpellLink id={r.id} name={r.name} />{r.pet && <span className="faint"> {r.pet}</span>}</span><span className="faint">{r.uses}</span><span className="faint">{r.enemies}</span></div>
            ))}
          </div>
        ))}
        {d.control.note && <div className="faint" style={{ fontSize: 12 }}>{d.control.note}</div>}
      </div>
    </div>
  );
}
