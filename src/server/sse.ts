// --- SSE fan-out ------------------------------------------------------------

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseEncoder = new TextEncoder();

export const broadcast = (event: string, data: unknown): void => {
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

/** One SSE stream per browser tab; `initial` is sent immediately (the watcher status today). */
export function eventsResponse(initial: { event: string; data: unknown }): Response {
  let selfController: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      selfController = controller;
      sseClients.add(controller);
      controller.enqueue(sseEncoder.encode(`event: ${initial.event}\ndata: ${JSON.stringify(initial.data)}\n\n`));
    },
    cancel() { sseClients.delete(selfController); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
