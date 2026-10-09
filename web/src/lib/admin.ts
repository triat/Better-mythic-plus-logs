// Admin page view models (issue #8): budget gauge, proposal queue, users, invites, instance; audit log rows (issue #9). Pure; tested.
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser, AuditAction, AuditKind, AuditRow, FeatureUsage, OverrideEntry, UsageCategory, UsageReport } from "../types.ts";
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
  /** "pts · hour" cell: a member with their own WCL client spends nothing from the shared budget, so it shows their own-client points, labelled. */
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
    points24h: fmtPts(u.points24h + u.ownPoints24h), discordId: u.discordId, sessions: u.sessions, canRevoke: !self && !banned,
    banned, ban: self || u.configAdmin ? null : banned ? "unban" : "ban", pointsCell: u.ownClient ? t("admin.users.ownClientPts", { pts: fmtPts(u.ownPointsHour) }) : pointsHour,
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
  ops_denied: "security",
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
    case "ops_denied":
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

// --- Feature usage (spec 2026-10-09-feature-usage-dashboard-design.md; canvas "usage", A table + B cards) ---

/** The categories in catalogue order (the front's copy of `USAGE_CATEGORIES`: runtime values cannot come from src/). */
export const USAGE_CATEGORY_ORDER: readonly UsageCategory[] = ["lookup", "result", "deepdive", "history", "live", "help", "account", "admin"];
export type UsageView = "table" | "categories";
const DAY = 86_400_000;
const pctOf = (share: number): number => Math.round(share * 100);

export interface UsageKpi { key: string; label: string; value: string; sub: string; warn: boolean }
export function usageKpis(t: T, r: UsageReport): UsageKpi[] {
  const pctMembers = (n: number) => t("admin.usage.kpi.pctMembers", { pct: r.members > 0 ? Math.round((n / r.members) * 100) : 0 });
  const lookups = r.features.filter((f) => f.event === "lookup" || f.event === "lookup_cached" || f.event === "lookup_refresh").reduce((s, f) => s + f.uses, 0);
  const unused = r.features.filter((f) => f.uses === 0).length;
  return [
    { key: "today", label: t("admin.usage.kpi.today"), value: fmtPts(r.active.today), sub: t("admin.usage.kpi.ofMembers", { n: fmtPts(r.members) }), warn: false },
    { key: "d7", label: t("admin.usage.kpi.d7"), value: fmtPts(r.active.d7), sub: pctMembers(r.active.d7), warn: false },
    { key: "d30", label: t("admin.usage.kpi.d30"), value: fmtPts(r.active.d30), sub: pctMembers(r.active.d30), warn: false },
    { key: "lookups", label: t("admin.usage.kpi.lookups"), value: r.active.period > 0 ? fmtPts(Math.round(lookups / r.active.period)) : "—", sub: t("admin.usage.kpi.lookupsSub", { days: r.days }), warn: false },
    { key: "unused", label: t("admin.usage.kpi.unused"), value: String(unused), sub: t("admin.usage.kpi.ofCatalogue", { n: r.features.length }), warn: unused > 0 },
  ];
}

export interface UsageChip { key: UsageCategory | "all"; label: string; count: number }
/** "All" plus one chip per category that has catalogue entries, with how many it holds. */
export function usageChips(t: T, r: UsageReport): UsageChip[] {
  return [
    { key: "all", label: t("admin.usage.category.all"), count: r.features.length },
    ...USAGE_CATEGORY_ORDER.map((c) => ({ key: c, label: t(`admin.usage.category.${c}`), count: r.features.filter((f) => f.category === c).length })).filter((c) => c.count > 0),
  ];
}

export interface SparkBar { pct: number; title: string }
export interface UsageTopRow { userId: number; name: string; initials: string; uses: string; last: string }
export interface UsageRowModel {
  event: string; category: string; source: string; sharePct: number; users: string; uses: string; last: string; unused: boolean;
  spark: SparkBar[]; top: UsageTopRow[]; topTitle: string; topTotal: string;
}
const dayLabel = (ms: number): string => new Date(ms).toISOString().slice(5, 10);

export function usageRow(t: T, r: UsageReport, f: FeatureUsage, now = Date.now()): UsageRowModel {
  const max = Math.max(0, ...f.daily);
  return {
    event: f.event,
    category: t(`admin.usage.category.${f.category}`),
    source: t(`admin.usage.source.${f.source}`),
    sharePct: pctOf(f.share),
    users: fmtPts(f.users),
    uses: fmtPts(f.uses),
    last: f.lastAt === null ? t("admin.usage.never") : fmtShortAge(t, f.lastAt, now),
    unused: f.uses === 0,
    // 0 = an empty day (drawn as a flat tick); otherwise at least 8 % so a small day stays visible.
    spark: f.daily.map((n, i) => ({ pct: n === 0 || max === 0 ? 0 : Math.max(8, Math.round((n / max) * 100)), title: t("admin.usage.dayTitle", { day: dayLabel(r.from + i * DAY), n: fmtPts(n) }) })),
    top: f.top.map((u) => ({ userId: u.userId, name: u.username, initials: initialsOf(u.username), uses: fmtPts(u.uses), last: fmtShortAge(t, u.lastAt, now) })),
    topTitle: t("admin.usage.topTitle", { event: f.event, days: r.days }),
    topTotal: t("admin.usage.topTotal", { count: f.users }) + (r.includeAdmins ? "" : t("admin.usage.adminsHidden")),
  };
}

/** Variant A: the table rows of one category (or all), used ones (most members first, as the server sorts) then the unused ones. */
export function usageTable(t: T, r: UsageReport, category: UsageCategory | "all", now = Date.now()): { used: UsageRowModel[]; unused: UsageRowModel[] } {
  const rows = r.features.filter((f) => category === "all" || f.category === category).map((f) => usageRow(t, r, f, now));
  return { used: rows.filter((x) => !x.unused), unused: rows.filter((x) => x.unused) };
}

export interface UsageCardModel { key: UsageCategory; title: string; sub: string; lines: Array<{ row: UsageRowModel; value: string }> }
/** Variant B: one card per category, lines most members first, unused ones last and flagged. */
export function usageCards(t: T, r: UsageReport, now = Date.now()): UsageCardModel[] {
  return USAGE_CATEGORY_ORDER.map((c) => {
    const fs = r.features.filter((f) => f.category === c);
    const unused = fs.filter((f) => f.uses === 0).length;
    const rows = [...fs.filter((f) => f.uses > 0), ...fs.filter((f) => f.uses === 0)].map((f) => usageRow(t, r, f, now));
    return {
      key: c,
      title: t(`admin.usage.category.${c}`),
      sub: t("admin.usage.cardSub", { count: fs.length }) + (unused > 0 ? t("admin.usage.cardUnused", { n: unused }) : ""),
      lines: rows.map((row) => ({ row, value: row.unused ? t("admin.usage.unused") : t("admin.usage.lineValue", { users: row.users, pct: row.sharePct }) })),
    };
  }).filter((c) => c.lines.length > 0);
}

/** Nothing recorded at all over the period (the first days after the release). */
export const usageIsEmpty = (r: UsageReport): boolean => r.features.every((f) => f.uses === 0);
