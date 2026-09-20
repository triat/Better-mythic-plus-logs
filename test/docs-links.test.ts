import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FILES = ["README.md", "AGENTS.md", "deploy/README.md", ...walk(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => f.slice(ROOT.length + 1))];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
/** GitHub's heading → anchor rule (the subset the docs use). */
export const slug = (heading: string): string =>
  heading.trim().toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
/** Drops fenced code blocks so `#` comment lines inside them aren't mistaken for headings or links. */
const stripCode = (md: string): string => md.replace(/```[\s\S]*?```/g, "");
export const headings = (md: string): Set<string> =>
  new Set([...stripCode(md).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1]!)));
/** Relative links only: skips http(s), mailto, and pure in-page anchors are checked against the same file. */
const links = (md: string): Array<{ path: string; anchor: string | null }> =>
  [...stripCode(md).replace(/`[^`\n]*`/g, "").matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((t) => !/^[a-z]+:/.test(t))
    .map((t) => { const [p, a] = t.split("#"); return { path: p ?? "", anchor: a ?? null }; });

describe("docs links", () => {
  for (const file of FILES) {
    test(file, () => {
      const md = readFileSync(join(ROOT, file), "utf8");
      const own = headings(md);
      const bad: string[] = [];
      for (const l of links(md)) {
        const target = l.path === "" ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), l.path);
        if (!existsSync(target)) { bad.push(`${l.path}#${l.anchor ?? ""} (missing file)`); continue; }
        if (l.anchor !== null && target.endsWith(".md")) {
          const h = l.path === "" ? own : headings(readFileSync(target, "utf8"));
          if (!h.has(l.anchor)) bad.push(`${l.path}#${l.anchor} (missing heading)`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
  test("slug", () => {
    expect(slug("Deep-dive: defensive cooldowns")).toBe("deep-dive-defensive-cooldowns");
    expect(slug("Getting Warcraft Logs API credentials")).toBe("getting-warcraft-logs-api-credentials");
    expect(slug("Flags (shared across `lookup`, `mplus`, `watch`)")).toBe("flags-shared-across-lookup-mplus-watch");
  });
  test("ignores links inside inline code", () => {
    expect(links("see `[x](nope.md)` and [y](README.md)")).toEqual([{ path: "README.md", anchor: null }]);
  });
  test("ignores headings inside fenced code blocks", () => {
    const md = "# Real heading\n\n```bash\n# comment, not a heading\necho hi\n```\n";
    expect(headings(md)).toEqual(new Set([slug("Real heading")]));
  });
});
