import type { RunDetailView } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { SpellLink } from "../SpellLink.tsx";

/** Canvas SelfDetails "RUN DETAIL": killing hits, avoidable abilities, casts that went through. */
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
        {d.casts.map((c) => <div key={c.id} className="ab-row"><SpellLink id={c.id} name={c.name} /><span className="faint">{c.ofText}</span><span /></div>)}
        {d.kicked && <div className="faint" style={{ fontSize: 12 }}>{d.kicked}</div>}
      </div>
    </div>
  );
}
