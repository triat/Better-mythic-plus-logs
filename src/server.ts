import pc from "picocolors";
import { hasCredentials } from "./config.ts";
import { dim, err, heading, ok } from "./format.ts";
import {
  analyzeLookup,
  fetchMplusData,
  filterBySpec,
  inferTargetLevel,
  uniqueSpecs,
} from "./mplus.ts";
import type { Metric } from "./roles.ts";
import { renderMainPage, renderSetupPage } from "./server-ui.ts";
import { resolveEnvPath, writeCredentials } from "./setup.ts";
import { parseNameRealm } from "./util.ts";
import { resetAuthCache } from "./wcl/auth.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
}

interface LookupRequest {
  character?: string;
  level?: number | string | null;
  spec?: string | null;
  metric?: string | null;
}

interface SetupRequest {
  clientId?: string;
  clientSecret?: string;
}

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const html = (body: string): Response =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

const parseMetric = (raw: string | null | undefined): Metric | undefined => {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return v === "dps" || v === "hps" ? v : undefined;
};

async function handleLookup(req: Request): Promise<Response> {
  if (!hasCredentials()) {
    return jsonResponse(
      { ok: false, error: "No credentials configured. Visit /setup first." },
      400,
    );
  }
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
  const target =
    parseNameRealm(raw) ??
    (() => {
      const bits = raw.split(/\s+/);
      return bits.length >= 2
        ? { name: bits[0]!, realm: bits.slice(1).join(" ") }
        : null;
    })();
  if (!target) {
    return jsonResponse(
      {
        ok: false,
        error: "Could not parse character. Use `Name-Realm` or `Name Realm`.",
      },
      400,
    );
  }

  const specFilter =
    body.spec && body.spec.trim() ? body.spec.trim() : null;
  const metric = parseMetric(body.metric ?? null);
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

  try {
    const data = await fetchMplusData(target.name, target.realm, {
      metric,
      specFilter,
    });
    const runs = specFilter ? filterBySpec(data.runs, specFilter) : data.runs;
    if (specFilter && runs.length === 0) {
      const avail = uniqueSpecs(data.runs);
      return jsonResponse(
        {
          ok: false,
          error: `No runs for spec "${specFilter}". ${
            avail.length > 0
              ? "Specs on this character: " + avail.join(", ")
              : "Character has no runs this season."
          }`,
        },
        404,
      );
    }
    const filtered = specFilter
      ? { ...data, runs, specFilter }
      : data;
    const inferred = inferTargetLevel(filtered.runs);
    const effective = levelOverride ?? inferred;
    if (effective === null) {
      return jsonResponse(
        {
          ok: false,
          error: "No runs found — cannot auto-detect target level. Pass `level` explicitly.",
        },
        404,
      );
    }
    const result = analyzeLookup(
      filtered.runs,
      effective,
      filtered.seasonDungeons,
      levelOverride === null,
    );

    return jsonResponse({
      ok: true,
      result: {
        character: filtered.character,
        zone: {
          id: filtered.zoneID,
          name: filtered.zoneName,
          partition: filtered.partition,
        },
        metric: filtered.metric,
        metricAutoSelected: filtered.metricAutoSelected,
        alternateMetricHasData: filtered.alternateMetricHasData,
        specFilter: filtered.specFilter,
        runsIndexed: filtered.runs.length,
        seasonDungeons: filtered.seasonDungeons,
        ...result,
      },
    });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
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

export async function runServer(opts: ServeOptions): Promise<void> {
  const envPathHint = await resolveEnvPath();

  const server = Bun.serve({
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "GET" && path === "/") {
        if (!hasCredentials()) {
          return Response.redirect("/setup", 302);
        }
        return html(renderMainPage());
      }
      if (req.method === "GET" && path === "/setup") {
        return html(renderSetupPage(hasCredentials()));
      }
      if (req.method === "POST" && path === "/api/setup") {
        return handleSetup(req);
      }
      if (req.method === "POST" && path === "/api/lookup") {
        return handleLookup(req);
      }
      if (req.method === "POST" && path === "/api/quit") {
        queueMicrotask(() => setTimeout(() => process.exit(0), 120));
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
}
