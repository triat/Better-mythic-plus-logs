import type { Server } from "bun";
import pc from "picocolors";
import {
  type ClipboardBackend,
  detectClipboardReader,
  isPlausibleNameRealm,
} from "./clipboard.ts";
import { hasCredentials } from "./config.ts";
import { dim, err, heading, ok } from "./format.ts";
import { buildLookupPayload, performLookup } from "./lookup.ts";
import type { Metric } from "./roles.ts";
import { closeStore } from "./signals/store.ts";
import { History } from "./server-history.ts";
import type { HistoryEntry } from "./server-history.ts";
import { resolveEnvPath, writeCredentials } from "./setup.ts";
import { parseNameRealm, parseRaiderIOUrl } from "./util.ts";
import { resetAuthCache } from "./wcl/auth.ts";
import { createStaticHandler, defaultAssetLoader } from "./web-static.ts";
import type { AssetLoader } from "./web-static.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
  /** Test hook: where the built front lives. Default: embedded web/dist. */
  assets?: AssetLoader;
}

interface LookupRequest {
  character?: string;
  level?: number | string | null;
  spec?: string | null;
  metric?: string | null;
  refresh?: boolean;
}

const history = new History(20);

const historySummary = (entry: HistoryEntry) => ({
  key: entry.key,
  label: entry.label,
  charClass: entry.charClass,
  spec: entry.spec,
  targetLevel: entry.targetLevel,
  targetAutoDetected: entry.targetAutoDetected,
  fetchedAt: entry.fetchedAt,
  request: entry.request,
});

interface SetupRequest {
  clientId?: string;
  clientSecret?: string;
}

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const parseMetric = (raw: string | null | undefined): Metric | undefined => {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return v === "dps" || v === "hps" ? v : undefined;
};

function parseCharacterInput(
  raw: string,
): { name: string; realm: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const rio = parseRaiderIOUrl(s);
  if (rio) return { name: rio.name, realm: rio.realm };
  const fromDash = parseNameRealm(s);
  if (fromDash) return fromDash;
  const bits = s.split(/\s+/);
  return bits.length >= 2
    ? { name: bits[0]!, realm: bits.slice(1).join(" ") }
    : null;
}

export interface LookupError {
  ok: false;
  error: string;
  status: number;
}

export interface LookupSuccess {
  ok: true;
  key: string;
  result: unknown;
  fromCache: boolean;
}

