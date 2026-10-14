// Dev-only, spends WCL points (~100 per character never seen before, a few if already cached). Runs
// the production lookup — `performLookup`, the very code behind bmpl.riat.dev — on a stratified sample
// of the pool discover.ts built, and saves each payload for offline analysis (analyze.ts re-scores them
// at 0 points, as often as needed).
//
//   bun scripts/calibration/collect.ts [--until HH:MM] [--reserve 200] [--concurrency 1] [--pace 16] [--limit N]
//
// Pacing: WCL rate-limits per IP address ("Too many requests from this IP address") independently of the
// point budget — a burst of ~160 lookups in 3 minutes got the IP blocked. So lookups are spread over
// the hour instead of spent in a burst: one start every `--pace` seconds (~90 pts each, 18,000 pts/h →
// one every ~18 s uses the whole budget), and a 429 backs off exponentially, from 1 to 10 minutes.
//
// Sampling: every character gets one cell, role × level (15..20) × performance quintile (5), and the
// collector takes one character per cell per round, round after round. Whenever it stops — deadline,
// budget, Ctrl+C — the sample is balanced across cells. Resumable: a character with a saved payload (or
// a recorded failure) is never looked up twice.
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setRateLimitObserver, type RateLimit } from "../../src/wcl/client.ts";
import { buildLookupPayload, performLookup } from "../../src/lookup.ts";
import { candidates, schedule } from "../../src/calibration/discover.ts";
import { DIR, LEVELS, type PoolEntry } from "./discover.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const UNTIL = args.get("until") ?? "12:50";
const RESERVE = Number(args.get("reserve") ?? 200);
const CONCURRENCY = Number(args.get("concurrency") ?? 1);
const PACE_MS = Number(args.get("pace") ?? 16) * 1000;
const LIMIT = Number(args.get("limit") ?? Infinity);
/** Never start a lookup that could push the hour past the reserve: a fresh character's worst case. */
const LOOKUP_HEADROOM = 250;

const PAYLOADS = `${DIR}/payloads`;
const FAILED = `${DIR}/failed.jsonl`;
const LOG = `${DIR}/collect.log`;

export { type Candidate, candidates, fileKey, schedule } from "../../src/calibration/discover.ts";

function deadline(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h!, m!, 0, 0);
  return d.getTime();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  mkdirSync(PAYLOADS, { recursive: true });
  const pool = JSON.parse(readFileSync(`${DIR}/pool.json`, "utf8")) as PoolEntry[];
  const failed = new Set(existsSync(FAILED) ? readFileSync(FAILED, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).key as string) : []);
  const queue = schedule(candidates(pool)).filter((c) => LEVELS.includes(c.level as never) && !failed.has(c.key) && !existsSync(`${PAYLOADS}/${c.key}.json`));
  const stopAt = deadline(UNTIL);
  const log = (line: string) => { const l = `${new Date().toTimeString().slice(0, 8)} ${line}`; console.log(l); appendFileSync(LOG, l + "\n"); };
  log(`queue ${queue.length} candidates, until ${UNTIL}, reserve ${RESERVE} pts, ${CONCURRENCY} workers`);

  // Budget, from every WCL response's rateLimitData.
  let rl: (RateLimit & { at: number }) | null = null;
  setRateLimitObserver((r) => { if (!rl || r.pointsSpentThisHour >= rl.pointsSpentThisHour || Date.now() > rl.at + rl.pointsResetIn * 1000) rl = { ...r, at: Date.now() }; });
  let throttledUntil = 0;
  let backoffMs = 60_000;
  let nextStartAt = 0;
  let done = 0;
  let next = 0;

  async function waitForBudget(): Promise<void> {
    for (;;) {
      if (Date.now() < throttledUntil) { await sleep(throttledUntil - Date.now()); continue; }
      if (!rl) return;
      const left = rl.limitPerHour - rl.pointsSpentThisHour;
      if (left >= RESERVE + LOOKUP_HEADROOM) return;
      const resetAt = rl.at + rl.pointsResetIn * 1000 + 5000;
      log(`budget: ${left.toFixed(0)} pts left this hour — pausing until the reset (${new Date(resetAt).toTimeString().slice(0, 5)})`);
      await sleep(Math.max(5000, resetAt - Date.now()));
      rl = null; // the next response re-primes it
      return;
    }
  }

  async function worker(): Promise<void> {
    while (next < queue.length && done < LIMIT && Date.now() < stopAt) {
      const c = queue[next++]!;
      await waitForBudget();
      // One lookup start per PACE_MS across all workers.
      const wait = nextStartAt - Date.now();
      nextStartAt = Math.max(Date.now(), nextStartAt) + PACE_MS;
      if (wait > 0) await sleep(wait);
      if (Date.now() >= stopAt) break;
      const before = rl?.pointsSpentThisHour ?? null;
      try {
        const outcome = await performLookup({ name: c.name, realm: c.server, region: "eu", level: c.level, spec: c.spec, enrich: true });
        if (!outcome.ok) {
          appendFileSync(FAILED, JSON.stringify({ key: c.key, status: outcome.status, error: outcome.error }) + "\n");
          log(`skip ${c.name}-${c.server} (${c.spec}): ${outcome.status} ${outcome.error.slice(0, 80)}`);
          continue;
        }
        backoffMs = 60_000; // a successful lookup ends any backoff streak
        const payload = buildLookupPayload(outcome, c.server);
        writeFileSync(`${PAYLOADS}/${c.key}.json`, JSON.stringify({ study: c, payload }));
        done++;
        const ev = outcome.evaluation;
        // With 3 workers the delta also carries the other lookups' spending: an estimate, not a bill.
        const cost = before === null || !rl ? "?" : Math.max(0, rl.pointsSpentThisHour - before).toFixed(0);
        log(`#${done} ${c.role}/+${c.level}/q${c.quintile} ${c.name}-${c.server} ${c.spec}: ${ev.verdict} ${ev.global ?? "—"} (~${cost} pts, ${rl ? (rl.limitPerHour - rl.pointsSpentThisHour).toFixed(0) : "?"} left)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/429/.test(msg)) {
          throttledUntil = Date.now() + backoffMs;
          queue.push(c); // retried at the end of the queue
          log(`429 on ${c.name}-${c.server}: WCL is limiting this IP — all workers pause ${backoffMs / 60_000} min`);
          backoffMs = Math.min(10 * 60_000, backoffMs * 2);
        } else {
          appendFileSync(FAILED, JSON.stringify({ key: c.key, status: 0, error: msg.slice(0, 300) }) + "\n");
          log(`error ${c.name}-${c.server} (${c.spec}): ${msg.slice(0, 120)}`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`stopped: ${done} payloads saved this run`);
}

if (import.meta.main) await main();
