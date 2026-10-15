// Structured logs: one JSON object per line on stdout, which journald keeps and Grafana Alloy ships to VictoriaLogs
// (spec docs/superpowers/specs/2026-10-15-observability-design.md, decision 4). Every line carries `ts` (ISO 8601, UTC,
// ms), `level` and `event`, then the event's own fields. Members appear as `user#<id>` only: a field that could name a
// person (an IP, a Discord id) is dropped here, whoever passes it.
export type Level = "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

/** Fields never written, whatever the caller passes: the ops API's rule, applied to the logs. */
const FORBIDDEN = new Set(["ip", "discordId", "discord_id", "username", "email"]);
/** A string field longer than this is clipped; a stack gets more room. */
const MAX_STRING = 1000;
const MAX_STACK = 4000;

// Under `bun test` (NODE_ENV=test) the default sink is silent: a hosted test server would otherwise print a line per
// request. Tests that check the lines install their own sink.
const stdoutSink = (line: string): void => { process.stdout.write(`${line}\n`); };
const defaultSink = process.env.NODE_ENV === "test" ? () => {} : stdoutSink;
let sink: (line: string) => void = defaultSink;
let clock: () => number = Date.now;

/** Tests: capture the lines (and fix the clock); `null` restores the default sink and the real clock. */
export function setLogSink(fn: ((line: string) => void) | null, now: (() => number) | null = null): void {
  sink = fn ?? defaultSink;
  clock = now ?? Date.now;
}

const clipped = (k: string, v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const max = k === "stack" ? MAX_STACK : MAX_STRING;
  return v.length > max ? `${v.slice(0, max)}…` : v;
};

/** The message a log viewer shows for the line: the event, with its most telling field. */
const msgOf = (event: string, f: Fields): string => {
  if (event === "http_request") return `${String(f.method)} ${String(f.route)} ${String(f.status)} ${String(f.ms)} ms`;
  if (typeof f.message === "string") return `${event}: ${f.message}`;
  if (typeof f.action === "string") return `${event}: ${f.action}`;
  return event;
};

export function logEvent(level: Level, event: string, fields: Fields = {}): void {
  // `msg` is what VictoriaLogs takes as the message (`_msg_field=msg` in deploy/alloy/config.alloy); `event` stays a field.
  const out: Fields = { ts: new Date(clock()).toISOString(), level, event, msg: clipped("msg", msgOf(event, fields)) };
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN.has(k) || v === undefined || k === "ts" || k === "level" || k === "event" || k === "msg") continue;
    out[k] = clipped(k, v);
  }
  let line: string;
  try {
    line = JSON.stringify(out);
  } catch {
    line = JSON.stringify({ ts: out.ts, level, event, unserializable: true });
  }
  sink(line);
}

export const log = {
  info: (event: string, fields?: Fields) => logEvent("info", event, fields),
  warn: (event: string, fields?: Fields) => logEvent("warn", event, fields),
  error: (event: string, fields?: Fields) => logEvent("error", event, fields),
};

/** `message` and `stack` of anything thrown. */
export const errorFields = (e: unknown): { message: string; stack: string | null } =>
  e instanceof Error ? { message: e.message, stack: e.stack ?? null } : { message: String(e), stack: null };

/** The way a member appears in the logs. */
export const userRef = (id: number | null | undefined): string | null => (id === null || id === undefined ? null : `user#${id}`);
