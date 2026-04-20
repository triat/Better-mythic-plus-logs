import * as fs from "node:fs/promises";
import * as path from "node:path";

const TARGET_KEYS = ["WCL_CLIENT_ID", "WCL_CLIENT_SECRET"] as const;

/** Pick the best .env path: existing next to exe/cwd, or fall back to cwd. */
export async function resolveEnvPath(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(path.dirname(process.execPath), ".env"),
  ];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return candidates[0]!;
}

const escapeValue = (v: string): string => {
  const trimmed = v.trim();
  if (/[\s"'#]/.test(trimmed)) return `"${trimmed.replace(/"/g, '\\"')}"`;
  return trimmed;
};

export async function writeCredentials(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cid = clientId.trim();
  const csec = clientSecret.trim();
  if (!cid || !csec) {
    throw new Error("Both client ID and secret are required.");
  }

  const envPath = await resolveEnvPath();

  let existing = "";
  try {
    existing = await fs.readFile(envPath, "utf8");
  } catch {
    /* file does not exist — that's fine */
  }

  const preserved = existing
    .split(/\r?\n/)
    .filter((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
      if (!m) return line.trim() !== "";
      return !TARGET_KEYS.includes(m[1] as (typeof TARGET_KEYS)[number]);
    });

  const next = [
    ...preserved,
    `WCL_CLIENT_ID=${escapeValue(cid)}`,
    `WCL_CLIENT_SECRET=${escapeValue(csec)}`,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") + "\n";

  await fs.writeFile(envPath, next, { mode: 0o600 });

  process.env.WCL_CLIENT_ID = cid;
  process.env.WCL_CLIENT_SECRET = csec;

  return envPath;
}
