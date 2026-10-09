import { classHex, className } from "@shared/wow/classes.ts";
import type { AxisKey, HistoryItem, MyCharacter } from "../../types.ts";
import { realmName } from "../../lib/format.ts";
import { historyKeyFor, lookupQuery, mainPillars, seasonLine } from "../../lib/me.ts";
import { workOnRows } from "../../lib/self.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { useSeason } from "../../useSeason.ts";
import type { SelfActions } from "../self/ResultHead.tsx";
import { SyncButton } from "./SyncButton.tsx";

/** Canvas MeMainFirst: the main character as a large card (its pillars, trends, first point to work on). */
export function MainCard({ c, classID, spec, history, self }: { c: MyCharacter; classID: number | null; spec: string | null; history: HistoryItem[]; self: SelfActions }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const season = useSeason({ name: c.name, realm: c.realm, region: c.region, level: null }, self);
  const key = historyKeyFor(history, c);
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const first = workOnRows(t, locale, null, season.view, titleOf)[0] ?? null;
  const specClass = classID !== null ? [spec, className(classID)].filter(Boolean).join(" ") : null;
  return (
    <section className="card me-main">
      <div className="me-head">
        <span className="me-name me-name-big" style={{ color: classID !== null ? classHex(classID) : undefined }}>{c.name}</span>
        <span className="muted">{realmName(c.realm)} · {c.region.toUpperCase()}{specClass ? ` · ${specClass}` : ""}</span>
        <span className="me-main-badge">{t("me.main")}</span>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>{seasonLine(t, season.view)}</span>
      </div>
      <div className="me-tiles">
        {mainPillars(t, season.view).map((p) => (
          <div key={p.key} className="inset me-tile">
            <span className="label-caps">{p.title}</span>
            <span className={"pillar-score band-" + p.band} style={{ fontSize: 24 }}>{p.score}</span>
            <span className={"pillar-trend " + p.trend.cls}>{p.trend.text}</span>
          </div>
        ))}
      </div>
      {first && (
        <div className="me-work">
          <span className="label-caps">{t("me.workOnFirst")}</span>
          <b>{first.title}</b>
          <span className="faint">{first.pillar && <>· {first.pillar} </>}· {first.detail}</span>
          <span className="tone-bad">{first.impact}</span>
          <span className={first.past.cls}>{first.past.text}</span>
        </div>
      )}
      <div className="me-actions">
        {key ? (
          <><a className="btn btn-sm btn-primary" href={`/?open=${encodeURIComponent(key)}`}>{t("me.openName", { name: c.name })}</a><span className="faint" style={{ fontSize: 12 }}>{t("me.fromHistory")}</span></>
        ) : (
          <><a className="btn btn-sm" href={`/?q=${encodeURIComponent(lookupQuery(c))}`}>{t("me.lookUp")}</a><span className="faint" style={{ fontSize: 12 }}>{t("me.notInHistory")}</span></>
        )}
        <SyncButton season={season} self={self} />
      </div>
    </section>
  );
}
