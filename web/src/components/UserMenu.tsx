import { useEffect, useRef, useState } from "react";
import type { MenuModel } from "../lib/session.ts";
import { pendingText } from "../lib/session.ts";

interface Props { m: MenuModel; pendingProposals: number | null; onOpen: () => void; onSignOut: () => void }

/** Header trigger "[avatar] Name ▾" and its dropdown: identity, quota line + bar, Admin (admins), Sign out. Design: canvas "Hosted", header A. */
export function UserMenu({ m, pendingProposals, onOpen, onSignOut }: Props) {
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
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- onOpen is read once per opening
  const pending = pendingProposals === null ? null : pendingText(pendingProposals);
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className={"btn" + (open ? " active" : "")} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={m.handle}>
        <Avatar m={m} size={24} />{m.name} <span className="faint" style={{ fontSize: 12 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="menu card" role="menu">
          <div className="menu-head">
            <Avatar m={m} size={32} />
            <div className="menu-id"><span className="menu-name">{m.name}</span><span className="faint">{m.handle}</span></div>
          </div>
          <div className="menu-quota" title="Your share of the shared Warcraft Logs budget">
            <div className="menu-quota-row">
              <span className={"mono " + m.quota.tone}>{m.quota.text}</span>
              {m.quota.sub && <span className="faint">{m.quota.sub}</span>}
            </div>
            {m.quota.pct !== null && <span className="dd-bar" aria-hidden="true"><span style={{ width: `${m.quota.pct}%` }} /></span>}
          </div>
          <div className="menu-sep" />
          {m.isAdmin && <a className="menu-item" href="/admin" role="menuitem">Admin{pending && <span className="faint">· {pending}</span>}</a>}
          <button type="button" className="menu-item" role="menuitem" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function Avatar({ m, size }: { m: MenuModel; size: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="avatar" style={{ width: size, height: size, fontSize: size > 24 ? 13 : 11 }}>{m.initials}</span>;
  return <img className="avatar" src={m.avatarUrl} width={size} height={size} alt="" onError={() => setBroken(true)} />;
}
