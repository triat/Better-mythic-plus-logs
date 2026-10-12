import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api.ts";
import type { MeUser, QuotaInfo } from "./api.ts";
import type { HistoryItem, KnownCharacter, LookupPayload, LookupRequest, OverrideEntry, OwnClientView, Region } from "./types.ts";
import { POINTS_PER_RUN, unanalyzedRuns } from "./lib/deepdive.ts";
import { MAX_COMPARE, initialPick, pruneSelection, toggleSelection, withPayloadSummary } from "./lib/history.ts";
import { canAfford, quotaOrBudgetMessage, quotaTooltip } from "./lib/quota.ts";
import { fmtAge } from "./lib/format.ts";
import { bnetCodeOf } from "./lib/bnet.ts";
import { mineRequest } from "./lib/me.ts";
import { suggestionsOf } from "./lib/suggest.ts";
import type { Suggestion } from "./lib/suggest.ts";
import { OWN_CLIENT_GUIDE, menuModel } from "./lib/session.ts";
import { reevalHint } from "./lib/keyLevel.ts";
import { candHref, candState, candSwitchHref, compareHref } from "./lib/profile.ts";
import { resultView } from "./lib/self.ts";
import { LOCAL_STATUS, accountAccess, adminAccess, bootScreen, candidateHref, pageOf, proposalMode, uiControls } from "./lib/hostedMode.ts";
import type { StatusInfo } from "./lib/hostedMode.ts";
import type { CachedVerdict, LiveRole, LiveSort } from "./lib/live/roster.ts";
import { autoQueue, verdictScope } from "./lib/live/panel.ts";
import { useWowCapture } from "./lib/live/useWowCapture.ts";
import type { Locale } from "./lib/locale.ts";
import { effectiveRegion, isRegion } from "./lib/regions.ts";
import type { PaletteAction } from "./lib/palette.ts";
import { accountView, navItems } from "./lib/shell.ts";
import { parseServerSettings, readLocalSettings, writeLocalSettings } from "./lib/settings.ts";
import type { KeyValueStore, Settings } from "./lib/settings.ts";
import { DocsProvider } from "./docs.tsx";
import { LocaleProvider, useT } from "./locale.tsx";
import { SettingsProvider, useSettings } from "./settings.tsx";
import { useSse } from "./useSse.ts";
import { startUsageTracking, track } from "./usage.ts";
import { PrivacyPage } from "./components/account/PrivacyPage.tsx";
import { SettingsPage } from "./components/account/SettingsPage.tsx";
import { AdminPage } from "./components/admin/AdminPage.tsx";
import { Forbidden } from "./components/admin/Forbidden.tsx";
import { HelpPage } from "./components/help/HelpPage.tsx";
import { Compare } from "./components/Compare.tsx";
import { Detail } from "./components/Detail.tsx";
import type { DeepdiveActions } from "./components/Detail.tsx";
import type { SelfActions } from "./components/self/ResultHead.tsx";
import { HomePage } from "./components/home/HomePage.tsx";
import { Landing } from "./components/Landing.tsx";
import { LiveChip } from "./components/LiveChip.tsx";
import { LivePanel } from "./components/LivePanel.tsx";
import { MePage } from "./components/me/MePage.tsx";
import { Setup } from "./components/Setup.tsx";
import { Shell } from "./components/shell/Shell.tsx";
import { EMPTY_FORM } from "./components/shell/Sidebar.tsx";
import type { LookupForm, SidebarProps } from "./components/shell/Sidebar.tsx";
import { Toast } from "./components/Toast.tsx";
import type { ToastAction } from "./components/Toast.tsx";

type Screen =
  | { kind: "loading" }
  | { kind: "setup"; status: StatusInfo }
  | { kind: "signin"; status: StatusInfo }
  | { kind: "main"; status: StatusInfo; me: MeUser | null; settings: Settings | null; quota: QuotaInfo | null; ownClient: OwnClientView | null };

