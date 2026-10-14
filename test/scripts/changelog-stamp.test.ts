import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextProblem, stampSource } from "../../scripts/changelog-stamp.ts";

const SRC = `export const CHANGELOG_EN = [
  {
    version: "next",
    items: [
      "A line.",
    ],
  },
  {
    version: "0.10.2",
    date: "2026-10-14",
    items: ["Older."],
  },
];
`;

describe("changelog-stamp", () => {
  test("stampSource: next becomes the version with its date, same indentation, nothing else moves", () => {
    const out = stampSource(SRC, "0.10.3", "2026-10-20");
    expect(out).toContain(`  {\n    version: "0.10.3",\n    date: "2026-10-20",\n    items: [\n      "A line.",`);
    expect(out).not.toContain(`"next"`);
    expect(out.replace(`    version: "0.10.3",\n    date: "2026-10-20",\n`, `    version: "next",\n`)).toBe(SRC);
    expect(() => stampSource(out, "0.10.4", "2026-10-21")).toThrow();
  });
  test("nextProblem: missing, empty, blank line, fine", () => {
    expect(nextProblem([{ version: "0.10.2", items: ["x"] }])).toBe("no \"next\" entry");
    expect(nextProblem([{ version: "next", items: [] }])).toBe("the \"next\" entry is empty");
    expect(nextProblem([{ version: "next", items: [" "] }])).toBe("the \"next\" entry is empty");
    expect(nextProblem([{ version: "next", items: ["x"] }])).toBeNull();
  });
  // Synthetic files, not copies of the shipped ones: right after a release the shipped files have no "next" entry.
  test("the script stamps both files, and refuses a second run (no next left)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-stamp-"));
    try {
      mkdirSync(join(dir, "changelog"));
      writeFileSync(join(dir, "changelog", "en.ts"), SRC);
      writeFileSync(join(dir, "changelog", "fr.ts"), SRC.replace("CHANGELOG_EN", "CHANGELOG_FR"));
      const run = (v: string) => Bun.spawnSync(["bun", "scripts/changelog-stamp.ts", v, "2099-01-01", join(dir, "changelog")]);
      const check = () => Bun.spawnSync(["bun", "scripts/changelog-stamp.ts", "--check", join(dir, "changelog")]);
      const before = check();
      expect(before.exitCode).toBe(0);
      expect(before.stdout.toString()).toContain("- A line.");
      const ok = run("9.9.9");
      expect(ok.exitCode).toBe(0);
      for (const f of ["en.ts", "fr.ts"]) {
        const s = readFileSync(join(dir, "changelog", f), "utf8");
        expect(s).toContain(`version: "9.9.9",`);
        expect(s).toContain(`date: "2099-01-01",`);
        expect(s).not.toContain(`version: "next"`);
      }
      const again = run("9.9.10");
      expect(again.exitCode).toBe(1);
      expect(again.stderr.toString()).toContain("no \"next\" entry");
      expect(check().exitCode).toBe(1);
      expect(check().stderr.toString()).toContain("no \"next\" entry");
      writeFileSync(join(dir, "changelog", "en.ts"), "export const X = [];\n");
      expect(run("bad").exitCode).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
