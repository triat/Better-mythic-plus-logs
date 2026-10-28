import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { AdminAudit, AuditKind, AuditRow } from "../../types.ts";
import { AUDIT_DEFAULT_SIZE, AUDIT_PAGE_SIZES, type AuditPageSize, auditChips, auditFooter, auditRow } from "../../lib/admin.ts";
import { useT } from "../../locale.tsx";
import { Icon } from "../Icon.tsx";
import { Pager } from "./Pager.tsx";

interface Props {
  kind: AuditKind | "all";
  onKind: (kind: AuditKind | "all") => void;
}

const NO_COUNTS: AdminAudit["counts"] = { all: 0, login: 0, admin: 0, quota: 0, security: 0, error: 0 };
/** The search waits this long after the last key before it asks the server. */
const SEARCH_DELAY_MS = 300;

/**
 * The audit log (canvas A, then "bmpl · Admin listes" A): kind chips with totals, a member search ("who or target") and
 * 10 / 20 / 50 rows per page, newest first, numbered pages. Owns its data (0 WCL pts).
 */
export function Audit({ kind, onKind }: Props) {
  const { t } = useT();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [counts, setCounts] = useState<AdminAudit["counts"]>(NO_COUNTS);
  const [total, setTotal] = useState(0);
  const [size, setSize] = useState<AuditPageSize>(AUDIT_DEFAULT_SIZE);
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => { setQuery(typed.trim()); setPage(1); }, SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [typed]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    void api.admin.audit({ kind, offset: (page - 1) * size, limit: size, q: query }).then((r) => {
      if (!live) return;
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      setRows(r.rows);
      setCounts(r.counts);
      setTotal(r.total);
    });
    return () => { live = false; };
  }, [kind, page, size, query]);
  const pick = (k: AuditKind | "all") => { setPage(1); onKind(k); };
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <section id="audit" className="card admin-section">
      <div className="admin-section-head">
        <span style={{ fontWeight: 600 }}>{t("admin.audit.title")}</span>
        <span className="muted">{t("admin.audit.sub")}</span>
        <div className="grow" />
        {auditChips(t).map((c) => (
          <button
            key={c.kind} type="button" className={"chip" + (kind === c.kind ? " chip-on" : "")}
            onClick={() => pick(c.kind)}
          >
            {c.label} · {counts[c.kind]}
          </button>
        ))}
      </div>
      <div className="admin-tools">
        <label className="admin-search">
          <Icon name="search" size={14} />
          <input type="search" value={typed} placeholder={t("admin.audit.search")} aria-label={t("admin.audit.searchLabel")} onChange={(e) => setTyped(e.target.value)} />
        </label>
        <span className="faint">{t("admin.audit.searchHint")}</span>
        <div className="grow" />
        <span className="muted">{t("admin.audit.rows")}</span>
        <span className="seg">
          {AUDIT_PAGE_SIZES.map((n) => (
            <button
              key={n} type="button" className={"seg-item" + (n === size ? " on" : "")} aria-pressed={n === size}
              title={t("admin.audit.rowsLabel")} onClick={() => { setSize(n); setPage(1); }}
            >
              {n}
            </button>
          ))}
        </span>
      </div>
      <div className="admin-row admin-row-head admin-row-audit label-caps">
        <span>{t("admin.audit.head.time")}</span><span>{t("admin.audit.head.who")}</span><span>{t("admin.audit.head.action")}</span><span>{t("admin.audit.head.target")}</span><span>{t("admin.audit.head.detail")}</span>
      </div>
      {rows.length === 0 && !busy && !error && <div className="faint" style={{ fontSize: 13 }}>{t("admin.audit.empty")}</div>}
      {rows.map((row) => {
        const r = auditRow(t, row);
        return (
          <div key={r.id} className="inset admin-row admin-row-audit">
            <span className="mono faint" title={r.timeTitle}>{r.time}</span>
            <span className={r.whoFaint ? "faint" : undefined}>{r.who}</span>
            <span><span className={`dot ${r.dot}`} /><span className="mono" style={{ fontSize: 12 }}>{r.action}</span></span>
            <span className="text-soft" title={r.target}>{r.target}</span>
            <span className="faint">{r.detail}</span>
          </div>
        );
      })}
      {error && <div className="faint" style={{ fontSize: 12 }}>{error}</div>}
      <div className="pager-row">
        <span className="faint">{auditFooter(t, page, size, total, query)}</span>
        <div className="grow" />
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
    </section>
  );
}
