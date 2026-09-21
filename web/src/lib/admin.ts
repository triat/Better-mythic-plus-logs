// Admin page view models (issue #8): budget gauge, proposal queue, users, invites, instance; audit log rows (issue #9). Pure; tested.
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser, AuditAction, AuditKind, AuditRow, OverrideEntry } from "../types.ts";
import type { T } from "../i18n/t.ts";
import { patchText } from "./deepdive.ts";
import { fmtAge, fmtPts } from "./format.ts";
import { initialsOf } from "./session.ts";

const H = 3600_000;
const minutes = (s: number): number => Math.max(1, Math.ceil(s / 60));

/** Binary units (KiB/MiB, labelled KB/MB as the canvas does): "41.2 MB", "20.0 KB", "800 B". */
export const fmtBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
export function fmtUptime(t: T, s: number): string {
  if (s < 60) return t("admin.instance.uptimeLessMin");
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return t("admin.instance.uptimeDays", { d, h });
  if (h > 0) return t("admin.instance.uptimeHours", { h, m });
  return t("admin.instance.uptimeMinutes", { m });
}
const pointsTone = (used: number, limit: number): "" | "tone-warn" | "tone-bad" =>
  used >= limit * 0.9 ? "tone-bad" : used >= limit * 0.75 ? "tone-warn" : "";

/** `fmtAge` says "just now" for anything under an hour; the gauge/backup age want minute granularity. */
export function fmtShortAge(t: T, ms: number, now = Date.now()): string {
  const d = now - ms;
  if (d < 60_000) return t("common.age.justNow");
  if (d < H) return t("admin.gauge.minAgo", { n: Math.floor(d / 60_000) });
  return fmtAge(t, ms, now);
}

export interface GaugeModel { used: string; limit: string; pct: number; tone: "" | "tone-warn" | "tone-bad"; sub: string }
export function gaugeModel(t: T, u: AdminUsage | null, now = Date.now()): GaugeModel {
  const limit = u?.instance?.limitPerHour ?? 3600;
  if (!u || !u.instance) return { used: "—", limit: fmtPts(limit), pct: 0, tone: "", sub: t("admin.gauge.noCall") };
  const used = u.instance.pointsSpentThisHour;
  return {
    used: fmtPts(used), limit: fmtPts(limit), pct: Math.min(100, Math.round((used / limit) * 100)), tone: pointsTone(used, limit),
    sub: t("admin.gauge.sub", { min: minutes(u.resetInS), age: fmtShortAge(t, u.instance.observedAt, now) }),
  };
}

export interface ConsumerRow { userId: number; name: string; initials: string; avatarUrl: string; isAdmin: boolean; pct: number; text: string; tone: "" | "tone-warn" | "tone-bad" }
/** This hour's spenders, as the server already returns them (largest first); the bar is the member limit (admins: relative to it, "no limit"). */
export function topConsumers(t: T, u: AdminUsage | null, users: AdminUser[]): ConsumerRow[] {
  if (!u) return [];
  return u.users.map((r) => {
    const user = users.find((x) => x.id === r.userId);
    const isAdmin = (user?.role ?? r.role) === "admin";
    const name = user?.globalName ?? user?.username ?? r.username ?? t("admin.gauge.userRef", { id: String(r.userId) });
    return {
      userId: r.userId, name, initials: initialsOf(name), avatarUrl: user?.avatarUrl ?? "", isAdmin,
      pct: Math.min(100, Math.round((r.points / u.limitPerUser) * 100)),
      text: isAdmin ? t("admin.gauge.noLimit", { pts: fmtPts(r.points) }) : t("admin.gauge.ofLimit", { pts: fmtPts(r.points), limit: fmtPts(u.limitPerUser) }),
      tone: isAdmin ? "" : pointsTone(r.points, u.limitPerUser),
    };
  });
}

