import pc from "picocolors";
import {
  detectClipboardReader,
  isPlausibleNameRealm,
} from "./clipboard.ts";
import { dim, err, heading, ok } from "./format.ts";
import { renderLookup } from "./format-mplus.ts";
import {
  analyzeLookup,
  enrichLookupResult,
  fetchMplusData,
  filterBySpec,
  inferTargetLevel,
  uniqueSpecs,
} from "./mplus.ts";
import type { Metric } from "./roles.ts";

export interface WatchOptions {
  level: number | null;
  spec: string | null;
  metric: Metric | undefined;
  intervalMs: number;
  enrich: boolean;
}

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
          if (opts.enrich) await enrichLookupResult(filtered, result);
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
