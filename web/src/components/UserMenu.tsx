import { useEffect, useRef, useState } from "react";
import { LOCALES, LOCALE_LABELS } from "../lib/locale.ts";
import type { MenuModel } from "../lib/session.ts";
import { pendingText } from "../lib/session.ts";
import { useT } from "../locale.tsx";
import { Avatar } from "./Avatar.tsx";

interface Props { m: MenuModel; pendingProposals: number | null; onOpen: () => void; onSignOut: () => void }

/** Header trigger "[avatar] Name ▾" and its dropdown: identity, quota line + bar, the EN | FR language row, Help, Settings, Admin (admins), Sign out, Privacy. Design: canvas "Hosted", header A; "Phase2SettingsA" for the menu additions; "Locale" (A) for the language row. */
export function UserMenu({ m, pendingProposals, onOpen, onSignOut }: Props) {
  const { t, locale, setLocale } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    onOpen();
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
    // onOpen is read once per opening
  }, [open]);
  const pending = pendingProposals === null ? null : pendingText(pendingProposals);
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className={"btn" + (open ? " active" : "")} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={m.handle}>
        <Avatar src={m.avatarUrl} initials={m.initials} size={24} />{m.name} <span className="faint" style={{ fontSize: 12 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="menu card" role="menu">
          <div className="menu-head">
            <Avatar src={m.avatarUrl} initials={m.initials} size={32} />
            <div className="menu-id"><span className="menu-name">{m.name}</span><span className="faint">{m.handle}</span></div>
          </div>
          <div className="menu-quota" title={m.ownClient ? "Your Warcraft Logs client" : "Your share of the shared Warcraft Logs budget"}>
            <div className="menu-quota-row">
              <span className={"mono " + m.quota.tone}>{m.quota.text}</span>
              {m.quota.sub && <span className="faint">{m.quota.sub}</span>}
            </div>
            {m.quota.pct !== null && <span className="dd-bar" aria-hidden="true"><span style={{ width: `${m.quota.pct}%` }} /></span>}
            {m.guideLink && <a className="menu-guide" href={m.guideLink.href}>{m.guideLink.label}</a>}
          </div>
          <div className="menu-row" role="group" aria-label={t("common.locale.title")}>
            <span className="faint">{t("common.locale.title")}</span>
            <span className="seg" title={t("common.locale.hint")}>
              {LOCALES.map((l) => (
                <button key={l} type="button" className={"seg-item" + (l === locale ? " on" : "")} onClick={() => setLocale(l)} aria-pressed={l === locale}>{LOCALE_LABELS[l]}</button>
              ))}
            </span>
          </div>
          <div className="menu-sep" />
          <a className="menu-item" href="/help" role="menuitem">{t("common.help")}</a>
          <a className="menu-item" href="/settings" role="menuitem">{t("common.settings")}</a>
          {m.isAdmin && <a className="menu-item" href="/admin" role="menuitem">{t("common.admin")}{pending && <span className="faint">· {pending}</span>}</a>}
          <button type="button" className="menu-item" role="menuitem" onClick={onSignOut}>{t("common.signOut")}</button>
          <div className="menu-sep" />
          <a className="menu-foot faint" href="/privacy">{t("common.privacy")}</a>
        </div>
      )}
    </div>
  );
}