export interface HourBar { hourStart: number; points: number; pct: number; current: boolean }
/** 24 hourly slots ending with the current hour; heights relative to the busiest slot. */
export function hourBars(u: AdminUsage | null, now = Date.now()): HourBar[] {
  const end = Math.floor(now / H) * H;
  const byHour = new Map((u?.hours ?? []).map((h) => [h.hourStart, h.points]));
  const slots = Array.from({ length: 24 }, (_, i) => end - (23 - i) * H);
  const peak = Math.max(0, ...slots.map((h) => byHour.get(h) ?? 0));
  return slots.map((h) => {
    const points = byHour.get(h) ?? 0;
    return { hourStart: h, points, pct: peak > 0 ? Math.round((points / peak) * 100) : 0, current: h === end };
  });
}

export interface DiffRow { field: string; from: string; to: string }
/** What a proposal changes, field by field, current → proposed (the canvas "diff" column): name, kind, cooldown, duration. `field` is the displayed label. */
export function diffRows(t: T, p: AdminProposal): DiffRow[] {
  const patch: OverrideEntry = p.patch;
  const cur = p.current;
  const secs = (n: number | undefined): string => (n === undefined ? "—" : t("admin.queue.seconds", { n: String(n) }));
  const notInTable = t("admin.queue.notInTable");
  if (patch.ignore) {
    const from = cur ? t("admin.queue.listed", { kind: cur.kind, cd: String(cur.cooldownS) }) : p.ignored ? t("admin.queue.alreadyIgnored") : notInTable;
    return [{ field: t("admin.queue.field.ignore"), from, to: t("admin.queue.ignoredForSpec") }];
  }
  const rows: DiffRow[] = [];
  const same = (to: string) => t("admin.queue.noChange", { to });
  if (cur !== null && patch.name !== undefined && patch.name !== cur.name) {
    rows.push({ field: t("admin.queue.field.name"), from: cur.name, to: patch.name });
  }
  if (patch.kind !== undefined) {
    rows.push({ field: t("admin.queue.field.kind"), from: cur ? cur.kind : notInTable, to: cur?.kind === patch.kind ? same(patch.kind) : patch.kind });
  }
  if (patch.cooldownS !== undefined) {
    rows.push({ field: t("admin.queue.field.cooldown"), from: secs(cur?.cooldownS), to: cur?.cooldownS === patch.cooldownS ? same(secs(patch.cooldownS)) : secs(patch.cooldownS) });
  }
  if (patch.durationS !== undefined) {
    rows.push({ field: t("admin.queue.field.duration"), from: secs(cur?.durationS), to: cur?.durationS === patch.durationS ? same(secs(patch.durationS)) : secs(patch.durationS) });
  }
  return rows;
}

export interface ProposalCardModel { id: number; spellId: number; name: string; key: string; author: string; when: string; rows: DiffRow[] }
/** The spell id is an identifier: passed as a string so `t` does not group its thousands. */
const spellName = (t: T, p: AdminProposal): string => p.current?.name ?? p.patch.name ?? t("admin.queue.spell", { id: String(p.patch.id) });
export function proposalCard(t: T, p: AdminProposal, now = Date.now()): ProposalCardModel {
  return { id: p.id, spellId: p.spellId, name: spellName(t, p), key: p.key, author: p.username ?? t("admin.queue.unknownUser"), when: fmtAge(t, p.createdAt, now), rows: diffRows(t, p) };
}

export interface DecidedLine { id: number; dot: "dot-approved" | "dot-rejected"; what: string; author: string; status: "approved" | "rejected"; when: string; note: string | null }
export function decidedLine(t: T, p: AdminProposal, now = Date.now()): DecidedLine {
  const status = p.status === "approved" ? "approved" : "rejected";
  return { id: p.id, dot: status === "approved" ? "dot-approved" : "dot-rejected", what: `${spellName(t, p)} · ${p.key} · ${patchText(t, p.patch)}`, author: p.username ?? t("admin.queue.unknownUser"), status, when: fmtAge(t, p.decidedAt ?? p.createdAt, now), note: p.note };
}

