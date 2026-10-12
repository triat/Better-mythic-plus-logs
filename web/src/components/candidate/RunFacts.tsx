import type { RunDetail } from "../../lib/runView.ts";
import type { Moment } from "../../lib/timeline.ts";
import { useT } from "../../locale.tsx";
import { SpellLink } from "../SpellLink.tsx";

/** "Moments clés" (mockups F-Runs and F-Run): one button per death (selects it on the timeline), run-level lines inert. */
export function Moments({ moments, event, onSelect }: { moments: Moment[]; event: string | null; onSelect: (id: string) => void }) {
  const { t } = useT();
  return (
    <div className="rp-moments">
      <span className="tl-lbl">{t("cand.run.moments")}</span>
      {moments.map((m, i) => m.id !== null
        ? (
          <button
            key={m.id} type="button" className={"rp-moment" + (m.bad ? " bad" : "") + (m.id === event ? " on" : "")}
            aria-pressed={m.id === event} onClick={() => onSelect(m.id!)}
          >
            <span className="mono rp-moment-time">{m.time}</span><span>{m.text}</span>
          </button>
        )
        : (
          <div key={`run-${i}`} className="rp-moment rp-moment-run">
            <span className="mono rp-moment-time">{m.time}</span><span>{m.text}</span>
          </div>
        ))}
    </div>
  );
}

/** "Défensifs utilisés / possibles": one bar per major defensive, the potions as a count. */
export function DefensivesUsed({ rows }: { rows: RunDetail["defensives"] }) {
  const { t } = useT();
  return (
    <>
      <span className="tl-lbl">{t("cand.run.defensives")}</span>
      {rows.map((x) => (
        <div key={x.name} className={"rp-def" + (x.pct === 0 ? " none" : "")}>
          <span className="rp-def-name"><SpellLink id={x.id} name={x.name} /></span>
          {x.pct !== null ? <span className="rp-def-bar"><span style={{ width: `${x.pct}%` }} /></span> : <span />}
          <span className="mono rp-def-v">{x.used}</span>
        </div>
      ))}
    </>
  );
}
