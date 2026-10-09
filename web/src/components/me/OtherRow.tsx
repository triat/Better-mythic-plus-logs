import { classHex, className } from "@shared/wow/classes.ts";
import type { HistoryItem, MyCharacter } from "../../types.ts";
import { realmName } from "../../lib/format.ts";
import { historyKeyFor, lookupQuery, rowCells, seasonLine } from "../../lib/me.ts";
import { useT } from "../../locale.tsx";
import { useSeason } from "../../useSeason.ts";
import type { SelfActions } from "../self/ResultHead.tsx";
import { SyncButton } from "./SyncButton.tsx";

/** Canvas MeMainFirst, "other characters": one compact row each. */
export function OtherRow({ c, classID, spec, history, self, onMakeMain, onRemove }: {
  c: MyCharacter; classID: number | null; spec: string | null; history: HistoryItem[]; self: SelfActions; onMakeMain: () => void; onRemove: () => void;
}) {
  const { t } = useT();
  const season = useSeason({ name: c.name, realm: c.realm, region: c.region, level: null }, self);
  const key = historyKeyFor(history, c);
  const specClass = classID !== null ? [spec, className(classID)].filter(Boolean).join(" ") : null;
  return (
    <div className="inset me-row">
      <span>
        <b style={{ color: classID !== null ? classHex(classID) : undefined }}>{c.name}</b>{" "}
        <span className="muted" style={{ fontSize: 12 }}>{realmName(c.realm)} · {c.region.toUpperCase()}{specClass ? ` · ${specClass}` : ""}</span>
      </span>
      <span className="pillar-text" style={{ fontSize: 12 }}>{seasonLine(t, season.view)}</span>
      <div className="me-cells">{rowCells(season.view).map((x, i) => <span key={i} className={"cell cell-" + x.band}>{x.text}</span>)}</div>
      <div className="me-actions me-actions-end">
        {key
          ? <a className="btn btn-sm btn-primary" href={`/?open=${encodeURIComponent(key)}`} title={t("me.fromHistory")}>{t("me.open")}</a>
          : <a className="btn btn-sm btn-primary" href={`/?q=${encodeURIComponent(lookupQuery(c))}&region=${c.region}`} title={t("me.notInHistory")}>{t("me.lookUp")}</a>}
        <SyncButton season={season} self={self} compact />
        <button type="button" className="link-btn me-make-main" onClick={onMakeMain}>{t("me.makeMain")}</button>
        <button type="button" className="icon-btn tone-bad" onClick={onRemove} aria-label={t("me.remove")} title={t("me.remove")}>×</button>
      </div>
    </div>
  );
}
