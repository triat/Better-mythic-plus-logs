import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { UsageCategory, UsagePeriod, UsageReport } from "../../types.ts";
import { usageCards, usageChips, usageIsEmpty, usageKpis, usageTable } from "../../lib/admin.ts";
import type { UsageRowModel, UsageView } from "../../lib/admin.ts";
import { useT } from "../../locale.tsx";

const PERIODS: readonly UsagePeriod[] = [7, 30, 90];
const VIEWS: readonly UsageView[] = ["table", "categories"];
/** The table/categories choice is a per-browser convenience, not a setting: it may be missing or throw. */
const VIEW_KEY = "bmpl.adminUsageView";
const readView = (): UsageView => { try { return localStorage.getItem(VIEW_KEY) === "categories" ? "categories" : "table"; } catch { return "table"; } };
const writeView = (v: UsageView): void => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } };

/** Feature usage (canvas "usage", A + B): one header with the period, the admin filter and a Table / Categories switch.
 * Owns its data like `Audit` (GET /api/admin/features, 0 WCL pts). */
export function Usage() {
  const { t } = useT();
  const [days, setDays] = useState<UsagePeriod>(30);
  const [admins, setAdmins] = useState(false);
  const [view, setView] = useState<UsageView>(readView);
  const [category, setCategory] = useState<UsageCategory | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.admin.features(days, admins).then((r) => {
      if (!live) return;
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      setReport(r);
    });
    return () => { live = false; };
  }, [days, admins]);
  const pickView = (v: UsageView) => { setView(v); writeView(v); };
  const toggle = (event: string) => setOpen((o) => (o === event ? null : event));

  const head = (
    <>
      <div className="admin-section-head usage-head">
        <span style={{ fontWeight: 600 }}>{t("admin.usage.title")}</span>
        <span className="muted">{t("admin.usage.sub")}</span>
        <div className="grow" />
        <span className="seg">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={"seg-item" + (p === days ? " on" : "")} aria-pressed={p === days} onClick={() => setDays(p)}>{t("admin.usage.period", { n: p })}</button>
          ))}
        </span>
        <span className="seg">
          {VIEWS.map((v) => (
            <button key={v} type="button" className={"seg-item" + (v === view ? " on" : "")} aria-pressed={v === view} onClick={() => pickView(v)}>{t(`admin.usage.view.${v}`)}</button>
          ))}
        </span>
        <label className={"sw" + (admins ? " on" : "")}>
          <input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} />
          <span className="sw-track"><span className="sw-knob" /></span>
          <span>{t("admin.usage.includeAdmins")}</span>
        </label>
      </div>
      {report && (
        <div className="usage-kpis">
          {usageKpis(t, report).map((k) => (
            <div key={k.key} className="inset usage-kpi">
              <span className="label-caps">{k.label}</span>
              <span className={"usage-kpi-value" + (k.warn ? " warn" : "")}>{k.value}</span>
              <span className="faint">{k.sub}</span>
            </div>
          ))}
        </div>
      )}
      {error && <div className="faint" style={{ fontSize: 12 }}>{error}</div>}
    </>
  );

  if (!report || usageIsEmpty(report)) {
    return (
      <section id="usage" className="card admin-section usage">
        {head}
        {report && <div className="inset usage-empty muted">{t("admin.usage.empty", { days })}</div>}
      </section>
    );
  }

  if (view === "categories") {
    return (
      <section id="usage" className="admin-section usage">
        <div className="card admin-section">{head}</div>
        <div className="usage-cards">
          {usageCards(t, report).map((c) => (
            <div key={c.key} className="card usage-card">
              <div className="usage-card-head"><span className="section-title">{c.title}</span><span className="faint">{c.sub}</span></div>
              {c.lines.map(({ row, value }) => (
                <div key={row.event}>
                  <button type="button" className={"usage-line" + (row.unused ? " usage-unused" : "")} aria-expanded={open === row.event} onClick={() => toggle(row.event)}>
                    <span className="mono">{row.event}</span>
                    <span className="gauge-bar usage-bar" aria-hidden="true"><span style={{ width: `${row.sharePct}%` }} /></span>
                    <span className={"usage-line-value" + (row.unused ? " unused" : "")}>{value}</span>
                  </button>
                  {open === row.event && !row.unused && <TopMembers row={row} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const table = usageTable(t, report, category);
  return (
    <section id="usage" className="card admin-section usage">
      {head}
      <div className="usage-chips">
        {usageChips(t, report).map((c) => (
          <button key={c.key} type="button" className={"chip" + (category === c.key ? " chip-on" : "")} onClick={() => setCategory(c.key)}>{c.label} · {c.count}</button>
        ))}
      </div>
      <div className="admin-row admin-row-head admin-row-usage label-caps">
        <span>{t("admin.usage.head.feature")}</span><span>{t("admin.usage.head.category")}</span><span>{t("admin.usage.head.source")}</span>
        <span>{t("admin.usage.head.share")}</span><span>{t("admin.usage.head.members")}</span><span>{t("admin.usage.head.uses")}</span>
        <span>{t("admin.usage.head.last")}</span><span>{t("admin.usage.head.trend", { days })}</span>
      </div>
      {table.used.map((r) => <UsageRow key={r.event} row={r} open={open === r.event} onToggle={() => toggle(r.event)} />)}
      {table.unused.length > 0 && <div className="usage-day">{t("admin.usage.notUsed", { days, n: table.unused.length })}</div>}
      {table.unused.map((r) => <UsageRow key={r.event} row={r} open={false} onToggle={() => {}} />)}
      <div className="faint" style={{ fontSize: 12 }}>{t("admin.usage.foot")}</div>
    </section>
  );
}

function UsageRow({ row, open, onToggle }: { row: UsageRowModel; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button type="button" className={"inset admin-row admin-row-usage usage-row" + (row.unused ? " usage-unused" : "")} aria-expanded={row.unused ? undefined : open} disabled={row.unused} onClick={onToggle}>
        <span className="mono" style={{ fontSize: 12 }}>{row.event}</span>
        <span className="muted">{row.category}</span>
        <span><span className="usage-src">{row.source}</span></span>
        <span className="usage-share"><span className="gauge-bar usage-bar" aria-hidden="true"><span style={{ width: `${row.sharePct}%` }} /></span><span className="mono" style={{ fontSize: 12 }}>{row.sharePct} %</span></span>
        <span className="mono">{row.users}</span>
        <span className="mono">{row.uses}</span>
        <span className="faint">{row.last}</span>
        <span className="spark" aria-hidden="true">{row.spark.map((b, i) => <i key={i} className={b.pct === 0 ? "z" : undefined} style={b.pct === 0 ? undefined : { height: `${b.pct}%` }} title={b.title} />)}</span>
      </button>
      {open && <TopMembers row={row} />}
    </>
  );
}

function TopMembers({ row }: { row: UsageRowModel }) {
  return (
    <div className="inset usage-top">
      <div className="label-caps" style={{ marginBottom: 4 }}>{row.topTitle}</div>
      {row.top.map((u) => (
        <div key={u.userId} className="usage-top-row">
          <span className="avatar" style={{ width: 24, height: 24, fontSize: 11 }}>{u.initials}</span>
          <span className="usage-top-name">{u.name}</span>
          <span className="mono usage-top-uses">{u.uses}</span>
          <span className="faint">{u.last}</span>
        </div>
      ))}
      <div className="faint" style={{ fontSize: 12 }}>{row.topTotal}</div>
    </div>
  );
}
