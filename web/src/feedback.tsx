// Members' feedback (canvas "bmpl · Retours"): the context that opens the form from the account menu, the form itself
// (the What's new panel's frame), and the one-time invitation after a few lookups. Hosted and signed in only.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { api } from "./api.ts";
import { analyticsEvent } from "./analytics.ts";
import { FEEDBACK_KINDS, FEEDBACK_MESSAGE_MAX, PROMPT_KEY, parsePrompt, promptAfterLookup, promptDue, promptLater, promptStop, type PromptState } from "./lib/feedback.ts";
import { trapFocus } from "./lib/runSheet.ts";
import { useT } from "./locale.tsx";
import type { FeedbackKind } from "./types.ts";
import { track } from "./usage.ts";

interface FeedbackApi {
  enabled: boolean;
  operator: string;
  /** Opens the form; `place` says where from (Umami). */
  open: (place: "menu" | "prompt") => void;
  /** A successful lookup: counts towards the invitation. */
  lookedUp: () => void;
}
const Ctx = createContext<FeedbackApi>({ enabled: false, operator: "", open: () => {}, lookedUp: () => {} });
export const useFeedback = (): FeedbackApi => useContext(Ctx);

const readPrompt = (): PromptState => { try { return parsePrompt(localStorage.getItem(PROMPT_KEY)); } catch { return parsePrompt(null); } };
const writePrompt = (s: PromptState) => { try { localStorage.setItem(PROMPT_KEY, JSON.stringify(s)); } catch { /* private mode: the card may show again */ } };

export function FeedbackProvider({ enabled, operator, page, children }: { enabled: boolean; operator: string; page: string; children: ReactNode }) {
  const [form, setForm] = useState(false);
  const [sentGeneral, setSentGeneral] = useState(true);
  const [prompt, setPrompt] = useState<PromptState>(readPrompt);
  const shownOnce = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    void api.feedback.state(null).then((r) => { if (r.ok) setSentGeneral(r.sentGeneral); });
  }, [enabled]);
  const save = (s: PromptState) => { writePrompt(s); setPrompt(s); };
  const open = useCallback((place: "menu" | "prompt") => {
    track("feedback_open");
    analyticsEvent("feedback_open", { place });
    setForm(true);
  }, []);
  const lookedUp = useCallback(() => {
    if (!enabled) return;
    const next = promptAfterLookup(readPrompt());
    writePrompt(next);
    setPrompt(next);
  }, [enabled]);
  const due = enabled && !form && promptDue(prompt, Date.now(), sentGeneral);
  useEffect(() => {
    if (due && !shownOnce.current) { shownOnce.current = true; analyticsEvent("feedback_prompt", { action: "shown" }); }
  }, [due]);
  return (
    <Ctx.Provider value={{ enabled, operator, open, lookedUp }}>
      {children}
      {enabled && form && (
        <FeedbackForm operator={operator} page={page} onClose={() => setForm(false)} onSent={() => { setSentGeneral(true); save(promptStop(readPrompt())); }} />
      )}
      {due && (
        <FeedbackPrompt
          count={prompt.lookups} operator={operator}
          onOpen={() => { save(promptLater(readPrompt(), Date.now())); open("prompt"); }}
          onLater={() => { track("feedback_prompt_later"); analyticsEvent("feedback_prompt", { action: "later" }); save(promptLater(readPrompt(), Date.now())); }}
          onDismiss={() => { track("feedback_prompt_dismiss"); analyticsEvent("feedback_prompt", { action: "dismiss" }); save(promptStop(readPrompt())); }}
        />
      )}
    </Ctx.Provider>
  );
}

const FOCUSABLE = "button, a[href], textarea, input";

function FeedbackForm({ operator, page, onClose, onSent }: { operator: string; page: string; onClose: () => void; onSent: () => void }) {
  const { t } = useT();
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [replyOk, setReplyOk] = useState(true);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textRef.current?.focus(); }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const next = trapFocus(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
    if (next !== null) { e.preventDefault(); items[next]!.focus(); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || state !== "idle") return;
    setState("sending");
    const r = await api.feedback.send({ kind, message: message.trim(), replyOk, page });
    if (!r.ok) { setState("idle"); setError(r.error); return; }
    analyticsEvent("feedback_sent", { kind });
    setState("sent");
    onSent();
  };
  return (
    <div className="wn">
      <div className="wn-scrim" onClick={onClose} aria-hidden="true" />
      <section ref={ref} className="wn-panel fb-panel" role="dialog" aria-modal="true" aria-labelledby="fb-title" onKeyDown={onKeyDown}>
        <header className="wn-head">
          <div className="wn-titles">
            <h2 id="fb-title">{t("feedback.title")}</h2>
            <span className="wn-sub">{t("feedback.sub", { operator })}</span>
          </div>
          <button type="button" className="wn-close" aria-label={t("feedback.close")} onClick={onClose}>×</button>
        </header>
        {state === "sent" ? (
          <p className="fb-sent">{t("feedback.sent")}</p>
        ) : (
          <form className="fb-form" onSubmit={submit}>
            <fieldset className="fb-kinds">
              <legend className="label-caps">{t("feedback.kindLabel")}</legend>
              {FEEDBACK_KINDS.map((k) => (
                <button key={k} type="button" className={"chip fb-chip" + (kind === k ? " chip-on" : "")} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`feedback.kind.${k}`)}</button>
              ))}
            </fieldset>
            <label className="fb-field">
              <span className="label-caps">{t("feedback.messageLabel")}</span>
              <textarea ref={textRef} rows={7} maxLength={FEEDBACK_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} />
              <span className="faint fb-count mono">{t("feedback.count", { n: message.length, max: FEEDBACK_MESSAGE_MAX })}</span>
            </label>
            <label className="fb-check">
              <input type="checkbox" checked={replyOk} onChange={(e) => setReplyOk(e.target.checked)} />
              <span>{t("feedback.replyOk")}</span>
            </label>
            {error && <span className="fb-error">{t("feedback.failed", { error })}</span>}
            <div className="fb-actions">
              <button type="button" className="btn" onClick={onClose}>{t("feedback.cancel")}</button>
              <button type="submit" className="btn btn-primary" disabled={!message.trim() || state === "sending"}>
                {state === "sending" ? t("feedback.sending") : t("feedback.send")}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function FeedbackPrompt({ count, operator, onOpen, onLater, onDismiss }: { count: number; operator: string; onOpen: () => void; onLater: () => void; onDismiss: () => void }) {
  const { t } = useT();
  return (
    <aside className="fb-prompt card" aria-label={t("feedback.prompt.label")}>
      <div className="fb-prompt-head">
        <span className="fb-prompt-title">{t("feedback.prompt.title", { count })}</span>
        <button type="button" className="fb-prompt-x" aria-label={t("feedback.prompt.dismiss")} title={t("feedback.prompt.dismiss")} onClick={onDismiss}>×</button>
      </div>
      <span className="muted">{t("feedback.prompt.sub", { operator })}</span>
      <div className="fb-prompt-actions">
        <button type="button" className="btn btn-primary" onClick={onOpen}>{t("feedback.prompt.open")}</button>
        <button type="button" className="btn" onClick={onLater}>{t("feedback.prompt.later")}</button>
      </div>
    </aside>
  );
}
