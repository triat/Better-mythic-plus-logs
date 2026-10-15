// Reports the page's uncaught errors and rejections to `POST /api/client-error` (hosted, signed in only), for the logs
// stack's Errors dashboard. A failed send is dropped: reporting must never add an error of its own.
import { api } from "./api.ts";
import { clientErrorReport, createErrorReporter } from "./lib/clientErrors.ts";

/** Turns reporting on for the page's lifetime; returns the teardown. */
export function startErrorReporting(enabled: boolean, version: string | null): () => void {
  if (!enabled) return () => {};
  const report = createErrorReporter((r) => { void api.clientError(r).catch(() => {}); });
  const base = () => ({ page: location.pathname, origin: location.origin, version });
  const onError = (e: ErrorEvent): void => report(clientErrorReport("error", e.error ?? e.message, { ...base(), source: e.filename || null }));
  const onRejection = (e: PromiseRejectionEvent): void => report(clientErrorReport("rejection", e.reason, base()));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