// No router: every page (/, /candidate, /compare, /live, /admin, /settings, /privacy, /help, /me) is a full navigation resolved once from the pathname.
const page = pageOf(location.pathname);
// The Battle.net callback lands on /me?bnet=<code>; read before the boot effect erases the query string.
const bnetCode = bnetCodeOf(location.search);
const PAGE_EVENT = {
  home: "page_home", candidate: "page_candidate", compare: "page_compare", live: "page_live",
  admin: "page_admin", settings: "page_settings", privacy: "page_privacy", help: "page_help", me: "page_me",
} as const;
// The pages that switch profiles in place (Récents, the palette, a lookup): the candidate page, and Live, whose screen
// capture a navigation would end. Every other page navigates to the candidate page instead.
const inPlace = page === "candidate" || page === "live";

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  useEffect(() => {
    (async () => {
      const s = await api.status();
      const status: StatusInfo = s.ok
        ? {
            hosted: s.hosted, hasCredentials: s.hasCredentials, envPath: s.envPath ?? null,
            openSignup: s.openSignup ?? false, guildRequired: s.guildRequired ?? false, wclClients: s.wclClients ?? false, operator: s.operator ?? "",
            region: isRegion(s.region) ? s.region : "eu",
          }
        : LOCAL_STATUS;
      const me = status.hosted ? await api.me() : null;
      // Feature usage (hosted, signed in only): on for the page's lifetime; a full navigation starts it again.
      startUsageTracking(status.hosted && me?.kind === "ok");
      track(PAGE_EVENT[page]);
      const kind = bootScreen(status, me, location.pathname);
      if (kind === "main") {
        const settings = me?.kind === "ok" ? parseServerSettings((await api.settings().then((r) => (r.ok ? r.settings : null)))) : null;
        setScreen({ kind, status, me: me?.kind === "ok" ? me.user : null, settings, quota: me?.kind === "ok" ? me.quota : null, ownClient: me?.kind === "ok" ? me.ownClient : null });
      } else setScreen({ kind, status });
    })();
  }, []);
  // The screens before the settings exist (loading, sign-in, setup, the bare pages) read the locale from the browser only.
  if (screen.kind === "loading") return <BrowserLocale><Loading /></BrowserLocale>;
  // The privacy page is one bare page (brand header, no search) for everyone: readable before
  // signing in (it is linked from the sign-in note) and rendered outside `Main` when signed in, so
  // it never gets the app header on top of its own.
  if (screen.status.hosted && page === "privacy") return <BrowserLocale><PrivacyPage operator={screen.status.operator} guildRequired={screen.status.guildRequired} /></BrowserLocale>;
  // /help is public too: an anonymous hosted visitor gets the bare page (brand line, no search); signed in or local, it renders inside `Main` under the app header.
  if (screen.kind === "signin" && page === "help") return <BrowserLocale><HelpPage status={screen.status} bare /></BrowserLocale>;
  // Every other path, signed out: the landing page (redesign spec decision 2).
  if (screen.kind === "signin") return <BrowserLocale><Landing status={screen.status} search={location.search} /></BrowserLocale>;
  if (screen.kind === "setup") {
    return (
      <BrowserLocale>
        <Setup envPath={screen.status.envPath ?? ""} hasCredentials={screen.status.hasCredentials} onDone={() => { history.replaceState({}, "", "/"); setScreen({ kind: "main", status: { ...screen.status, hasCredentials: true }, me: null, settings: null, quota: null, ownClient: null }); }} />
      </BrowserLocale>
    );
  }
  return (
    <SettingsProvider hosted={screen.status.hosted} initial={screen.settings}>
      <SettingsLocale>
        <DocsProvider>
          <Main status={screen.status} me={screen.me} initialQuota={screen.quota} initialOwnClient={screen.ownClient} onSetup={() => { history.pushState({}, "", "/setup"); setScreen({ kind: "setup", status: { ...screen.status, hasCredentials: true } }); }} />
        </DocsProvider>
      </SettingsLocale>
    </SettingsProvider>
  );
}

