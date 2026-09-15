import pc from "picocolors";
import {
  detectClipboardReader,
  isPlausibleNameRealm,
} from "./clipboard.ts";
import { dim, err, heading, ok } from "./format.ts";
import { renderLookup } from "./format-mplus.ts";
import { performLookup } from "./lookup.ts";
import type { Metric } from "./roles.ts";
import { closeStore } from "./signals/store.ts";

export interface WatchOptions {
  level: number | null;
  spec: string | null;
  metric: Metric | undefined;
  intervalMs: number;
  enrich: boolean;
}

const divider = () => dim("─".repeat(60));

export async function runWatch(opts: WatchOptions): Promise<void> {
  if (process.listenerCount("SIGINT") === 0) {
    process.on("SIGINT", () => {
      closeStore();
      process.exit(0);
    });
  }

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
      const o = await performLookup({
        name: parsed.name,
        realm: parsed.realm,
        level: opts.level,
        spec: opts.spec,
        metric: opts.metric,
        enrich: opts.enrich,
      });
      if (!o.ok) {
        console.log(err("✗ " + o.error));
      } else {
        console.log(renderLookup(o.data, o.result, o.rio, o.rioError, o.summary));
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
