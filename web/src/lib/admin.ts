// Admin page view models (issue #8): budget gauge, proposal queue, users, invites, instance. Pure; tested.
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser, OverrideEntry } from "../types.ts";
import { patchText } from "./deepdive.ts";
import { fmtAge } from "./format.ts";
import { initialsOf } from "./session.ts";

const H = 3600_000;
const minutes = (s: number): number => Math.max(1, Math.ceil(s / 60));

/** Thousands separated by a space, no decimals: "1 412". */
export const fmtPts = (n: number): string => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
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
  return fmtAge(ms, now);
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
/** What a proposal changes, field by field, current → proposed (the canvas "diff" column). */
export function diffRows(p: AdminProposal): DiffRow[] {
  const patch: OverrideEntry = p.patch;
  const cur = p.current;
  if (patch.ignore) {
    const from = cur ? `listed (${cur.kind}, cd ${cur.cooldownS} s)` : p.ignored ? "already ignored" : "— (not in table)";
    return [{ field: "ignore", from, to: "ignored for this spec" }];
  }
  const rows: DiffRow[] = [];
  const same = (to: string) => `${to} (no change)`;
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
  return { id: p.id, spellId: p.spellId, name: p.current?.name ?? p.patch.name ?? `spell ${p.patch.id}`, key: p.key, author: p.username ?? "unknown user", when: fmtAge(p.createdAt, now), rows: diffRows(p) };
}

export interface DecidedLine { id: number; dot: "dot-approved" | "dot-rejected"; what: string; author: string; status: "approved" | "rejected"; when: string; note: string | null }
export function decidedLine(p: AdminProposal, now = Date.now()): DecidedLine {
  const status = p.status === "approved" ? "approved" : "rejected";
  const name = p.current?.name ?? p.patch.name ?? `spell ${p.patch.id}`;
  return { id: p.id, dot: status === "approved" ? "dot-approved" : "dot-rejected", what: `${name} · ${p.key} · ${patchText(p.patch)}`, author: p.username ?? "unknown user", status, when: fmtAge(p.decidedAt ?? p.createdAt, now), note: p.note };
}

export interface UserRowModel {
  id: number; name: string; handle: string; initials: string; avatarUrl: string; role: "member" | "admin"; roleNote: "env" | null; toggle: "make admin" | "make member" | null;
  lastSeen: string; pointsHour: string; pointsHourTone: "" | "tone-warn" | "tone-bad"; points24h: string; discordId: string; sessions: number; canRevoke: boolean;
}
/** `selfId` is the signed-in admin: no toggle, no revoke on yourself; env admins have no toggle either. */
export function userRow(u: AdminUser, now = Date.now(), selfId: number, limitPerUser = 300): UserRowModel {
  const name = u.globalName ?? u.username;
  const self = u.id === selfId;
  return {
    id: u.id, name, handle: `@${u.username}`, initials: initialsOf(name), avatarUrl: u.avatarUrl, role: u.role, roleNote: u.configAdmin ? "env" : null,
    toggle: self || u.configAdmin ? null : u.role === "admin" ? "make member" : "make admin",
    lastSeen: fmtAge(u.lastSeenAt, now), pointsHour: fmtPts(u.pointsHour), pointsHourTone: u.role === "admin" ? "" : pointsTone(u.pointsHour, limitPerUser),
    points24h: fmtPts(u.points24h), discordId: u.discordId, sessions: u.sessions, canRevoke: !self,
  };
}

export interface InviteRowModel { discordId: string; note: string; added: string; status: string; signedIn: boolean }
/** The "added" text always reads "admin #N" — resolving the id to a name is a component concern (it has the users list). */
export function inviteRow(i: AdminInvite, now = Date.now()): InviteRowModel {
  const by = i.invitedBy.startsWith("admin:") ? `admin #${i.invitedBy.slice(6)}` : i.invitedBy;
  return { discordId: i.discordId, note: i.note ?? "—", added: `${fmtAge(i.createdAt, now)} · ${by}`, status: i.user ? `signed in as ${i.user.username}` : "not signed in yet", signedIn: i.user !== null };
}

export interface InstanceModel { version: string; uptime: string; db: string; dbPath: string; backup: string; env: AdminInstance["env"] }
export function instanceModel(i: AdminInstance, now = Date.now()): InstanceModel {
  const file = i.dbPath.split(/[\\/]/).pop() ?? i.dbPath;
  return {
    version: i.version, uptime: fmtUptime(i.uptimeS), db: `${file} · ${fmtBytes(i.dbBytes)}`, dbPath: i.dbPath,
    backup: i.lastBackupAt === null ? "never (no last-backup file yet)" : fmtShortAge(i.lastBackupAt, now), env: i.env,
  };
}