export interface UserRowModel {
  id: number; name: string; handle: string; initials: string; avatarUrl: string; role: "member" | "admin"; roleNote: "env" | null; toggle: "make admin" | "make member" | null;
  lastSeen: string; pointsHour: string; pointsHourTone: "" | "tone-warn" | "tone-bad"; points24h: string; discordId: string; sessions: number; canRevoke: boolean;
  /** Issue #11: a banned row is dimmed and shows the red "banned" chip; `ban` is the button to offer (null on yourself and config admins). */
  banned: boolean; ban: "ban" | "unban" | null;
  /** "pts · hour" cell: a member with their own WCL client spends nothing from the shared budget. */
  pointsCell: string;
}
/** `selfId` is the signed-in admin: no toggle, no revoke, no ban on yourself; env admins have no toggle and cannot be banned either; a ban already ended the sessions (no revoke). */
export function userRow(t: T, u: AdminUser, now = Date.now(), selfId: number, limitPerUser = 300): UserRowModel {
  const name = u.globalName ?? u.username;
  const self = u.id === selfId;
  const banned = u.bannedAt !== null;
  const pointsHour = fmtPts(u.pointsHour);
  return {
    id: u.id, name, handle: `@${u.username}`, initials: initialsOf(name), avatarUrl: u.avatarUrl, role: u.role, roleNote: u.configAdmin ? "env" : null,
    toggle: self || u.configAdmin ? null : u.role === "admin" ? "make member" : "make admin",
    lastSeen: fmtAge(t, u.lastSeenAt, now), pointsHour, pointsHourTone: u.role === "admin" ? "" : pointsTone(u.pointsHour, limitPerUser),
    points24h: fmtPts(u.points24h), discordId: u.discordId, sessions: u.sessions, canRevoke: !self && !banned,
    banned, ban: self || u.configAdmin ? null : banned ? "unban" : "ban", pointsCell: u.ownClient ? t("admin.users.ownClient") : pointsHour,
  };
}

export interface InviteRowModel { discordId: string; note: string; added: string; status: string; signedIn: boolean }
/** The "added" text always reads "admin #N" — resolving the id to a name is a component concern (it has the users list). */
export function inviteRow(t: T, i: AdminInvite, now = Date.now()): InviteRowModel {
  const by = i.invitedBy.startsWith("admin:") ? t("admin.invites.adminRef", { n: i.invitedBy.slice(6) }) : i.invitedBy;
  return {
    discordId: i.discordId, note: i.note ?? "—", added: t("admin.invites.added", { age: fmtAge(t, i.createdAt, now), by }),
    status: i.user ? t("admin.invites.signedInAs", { name: i.user.username }) : t("admin.invites.notSignedIn"), signedIn: i.user !== null,
  };
}

export interface InstanceModel { version: string; uptime: string; db: string; dbPath: string; backup: string; env: AdminInstance["env"] }
export function instanceModel(t: T, i: AdminInstance, now = Date.now()): InstanceModel {
  const file = i.dbPath.split(/[\\/]/).pop() ?? i.dbPath;
  return {
    version: i.version, uptime: fmtUptime(t, i.uptimeS), db: `${file} · ${fmtBytes(i.dbBytes)}`, dbPath: i.dbPath,
    backup: i.lastBackupAt === null ? t("admin.instance.neverBackup") : fmtShortAge(t, i.lastBackupAt, now), env: i.env,
  };
}

// --- audit log (issue #9) ---

/** Same map as `ACTION_KIND` in src/hosted/audit.ts, duplicated because web/ imports types only from src/ (`Record` keeps it exhaustive). */
export const AUDIT_KIND_OF: Record<AuditAction, AuditKind> = {
  login: "login",
  login_denied: "login",
  logout: "login",
  account_delete: "login",
  wcl_client_set: "login",
  wcl_client_remove: "login",
  invite_add: "admin",
  invite_remove: "admin",
  role_change: "admin",
  sessions_revoke: "admin",
  proposal_approve: "admin",
  proposal_reject: "admin",
  user_ban: "admin",
  user_unban: "admin",
  quota_refused: "quota",
  rate_limited: "security",
  origin_rejected: "security",
  wcl_error: "error",
  server_error: "error",
};

