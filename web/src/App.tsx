import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { HistoryItem, LookupPayload, LookupRequest } from "./types.ts";
import { pruneSelection, toggleSelection } from "./lib/history.ts";
import { useSse } from "./useSse.ts";
import { Compare } from "./components/Compare.tsx";
import { Detail } from "./components/Detail.tsx";
import { EMPTY_FORM, Header } from "./components/Header.tsx";
import type { LookupForm } from "./components/Header.tsx";
import { Home } from "./components/Home.tsx";
import { Setup } from "./components/Setup.tsx";
import { Tabs } from "./components/Tabs.tsx";
import { Toast } from "./components/Toast.tsx";

type Screen =
  | { kind: "loading" }
  | { kind: "setup"; envPath: string; hasCredentials: boolean }
  | { kind: "main"; envPath: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  useEffect(() => {
    api.status().then((s) => {
      if (!s.ok) { setScreen({ kind: "main", envPath: "" }); return; }
      const wantSetup = !s.hasCredentials || location.pathname === "/setup";
      setScreen(wantSetup ? { kind: "setup", envPath: s.envPath, hasCredentials: s.hasCredentials } : { kind: "main", envPath: s.envPath });
    });
  }, []);
  if (screen.kind === "loading") return <div className="muted" style={{ padding: 24 }}><span className="spinner" /> loading…</div>;
  if (screen.kind === "setup") {
    return <Setup envPath={screen.envPath} hasCredentials={screen.hasCredentials} onDone={() => { history.replaceState({}, "", "/"); setScreen({ kind: "main", envPath: screen.envPath }); }} />;
  }
  return <Main envPath={screen.envPath} onSetup={() => { history.pushState({}, "", "/setup"); setScreen({ kind: "setup", envPath: screen.envPath, hasCredentials: true }); }} />;
}

const formToRequest = (f: LookupForm): LookupRequest => ({
  character: f.character.trim(),
  level: f.level || null,
  spec: f.spec.trim() || null,
  metric: f.metric || null,
});

