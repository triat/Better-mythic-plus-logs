// Dev-only: regenerates addon/bmpl/tests/vectors.txt from today's codec (web/src/lib/live/codec.ts).
// Never imported by the test suite (test/live-vectors.test.ts only reads the committed file) and never
// spends WCL points — it is pure, offline codec math.
//
// Run after any change to codec.ts, chunkRoster's framing or the roster line format:
//   bun scripts/live-vectors.ts > addon/bmpl/tests/vectors.txt
//   bun test test/live-vectors.test.ts
//
// The Lua addon cannot read this file at runtime (no filesystem access in the WoW addon sandbox), so
// `/bmpl selftest` in main.lua carries its own copy of these same three vectors as Lua literals — keep
// that table in sync by hand when this file's rosters change; `bun test` does not check the Lua copy.
import { chunkRoster, encodeFrame } from "../web/src/lib/live/codec.ts";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

type Role = "T" | "H" | "D";

const line = (kind: "a" | "p" | "s", name: string, realm: string, className: string, spec: string, role: Role, score: number) =>
  `${kind}|${name}-${realm}|${className}|${spec}|${role}|${score}`;

const vectors: Array<{ text: string; seq: number }> = [
  // One applicant: the common case, one frame.
  {
    text: `${line("a", "Applicantone", "Area52", "DeathKnight", "Blood", "T", 1520)}\n`,
    seq: 1,
  },
  // Three applicants (oldest first) plus one party member — still one frame.
  {
    text: [
      line("a", "Applicanttwo", "Area52", "Priest", "Holy", "H", 1480),
      line("a", "Applicantthree", "Stormrage", "Mage", "Frost", "D", 1610),
      line("a", "Applicantfour", "Illidan", "Rogue", "Assassination", "D", 0),
      line("p", "Partymember", "Area52", "Warrior", "Protection", "T", 1550),
    ].join("\n") + "\n",
    seq: 2,
  },
  // Twenty applicants: exercises chunkRoster's multi-frame split (well past the 61-byte payload cap).
  {
    text:
      Array.from({ length: 20 }, (_, i) => {
        const n = i + 1;
        const role: Role = i % 3 === 0 ? "T" : i % 3 === 1 ? "H" : "D";
        const [className, spec] = i % 2 === 0 ? ["Mage", "Frost"] : ["Priest", "Holy"];
        return line("a", `Applicant${String(n).padStart(2, "0")}`, "Area52", className, spec, role, 1000 + i * 10);
      }).join("\n") + "\n",
    seq: 65535,
  },
];

const lines = vectors.map(({ text, seq }) => {
  const frames = chunkRoster(text, seq).map((f) => hex(encodeFrame(f)));
  return [text.replaceAll("\n", "\\n"), String(seq), ...frames].join("\t");
});

console.log(lines.join("\n"));
