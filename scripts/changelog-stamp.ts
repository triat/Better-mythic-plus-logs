#!/usr/bin/env bun
// Release step (release.yml): the user-facing changelog's "next" entry becomes the released version, in both
// languages. With no "next" entry in either file the release is a technical one (nothing the users notice): nothing is
// stamped and the release goes on (decided 2026-10-27). Refuses (exit 1) when only one file has the entry, when it is
// empty, or when the version is already listed. Spec: docs/superpowers/specs/2026-10-14-whats-new-design.md, decision 3.
//
//   bun scripts/changelog-stamp.ts <X.Y.Z> <YYYY-MM-DD> [dir]     (dir defaults to web/src/changelog)
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ChangelogEntry } from "../web/src/changelog/types.ts";

export const FILES = ["en.ts", "fr.ts"] as const;
const NEXT = /version: "next",\n/;

/** The checks before stamping: a "next" entry with at least one non-empty line. Null when fine, else why not. */
export function nextProblem(entries: ChangelogEntry[]): string | null {
  const next = entries.find((e) => e.version === "next");
  if (!next) return "no \"next\" entry";
  if (next.items.length === 0 || next.items.some((i) => i.trim() === "")) return "the \"next\" entry is empty";
  return null;
}

/** The file's source with its `version: "next",` line replaced by the version and the date. */
export function stampSource(src: string, version: string, date: string): string {
  const m = NEXT.exec(src);
  if (!m) throw new Error("no `version: \"next\",` line");
  const indent = src.slice(src.lastIndexOf("\n", m.index) + 1, m.index);
  return src.replace(NEXT, `version: "${version}",\n${indent}date: "${date}",\n`);
}

if (import.meta.main) {
  const [version, date, dir = "web/src/changelog"] = process.argv.slice(2);
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: changelog-stamp <X.Y.Z> <YYYY-MM-DD> [dir]");
    process.exit(2);
  }
  const loaded: { f: string; entries: ChangelogEntry[] }[] = [];
  for (const f of FILES) {
    const mod = (await import(resolve(dir, f))) as Record<string, ChangelogEntry[]>;
    loaded.push({ f, entries: Object.values(mod).find(Array.isArray) ?? [] });
  }
  const withNext = loaded.filter((l) => l.entries.some((e) => e.version === "next"));
  if (withNext.length === 0) {
    console.log(`changelog: no "next" entry, ${version} is a technical release (nothing stamped, nothing new for the users)`);
    process.exit(0);
  }
  const problems: string[] = [];
  for (const { f, entries } of loaded) {
    const why = nextProblem(entries);
    if (why) problems.push(`${f}: ${why}`);
    if (entries.some((e) => e.version === version)) problems.push(`${f}: version ${version} is already in the changelog`);
  }
  if (problems.length > 0) {
    console.error(`The changelog cannot be stamped for ${version}: ${problems.join("; ")}. Write the release's lines under "next" in both web/src/changelog/en.ts and fr.ts, or in neither for a technical release.`);
    process.exit(1);
  }
  for (const f of FILES) {
    const path = join(dir, f);
    writeFileSync(path, stampSource(readFileSync(path, "utf8"), version, date));
  }
  console.log(`changelog: "next" → ${version} (${date})`);
}