function Main({ envPath, onSetup }: { envPath: string; onSetup: () => void }) {
  const [form, setForm] = useState<LookupForm>(EMPTY_FORM);
  const [tabs, setTabs] = useState<HistoryItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [fromCache, setFromCache] = useState(false);
  const [watch, setWatch] = useState<{ active: boolean; label: string | null }>({ active: false, label: null });
  const [stopped, setStopped] = useState(false);
  const payloads = useRef(new Map<string, LookupPayload>());
  // Re-render trigger for the payload cache (a ref does not re-render on its own).
  const [, bump] = useState(0);
  const touch = () => bump((n) => n + 1);

  const loadHistory = useCallback(async (): Promise<HistoryItem[]> => {
    const r = await api.history();
    if (!r.ok) return [];
    setTabs(r.items);
    setSelected((s) => pruneSelection(s, r.items.map((i) => i.key)));
    return r.items;
  }, []);

  /** On a 404 (server restarted / key evicted), `items` is the fresh (already reloaded) tab list. */
  const fetchPayload = useCallback(async (key: string): Promise<{ payload: LookupPayload | null; items: HistoryItem[] | null }> => {
    const cached = payloads.current.get(key);
    if (cached) return { payload: cached, items: null };
    const r = await api.historyEntry(key);
    if (!r.ok) {
      // Server restarted or key evicted: drop the stale tab.
      const items = await loadHistory();
      setToast(r.error);
      return { payload: null, items };
    }
    payloads.current.set(key, r.result);
    touch();
    return { payload: r.result, items: null };
  }, [loadHistory]);

  const showTab = useCallback(async (key: string) => {
    setCompareOpen(false);
    setActiveKey(key);
    setFromCache(true);
    const { payload, items } = await fetchPayload(key);
    if (payload === null) {
      // The failed key is gone from `items` (loadHistory reflects the server's current
      // history). Fall back to the first remaining tab, once — if that also fails,
      // leave `activeKey` null rather than recursing further.
      const fallback = items?.[0]?.key ?? null;
      if (!fallback) {
        setActiveKey((cur) => (cur === key ? null : cur));
        return;
      }
      setActiveKey((cur) => (cur === key ? fallback : cur));
      const { payload: fallbackPayload } = await fetchPayload(fallback);
      if (fallbackPayload === null) {
        setActiveKey((cur) => (cur === fallback ? null : cur));
      }
    }
  }, [fetchPayload]);

  // Boot: history → most recent tab.
  useEffect(() => {
    loadHistory().then((items) => { if (items.length > 0) void showTab(items[0]!.key); });
  }, [loadHistory, showTab]);

  const runLookup = useCallback(async (req: LookupRequest, refresh: boolean) => {
    setBusy(`${refresh ? "refreshing" : "looking up"} ${req.character}…`);
    setCompareOpen(false);
    const r = await api.lookup({ ...req, refresh });
    setBusy(null);
    if (!r.ok) { setToast(r.error); return; }
    payloads.current.set(r.key, r.result);
    setFromCache(r.fromCache);
    setActiveKey(r.key);
    touch();
    await loadHistory();
  }, [loadHistory]);

  const onLookup = () => void runLookup(formToRequest(form), false);
  const onRefresh = () => {
    const t = tabs.find((x) => x.key === activeKey);
    if (t) void runLookup(t.request, true);
  };

  const closeTab = async (key: string) => {
    await api.removeHistory(key);
    payloads.current.delete(key);
    const items = await loadHistory();
    if (activeKey === key) {
      const next = items[0]?.key ?? null;
      setActiveKey(next);
      if (next) void showTab(next);
    }
    if (selected.filter((k) => k !== key).length < 2) setCompareOpen(false);
  };

  const clearAll = async () => {
    if (!window.confirm(`Close all ${tabs.length} tabs?`)) return;
    await api.clearHistory();
    payloads.current.clear();
    setActiveKey(null);
    setSelected([]);
    setCompareOpen(false);
    await loadHistory();
  };

  const sseConnected = useSse({
    status: (s) => setWatch({ active: s.active, label: s.backend }),
    searching: (d) => setWatch((w) => ({ ...w, label: `looking up ${d.character}…` })),
    result: async (d) => { await loadHistory(); await showTab(d.key); setFromCache(d.fromCache); },
    error: (d) => setToast(d.message),
  });

  const onWatchToggle = async (wanted: boolean) => {
    const r = wanted ? await api.watchStart({ level: form.level || null, spec: form.spec || null, metric: form.metric || null }) : await api.watchStop();
    if (!r.ok) setToast(r.error);
    // The `status` SSE event is the source of truth for the toggle.
  };

  const onQuit = async () => {
    if (!window.confirm("Quit bmpl? The server will stop and this page will no longer work.")) return;
    await api.quit();
    setStopped(true);
  };

  if (stopped) return <main className="stopped"><h2>bmpl stopped</h2><p className="muted">You can close this tab.</p></main>;

  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;
  const activePayload = activeKey ? payloads.current.get(activeKey) ?? null : null;
  const empty = tabs.length === 0;

  return (
    <>
      <Header
        form={form} onChange={setForm} onLookup={onLookup} busy={busy}
        watchActive={watch.active} watchLabel={watch.label} onWatchToggle={onWatchToggle}
        sseConnected={sseConnected} onSetup={onSetup} onQuit={onQuit} hero={empty}
      />
      <Tabs
        items={tabs} activeKey={activeKey} selected={selected} compareOpen={compareOpen}
        onSelectTab={(k) => void showTab(k)} onToggle={(k) => setSelected((s) => toggleSelection(s, k))}
        onClose={(k) => void closeTab(k)} onClearAll={() => void clearAll()} onCompare={() => setCompareOpen(true)}
        onRefresh={onRefresh} fetchedAt={activeTab?.fetchedAt ?? null} fromCache={fromCache}
      />
      <main className="content">
        {empty && <Home envPath={envPath} />}
        {!empty && !compareOpen && activePayload && (
          <Detail payload={activePayload} fetchedAt={activeTab?.fetchedAt ?? null} fromCache={fromCache} onRefresh={onRefresh} />
        )}
        {!empty && !compareOpen && !activePayload && activeKey && <div className="muted"><span className="spinner" /> loading…</div>}
        {compareOpen && (
          <CompareLoader keys={selected} tabs={tabs} fetchPayload={fetchPayload} cache={payloads.current} onJump={(k) => void showTab(k)} />
        )}
      </main>
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}

function CompareLoader(p: {
  keys: string[];
  tabs: HistoryItem[];
  cache: Map<string, LookupPayload>;
  fetchPayload: (key: string) => Promise<{ payload: LookupPayload | null; items: HistoryItem[] | null }>;
  onJump: (key: string) => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all(p.keys.map((k) => p.fetchPayload(k))).then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, [p.keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = p.keys
    .map((k) => ({ item: p.tabs.find((t) => t.key === k), payload: p.cache.get(k) }))
    .filter((e): e is { item: HistoryItem; payload: LookupPayload } => !!e.item && !!e.payload);
  if (entries.length < 2) return <div className="muted"><span className="spinner" /> building compare view…</div>;
  return <Compare entries={entries} onJump={p.onJump} />;
}
