import { useState } from "react";
import { classHex } from "@shared/wow/classes.ts";
import type { StatusInfo } from "../lib/hostedMode.ts";
import { scoreTone } from "../lib/home.ts";
import { PREVIEW_AXES, PREVIEW_SCORE, landingView } from "../lib/landing.ts";
import { useT } from "../locale.tsx";
import { Icon } from "./Icon.tsx";

/** Shaman, the preview's class (WCL class id). */
const PREVIEW_CLASS = 9;
const PREVIEW_LEVEL = 19;

/**
 * The hosted instance's page for a signed-out visitor (redesign spec decision 2, mockup F-Landing; GET /api/me → 401):
 * what bmpl does, the Discord sign-in with the callback's refusals (invite id with its copy button, guild, banned,
 * rate, login failed), three steps, a static preview built from markup (no fetch), the WCL points and data facts.
 */
export function Landing({ status, search }: { status: StatusInfo; search: string }) {
  const { t } = useT();
  const v = landingView(t, status, search);
  const [copied, setCopied] = useState(false);
  const deniedDiscordId = v.notice?.kind === "invite" ? v.notice.discordId : null;
  const refusal = v.notice && v.notice.kind !== "invite" ? v.notice : null;
  const copy = async () => {
    if (!deniedDiscordId) return;
    try { await navigator.clipboard.writeText(deniedDiscordId); setCopied(true); } catch { /* no clipboard access: the id is plain text, selectable */ }
  };
  return (
    <div className="landing">
      <header className="land-top">
        <div className="land-row">
          <a className="home-logo" href="/">bmpl</a>
          <nav className="home-top-nav" aria-label={t("landing.nav")}>
            <a href="/help" className="home-top-a">{t("common.help")}</a>
            <a href="/privacy" className="home-top-a">{t("common.privacy")}</a>
            <a href="/auth/discord" className="btn">{t("landing.signIn")}</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="land-hero">
          <div className="land-row land-hero-row">
            <div className="land-hero-left">
              <span className="side-label home-label">{t("landing.kicker")}</span>
              <h1 className="land-title">{t("landing.title")}</h1>
              <p className="land-sub">{t("landing.sub")}</p>
              <div className="land-cta">
                <a className="btn btn-discord" href="/auth/discord"><Icon name="discord" size={18} /> {t("signin.discord")}</a>
                <span className="home-sub">{t("landing.free")}</span>
              </div>
              {v.loginFailed && <p className="land-failed">{t("signin.failed")}</p>}
              {deniedDiscordId && (
                <div className="inset signin-denied">
                  <div className="label-caps">{t("signin.invite.title")}</div>
                  <div>{t("signin.invite.body")}</div>
                  <div className="signin-id">
                    <span className="mono">{deniedDiscordId}</span>
                    <button type="button" className="chip" onClick={() => void copy()}>{copied ? t("signin.copied") : t("signin.copy")}</button>
                  </div>
                  <div className="faint land-small">{t("signin.invite.then")}</div>
                </div>
              )}
              {refusal && (
                <div className="inset signin-denied">
                  <div className="label-caps">{refusal.title}</div>
                  <div>{refusal.text}</div>
                </div>
              )}
            </div>
            <Preview />
          </div>
        </section>

        <section className="land-section">
          <div className="land-row land-col">
            <h2 className="land-h2">{t("landing.how")}</h2>
            <div className="land-steps">
              {v.steps.map((s) => (
                <div key={s.n} className="card land-step">
                  <span className="mono land-step-n">{s.n}</span>
                  <strong className="land-step-title">{s.title}</strong>
                  <span className="land-text">{s.text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="land-section land-facts-section">
          <div className="land-row land-facts">
            {v.facts.map((f) => (
              <div key={f.key} className="card land-fact">
                <span className="land-fact-icon"><Icon name={f.key === "points" ? "clock" : "lock"} size={22} /></span>
                <div className="land-fact-body">
                  <strong className="land-fact-title">{f.title}</strong>
                  <span className="land-text">{f.text}{f.key === "data" && <> <a href="/privacy">{t("common.privacy")}</a></>}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="land-foot">
        <div className="land-row land-foot-row">
          <span>{t("landing.footer")}</span>
          <a href="/privacy" className="land-foot-first">{t("common.privacy")}</a>
          <a href="/help">{t("common.help")}</a>
        </div>
      </footer>
    </div>
  );
}

/** A static summary card (no data fetch): what a result looks like. */
function Preview() {
  const { t } = useT();
  return (
    <section className="card land-preview" aria-label={t("landing.preview.label")}>
      <div className="land-preview-head">
        <span className="land-preview-icon"><Icon name="bolt" size={24} /></span>
        <div className="home-who land-grow">
          <span className="land-preview-name" style={{ color: classHex(PREVIEW_CLASS) }}>{t("landing.preview.name")}</span>
          <span className="home-sub">{t("landing.preview.who", { level: PREVIEW_LEVEL })}</span>
        </div>
        <div className="land-preview-verdict">
          <span className="mono land-preview-score">{PREVIEW_SCORE}</span>
          <span className="home-verdict invite">{t("verdict.words.invite")}</span>
        </div>
      </div>
      <div className="land-axes">
        {PREVIEW_AXES.map((a) => (
          <div key={a.key} className="land-axis">
            <span className="land-axis-name">{t(`verdict.axes.${a.key}`)}</span>
            <span className="land-axis-track">
              <span className={"land-axis-bar " + scoreTone(a.score)} style={{ width: `${a.score}%` }} />
              <span className="land-axis-tick" />
            </span>
            <span className="mono land-axis-v">{a.score}</span>
          </div>
        ))}
      </div>
      <div className="land-preview-lines">
        <span><span className="mono home-better">+</span> {t("landing.preview.good")}</span>
        <span><span className="mono home-worse">−</span> {t("landing.preview.bad")}</span>
      </div>
      <span className="land-small faint">{t("landing.preview.note")}</span>
    </section>
  );
}
