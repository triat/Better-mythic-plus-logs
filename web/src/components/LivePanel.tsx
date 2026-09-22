import { CLASS_NAMES, classHex, className } from "@shared/wow/classes.ts";
import { useT } from "../locale.tsx";
import type { CachedVerdict, LiveRole, LiveSort, Roster } from "../lib/live/roster.ts";
import { LIVE_ROLES } from "../lib/live/roster.ts";
import { classMenu, panelView, sortMenu } from "../lib/live/panel.ts";
import type { PanelRow } from "../lib/live/panel.ts";
import { ChipMenu } from "./ChipMenu.tsx";

interface Props {
  roster: Roster;
  verdicts: Map<string, CachedVerdict>;
  sort: LiveSort;
  roles: readonly LiveRole[];
  classes: readonly string[];
  onSortChange: (v: LiveSort) => void;
  onRolesChange: (v: LiveRole[]) => void;
  onClassesChange: (v: string[]) => void;
  /** A row click, the Check button, or an armed auto-lookup all resolve to this — the same lookup the search bar runs. */
  onSelect: (character: string) => void;
  auto: boolean;
  /** The member's own WCL client is usable (hosted) or this is local mode — see `App.tsx`'s `autoAllowed`. */
  autoAllowed: boolean;
  onAutoChange: (v: boolean) => void;
  /** Characters the auto queue has already claimed (the in-flight one, plus whatever is waiting behind it). */
  queued: ReadonlySet<string>;
  now: number;
}

/** `DeathKnight` → id 1, `DemonHunter` → id 12 … — the roster's WCL spacing-free names, built once from
 * `CLASS_NAMES` rather than hardcoded, so a new class needs no update here. */
const CLASS_ID_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(CLASS_NAMES).map(([id, name]) => [name.replace(/\s+/g, ""), Number(id)]),
);
const classColor = (name: string): string => classHex(CLASS_ID_BY_NAME[name] ?? -1);
const classLabel = (name: string): string => (CLASS_ID_BY_NAME[name] !== undefined ? className(CLASS_ID_BY_NAME[name]!) : name);

/**
 * The full-width band under the header: the Group Finder roster, one row per applicant then the party
 * under a separator. Design: canvas "Live", variant A. Rendered only while a fresh roster is on screen
 * (`App.tsx` passes `useWowCapture()`'s `roster`, already null once it goes stale).
 */
export function LivePanel(p: Props) {
  const { t } = useT();
  const view = panelView(t, { roster: p.roster, verdicts: p.verdicts, settings: { liveSort: p.sort, liveRoles: p.roles, liveClasses: p.classes }, now: p.now });
  const applicantsForClassMenu = p.roster.players.filter((pl) => pl.kind === "applicant");

  const toggleRole = (role: LiveRole) => {
    const on = p.roles.includes(role);
    p.onRolesChange(on ? p.roles.filter((r) => r !== role) : [...p.roles, role]);
  };

  const row = (r: PanelRow, isParty: boolean, i: number) => {
    const status = r.verdict ? (
      <span className={"badge-sm badge-" + r.verdict.verdict}>
        {t(`verdict.words.${r.verdict.verdict}`)}
        {r.verdict.score !== null && <> <b>{Math.round(r.verdict.score)}</b></>}
      </span>
    ) : isParty ? (
      <span className="faint live-status">{t("live.panel.you")}</span>
    ) : p.queued.has(r.player.character) ? (
      <span className="muted live-status">{t("live.panel.queued")}</span>
    ) : (
      <span className="muted live-status">{t("live.panel.notVetted")}</span>
    );
    const trailing = r.verdict ? (
      <span className="faint live-status">{r.ageLabel}</span>
    ) : !isParty && !p.queued.has(r.player.character) ? (
      <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); p.onSelect(r.player.character); }}>
        {t("live.panel.check")}
      </button>
    ) : (
      <span />
    );
    return (
      <div key={r.player.character} className={"live-row" + (i % 2 === 1 ? " alt" : "")} onClick={() => p.onSelect(r.player.character)}>
        <span className="cls" style={{ background: classColor(r.player.className) }} />
        <span><span className="nm">{r.player.name}</span><span className="faint">-{r.player.realm}</span></span>
        <span className="muted">{t(`live.role.${r.player.role}`)}</span>
        <span className="sc mono">{r.player.score || "—"}</span>
        {status}
        {trailing}
      </div>
    );
  };

  return (
    <div className="live">
      <div className="live-head">
        <span className="section-title">{t("live.panel.title")}</span>
        <span className="muted">{view.countLine}</span>
        <span className="rolefilter">
          {LIVE_ROLES.map((role) => (
            <button key={role} type="button" className={"rf" + (p.roles.includes(role) ? " on" : "")} onClick={() => toggleRole(role)}>
              {t(`live.role.${role}`)}
            </button>
          ))}
        </span>
        <ChipMenu
          // No dedicated "Sort ▾" caption key in the brief's dictionary list (the chip's own value,
          // e.g. "verdict ▾", already says what it is — same minimal style as `regionChipLabel`, which
          // has no "Region ·" prefix either); the menu's head repeats that value rather than a blank one.
          label={t(`live.sort.${p.sort}`) + " ▾"}
          className="chip chip-on"
          head={t(`live.sort.${p.sort}`)}
          items={sortMenu(t, p.sort)}
          onPick={(v) => p.onSortChange(v as LiveSort)}
        />
        <ChipMenu
          label={(p.classes.length === 0 ? t("live.class.all") : classLabel(p.classes[0]!)) + " ▾"}
          className={"chip" + (p.classes.length > 0 ? " chip-on" : "")}
          head={p.classes.length === 0 ? t("live.class.all") : classLabel(p.classes[0]!)}
          items={classMenu(t, classLabel, applicantsForClassMenu, p.classes)}
          onPick={(v) => p.onClassesChange(v ? [v] : [])}
        />
        <span className="grow" />
        <label className={"watch" + (p.auto ? " on" : "") + (p.autoAllowed ? "" : " disabled")} title={t("live.panel.auto")}>
          <input type="checkbox" checked={p.auto} disabled={!p.autoAllowed} onChange={(e) => p.onAutoChange(e.target.checked)} />
          <span className="switch" />
          <span>{t("live.panel.auto")}</span>
        </label>
      </div>
      {!p.autoAllowed && <a className="faint live-auto-guide" href="/help#wcl-client">{t("live.panel.autoNeedsClient")}</a>}
      {view.applicants.map((r, i) => row(r, false, i))}
      {view.party.length > 0 && (
        <>
          <div className="live-sep">{t("live.panel.yourGroup")}<i /></div>
          {view.party.map((r, i) => row(r, true, view.applicants.length + i))}
        </>
      )}
    </div>
  );
}
