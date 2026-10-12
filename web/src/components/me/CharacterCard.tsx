import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MyCharacter } from "../../types.ts";
import { charKey, menuStep, type CharAction, type CharCard, type CharCompact, type CharMenuItem } from "../../lib/characters.ts";
import { syncProgress } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { useSeason, type SeasonState } from "../../useSeason.ts";
import { Around } from "../Around.tsx";
import { Icon } from "../Icon.tsx";
import type { SelfActions } from "../owner/types.ts";

/**
 * Loads one character's season (`GET /api/season`, 0 pts) through `useSeason` and hands its state to the page, which
 * groups the characters once every answer is in. Renders nothing; the sync it holds starts only from a click.
 */
export function SeasonProbe({ c, self, onState }: { c: MyCharacter; self: SelfActions; onState: (key: string, s: SeasonState | null) => void }) {
  const s = useSeason({ name: c.name, realm: c.realm, region: c.region, level: null }, self);
  const key = charKey(c);
  useEffect(() => { onState(key, s); }, [key, s.view, s.loading, s.failed, s.running, s.progress, s.error, s.start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onState(key, null), [key, onState]);
  return null;
}

/** The "⋯" menu (mockup F-Persos): ↑↓ Home End move, Escape or a click outside closes, focus returns to the button. */
function CharMenu({ charKey: key, name, items, onPick }: { charKey: string; name: string; items: CharMenuItem[]; onPick: (a: CharAction) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const focusItem = (i: number) => ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]")[i]?.focus();
  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const next = menuStep(e.key, all.indexOf(document.activeElement as HTMLButtonElement), all.length);
    if (next !== null) { e.preventDefault(); focusItem(next); }
  };
  if (items.length === 0) return null;
  return (
    <div className="chars-more" ref={ref} onKeyDown={open ? onKey : undefined}>
      <button
        ref={button} type="button" className="btn chars-ico" data-char-more={key} aria-haspopup="menu" aria-expanded={open}
        aria-label={t("chars.moreFor", { name })} title={t("chars.more")} onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div className="menu card chars-menu" role="menu" aria-label={t("chars.moreFor", { name })}>
          {items.map((m) => (
            <button
              key={m.action} type="button" role="menuitem" className={"menu-item" + (m.danger ? " chars-danger" : "")}
              onClick={() => { close(); onPick(m.action); }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Today's remove confirmation (canvas MeDetails): the cached runs stay, only the link to the member goes. */
function RemoveConfirm({ name, onRemove, onKeep }: { name: string; onRemove: () => void; onKeep: () => void }) {
  const { t } = useT();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { keep.current?.focus(); }, []);
  return (
    <div className="me-confirm chars-confirm" role="alertdialog" aria-label={t("me.remove")}>
      <span><Around message={t("me.removeConfirm")} params={{ name: <b>{name}</b> }} /></span>
      <div className="grow" />
      <button type="button" className="btn btn-danger" onClick={onRemove}>{t("me.remove")}</button>
      <button ref={keep} type="button" className="btn" onClick={onKeep}>{t("me.keep")}</button>
    </div>
  );
}

const Badge = ({ initials, color, big }: { initials: string; color: string | null; big?: boolean }) => (
  <span className={"chars-badge" + (big ? " chars-badge-big" : "")} style={color ? { color } : undefined} aria-hidden="true">{initials}</span>
);

/** The sync with its cost on the button (pressing it is the confirmation); progress and Cancel while it runs. */
function CardSync({ card, season }: { card: CharCard; season: SeasonState | undefined }) {
  const { t } = useT();
  if (season?.running && season.progress) {
    return (
      <>
        <span className="muted chars-small">{syncProgress(t, season.progress)}</span>
        <button type="button" className="btn" onClick={season.stop}>{t("self.sync.cancel")}</button>
      </>
    );
  }
  return (
    <>
      {card.noClient && <a className="chars-small" href="/settings">{t("self.sync.addClient")}</a>}
      {card.sync && season && <button type="button" className="btn" onClick={() => void season.start()}>{card.sync}</button>}
      {season?.error && <span className="tone-bad chars-small">{t("self.sync.stopped", { error: season.error })}</span>}
    </>
  );
}

export function CharacterCard({ card, season, removing, onAction, onRemove, onKeep }: {
  card: CharCard; season: SeasonState | undefined; removing: boolean;
  onAction: (a: CharAction) => void; onRemove: () => void; onKeep: () => void;
}) {
  const { t } = useT();
  return (
    <article className={"card chars-card" + (card.main ? " chars-card-main" : "")} data-char={card.key}>
      <div className="chars-card-head">
        <Badge initials={card.initials} color={card.classColor} big />
        <div className="chars-who">
          <div className="chars-name-row">
            <span className="chars-name" style={card.classColor ? { color: card.classColor } : undefined}>{card.name}</span>
            {card.main && <span className="chars-main">{t("chars.main")}</span>}
          </div>
          <span className="chars-sub">{card.sub}</span>
        </div>
        <span className="chars-global mono">{t("chars.global")}<b>{card.global}</b></span>
      </div>
      <div className="chars-bars">
        {card.bars.map((b) => (
          <div key={b.key} className="chars-bar-row">
            <span className="chars-bar-label">{b.label}</span>
            <span className={"chars-bar chars-band-" + b.band} aria-hidden="true">
              {b.value !== null && <span className="chars-bar-fill" style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />}
              <span className="chars-bar-tick" />
            </span>
            <span className={"chars-bar-value mono chars-band-" + b.band}>{b.text}</span>
          </div>
        ))}
      </div>
      <div className="chars-lines">
        <span className="muted">{card.line}</span>
        <span className={"chars-note-" + card.note.tone} title={card.note.hint ?? undefined}>{card.note.text}</span>
        {card.status && <span className="tone-bad chars-small" role="status">{card.status}</span>}
      </div>
      {removing ? <RemoveConfirm name={card.name} onRemove={onRemove} onKeep={onKeep} /> : (
        <div className="chars-actions">
          <a className="btn btn-primary" href={card.open.href} title={card.open.hint}>{card.open.label}</a>
          <CardSync card={card} season={season} />
          <a className="btn" href={card.rio} target="_blank" rel="noreferrer">{t("chars.rio")}</a>
          <CharMenu charKey={card.key} name={card.name} items={card.menu} onPick={onAction} />
        </div>
      )}
    </article>
  );
}

/** "No season yet": initials tile, name, realm, Open or Look up (the latter only fills the search field), "⋯". */
export function CharacterRow({ row, removing, onAction, onRemove, onKeep }: {
  row: CharCompact; removing: boolean; onAction: (a: CharAction) => void; onRemove: () => void; onKeep: () => void;
}) {
  const { t } = useT();
  if (removing) return <div className="chars-row-confirm"><RemoveConfirm name={row.name} onRemove={onRemove} onKeep={onKeep} /></div>;
  return (
    <div className="card chars-row" data-char={row.key}>
      <Badge initials={row.initials} color={row.classColor} />
      <div className="chars-who">
        <span className="chars-row-name" style={row.classColor ? { color: row.classColor } : undefined}>
          {row.name}{row.main && <span className="chars-main">{t("chars.main")}</span>}
        </span>
        <span className="chars-sub">{row.realm}</span>
        {row.status && <span className="chars-small muted" role="status">{row.status}</span>}
      </div>
      <a className="btn" href={row.search.href} title={row.search.hint}>{row.search.label}</a>
      <CharMenu charKey={row.key} name={row.name} items={row.menu} onPick={onAction} />
    </div>
  );
}
