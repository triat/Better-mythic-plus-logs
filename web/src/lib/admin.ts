// Admin page view models (issue #8): budget gauge, proposal queue, users, invites, instance; audit log rows (issue #9). Pure; tested.
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser, AuditAction, AuditKind, AuditRow, OverrideEntry } from "../types.ts";
import { tEn } from "../i18n/t.ts";
import { patchText } from "./deepdive.ts";
import { fmtAge, fmtPts } from "./format.ts";
import { initialsOf } from "./session.ts";

const H = 3600_000;
const minutes = (s: number): number => Math.max(1, Math.ceil(s / 60));

/** Binary units (KiB/MiB, labelled KB/MB as the canvas does): "41.2 MB", "20.0 KB", "800 B". */
export const fmtBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
export function fmtUptime(s: number): string {
  if (s < 60) return "less than a minute";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
const pointsTone = (used: number, limit: number): "" | "tone-warn" | "tone-bad" =>
  used >= limit * 0.9 ? "tone-bad" : used >= limit * 0.75 ? "tone-warn" : "";

/** `fmtAge` says "just now" for anything under an hour; the gauge/backup age want minute granularity. */
export function fmtShortAge(ms: number, now = Date.now()): string {
  const d = now - ms;
  if (d < 60_000) return "just now";
  if (d < H) return `${Math.floor(d / 60_000)} min ago`;
  return fmtAge(tEn, ms, now);
}

export interface GaugeModel { used: string; limit: string; pct: number; tone: "" | "tone-warn" | "tone-bad"; sub: string }
export function gaugeModel(u: AdminUsage | null, now = Date.now()): GaugeModel {
  const limit = u?.instance?.limitPerHour ?? 3600;
  if (!u || !u.instance) return { used: "—", limit: fmtPts(limit), pct: 0, tone: "", sub: "no WCL call observed since the server started" };
  const used = u.instance.pointsSpentThisHour;
  return {
    used: fmtPts(used), limit: fmtPts(limit), pct: Math.min(100, Math.round((used / limit) * 100)), tone: pointsTone(used, limit),
    sub: `resets in ${minutes(u.resetInS)} min · floor 100 pts · last rateLimitData ${fmtShortAge(u.instance.observedAt, now)}`,
  };
}

export interface ConsumerRow { userId: number; name: string; initials: string; avatarUrl: string; isAdmin: boolean; pct: number; text: string; tone: "" | "tone-warn" | "tone-bad" }
/** This hour's spenders, as the server already returns them (largest first); the bar is the member limit (admins: relative to it, "no limit"). */
export function topConsumers(u: AdminUsage | null, users: AdminUser[]): ConsumerRow[] {
  if (!u) return [];
  return u.users.map((r) => {
    const user = users.find((x) => x.id === r.userId);
    const isAdmin = (user?.role ?? r.role) === "admin";
    const name = user?.globalName ?? user?.username ?? r.username ?? `user #${r.userId}`;
    return {
      userId: r.userId, name, initials: initialsOf(name), avatarUrl: user?.avatarUrl ?? "", isAdmin,
      pct: Math.min(100, Math.round((r.points / u.limitPerUser) * 100)),
      text: isAdmin ? `${fmtPts(r.points)} · no limit` : `${fmtPts(r.points)} / ${fmtPts(u.limitPerUser)}`,
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
const secs = (n: number | undefined): string => (n === undefined ? "—" : `${n} s`);
/** What a proposal changes, field by field, current → proposed (the canvas "diff" column): name, kind, cooldown, duration. */
export function diffRows(p: AdminProposal): DiffRow[] {
  const patch: OverrideEntry = p.patch;
  const cur = p.current;
  if (patch.ignore) {
    const from = cur ? `listed (${cur.kind}, cd ${cur.cooldownS} s)` : p.ignored ? "already ignored" : "— (not in table)";
    return [{ field: "ignore", from, to: "ignored for this spec" }];
  }
  const rows: DiffRow[] = [];
  const same = (to: string) => `${to} (no change)`;
  if (cur !== null && patch.name !== undefined && patch.name !== cur.name) {
    rows.push({ field: "name", from: cur.name, to: patch.name });
  }
  if (patch.kind !== undefined) {
    rows.push({ field: "kind", from: cur ? cur.kind : "— (not in table)", to: cur?.kind === patch.kind ? same(patch.kind) : patch.kind });
  }
  if (patch.cooldownS !== undefined) {
    rows.push({ field: "cooldown", from: secs(cur?.cooldownS), to: cur?.cooldownS === patch.cooldownS ? same(secs(patch.cooldownS)) : secs(patch.cooldownS) });
  }
  if (patch.durationS !== undefined) {
    rows.push({ field: "duration", from: secs(cur?.durationS), to: cur?.durationS === patch.durationS ? same(secs(patch.durationS)) : secs(patch.durationS) });
  }
  return rows;
}

export interface ProposalCardModel { id: number; spellId: number; name: string; key: string; author: string; when: string; rows: DiffRow[] }
export function proposalCard(p: AdminProposal, now = Date.now()): ProposalCardModel {
  return { id: p.id, spellId: p.spellId, name: p.current?.name ?? p.patch.name ?? `spell ${p.patch.id}`, key: p.key, author: p.username ?? "unknown user", when: fmtAge(tEn, p.createdAt, now), rows: diffRows(p) };
}

export interface DecidedLine { id: number; dot: "dot-approved" | "dot-rejected"; what: string; author: string; status: "approved" | "rejected"; when: string; note: string | null }
export function decidedLine(p: AdminProposal, now = Date.now()): DecidedLine {
  const status = p.status === "approved" ? "approved" : "rejected";
  const name = p.current?.name ?? p.patch.name ?? `spell ${p.patch.id}`;
  return { id: p.id, dot: status === "approved" ? "dot-approved" : "dot-rejected", what: `${name} · ${p.key} · ${patchText(p.patch)}`, author: p.username ?? "unknown user", status, when: fmtAge(tEn, p.decidedAt ?? p.createdAt, now), note: p.note };
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
export function userRow(u: AdminUser, now = Date.now(), selfId: number, limitPerUser = 300): UserRowModel {
  const name = u.globalName ?? u.username;
  const self = u.id === selfId;
  const banned = u.bannedAt !== null;
  const pointsHour = fmtPts(u.pointsHour);
  return {
    id: u.id, name, handle: `@${u.username}`, initials: initialsOf(name), avatarUrl: u.avatarUrl, role: u.role, roleNote: u.configAdmin ? "env" : null,
    toggle: self || u.configAdmin ? null : u.role === "admin" ? "make member" : "make admin",
    lastSeen: fmtAge(tEn, u.lastSeenAt, now), pointsHour, pointsHourTone: u.role === "admin" ? "" : pointsTone(u.pointsHour, limitPerUser),
    points24h: fmtPts(u.points24h), discordId: u.discordId, sessions: u.sessions, canRevoke: !self && !banned,
    banned, ban: self || u.configAdmin ? null : banned ? "unban" : "ban", pointsCell: u.ownClient ? "own client" : pointsHour,
  };
}

export interface InviteRowModel { discordId: string; note: string; added: string; status: string; signedIn: boolean }
/** The "added" text always reads "admin #N" — resolving the id to a name is a component concern (it has the users list). */
export function inviteRow(i: AdminInvite, now = Date.now()): InviteRowModel {
  const by = i.invitedBy.startsWith("admin:") ? `admin #${i.invitedBy.slice(6)}` : i.invitedBy;
  return { discordId: i.discordId, note: i.note ?? "—", added: `${fmtAge(tEn, i.createdAt, now)} · ${by}`, status: i.user ? `signed in as ${i.user.username}` : "not signed in yet", signedIn: i.user !== null };
}

export interface InstanceModel { version: string; uptime: string; db: string; dbPath: string; backup: string; env: AdminInstance["env"] }
export function instanceModel(i: AdminInstance, now = Date.now()): InstanceModel {
  const file = i.dbPath.split(/[\\/]/).pop() ?? i.dbPath;
  return {
    version: i.version, uptime: fmtUptime(i.uptimeS), db: `${file} · ${fmtBytes(i.dbBytes)}`, dbPath: i.dbPath,
    backup: i.lastBackupAt === null ? "never (no last-backup file yet)" : fmtShortAge(i.lastBackupAt, now), env: i.env,
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

export const AUDIT_CHIPS: ReadonlyArray<{ kind: AuditKind | "all"; label: string }> = [
  { kind: "all", label: "All" }, { kind: "login", label: "Logins" }, { kind: "admin", label: "Admin" },
  { kind: "quota", label: "Quota" }, { kind: "security", label: "Security" }, { kind: "error", label: "Errors" },
];

const AUDIT_DOT: Record<AuditKind, AuditRowModel["dot"]> = { login: "dot-login", admin: "dot-admin", quota: "dot-quota", security: "dot-sec", error: "dot-error" };

export interface AuditRowModel {
  id: number; time: string; who: string; whoFaint: boolean; dot: "dot-login" | "dot-admin" | "dot-quota" | "dot-sec" | "dot-error";
  action: string; target: string; detail: string;
}

const pad2 = (n: number): string => n.toString().padStart(2, "0");
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** Local time: "14:02" today, "yesterday 14:30", else `fmtAge` ("5d ago"). */
function auditTime(at: number, now: number): string {
  const d = new Date(at), n = new Date(now);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (sameDay(d, n)) return hm;
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${hm}`;
  return fmtAge(tEn, at, now);
}

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const noteText = (note: unknown): string => (typeof note === "string" && note ? `note: “${note}”` : "");

/** The detail column, one shape per action (see the `detail` objects recorded in src/server/*.ts); "" when there is nothing to say. */
export function auditDetail(action: AuditAction, detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  switch (action) {
    case "wcl_error":
    case "server_error":
      return str(detail.message);
    case "quota_refused":
      return `${detail.error === "budget" ? "instance budget" : "quota"} · ${num(detail.used)}/${num(detail.limit)} pts used, resets in ${minutes(num(detail.resetInS))} min`;
    case "rate_limited":
      return `${num(detail.limit)} per ${num(detail.windowS)} s · retry in ${num(detail.retryAfterS)} s`;
    case "origin_rejected":
      return `Origin ${str(detail.origin) || "—"}${detail.fetchSite ? ` · Sec-Fetch-Site ${str(detail.fetchSite)}` : ""}`;
    case "login":
      return str(detail.userAgent);
    case "login_denied":
      return str(detail.reason);
    case "invite_add":
      return noteText(detail.note);
    case "invite_remove":
    case "sessions_revoke":
      return `${num(detail.sessionsEnded)} session(s) ended`;
    case "proposal_approve":
    case "proposal_reject": {
      const note = noteText(detail.note);
      const patch = detail.patch && typeof detail.patch === "object" ? patchText(detail.patch as OverrideEntry) : "";
      return `${patch}${note ? ` · ${note}` : ""}`;
    }
    case "user_ban":
      return `${num(detail.sessionsEnded)} session(s) ended`;
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

export function auditRow(r: AuditRow, now = Date.now()): AuditRowModel {
  return {
    id: r.id, time: auditTime(r.at, now), who: r.username ?? "—", whoFaint: r.username === null, dot: AUDIT_DOT[AUDIT_KIND_OF[r.action]],
    action: r.action, target: r.target ?? "", detail: auditDetail(r.action, r.detail),
  };
}

export const auditShowing = (shown: number, total: number): string => `showing ${shown} of ${fmtPts(total)} · newest first`;
