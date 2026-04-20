import { $ } from "bun";
import pc from "picocolors";
import { dim, err, heading, ok } from "./format.ts";
import { renderLookup } from "./format-mplus.ts";
import {
  analyzeLookup,
  fetchMplusData,
  filterBySpec,
  inferTargetLevel,
  uniqueSpecs,
} from "./mplus.ts";
import type { Metric } from "./roles.ts";
import { parseNameRealm } from "./util.ts";

type ClipboardReader = () => Promise<string>;

export interface WatchOptions {
  level: number | null;
  spec: string | null;
  metric: Metric | undefined;
  intervalMs: number;
}

const stripTrailingNewline = (s: string): string => s.replace(/\r?\n$/, "");

async function which(cmd: string): Promise<boolean> {
  try {
    const p = await $`which ${cmd}`.nothrow().quiet();
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

const isWSL = (): boolean =>
  process.platform === "linux" &&
  (!!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP);

async function detectClipboardReader(): Promise<
  { label: string; read: ClipboardReader }
> {
  if (isWSL() || process.platform === "win32") {
    if (process.platform === "win32" || (await which("powershell.exe"))) {
      return {
        label: "powershell.exe Get-Clipboard",
        read: async () =>
          stripTrailingNewline(
            await $`powershell.exe -NoProfile -Command Get-Clipboard`.text(),
          ),
      };
    }
  }
  if (process.platform === "darwin") {
    return {
      label: "pbpaste",
      read: async () => stripTrailingNewline(await $`pbpaste`.text()),
    };
  }
  if (process.platform === "linux") {
    if (await which("wl-paste")) {
      return {
        label: "wl-paste",
        read: async () => stripTrailingNewline(await $`wl-paste -n`.text()),
      };
    }
    if (await which("xclip")) {
      return {
        label: "xclip",
        read: async () =>
          stripTrailingNewline(
            await $`xclip -selection clipboard -o`.text(),
          ),
      };
    }
  }
  throw new Error(
    "No clipboard reader found. Install wl-clipboard or xclip (Linux), or run this from WSL with PowerShell available.",
  );
}

// Name part: starts with a letter, 2-20 chars (letters, apostrophes).
// Realm part: starts with a letter, 3-30 chars (letters, apostrophes, dashes).
// Using Unicode letter class so accents work.
const NAME_RE = /^[\p{L}][\p{L}'-]{1,19}$/u;
const REALM_RE = /^[\p{L}][\p{L}'-]{2,29}$/u;

const isPlausibleNameRealm = (
  text: string,
): { name: string; realm: string } | null => {
  if (text.length < 4 || text.length > 60) return null;
  if (/\s/.test(text)) return null; // in-game compact form has no spaces
  const p = parseNameRealm(text);
  if (!p) return null;
  if (!NAME_RE.test(p.name) || !REALM_RE.test(p.realm)) return null;
  return p;
};

const divider = () => dim("─".repeat(60));

export async function runWatch(opts: WatchOptions): Promise<void> {
  const clipboard = await detectClipboardReader();
  const levelLabel = opts.level === null ? "auto" : `+${opts.level}`;
  console.log(
    `${heading("bmpl watch")}  ${dim(
      `target ${levelLabel}` +
        (opts.spec ? `, spec ${opts.spec}` : "") +
        (opts.metric ? `, metric ${opts.metric}` : "") +
        `  ·  via ${clipboard.label}  ·  poll ${opts.intervalMs}ms`,
    )}`,
  );
  console.log(
    dim(
      "Copy a Name-Realm from the group finder (or anywhere) to trigger a lookup. Ctrl+C to quit.",
    ),
  );

  // Seed lastSeen with the current clipboard so we don't fire on startup.
  let lastSeen = "";
  try {
    lastSeen = (await clipboard.read()).trim();
  } catch {
    // fall through
  }

  while (true) {
    let current: string;
    try {
      current = (await clipboard.read()).trim();
    } catch (e) {
      console.error(
        err(
          "✗ clipboard read failed: " +
            (e instanceof Error ? e.message : String(e)),
        ),
      );
      await Bun.sleep(opts.intervalMs);
      continue;
    }

    if (current === lastSeen) {
      await Bun.sleep(opts.intervalMs);
      continue;
    }
    lastSeen = current;

    const parsed = isPlausibleNameRealm(current);
    if (!parsed) {
      await Bun.sleep(opts.intervalMs);
      continue;
    }

    console.log("");
    console.log(divider());
    console.log(
      `${pc.bold("→")} ${parsed.name}-${parsed.realm} ${dim(
        `(${opts.level === null ? "auto target" : `+${opts.level}`})`,
      )}`,
    );
    console.log(divider());

    try {
      const data = await fetchMplusData(parsed.name, parsed.realm, {
        metric: opts.metric,
        specFilter: opts.spec,
      });
      const runs = opts.spec ? filterBySpec(data.runs, opts.spec) : data.runs;
      if (opts.spec && runs.length === 0) {
        const avail = uniqueSpecs(data.runs);
        console.log(
          err(
            `No runs for spec "${opts.spec}". Specs on this character: ${
              avail.length > 0 ? avail.join(", ") : "(none)"
            }.`,
          ),
        );
      } else {
        const filtered = opts.spec
          ? { ...data, runs, specFilter: opts.spec }
          : data;
        const inferred = inferTargetLevel(filtered.runs);
        const effective = opts.level ?? inferred;
        if (effective === null) {
          console.log(
            err("✗ no runs found — cannot auto-detect target level."),
          );
        } else {
          const result = analyzeLookup(
            filtered.runs,
            effective,
            filtered.seasonDungeons,
            opts.level === null,
          );
          console.log(renderLookup(filtered, result));
        }
      }
    } catch (e) {
      console.error(
        err("✗ " + (e instanceof Error ? e.message : String(e))),
      );
    }

    console.log("");
    console.log(dim(ok("waiting for next clipboard copy…")));
    await Bun.sleep(opts.intervalMs);
  }
}