export const AUDIT_CHIP_KINDS: ReadonlyArray<AuditKind | "all"> = ["all", "login", "admin", "quota", "security", "error"];
/** The kind filter chips, "All" first, in the order of the canvas. */
export const auditChips = (t: T): Array<{ kind: AuditKind | "all"; label: string }> =>
  AUDIT_CHIP_KINDS.map((kind) => ({ kind, label: t(`admin.audit.chips.${kind}`) }));

const AUDIT_DOT: Record<AuditKind, AuditRowModel["dot"]> = { login: "dot-login", admin: "dot-admin", quota: "dot-quota", security: "dot-sec", error: "dot-error" };

export interface AuditRowModel {
  id: number; time: string; who: string; whoFaint: boolean; dot: "dot-login" | "dot-admin" | "dot-quota" | "dot-sec" | "dot-error";
  action: string; target: string; detail: string;
}

const pad2 = (n: number): string => n.toString().padStart(2, "0");
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** Local time: "14:02" today, "yesterday 14:30", else `fmtAge` ("5d ago"). */
function auditTime(t: T, at: number, now: number): string {
  const d = new Date(at), n = new Date(now);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (sameDay(d, n)) return hm;
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (sameDay(d, yesterday)) return t("admin.audit.yesterday", { time: hm });
  return fmtAge(t, at, now);
}

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const noteText = (t: T, note: unknown): string => (typeof note === "string" && note ? t("admin.audit.detail.note", { note }) : "");

/** The detail column, one shape per action (see the `detail` objects recorded in src/server/*.ts); "" when there is nothing to say.
 * The values (message, reason, user agent, origin, username) are server data and stay as recorded; only the glue is translated. */
export function auditDetail(t: T, action: AuditAction, detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  switch (action) {
    case "wcl_error":
    case "server_error":
      return str(detail.message);
    case "quota_refused":
      return t("admin.audit.detail.quotaRefused", {
        what: t(detail.error === "budget" ? "admin.audit.detail.budget" : "admin.audit.detail.quota"),
        used: num(detail.used), limit: num(detail.limit), min: minutes(num(detail.resetInS)),
      });
    case "rate_limited":
      return t("admin.audit.detail.rateLimited", { limit: String(num(detail.limit)), window: String(num(detail.windowS)), retry: String(num(detail.retryAfterS)) });
    case "origin_rejected":
      return `Origin ${str(detail.origin) || "—"}${detail.fetchSite ? ` · Sec-Fetch-Site ${str(detail.fetchSite)}` : ""}`;
    case "login":
      return str(detail.userAgent);
    case "login_denied":
      return str(detail.reason);
    case "invite_add":
      return noteText(t, detail.note);
    case "invite_remove":
    case "sessions_revoke":
      return t("admin.audit.detail.sessionsEnded", { n: num(detail.sessionsEnded) });
    case "proposal_approve":
    case "proposal_reject": {
      const note = noteText(t, detail.note);
      const patch = detail.patch && typeof detail.patch === "object" ? patchText(t, detail.patch as OverrideEntry) : "";
      return `${patch}${note ? ` · ${note}` : ""}`;
    }
    case "user_ban":
      return t("admin.audit.detail.sessionsEnded", { n: num(detail.sessionsEnded) });
    case "account_delete":
      return str(detail.username); // the row's user is gone (userId null): the name is the only trace
    case "role_change":
    case "logout":
    case "wcl_client_set":
    case "wcl_client_remove":
    case "user_unban":
      return "";
  }
}

export function auditRow(t: T, r: AuditRow, now = Date.now()): AuditRowModel {
  return {
    id: r.id, time: auditTime(t, r.at, now), who: r.username ?? "—", whoFaint: r.username === null, dot: AUDIT_DOT[AUDIT_KIND_OF[r.action]],
    action: r.action, target: r.target ?? "", detail: auditDetail(t, r.action, r.detail),
  };
}

export const auditShowing = (t: T, shown: number, total: number): string => t("admin.audit.showing", { shown, total: fmtPts(total) });
