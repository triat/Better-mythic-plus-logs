// The Group Finder roster (mockup F-Live): the role / class / sort chips, then one card with the applicants grouped
// by role. Under 760 px a row becomes a two-line card (identity + action, then spec · ilvl · RIO and the verdict).
import { CLASS_NAMES, className } from "@shared/wow/classes.ts";
import { useT } from "../../locale.tsx";
import { classMenu, rolesFor, sortMenu } from "../../lib/live/panel.ts";
import type { LiveRowView, LiveView } from "../../lib/live/panel.ts";
import type { LiveRole, LiveSort, Roster } from "../../lib/live/roster.ts";
import { ChipMenu } from "../ChipMenu.tsx";
import { Icon } from "../Icon.tsx";

/** `DeathKnight` → "Death Knight": the class menu's labels, from the one runtime table `web/` may import. */
const CLASS_ID_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(CLASS_NAMES).map(([id, name]) => [name.replace(/\s+/g, ""), Number(id)]),
);
const classLabel = (name: string): string => (CLASS_ID_BY_NAME[name] !== undefined ? className(CLASS_ID_BY_NAME[name]!) : name);

/** The role glyphs of mockup F-Live. */
const ROLE_ICON: Record<LiveRole, string> = {
  tank: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z",
  healer: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z",
  dps: "M14.5 4l5.5 5.5-9 9H5.5V13l9-9zM4 20l3-3",
};

export function RoleIcon({ role }: { role: LiveRole }) {
  return (
    <svg className="lv-role-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d={ROLE_ICON[role]} />
    </svg>
  );
}

/** The class tile: initials in the class colour (data from src/wow/classes.ts), tinted from it. */
export function ClassTile({ row }: { row: Pick<LiveRowView, "classColor" | "initials"> }) {
  return <span className="lv-tile" style={{ color: row.classColor }} aria-hidden="true">{row.initials}</span>;
}

interface Props {
  view: LiveView;
  roster: Roster;
  classes: readonly string[];
  sort: LiveSort;
  onSortChange: (v: LiveSort) => void;
  onRolesChange: (v: LiveRole[]) => void;
  onClassesChange: (v: string[]) => void;
  onSelect: (character: string) => void;
}

export function LiveRoster({ view, roster, classes, sort, onSortChange, onRolesChange, onClassesChange, onSelect }: Props) {
  const { t } = useT();
  const applicants = roster.players.filter((pl) => pl.kind === "applicant");
  const sortValue = t("live.panel.sortChip", { value: t(`live.sort.${sort}`) });
  const classValue = t("live.panel.classChip", { value: classes.length === 0 ? t("live.class.all") : classLabel(classes[0]!) });
  return (
    <>
      <section className="lv-chips" aria-label={t("live.panel.title")}>
        <span className="synth-lbl lv-chips-lbl">{t("live.panel.title")}</span>
        {view.roleChips.map((c) => (
          <button
            key={c.value} type="button" className={"lv-chip" + (c.on ? " on" : "")} aria-pressed={c.on}
            onClick={() => onRolesChange(rolesFor(c.value))}
          >
            {c.label}
          </button>
        ))}
        <span className="lv-grow" />
        <ChipMenu
          label={classValue + " ▾"} className={"lv-chip" + (classes.length > 0 ? " on" : "")} head={classValue}
          items={classMenu(t, classLabel, applicants, classes)} onPick={(v) => onClassesChange(v ? [v] : [])}
        />
        <ChipMenu
          label={sortValue + " ▾"} className="lv-chip" head={sortValue}
          items={sortMenu(t, sort)} onPick={(v) => onSortChange(v as LiveSort)}
        />
      </section>
      {view.groups.length > 0 && (
        <section className="card lv-card">
          <div className="lv-row lv-th-row" aria-hidden="true">
            <span>{t("live.panel.columns.candidate")}</span>
            <span>{t("live.panel.columns.spec")}</span>
            <span>{t("live.panel.columns.ilvl")}</span>
            <span>{t("live.panel.columns.rio")}</span>
            <span>{view.columns.verdict}</span>
            <span />
          </div>
          {view.groups.map((g) => (
            <div key={g.role} className="lv-group" role="group" aria-label={g.label}>
              <div className="lv-group-head">
                <RoleIcon role={g.role} />
                <span className="synth-lbl">{g.label}</span>
                <span className="mono lv-group-count">{g.count}</span>
              </div>
              {g.rows.map((r) => <Row key={r.id} row={r} onSelect={onSelect} />)}
            </div>
          ))}
        </section>
      )}
      {view.hidden > 0 && <p className="lv-hidden">{t("live.panel.hidden", { count: view.hidden })}</p>}
    </>
  );
}

function Row({ row: r, onSelect }: { row: LiveRowView; onSelect: (character: string) => void }) {
  const { t } = useT();
  return (
    <div className="lv-row">
      <div className="lv-id">
        <ClassTile row={r} />
        <div className="lv-id-text">
          <strong className="lv-name" style={{ color: r.classColor }}>{r.name}</strong>
          <span className="lv-realm">{r.realm}</span>
        </div>
      </div>
      <div className="lv-meta">
        <span className={"lv-spec" + (r.spec === "—" ? " none" : "")}>{r.spec}</span>
        <span className={"lv-ilvl" + (r.ilvl === "—" ? " none" : "")}>
          <span className="mono">{r.ilvl}</span><span className="lv-unit"> {t("live.panel.columns.ilvl")}</span>
        </span>
        <span className="lv-rio">
          <span className="mono">{r.rio}</span><span className="lv-unit"> {t("live.panel.columns.rio")}</span>
        </span>
        <span className="lv-verdict">
          {r.verdict ? (
            <>
              <span className={"cand-pill " + r.verdict.cls}>
                {r.verdict.label}{r.verdict.score !== null && <span className="mono">{r.verdict.score}</span>}
              </span>
              {r.verdict.spread && <span className="rel-spread mono">{r.verdict.spread}</span>}
              {r.verdict.unproven && <span className="rel-mark" role="img" aria-label={r.verdict.unproven} title={r.verdict.unproven}><Icon name="warn" size={13} /></span>}
              {r.age && <span className="lv-age">{r.age}</span>}
            </>
          ) : (
            <span className="lv-state">{r.state === "queued" ? t("live.panel.queued") : t("live.panel.notVetted")}</span>
          )}
        </span>
      </div>
      <div className="lv-act">
        {r.action && (
          <button
            type="button" className={"btn lv-btn" + (r.action.kind === "evaluate" ? " btn-primary" : "")}
            onClick={() => onSelect(r.character)}
          >
            {r.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
