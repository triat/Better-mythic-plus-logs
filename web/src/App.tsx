import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { MeUser, QuotaInfo } from "./api.ts";
import type { HistoryItem, LookupPayload, LookupRequest, OverrideEntry, OwnClientView } from "./types.ts";
import { POINTS_PER_RUN, unanalyzedRuns } from "./lib/deepdive.ts";
import { pruneSelection, toggleSelection } from "./lib/history.ts";
import { canAfford, quotaTooltip } from "./lib/quota.ts";
import { menuModel } from "./lib/session.ts";
import { reevalHint } from "./lib/keyLevel.ts";
import { LOCAL_STATUS, accountAccess, adminAccess, bootScreen, deniedNotice, loginFailed, pageOf, proposalMode, signInNote, uiControls } from "./lib/hostedMode.ts";
import type { StatusInfo } from "./lib/hostedMode.ts";
import { parseServerSettings } from "./lib/settings.ts";
import type { Settings } from "./lib/settings.ts";
import { SettingsProvider, useSettings } from "./settings.tsx";
import { useSse } from "./useSse.ts";
import { PrivacyPage } from "./components/account/PrivacyPage.tsx";
import { SettingsPage } from "./components/account/SettingsPage.tsx";
import { AdminPage } from "./components/admin/AdminPage.tsx";
import { Forbidden } from "./components/admin/Forbidden.tsx";
import { Compare } from "./components/Compare.tsx";
import { Detail } from "./components/Detail.tsx";
import type { DeepdiveActions } from "./components/Detail.tsx";
import { EMPTY_FORM, Header } from "./components/Header.tsx";
import type { LookupForm } from "./components/Header.tsx";
import { Home } from "./components/Home.tsx";
import { Setup } from "./components/Setup.tsx";
import { SignIn } from "./components/SignIn.tsx";
import { Tabs } from "./components/Tabs.tsx";
import { Toast } from "./components/Toast.tsx";

type Screen =
  | { kind: "loading" }
  | { kind: "setup"; status: StatusInfo }
  | { kind: "signin"; status: StatusInfo }
  | { kind: "main"; status: StatusInfo; me: MeUser | null; settings: Settings | null; quota: QuotaInfo | null; ownClient: OwnClientView | null };

// No router: /admin, /settings and /privacy are full navigations resolved once from the pathname.
const page = pageOf(location.pathname);

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  useEffect(() => {
    (async () => {
      const s = await api.status();
      const status: StatusInfo = s.ok
        ? {
            hosted: s.hosted, hasCredentials: s.hasCredentials, envPath: s.envPath ?? null,
            openSignup: s.openSignup ?? false, guildRequired: s.guildRequired ?? false, wclClients: s.wclClients ?? false, operator: s.operator ?? "",
          }
        : LOCAL_STATUS;
      const me = status.hosted ? await api.me() : null;
      const kind = bootScreen(status, me, location.pathname);
      if (kind === "main") {
        const settings = me?.kind === "ok" ? parseServerSettings((await api.settings().then((r) => (r.ok ? r.settings : null)))) : null;
        setScreen({ kind, status, me: me?.kind === "ok" ? me.user : null, settings, quota: me?.kind === "ok" ? me.quota : null, ownClient: me?.kind === "ok" ? me.ownClient : null });
      } else setScreen({ kind, status });
    })();
  }, []);
  if (screen.kind === "loading") return <div className="muted" style={{ padding: 24 }}><span className="spinner" /> loading…</div>;
  // The privacy page is readable before signing in (it is linked from the sign-in note).
  if (screen.kind === "signin" && page === "privacy") return <PrivacyPage operator={screen.status.operator} guildRequired={screen.status.guildRequired} />;
  if (screen.kind === "signin") return <SignIn notice={deniedNotice(location.search)} loginFailed={loginFailed(location.search)} note={signInNote(screen.status)} />;
  if (screen.kind === "setup") {
    return <Setup envPath={screen.status.envPath ?? ""} hasCredentials={screen.status.hasCredentials} onDone={() => { history.replaceState({}, "", "/"); setScreen({ kind: "main", status: { ...screen.status, hasCredentials: true }, me: null, settings: null, quota: null, ownClient: null }); }} />;
  }
  return (
    <SettingsProvider hosted={screen.status.hosted} initial={screen.settings}>
      <Main status={screen.status} me={screen.me} initialQuota={screen.quota} initialOwnClient={screen.ownClient} onSetup={() => { history.pushState({}, "", "/setup"); setScreen({ kind: "setup", status: { ...screen.status, hasCredentials: true } }); }} />
    </SettingsProvider>
  );
}

const formToRequest = (f: LookupForm, level: number | null): LookupRequest => ({
  character: f.character.trim(),
  level,
  spec: f.spec.trim() || null,
  metric: f.metric || null,
});

