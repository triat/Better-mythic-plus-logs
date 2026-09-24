import type { AxisKey, Evaluation } from "../types.ts";
import { driversView } from "../lib/drivers.ts";
import { useDocs } from "../docs.tsx";
import { useT } from "../locale.tsx";
import { Around } from "./Around.tsx";
import { HelpLink } from "./HelpLink.tsx";

/** "What makes this score": diverging bars of the score drivers (canvas variant B). Nothing for an evaluation saved
 * before drivers existed. */
export function ScoreDrivers({ evaluation }: { evaluation: Evaluation }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const v = driversView(t, locale, evaluation, titleOf);
  if (!v) return null;
  return (
    <div className="drivers inset">
      <div className="drivers-row">
        <span className="drivers-title"><span className="label-caps">{t("drivers.title")}</span><HelpLink anchor="drivers" /></span>
        <span className="drivers-caption cost">{t("drivers.costs")}</span>
        <span />
        <span className="drivers-caption earn">{t("drivers.earns")}</span>
        <span />
      </div>
      {v.rows.map((r) => (
        <div key={r.source} className="drivers-row">
          <span>{r.title}</span>
          <span className="drivers-side cost">
            {r.tone === "bad" && <><span className="drivers-impact tone-bad">{r.impact}</span><span className="drivers-bar" style={{ width: r.barPx }} /></>}
          </span>
          <span className="drivers-axis" />
          <span className="drivers-side earn">
            {r.tone === "good" && <><span className="drivers-bar" style={{ width: r.barPx }} /><span className="drivers-impact tone-good">{r.impact}</span></>}
          </span>
          <span className="drivers-value">{r.value} <span className="faint">· {r.reference}</span></span>
        </div>
      ))}
      {v.path && (
        <div className="drivers-path">
          <Around
            message={v.path.message}
            params={{
              verdict: <b className={v.path.verdictCls}>{v.path.verdict}</b>,
              threshold: v.path.threshold,
              list: <b>{v.path.list}</b>,
              score: <span className="mono">{v.path.score}</span>,
            }}
          />
        </div>
      )}
    </div>
  );
}
