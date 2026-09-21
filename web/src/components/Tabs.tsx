import { classHex, className } from "@shared/wow/classes.ts";
import type { HistoryItem, Region } from "../types.ts";
import { MAX_COMPARE, tabLevel, tabSubtitle } from "../lib/history.ts";
import { fmtAge } from "../lib/format.ts";
import { useT } from "../locale.tsx";

interface Props {
  items: HistoryItem[];
  activeKey: string | null;
  selected: string[];
  compareOpen: boolean;
  onSelectTab: (key: string) => void;
  onToggle: (key: string) => void;
  onClose: (key: string) => void;
  onClearAll: () => void;
  onCompare: () => void;
  onRefresh: () => void;
  fetchedAt: number | null;
  fromCache: boolean;
  /** The instance default: a tab names its region only when it differs. */
  region: Region;
}

export function Tabs(p: Props) {
  const { t } = useT();
  if (p.items.length === 0) return null;
  const n = p.items.length;
  return (
    <div className="tabs">
      <div className="tab-strip" role="tablist">
        {p.items.map((item) => {
          const active = item.key === p.activeKey && !p.compareOpen;
          const checked = p.selected.includes(item.key);
          return (
            <div
              key={item.key}
              className={"tab" + (active ? " active" : "")}
              onClick={() => p.onSelectTab(item.key)}
              role="tab"
              aria-selected={active}
              title={`${item.label} · ${className(item.charClass)} · ${tabSubtitle(t, item, p.region)}`}
            >
              <button
                type="button"
                className={"tab-check" + (checked ? " checked" : "")}
                title={t("tabs.compare")}
                aria-label={t("tabs.compare")}
                onClick={(e) => { e.stopPropagation(); p.onToggle(item.key); }}
              >
                {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
              </button>
              <span className="tab-title" style={{ color: classHex(item.charClass) }}>{item.label.split("-")[0]}</span>
              <span className="tab-level mono">{tabLevel(item, p.region)}</span>
              <button type="button" className="tab-close" title={t("tabs.close")} aria-label={t("tabs.close")} onClick={(e) => { e.stopPropagation(); p.onClose(item.key); }}>×</button>
            </div>
          );
        })}
      </div>
      <div className="tab-toolbar">
        <span className="muted tab-meta">
          {t("tabs.profiles", { n })}
          {p.selected.length > 0 ? t("tabs.selected", { n: p.selected.length }) : ""}
          {p.fetchedAt !== null && !p.compareOpen
            ? t("tabs.fetched", { age: fmtAge(t, p.fetchedAt) }) + (p.fromCache ? t("tabs.cached") : "")
            : ""}
        </span>
        <div className="grow" />
        <button className="btn" onClick={p.onRefresh} disabled={!p.activeKey || p.compareOpen} title={t("tabs.refreshTitle")}>{t("tabs.refresh")}</button>
        <button className={"btn" + (p.selected.length >= 2 ? " btn-primary" : "")} onClick={p.onCompare} disabled={p.selected.length < 2}>
          {t("tabs.compareBtn", { sel: p.selected.length, max: MAX_COMPARE })}
        </button>
        <button className="btn" onClick={p.onClearAll} title={t("tabs.closeAll")}>{t("tabs.clear", { n })}</button>
      </div>
    </div>
  );
}