function Main({ status, me, initialQuota, initialOwnClient, onSetup }: { status: StatusInfo; me: MeUser | null; initialQuota: QuotaInfo | null; initialOwnClient: OwnClientView | null; onSetup: () => void }) {
  const controls = uiControls(status);
  const [form, setForm] = useState<LookupForm>(EMPTY_FORM);
  const [quota, setQuota] = useState<QuotaInfo | null>(initialQuota);
  // The member's own WCL client (issue #11): its counter replaces the quota line; lookups and deep-dives carry the latest view.
  const [ownClient, setOwnClient] = useState<OwnClientView | null>(initialOwnClient);
  const menu = me ? menuModel(me, quota, ownClient) : null;
  // Admins see "N pending proposals" next to the Admin item; counted when the menu opens (0 WCL pts, SQLite only).
  const [pendingProposals, setPendingProposals] = useState<number | null>(null);
  const onMenuOpen = useCallback(async () => {
    if (me?.role !== "admin") return;
    const r = await api.admin.proposals("pending");
    if (r.ok) setPendingProposals(r.proposals.length);
  }, [me]);
  // "Your key": the level every lookup is evaluated for (null = auto). Per browser locally, per account when hosted.
  const { settings, update: updateSettings } = useSettings();
  const yourKey = settings.yourKey;
  const onKeyChange = (v: number | null) => updateSettings({ yourKey: v });
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
  const [tick, bump] = useState(0);
  const touch = () => bump((n) => n + 1);
  // Latest active key for async callbacks that outlive a tab switch (see reloadActive).
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const loadHistory = useCallback(async (): Promise<HistoryItem[]> => {
    const r = await api.history();
    if (!r.ok) return [];
    setTabs(r.items);
    setSelected((s) => pruneSelection(s, r.items.map((i) => i.key)));
    const keep = new Set(r.items.map((i) => i.key));
    for (const k of [...payloads.current.keys()]) if (!keep.has(k)) payloads.current.delete(k);
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

  // Self-heal: whenever the cache was cleared (e.g. by a reload that raced a tab switch),
  // re-fetch the active tab so it never sits on "loading…". `tick` re-runs this after touch().
  useEffect(() => {
    if (activeKey && !payloads.current.has(activeKey)) void fetchPayload(activeKey);
  }, [activeKey, fetchPayload, tick]);

  const runLookup = useCallback(async (req: LookupRequest, refresh: boolean) => {
    setBusy(`${refresh ? "refreshing" : "looking up"} ${req.character}…`);
    setCompareOpen(false);
    const r = await api.lookup({ ...req, refresh });
    setBusy(null);
    if (!r.ok) { if (r.quota) setQuota(r.quota); setToast(r.error); return; }
    if (r.quota) setQuota(r.quota);
    if (r.ownClient !== undefined) setOwnClient(r.ownClient);
    payloads.current.set(r.key, r.result);
    setFromCache(r.fromCache);
    setActiveKey(r.key);
    touch();
    await loadHistory();
  }, [loadHistory]);

  const onLookup = () => void runLookup(formToRequest(form, yourKey), false);
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

  /** Re-run the active tab's lookup for "your key" and drop the old tab (the cache key includes the level). */
  const reevaluate = async () => {
    const t = tabs.find((x) => x.key === activeKey);
    if (!t) return;
    const oldKey = t.key;
    await runLookup({ ...t.request, level: yourKey }, false);
    // runLookup activated the new key; the old entry is redundant now.
    await api.removeHistory(oldKey);
    payloads.current.delete(oldKey);
    await loadHistory();
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
    result: async (d) => { await loadHistory(); if (!d.fromCache) payloads.current.delete(d.key); await showTab(d.key); setFromCache(d.fromCache); },
    error: (d) => setToast(d.message),
  });

  const onWatchToggle = async (wanted: boolean) => {
    const r = wanted ? await api.watchStart({ level: yourKey, spec: form.spec.trim() || null, metric: form.metric || null }) : await api.watchStop();
    if (!r.ok) setToast(r.error);
    // The `status` SSE event is the source of truth for the toggle.
  };

  const onQuit = async () => {
    if (!window.confirm("Quit bmpl? The server will stop and this page will no longer work.")) return;
    await api.quit();
    setStopped(true);
  };

  const onSignOut = async () => {
    const r = await api.logout();
    if (!r.ok) { setToast(r.error); return; }
    location.assign("/");
  };

  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;
  const activePayload = activeKey ? payloads.current.get(activeKey) ?? null : null;

  // --- run deep-dive ---
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  /** Drop every cached payload (analyses/table edits affect all tabs server-side) and reload the active one. */
  const reloadActive = useCallback(async () => {
    payloads.current.clear();
    const key = activeKeyRef.current;
    if (key) await fetchPayload(key);
    touch();
  }, [fetchPayload]);

  const analyze = useCallback(async (run: { reportCode: string; fightID: number }, force = false) => {
    if (!activePayload) return;
    const key = `${run.reportCode}:${run.fightID}`;
    setAnalyzing(key);
    const r = await api.deepdive({ reportCode: run.reportCode, fightID: run.fightID, character: activePayload.character.name, force });
    if (!r.ok) { if (r.quota) setQuota(r.quota); setAnalyzing(null); setToast(r.error); return false; }
    if (r.quota) setQuota(r.quota);
    if (r.ownClient !== undefined) setOwnClient(r.ownClient);
    // Keep the buttons disabled until the refreshed payload is in.
    await reloadActive();
    setAnalyzing(null);
    return true;
  }, [activePayload, reloadActive]);

  const analyzeAll = useCallback(async () => {
    if (!activePayload) return;
    const todo = unanalyzedRuns(activePayload);
    for (let i = 0; i < todo.length; i++) {
      setProgress(`Analyzing ${i + 1}/${todo.length}…`);
      const ok = await analyze(todo[i]!);
      if (!ok) break; // a 402/502 stops the batch; the toast says why
    }
    setProgress(null);
  }, [activePayload, analyze]);

  const patchDefensives = useCallback(async (className: string, spec: string, patch: OverrideEntry) => {
    const r = await api.patchDefensives({ className, spec, patch });
    if (!r.ok) { setToast(r.error); return; }
    await reloadActive();
  }, [reloadActive]);

  const deepdiveActions: DeepdiveActions = {
    analyzing, progress, analyze: async (run, force) => { await analyze(run, force); }, analyzeAll, patch: patchDefensives,
    // An own client never blocks an analysis: the shared quota is not what it spends from.
    canAfford: (runs) => ownClient !== null || canAfford(quota, runs * POINTS_PER_RUN),
    quotaTooltip: quotaTooltip(quota),
    mode: proposalMode(status, me),
  };

  if (stopped) return <main className="stopped"><h2>bmpl stopped</h2><p className="muted">You can close this tab.</p></main>;

  const empty = tabs.length === 0;
  // History eviction can shrink `selected` below 2 while compareOpen is still true; fall back
  // to the detail view rather than leaving CompareLoader stuck on its "building…" spinner.
  const showCompare = compareOpen && selected.length >= 2;
  // /admin and /settings are full navigations from the user menu (no router): same header (no search), their sections instead of the tabs.
  const isMainPage = page === "main";
  const access = adminAccess(status, me);
  const account = accountAccess(status, me);

  return (
    <>
      <Header
        form={form} onChange={setForm} yourKey={yourKey} keyFallback={activePayload?.targetLevel ?? null} onKeyChange={onKeyChange}
        onLookup={onLookup} busy={busy}
        watchActive={watch.active} watchLabel={watch.label} onWatchToggle={onWatchToggle}
        sseConnected={sseConnected} onSetup={onSetup} onQuit={onQuit} hero={empty && isMainPage} search={isMainPage} controls={controls}
        menu={menu} pendingProposals={pendingProposals} onMenuOpen={() => void onMenuOpen()} onSignOut={onSignOut}
      />
      {page === "admin" && (
        access === "ok" && me ? <AdminPage me={me} /> : <Forbidden reason={access === "local" ? "local" : "member"} handle={me ? `@${me.username}` : null} />
      )}
      {page === "settings" && (
        account === "ok" && me
          ? <SettingsPage me={me} status={status} quota={quota} ownClient={ownClient} onOwnClientChange={setOwnClient} onDeleted={() => location.assign("/")} />
          : <Forbidden reason="local" handle={null} title="Hosted mode only" text="Settings exist in hosted mode only." />
      )}
      {page === "privacy" && (
        status.hosted
          ? <PrivacyPage operator={status.operator} guildRequired={status.guildRequired} />
          : <Forbidden reason="local" handle={null} title="Hosted mode only" text="The privacy page exists in hosted mode only." />
      )}
      {isMainPage && (
        <>
          <Tabs
            items={tabs} activeKey={activeKey} selected={selected} compareOpen={showCompare}
            onSelectTab={(k) => void showTab(k)} onToggle={(k) => setSelected((s) => toggleSelection(s, k))}
            onClose={(k) => void closeTab(k)} onClearAll={() => void clearAll()} onCompare={() => setCompareOpen(true)}
            onRefresh={onRefresh} fetchedAt={activeTab?.fetchedAt ?? null} fromCache={fromCache}
          />
          <main className={"content" + (empty ? " content-home" : "")}>
            {empty && <Home envPath={controls.envPath ? status.envPath : null} />}
            {!empty && !showCompare && activePayload && (
              <Detail payload={activePayload} hint={activeTab ? reevalHint(yourKey, activeTab) : null} onReevaluate={() => void reevaluate()} deepdive={deepdiveActions} />
            )}
            {!empty && !showCompare && !activePayload && activeKey && <div className="muted"><span className="spinner" /> loading…</div>}
            {showCompare && (
              <CompareLoader keys={selected} tabs={tabs} fetchPayload={fetchPayload} cache={payloads.current} onJump={(k) => void showTab(k)} />
            )}
          </main>
        </>
      )}
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