const browserStore = (): KeyValueStore | null => { try { return localStorage; } catch { return null; } };
/** Anonymous screens: the remembered choice lives in the browser only (`bmpl.locale`). */
function BrowserLocale({ children }: { children: ReactNode }) {
  const persist = useCallback((l: Locale) => writeLocalSettings(browserStore(), { locale: l }), []);
  return <LocaleProvider saved={readLocalSettings(browserStore()).locale} persist={persist}>{children}</LocaleProvider>;
}
/** Signed in / local: the choice is a setting (hosted: PUT /api/settings, mirrored to the browser by SettingsProvider). */
function SettingsLocale({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const persist = useCallback((l: Locale) => update({ locale: l }), [update]);
  return <LocaleProvider saved={settings.locale} persist={persist}>{children}</LocaleProvider>;
}
/** The app-level spinner (padded, before anything else exists) or, `inline`, the one a content area shows while its payload loads. */
function Loading({ inline = false }: { inline?: boolean }) {
  const { t } = useT();
  return <div className="muted" style={inline ? undefined : { padding: 24 }}><span className="spinner" /> {t("common.loading")}</div>;
}
const formToRequest = (f: LookupForm, level: number | null, region: Region): LookupRequest => ({
  character: f.character.trim(),
  level,
  spec: f.spec.trim() || null,
  metric: f.metric || null,
  region,
});

function Main({ status, me, initialQuota, initialOwnClient, onSetup }: { status: StatusInfo; me: MeUser | null; initialQuota: QuotaInfo | null; initialOwnClient: OwnClientView | null; onSetup: () => void }) {
  const { t } = useT();
  const controls = uiControls(status);
  const [form, setForm] = useState<LookupForm>(EMPTY_FORM);
  const [quota, setQuota] = useState<QuotaInfo | null>(initialQuota);
  // The member's own WCL client (issue #11): its counter replaces the quota line; lookups and deep-dives carry the latest view.
  const [ownClient, setOwnClient] = useState<OwnClientView | null>(initialOwnClient);
  const menu = me ? menuModel(t, me, quota, ownClient) : null;
  // The toast action on a quota/budget refusal: label from the dictionary, href fixed (session.ts keeps only that).
  const ownClientAction = useMemo<ToastAction>(() => ({ label: t("errors.ownClientAction"), href: OWN_CLIENT_GUIDE.href }), [t]);
  // Admins see "N pending proposals" next to the Admin item; counted when the menu opens (0 WCL pts, SQLite only).
  const [pendingProposals, setPendingProposals] = useState<number | null>(null);
  const onMenuOpen = useCallback(async () => {
    if (me?.role !== "admin") return;
    const r = await api.admin.proposals("pending");
    if (r.ok) setPendingProposals(r.proposals.length);
  }, [me]);
  // "Your key": the level every lookup is evaluated for (null = auto). Per browser locally, per account when hosted.
  const { settings, update: updateSettings, adopt: adoptSettings } = useSettings();
  const yourKey = settings.yourKey;
  const onKeyChange = (v: number | null) => { track("key_level_change"); updateSettings({ yourKey: v }); };
  // The region: the saved choice, else the instance default. Not part of the form — it is a setting like "your key".
  const region = effectiveRegion(settings.region, status.region);
  const regionRef = useRef(region);
  regionRef.current = region;
  const [tabs, setTabs] = useState<HistoryItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // The Compare page's picker (redesign phase 1 caps it at MAX_COMPARE = 3 — phase 4: 5).
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToastState] = useState<{ message: string; action: ToastAction | null } | null>(null);
  const setToast = useCallback((message: string, action: ToastAction | null = null) => setToastState({ message, action }), []);
  const closeToast = useCallback(() => setToastState(null), []);
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
    // The server re-evaluated the entry with today's rules: Récents shows the same verdict and score as the page.
    setTabs((items) => withPayloadSummary(items, key, r.result));
    touch();
    return { payload: r.result, items: null };
  }, [loadHistory]);

  const showTab = useCallback(async (key: string) => {
    setActiveKey(key);
    setFromCache(true);
    const { payload, items } = await fetchPayload(key);
    if (payload === null) {
      // The failed key is gone from `items` (loadHistory reflects the server's current
      // history). Fall back to the first remaining tab, once — if that also fails,
      // leave `activeKey` null rather than recursing further.
      // On the candidate page the URL names the profile actually shown, not the evicted one it asked for.
      const landOn = (shown: string | null) => {
        if (page === "candidate") history.replaceState({}, "", shown ? candSwitchHref(shown, location.search) : "/candidate");
      };
      const fallback = items?.[0]?.key ?? null;
      if (!fallback) {
        if (activeKeyRef.current === key) landOn(null);
        setActiveKey((cur) => (cur === key ? null : cur));
        return;
      }
      if (activeKeyRef.current === key) landOn(fallback);
      setActiveKey((cur) => (cur === key ? fallback : cur));
      const { payload: fallbackPayload } = await fetchPayload(fallback);
      if (fallbackPayload === null) {
        if (activeKeyRef.current === fallback) landOn(null);
        setActiveKey((cur) => (cur === fallback ? null : cur));
      }
    }
  }, [fetchPayload]);

  // Boot: history, then on the candidate page ?open=<key> when it names a tab, else the most recent one (0 pts), with
  // the URL naming the profile shown. ?q= only fills the search field (a Raider.IO link carries its own region): a URL
  // never starts a lookup by itself, and never writes a setting. A pre-redesign /?open= link lands on the candidate page.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const boot = candState(location.search);
    const legacyOpen = page === "home" ? params.get("open") : null;
    if (legacyOpen) { location.replace(candidateHref(legacyOpen)); return; }
    const q = params.get("q");
    if (q) setForm((f) => ({ ...f, character: q }));
    if (location.search) history.replaceState({}, "", location.pathname);
    loadHistory().then((items) => {
      // The profile header's Compare: that profile ticked on arrival.
      if (page === "compare") setSelected(initialPick(params.toString(), items.map((i) => i.key)));
      if (page !== "candidate" || items.length === 0) return;
      const want = params.get("open");
      const key = (want && items.some((i) => i.key === want) ? want : null) ?? items[0]!.key;
      // The tab, run and sheet survive the boot; a run of the asked-for profile means nothing on the fallback one.
      history.replaceState({}, "", key === want ? candHref(key, boot) : candHref(key, { tab: boot.tab }));
      void showTab(key);
    });
    // Once per page load: the URL is read at boot only.
  }, [loadHistory, showTab]);

  // Self-heal: whenever the cache was cleared (e.g. by a reload that raced a tab switch),
  // re-fetch the active tab so it never sits on "loading…". `tick` re-runs this after touch().
  useEffect(() => {
    if (activeKey && !payloads.current.has(activeKey)) void fetchPayload(activeKey);
  }, [activeKey, fetchPayload, tick]);

  /** Runs a lookup and shows its result here; the history key, or null when it was refused (the toast says why). */
  const runLookup = useCallback(async (req: LookupRequest, refresh: boolean): Promise<string | null> => {
    setBusy(t(refresh ? "header.busy.refreshing" : "header.busy.lookingUp", { name: req.character }));
    const r = await api.lookup({ ...req, refresh, mine: mineRequest(settings.characters, req.character, req.region ?? regionRef.current) });
    setBusy(null);
    // A refusal that carries the member's own quota numbers gets the way out: the guide to an own client.
    if (!r.ok) { if (r.quota) setQuota(r.quota); setToast(quotaOrBudgetMessage(t, r), r.quota ? ownClientAction : null); return null; }
    if (r.quota) setQuota(r.quota);
    if (r.ownClient !== undefined) setOwnClient(r.ownClient);
    payloads.current.set(r.key, r.result);
    setFromCache(r.fromCache);
    setActiveKey(r.key);
    // A user lookup whose effective region differs (a pasted Raider.IO URL carries its own) flips the
    // remembered region to it. A refresh is not a choice: refreshing a foreign-region tab leaves it alone.
    if (!refresh && r.request.region !== regionRef.current) updateSettings({ region: r.request.region });
    touch();
    await loadHistory();
    return r.key;
  }, [loadHistory, updateSettings, t, ownClientAction, settings.characters]);

  /** Shows a history profile: in place on the candidate page (the URL follows) and on Live, else on the candidate page. */
  const openProfile = useCallback((key: string) => {
    if (!inPlace) { location.assign(candidateHref(key)); return; }
    if (page === "candidate") history.replaceState({}, "", candSwitchHref(key, location.search));
    void showTab(key);
  }, [showTab]);

  /** A lookup from the sidebar, the palette or a page: shown in place, else the candidate page once it answered — the
   * navigation opens the stored result (0 pts), so no lookup is ever repeated by it. */
  const lookupAndLand = useCallback(async (req: LookupRequest, refresh = false) => {
    const key = await runLookup(req, refresh);
    if (key === null) return;
    if (!inPlace) location.assign(candidateHref(key));
    else if (page === "candidate") history.replaceState({}, "", candSwitchHref(key, location.search));
  }, [runLookup]);

  const onLookup = () => void lookupAndLand(formToRequest(form, yourKey, region));

  // The search suggestions (canvas "suggest"): history and My characters, plus, locally, the characters bmpl's own
  // database has seen, read again whenever history changes. Hosted, that cache is every member's: never asked for.
  const [known, setKnown] = useState<KnownCharacter[]>([]);
  useEffect(() => {
    if (status.hosted) return;
    let stale = false;
    void api.knownCharacters().then((r) => { if (r.ok && !stale) setKnown(r.characters); });
    return () => { stale = true; };
  }, [status.hosted, tabs]);
  const suggestions = useMemo(() => suggestionsOf(settings.characters, tabs, known), [settings.characters, tabs, known]);
  // A row with a history tab opens it (0 pts); any other is looked up in its own region, as Look up would. Either way
  // the region follows the row, so the next Look up of the same text does not search another region.
  const onSuggest = (s: Suggestion) => {
    setForm((f) => ({ ...f, character: s.fill }));
    if (s.region !== regionRef.current) { updateSettings({ region: s.region }); regionRef.current = s.region; }
    if (s.historyKey) openProfile(s.historyKey);
    else if (!busy) void lookupAndLand(formToRequest({ ...form, character: s.fill }, yourKey, s.region));
  };
  // The palette's rows: a history profile, a lookup (in the row's region, like a suggestion), or a page.
  const onPalette = (a: PaletteAction) => {
    if (a.kind === "go") { location.assign(a.href); return; }
    if (a.kind === "open") { openProfile(a.historyKey); return; }
    setForm((f) => ({ ...f, character: a.fill }));
    if (a.region !== regionRef.current) { updateSettings({ region: a.region }); regionRef.current = a.region; }
    if (!busy) void lookupAndLand(formToRequest({ ...form, character: a.fill }, yourKey, a.region));
  };
  const onRefresh = () => {
    const tab = tabs.find((x) => x.key === activeKey);
    if (tab) void lookupAndLand(tab.request, true);
  };

  const closeTab = async (key: string) => {
    await api.removeHistory(key);
    payloads.current.delete(key);
    const items = await loadHistory();
    if (activeKey === key) {
      const next = items[0]?.key ?? null;
      setActiveKey(next);
      if (page === "candidate") history.replaceState({}, "", next ? candSwitchHref(next, location.search) : "/candidate");
      if (next) void showTab(next);
    }
  };

  /** Re-run the active tab's lookup for "your key" and drop the old tab (the cache key includes the level). */
  const reevaluate = async () => {
    const tab = tabs.find((x) => x.key === activeKey);
    if (!tab) return;
    track("reevaluate");
    const oldKey = tab.key;
    if (await runLookup({ ...tab.request, level: yourKey }, false) === null) return;
    if (page === "candidate" && activeKeyRef.current) history.replaceState({}, "", candSwitchHref(activeKeyRef.current, location.search));
    // runLookup activated the new key; the old entry is redundant now.
    await api.removeHistory(oldKey);
    payloads.current.delete(oldKey);
    await loadHistory();
  };

  const clearAll = async () => {
    if (!window.confirm(t("shell.recent.clearConfirm", { count: tabs.length }))) return;
    await api.clearHistory();
    payloads.current.clear();
    setActiveKey(null);
    setSelected([]);
    if (page === "candidate") history.replaceState({}, "", "/candidate");
    await loadHistory();
  };

  const sseConnected = useSse({
    status: (s) => setWatch({ active: s.active, label: s.backend }),
    searching: (d) => setWatch((w) => ({ ...w, label: t("header.busy.lookingUp", { name: d.character }) })),
    // A clipboard-watch result: shown in place on the candidate and Live pages, opened from home (as the old home
    // page showed it); elsewhere (My characters, Help, …) it only lands in Récents.
    result: async (d) => {
      await loadHistory();
      if (!d.fromCache) payloads.current.delete(d.key);
      if (page === "home") { location.assign(candidateHref(d.key)); return; }
      if (!inPlace) return;
      if (page === "candidate") history.replaceState({}, "", candSwitchHref(d.key, location.search));
      await showTab(d.key);
      setFromCache(d.fromCache);
    },
    error: (d) => setToast(d.message),
  });

  const onWatchToggle = async (wanted: boolean) => {
    const r = wanted ? await api.watchStart({ level: yourKey, spec: form.spec.trim() || null, metric: form.metric || null, region }) : await api.watchStop();
    if (!r.ok) setToast(r.error);
    // The `status` SSE event is the source of truth for the toggle.
  };

  const onQuit = async () => {
    if (!window.confirm(t("header.quitConfirm"))) return;
    await api.quit();
    setStopped(true);
  };

  const onSignOut = async () => {
    const r = await api.logout();
    if (!r.ok) { setToast(r.error); return; }
    location.assign("/");
  };

  const activeTab = tabs.find((x) => x.key === activeKey) ?? null;
  const activePayload = activeKey ? payloads.current.get(activeKey) ?? null : null;
  // One `page_main_result` per result shown (a tab switch, a lookup, the boot tab), once its payload is in.
  const resultShown = activeKey !== null && activePayload !== null;
  // Only where a result is on screen: a lookup started on another page lands on /candidate, which counts it there.
  useEffect(() => { if (resultShown && inPlace) track("page_main_result"); }, [activeKey, resultShown]);

  // --- Live panel (game-integration Task 7): a single `useWowCapture()` here, shared by the header's
  // Live chip and the panel below (two hook instances would each open their own screen capture). ---
  const live = useWowCapture();
  const [liveVerdicts, setLiveVerdicts] = useState<Map<string, CachedVerdict>>(new Map());
  const [liveAuto, setLiveAuto] = useState(false);
  const [liveAutoInFlight, setLiveAutoInFlight] = useState<string | null>(null);
  // The auto switch needs a WCL client that isn't the shared meter: the member's own (hosted, usable) or
  // local mode (the CLI's own credentials — never the shared budget either).
  const liveAutoAllowed = !status.hosted || (ownClient !== null && ownClient.usable);
  useEffect(() => { if (!liveAutoAllowed) setLiveAuto(false); }, [liveAutoAllowed]);

  // A cached verdict belongs to one (key level, region) pair. When the member moves their key, every
  // entry in the map is stale: shown, it badges a row with a verdict computed for another level; kept,
  // `autoQueue` skips that row forever (`verdicts.has`), so an armed auto-lookup never re-vets it.
  // Emptied during render (React's "adjust state when a prop changes"), not in an effect, so no stale
  // badge is ever committed to the screen; the `liveCached` effect below then re-queries for the new
  // scope. `liveAutoInFlight` is deliberately NOT cleared — it is the one-lookup-at-a-time guard, and
  // dropping it here would let a second `/api/lookup` start while the first is still running. The
  // in-flight one's result is discarded below instead, by comparing the scope it was dispatched in.
  const liveScope = verdictScope(yourKey, region);
  const liveScopeRef = useRef(liveScope);
  const [liveScopeSeen, setLiveScopeSeen] = useState(liveScope);
  if (liveScopeSeen !== liveScope) {
    setLiveScopeSeen(liveScope);
    setLiveVerdicts(new Map());
  }
  liveScopeRef.current = liveScope;

  // POST /api/live/cached whenever the roster's *player set* changes (not on every frame — `liveCharKey`
  // is stable across frames that redraw the same roster). 0 WCL pts; region is sent for every player,
  // computed exactly like every other lookup (`effectiveRegion`) — see Task 4's review note in the brief.
  const liveCharKey = live.roster ? live.roster.players.map((pl) => pl.character).join("|") : "";
  useEffect(() => {
    const roster = live.roster;
    if (!roster) return;
    const players = roster.players.map((pl) => ({ character: pl.character, region }));
    let alive = true;
    void api.liveCached(players, yourKey).then((verdicts) => {
      if (!alive) return;
      setLiveVerdicts((prev) => {
        const next = new Map(prev);
        verdicts.forEach((v, i) => { if (v) next.set(players[i]!.character, { verdict: v.verdict, score: v.score, targetLevel: v.targetLevel, fetchedAt: v.fetchedAt }); });
        return next;
      });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCharKey, region, yourKey]);

  // The auto-lookup queue: one in-flight `api.lookup` at a time, re-evaluated whenever the roster or the
  // verdict map changes. It never touches the active tab (the member keeps browsing whatever they had
  // open) but the lookup still lands in history like any other, so the applicant becomes a normal tab.
  useEffect(() => {
    const roster = live.roster;
    if (!liveAuto || !liveAutoAllowed || !roster || liveAutoInFlight) return;
    const next = autoQueue(roster.players, liveVerdicts, new Set())[0];
    if (!next) return;
    setLiveAutoInFlight(next);
    const dispatchedIn = liveScope; // the (key level, region) this lookup is being run for — see above.
    (async () => {
      const r = await api.lookup({ character: next, level: yourKey, spec: null, metric: null, region, refresh: false });
      if (!r.ok) {
        setLiveAuto(false); // a quota/budget refusal turns the switch off, same toast as a manual lookup.
        if (r.quota) setQuota(r.quota);
        setToast(quotaOrBudgetMessage(t, r), r.quota ? ownClientAction : null);
        setLiveAutoInFlight(null);
        return;
      }
      if (r.quota) setQuota(r.quota);
      if (r.ownClient !== undefined) setOwnClient(r.ownClient);
      payloads.current.set(r.key, r.result);
      touch();
      await loadHistory();
      const ev = r.result.evaluation;
      // The key level moved while this was in flight: the result is still a real lookup (it lands in
      // history like any other), it just no longer belongs in a map scoped to the new level.
      if (liveScopeRef.current === dispatchedIn) {
        setLiveVerdicts((prev) => {
          const merged = new Map(prev);
          merged.set(next, { verdict: ev.verdict, score: ev.global, targetLevel: ev.targetLevel, fetchedAt: Date.now() });
          return merged;
        });
      }
      setLiveAutoInFlight(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAuto, liveAutoAllowed, live.roster, liveVerdicts, liveAutoInFlight, yourKey, region]);

  const onLiveSelect = (character: string) => { track("live_check"); void lookupAndLand({ character, level: yourKey, spec: null, metric: null, region }); };

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
    if (!r.ok) { if (r.quota) setQuota(r.quota); setAnalyzing(null); setToast(quotaOrBudgetMessage(t, r), r.quota ? ownClientAction : null); return false; }
    if (r.quota) setQuota(r.quota);
    if (r.ownClient !== undefined) setOwnClient(r.ownClient);
    // Keep the buttons disabled until the refreshed payload is in.
    await reloadActive();
    setAnalyzing(null);
    return true;
  }, [activePayload, reloadActive, t, ownClientAction]);

  const analyzeAll = useCallback(async () => {
    if (!activePayload) return;
    track("analyze_all");
    const todo = unanalyzedRuns(activePayload);
    for (let i = 0; i < todo.length; i++) {
      setProgress(t("runs.analyzing", { done: i + 1, total: todo.length }));
      const ok = await analyze(todo[i]!);
      if (!ok) break; // a 402/502 stops the batch; the toast says why
    }
    setProgress(null);
  }, [activePayload, analyze, t]);

  const patchDefensives = useCallback(async (className: string, spec: string, patch: OverrideEntry) => {
    const r = await api.patchDefensives({ className, spec, patch });
    if (!r.ok) { setToast(r.error); return; }
    await reloadActive();
  }, [reloadActive]);

  const deepdiveActions: DeepdiveActions = {
    analyzing, progress, analyze: async (run, force) => { await analyze(run, force); }, analyzeAll, patch: patchDefensives,
    // An own client never blocks an analysis: the shared quota is not what it spends from.
    canAfford: (runs) => ownClient !== null || canAfford(quota, runs * POINTS_PER_RUN),
    quotaTooltip: quotaTooltip(t, quota),
    mode: proposalMode(status, me),
  };
  const selfActions: SelfActions = {
    hosted: status.hosted,
    ownClient,
    setOwnClient,
    characters: settings.characters,
    setCharacters: (characters) => updateSettings({ characters }),
    adoptCharacters: (characters) => adoptSettings({ characters }),
  };

  // The Compare page opens a comparison as soon as two profiles are ticked; counted once per opening.
  const showCompare = page === "compare" && selected.length >= 2;
  useEffect(() => { if (showCompare) track("compare_open"); }, [showCompare]);

  if (stopped) return <main className="stopped"><h2>{t("header.stopped")}</h2><p className="muted">{t("header.stoppedSub")}</p></main>;

  const access = adminAccess(status, me);
  const account = accountAccess(status, me);
  const onRegionChange = (r: Region) => { track("region_change"); updateSettings({ region: r }); };
  const profileFetch = { fetchedAt: activeTab?.fetchedAt ?? null, cached: fromCache, onRefresh, busy: !activeTab || !!busy };
  const result = activeKey && (activePayload
    ? (
      <Detail
        key={activeKey} payload={activePayload} hint={activeTab ? reevalHint(t, yourKey, activeTab) : null} onReevaluate={() => void reevaluate()}
        deepdive={deepdiveActions} self={selfActions} fetch={profileFetch} compareHref={compareHref(activeKey)}
        // The candidate page mirrors the profile's tab / run / sheet into its URL; Live keeps them in memory.
        urlKey={page === "candidate" ? activeKey : null}
      />
    )
    : <Loading inline />);
  // The candidate profile carries its own fetch line and Refresh; the owner's view (phase 3) still has the bar above it.
  const ownerShown = activePayload !== null && resultView(settings.characters, activePayload) === "owner";

  const sidebar: SidebarProps = {
    form, onFormChange: setForm, onLookup, busy, suggestions, onSuggest,
    region, instanceRegion: status.region, onRegionChange, payload: activePayload,
    yourKey, keyFallback: activePayload?.targetLevel ?? null, onKeyChange, sseConnected,
    nav: navItems(t, page, { candidates: tabs.length, liveOn: live.state.kind === "live" }),
    recentItems: tabs, recentActive: inPlace ? activeKey : null,
    onRecent: inPlace ? openProfile : null,
    onRemove: (k) => void closeTab(k), onClearAll: () => void clearAll(),
    account: accountView(t, status, menu), controls, menu, pendingProposals, onMenuOpen: () => void onMenuOpen(), onSignOut,
    watch, onWatchToggle, onSetup, onQuit,
  };
  const palette = { sources: { suggestions, mine: settings.characters, history: tabs, region }, yourKey, onRun: onPalette };
  const toastEl = <Toast message={toast?.message ?? null} action={toast?.action ?? null} onClose={closeToast} />;

  // The connected home page sits outside the frame (redesign spec decision 2).
  if (page === "home") {
    return (
      <>
        <HomePage {...sidebar} palette={palette} history={tabs} liveOn={live.state.kind === "live"} self={selfActions} envPath={status.hosted ? null : status.envPath ?? ""} />
        {toastEl}
      </>
    );
  }

  return (
    <>
      <Shell sidebar={sidebar} palette={palette}>
        {page === "candidate" && (
          <div className="content content-result">
            {tabs.length === 0 ? (
              <section className="card cand-empty">
                <h1>{t("shell.candidate.empty")}</h1>
                <p className="muted">{t("shell.candidate.emptySub")}</p>
                <a href="/">{t("shell.candidate.home")}</a>
              </section>
            ) : (
              <>
                {ownerShown && <div className="cand-bar">
                  <span className="muted">
                    {activeTab ? t("shell.candidate.fetched", { age: fmtAge(t, activeTab.fetchedAt) }) : ""}
                    {activeTab && fromCache ? ` · ${t("shell.candidate.cached")}` : ""}
                  </span>
                  <button type="button" className="btn" onClick={onRefresh} disabled={!activeTab || !!busy} title={t("shell.candidate.refreshTitle")}>{t("shell.candidate.refresh")}</button>
                </div>}
                {result}
              </>
            )}
          </div>
        )}
        {page === "compare" && (
          <div className={"content" + (showCompare ? " content-result" : "")}>
            <div className="page-head">
              <h1>{t("shell.compare.title")}</h1>
              <span className="muted">{tabs.length === 0 ? t("shell.compare.empty") : t("shell.compare.sub")}</span>
            </div>
            {tabs.length > 0 && (
              <fieldset className="card compare-pick">
                <legend className="side-label">{t("shell.compare.count", { sel: selected.length, max: MAX_COMPARE })}</legend>
                {tabs.map((item) => {
                  const on = selected.includes(item.key);
                  return (
                    <label key={item.key} className={"compare-pick-row" + (on ? " on" : "")}>
                      <input
                        type="checkbox" checked={on} disabled={!on && selected.length >= MAX_COMPARE}
                        onChange={() => setSelected((s) => toggleSelection(s, item.key))}
                      />
                      <span className={"recent-dot " + (item.verdict ?? "none")} aria-hidden="true" />
                      <span className="compare-pick-name">{item.label}</span>
                      <span className={"recent-score mono " + (item.verdict ?? "none")}>{item.score === null ? "—" : Math.round(item.score)}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            {tabs.length > 0 && !showCompare && <p className="faint">{t("shell.compare.pick")}</p>}
            {showCompare && (
              <CompareLoader keys={selected} tabs={tabs} fetchPayload={fetchPayload} cache={payloads.current} onJump={(k) => location.assign(candidateHref(k))} />
            )}
          </div>
        )}
        {page === "live" && (
          <div className={"content" + (activeKey ? " content-result" : "")}>
            <div className="page-head">
              <h1>{t("shell.live.title")}</h1>
              <LiveChip state={live.state} connect={() => { track("live_connect"); return live.connect(); }} />
            </div>
            {live.roster ? (
              <LivePanel
                roster={live.roster} verdicts={liveVerdicts}
                sort={settings.liveSort} roles={settings.liveRoles} classes={settings.liveClasses}
                onSortChange={(v: LiveSort) => { track("live_filter"); updateSettings({ liveSort: v }); }}
                onRolesChange={(v: LiveRole[]) => { track("live_filter"); updateSettings({ liveRoles: v }); }}
                onClassesChange={(v: string[]) => { track("live_filter"); updateSettings({ liveClasses: v }); }}
                onSelect={onLiveSelect}
                auto={liveAuto} autoAllowed={liveAutoAllowed} onAutoChange={(v: boolean) => { track("live_auto_toggle"); setLiveAuto(v); }}
                queued={liveAutoInFlight ? new Set([liveAutoInFlight]) : new Set<string>()}
                now={Date.now()}
              />
            ) : (
              <p className="muted live-intro">{t("shell.live.sub")}</p>
            )}
            {result}
          </div>
        )}
        {page === "admin" && (
          access === "ok" && me ? <AdminPage me={me} /> : <Forbidden reason={access === "local" ? "local" : "member"} handle={me ? `@${me.username}` : null} />
        )}
        {page === "settings" && (
          account === "ok" && me
            ? <SettingsPage me={me} status={status} quota={quota} ownClient={ownClient} onOwnClientChange={setOwnClient} onDeleted={() => location.assign("/")} />
            : <Forbidden reason="local" handle={null} title={t("admin.forbidden.hostedOnly")} text={t("admin.forbidden.settingsHosted")} />
        )}
        {page === "help" && <HelpPage status={status} />}
        {page === "me" && (
          <div className="content">
            <MePage
              self={selfActions} history={tabs} region={region} instanceRegion={status.region} bnetCode={bnetCode}
              onRegionChange={onRegionChange}
            />
          </div>
        )}
        {page === "privacy" && (
          // Hosted visitors never reach here (App renders the bare page before Main).
          <Forbidden reason="local" handle={null} title={t("admin.forbidden.hostedOnly")} text={t("admin.forbidden.privacyHosted")} />
        )}
      </Shell>
      {toastEl}
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
  const { t } = useT();
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all(p.keys.map((k) => p.fetchPayload(k))).then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, [p.keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = p.keys
    .map((k) => ({ item: p.tabs.find((x) => x.key === k), payload: p.cache.get(k) }))
    .filter((e): e is { item: HistoryItem; payload: LookupPayload } => !!e.item && !!e.payload);
  if (entries.length < 2) return <div className="muted"><span className="spinner" /> {t("compare.building")}</div>;
  return <Compare entries={entries} onJump={p.onJump} />;
}
