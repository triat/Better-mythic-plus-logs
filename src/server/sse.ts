// --- SSE fan-out ------------------------------------------------------------
// Clients are keyed by user id: `null` is a local-mode tab (one person, one process), a number is a
// hosted member's tab. Local broadcasts never reach hosted tabs and a member never sees another's events.

const sseClients = new Map<ReadableStreamDefaultController<Uint8Array>, number | null>();
const sseEncoder = new TextEncoder();

const encode = (event: string, data: unknown): Uint8Array => sseEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const send = (c: ReadableStreamDefaultController<Uint8Array>, bytes: Uint8Array): void => {
  try {
    c.enqueue(bytes);
  } catch {
    /* client closed */
  }
};

/** Local-mode fan-out: every user-less client (the clipboard watcher's audience). */
export const broadcast = (event: string, data: unknown): void => {
  const bytes = encode(event, data);
  for (const [c, userId] of sseClients) if (userId === null) send(c, bytes);
};

/** Hosted fan-out: every tab of one member. */
export const broadcastTo = (userId: number, event: string, data: unknown): void => {
  const bytes = encode(event, data);
  for (const [c, uid] of sseClients) if (uid === userId) send(c, bytes);
};

// Periodic heartbeat so SSE connections are never fully idle, even without
// a watcher event. A `:` line is an SSE comment — the browser ignores it
// but it keeps the socket live through any reverse proxies.
const HEARTBEAT_BYTES = sseEncoder.encode(`: ping\n\n`);
// unref: this module is imported by cli.ts for every command (not just `serve`),
// so this timer must not keep the process alive when no server is running.
setInterval(() => {
  for (const c of sseClients.keys()) send(c, HEARTBEAT_BYTES);
}, 20_000).unref();

/** One SSE stream per browser tab; `initial` is sent immediately (the watcher status today). `userId` is null in local mode. */
export function eventsResponse(initial: { event: string; data: unknown }, userId: number | null): Response {
  let selfController: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      selfController = controller;
      sseClients.set(controller, userId);
      controller.enqueue(encode(initial.event, initial.data));
    },
    cancel() { sseClients.delete(selfController); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
