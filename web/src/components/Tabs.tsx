import { classHex, className } from "@shared/wow/classes.ts";
import type { HistoryItem, Region } from "../types.ts";
import { MAX_COMPARE, tabLevel, tabSubtitle } from "../lib/history.ts";
import { fmtAge } from "../lib/format.ts";

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
  if (p.items.length === 0) return null;
  const n = p.items.length;
  return (
    <div className="tabs">
      <div className="tab-strip" role="tablist">
        {p.items.map((t) => {
          const active = t.key === p.activeKey && !p.compareOpen;
          const checked = p.selected.includes(t.key);
          return (
            <div
              key={t.key}
              className={"tab" + (active ? " active" : "")}
              onClick={() => p.onSelectTab(t.key)}
              role="tab"
              aria-selected={active}
              title={`${t.label} · ${className(t.charClass)} · ${tabSubtitle(t, p.region)}`}
            >
              <button
                type="button"
                className={"tab-check" + (checked ? " checked" : "")}
                title="Select for compare"
                aria-label="Select for compare"
                onClick={(e) => { e.stopPropagation(); p.onToggle(t.key); }}
              >
                {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
              </button>
              <span className="tab-title" style={{ color: classHex(t.charClass) }}>{t.label.split("-")[0]}</span>
              <span className="tab-level mono">{tabLevel(t, p.region)}</span>
              <button type="button" className="tab-close" title="Close tab" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); p.onClose(t.key); }}>×</button>
            </div>
          );
        })}
      </div>
      <div className="tab-toolbar">
        <span className="muted tab-meta">
          {n} profile{n === 1 ? "" : "s"}{p.selected.length > 0 ? ` · ${p.selected.length} selected` : ""}
          {p.fetchedAt !== null && !p.compareOpen && <> · fetched {fmtAge(p.fetchedAt)}{p.fromCache ? " · cached · 0 API pts" : ""}</>}
        </span>
        <div className="grow" />
        <button className="btn" onClick={p.onRefresh} disabled={!p.activeKey || p.compareOpen} title="Re-fetch the active tab">↻ Refresh</button>
        <button className={"btn" + (p.selected.length >= 2 ? " btn-primary" : "")} onClick={p.onCompare} disabled={p.selected.length < 2}>
          Compare ({p.selected.length}/{MAX_COMPARE})
        </button>
        <button className="btn" onClick={p.onClearAll} title="Close all tabs">Clear {n}</button>
      </div>
    </div>
  );
}