export async function runLookupWithCache(opts: {
  character: string;
  level: number | null;
  spec: string | null;
  metric: Metric | null;
  refresh: boolean;
}): Promise<LookupSuccess | LookupError> {
  if (!hasCredentials()) {
    return { ok: false, error: "No credentials configured. Visit /setup first.", status: 400 };
  }
  const target = parseCharacterInput(opts.character);
  if (!target) {
    return {
      ok: false,
      error: "Could not parse character. Use `Name-Realm` or `Name Realm`.",
      status: 400,
    };
  }

  const requestCharacter = `${target.name}-${target.realm}`;
  const request = { character: requestCharacter, level: opts.level, spec: opts.spec, metric: opts.metric };

  if (!opts.refresh) {
    const hit = history.cached(request);
    if (hit) return { ok: true, key: hit.key, result: hit.result, fromCache: true };
  }

  try {
    const o = await performLookup({
      name: target.name,
      realm: target.realm,
      level: opts.level,
      spec: opts.spec,
      metric: opts.metric ?? undefined,
      enrich: true,
      refresh: opts.refresh,
    });
    if (!o.ok) return { ok: false, status: o.status, error: o.error };
    const payload = buildLookupPayload(o, target.realm);

    // Keyed by the *effective* level: an auto-detected +21 and an explicit +21 are one tab.
    const entry = history.record(request, {
      result: payload,
      label: requestCharacter,
      charClass: o.data.character.classID,
      spec: o.data.character.spec,
      targetLevel: o.result.targetLevel,
      targetAutoDetected: o.result.targetAutoDetected,
    });

    return { ok: true, key: entry.key, result: payload, fromCache: false };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function handleLookup(req: Request): Promise<Response> {
  let body: LookupRequest;
  try {
    body = (await req.json()) as LookupRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const raw = (body.character ?? "").trim();
  if (!raw) {
    return jsonResponse({ ok: false, error: "`character` is required" }, 400);
  }
  let levelOverride: number | null = null;
  if (body.level !== undefined && body.level !== null && body.level !== "") {
    const n = Number.parseInt(String(body.level), 10);
    if (!Number.isFinite(n) || n < 2) {
      return jsonResponse(
        { ok: false, error: `Invalid level: ${body.level}` },
        400,
      );
    }
    levelOverride = n;
  }
  const result = await runLookupWithCache({
    character: raw,
    level: levelOverride,
    spec: body.spec && body.spec.trim() ? body.spec.trim() : null,
    metric: parseMetric(body.metric ?? null) ?? null,
    refresh: !!body.refresh,
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.error }, result.status);
  }
  return jsonResponse({
    ok: true,
    result: result.result,
    key: result.key,
    fromCache: result.fromCache,
  });
}

async function handleSetup(req: Request): Promise<Response> {
  let body: SetupRequest;
  try {
    body = (await req.json()) as SetupRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!body.clientId || !body.clientSecret) {
    return jsonResponse(
      { ok: false, error: "Both clientId and clientSecret are required." },
      400,
    );
  }
  try {
    const envPath = await writeCredentials(body.clientId, body.clientSecret);
    resetAuthCache();
    return jsonResponse({ ok: true, envPath });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
}

// --- SSE fan-out ------------------------------------------------------------

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseEncoder = new TextEncoder();

const broadcast = (event: string, data: unknown): void => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const bytes = sseEncoder.encode(msg);
  for (const c of sseClients) {
    try {
      c.enqueue(bytes);
    } catch {
      /* client closed */
    }
  }
};

// Periodic heartbeat so SSE connections are never fully idle, even without
// a watcher event. A `:` line is an SSE comment — the browser ignores it
// but it keeps the socket live through any reverse proxies.
const HEARTBEAT_BYTES = sseEncoder.encode(`: ping\n\n`);
// unref: this module is imported by cli.ts for every command (not just `serve`),
// so this timer must not keep the process alive when no server is running.
setInterval(() => {
  for (const c of sseClients) {
    try {
      c.enqueue(HEARTBEAT_BYTES);
    } catch {
      /* client closed */
    }
  }
}, 20_000).unref();

// --- Clipboard watcher state machine ---------------------------------------

interface WatcherState {
  active: boolean;
  opts: {
    level: number | null;
    spec: string | null;
    metric: Metric | null;
  };
  intervalId: ReturnType<typeof setInterval> | null;
  backend: ClipboardBackend | null;
  lastSeen: string;
}

const watcher: WatcherState = {
  active: false,
  opts: { level: null, spec: null, metric: null },
  intervalId: null,
  backend: null,
  lastSeen: "",
};

async function watcherTick(): Promise<void> {
  if (!watcher.backend) return;
  let value = "";
  try {
    value = (await watcher.backend.read()).trim();
  } catch (e) {
    broadcast("error", {
      message: "clipboard read failed: " + (e instanceof Error ? e.message : String(e)),
    });
    return;
  }
  if (value === watcher.lastSeen) return;
  watcher.lastSeen = value;
  const parsed = isPlausibleNameRealm(value);
  if (!parsed) return;
  broadcast("searching", { character: value });
  const result = await runLookupWithCache({
    character: value,
    level: watcher.opts.level,
    spec: watcher.opts.spec,
    metric: watcher.opts.metric,
    refresh: false,
  });
  if (result.ok) {
    broadcast("result", { key: result.key, fromCache: result.fromCache });
  } else {
    broadcast("error", { message: result.error, character: value });
  }
}

async function startWatcher(opts: WatcherState["opts"]): Promise<void> {
  // Always update options — allows reconfiguring without a restart.
  watcher.opts = opts;
  if (watcher.active) {
    broadcast("status", { active: true, opts });
    return;
  }
  try {
    watcher.backend = await detectClipboardReader();
  } catch (e) {
    throw new Error(
      "Clipboard unavailable on this platform: " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  // Seed lastSeen so we don't instantly re-fire on whatever was in the clipboard.
  try {
    watcher.lastSeen = (await watcher.backend.read()).trim();
  } catch {
    watcher.lastSeen = "";
  }
  watcher.active = true;
  watcher.intervalId = setInterval(watcherTick, 750);
  broadcast("status", {
    active: true,
    opts,
    backend: watcher.backend.label,
  });
}

function stopWatcher(): void {
  if (!watcher.active) return;
  if (watcher.intervalId) {
    clearInterval(watcher.intervalId);
    watcher.intervalId = null;
  }
  watcher.active = false;
  broadcast("status", { active: false });
}

const openBrowser = (url: string): void => {
  const isWSL =
    process.platform === "linux" &&
    (!!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP);

  let cmd: string[] | null = null;
  if (process.platform === "win32" || isWSL) {
    cmd = ["cmd.exe", "/c", "start", "", url];
  } else if (process.platform === "darwin") {
    cmd = ["open", url];
  } else if (process.platform === "linux") {
    cmd = ["xdg-open", url];
  }
  if (!cmd) return;

  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* best-effort */
  }
};

// Installed bun-types (1.3.12) requires an explicit WebSocketData type argument on
// `Server` (it had none when this task was verified on Bun 1.3.4); `undefined` matches
// `Bun.serve`'s default here since we don't use the websocket upgrade API.
export async function runServer(opts: ServeOptions): Promise<Server<undefined>> {
  if (process.listenerCount("SIGINT") === 0) {
    process.on("SIGINT", () => {
      closeStore();
      process.exit(0);
    });
  }

  const envPathHint = await resolveEnvPath();
  const serveStatic = createStaticHandler(opts.assets ?? defaultAssetLoader);

  const server = Bun.serve({
    port: opts.port,
    // Local single-user tool — disable the 10s idle-connection timeout so
    // long-lived SSE streams and slow enrichment lookups don't get killed.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "GET") {
        const staticRes = await serveStatic(path);
        if (staticRes) return staticRes;
      }
      if (req.method === "POST" && path === "/api/setup") {
        return handleSetup(req);
      }
      if (req.method === "POST" && path === "/api/lookup") {
        return handleLookup(req);
      }
      if (req.method === "GET" && path === "/api/history") {
        // Newest first for the UI.
        const items = history.list().map(historySummary);
        return jsonResponse({ ok: true, items });
      }
      if (req.method === "GET" && path.startsWith("/api/history/")) {
        const key = decodeURIComponent(path.slice("/api/history/".length));
        const entry = history.get(key);
        if (!entry) return jsonResponse({ ok: false, error: "Not in history" }, 404);
        return jsonResponse({ ok: true, result: entry.result, key, fromCache: true });
      }
      if (req.method === "DELETE" && path === "/api/history") {
        history.clear();
        return jsonResponse({ ok: true });
      }
      if (req.method === "DELETE" && path.startsWith("/api/history/")) {
        const key = decodeURIComponent(path.slice("/api/history/".length));
        const removed = history.remove(key);
        return jsonResponse({ ok: removed });
      }
      if (req.method === "GET" && path === "/api/events") {
        let selfController: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            selfController = controller;
            sseClients.add(controller);
            controller.enqueue(
              sseEncoder.encode(
                `event: status\ndata: ${JSON.stringify({
                  active: watcher.active,
                  opts: watcher.opts,
                  backend: watcher.backend?.label ?? null,
                })}\n\n`,
              ),
            );
          },
          cancel() {
            sseClients.delete(selfController);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }
      if (req.method === "POST" && path === "/api/watch/start") {
        let body: {
          level?: number | string | null;
          spec?: string | null;
          metric?: string | null;
        };
        try {
          body = await req.json();
        } catch {
          body = {};
        }
        let level: number | null = null;
        if (body.level !== undefined && body.level !== null && body.level !== "") {
          const n = Number.parseInt(String(body.level), 10);
          if (Number.isFinite(n) && n >= 2) level = n;
        }
        const opts = {
          level,
          spec: body.spec && body.spec.trim() ? body.spec.trim() : null,
          metric: parseMetric(body.metric ?? null) ?? null,
        };
        try {
          await startWatcher(opts);
          return jsonResponse({ ok: true, active: true, opts });
        } catch (e) {
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            500,
          );
        }
      }
      if (req.method === "POST" && path === "/api/watch/stop") {
        stopWatcher();
        return jsonResponse({ ok: true, active: false });
      }
      if (req.method === "GET" && path === "/api/watch/status") {
        return jsonResponse({
          ok: true,
          active: watcher.active,
          opts: watcher.opts,
          backend: watcher.backend?.label ?? null,
        });
      }
      if (req.method === "POST" && path === "/api/quit") {
        stopWatcher();
        queueMicrotask(() => setTimeout(() => {
          closeStore();
          process.exit(0);
        }, 120));
        return jsonResponse({ ok: true });
      }
      if (req.method === "GET" && path === "/api/status") {
        return jsonResponse({
          ok: true,
          hasCredentials: hasCredentials(),
          envPath: envPathHint,
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const url = `http://localhost:${server.port}`;
  console.log(`${heading("bmpl serve")}  ${ok(url)}`);
  console.log(
    dim(
      `  env path: ${envPathHint}  ·  credentials: ${
        hasCredentials() ? "loaded" : "not set (setup page will open)"
      }`,
    ),
  );
  console.log(dim("  Ctrl+C to stop."));

  if (opts.open) {
    // tiny delay so the server is ready before the browser hits it
    setTimeout(() => openBrowser(url), 80);
  }

  return server;
}
