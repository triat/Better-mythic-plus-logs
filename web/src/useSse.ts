import { useEffect, useRef, useState } from "react";
import type { WatchStatus } from "./types.ts";

export interface SseHandlers {
  status: (s: WatchStatus) => void;
  searching: (d: { character: string }) => void;
  result: (d: { key: string; fromCache: boolean }) => void;
  error: (d: { message: string; character?: string }) => void;
}

/** One EventSource for the app lifetime; returns whether it is currently connected. */
export function useSse(handlers: SseHandlers): boolean {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const es = new EventSource("/api/events");
    // Listeners take `Event` (lib.dom's string overload wants an EventListener); the
    // server's events are MessageEvents with a JSON `data` field.
    const on = (name: keyof SseHandlers) => (e: Event) => {
      const data = (e as MessageEvent).data;
      if (!data) return;
      try {
        (ref.current[name] as (d: unknown) => void)(JSON.parse(data));
      } catch {
        /* malformed event: ignore */
      }
    };
    es.onopen = () => setConnected(true);
    // The server also emits a custom `event: error` (a MessageEvent); it reaches onerror too.
    // Only a real transport error changes readyState, so branch on that, not on the event.
    es.onerror = () => setConnected(es.readyState === EventSource.OPEN);
    es.addEventListener("status", on("status"));
    es.addEventListener("searching", on("searching"));
    es.addEventListener("result", on("result"));
    es.addEventListener("error", on("error"));
    return () => es.close();
  }, []);
  return connected;
}
