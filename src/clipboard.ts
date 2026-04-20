import { $ } from "bun";
import { parseNameRealm } from "./util.ts";

export type ClipboardReader = () => Promise<string>;

export interface ClipboardBackend {
  label: string;
  read: ClipboardReader;
}

const stripTrailingNewline = (s: string): string => s.replace(/\r?\n$/, "");

async function which(cmd: string): Promise<boolean> {
  try {
    const p = await $`which ${cmd}`.nothrow().quiet();
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

const isWSL = (): boolean =>
  process.platform === "linux" &&
  (!!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP);

export async function detectClipboardReader(): Promise<ClipboardBackend> {
  if (isWSL() || process.platform === "win32") {
    if (process.platform === "win32" || (await which("powershell.exe"))) {
      // Force UTF-8 on the output stream before Get-Clipboard. PowerShell's
      // default console output encoding on many Windows installs is the
      // legacy DOS code page (e.g. CP437), which mangles accented chars
      // like "ì" → 0x8D — invalid as UTF-8 — when we decode the stream.
      const cmd =
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard";
      return {
        label: "powershell.exe Get-Clipboard (UTF-8)",
        read: async () =>
          stripTrailingNewline(
            await $`powershell.exe -NoProfile -Command ${cmd}`.text(),
          ),
      };
    }
  }
  if (process.platform === "darwin") {
    return {
      label: "pbpaste",
      read: async () => stripTrailingNewline(await $`pbpaste`.text()),
    };
  }
  if (process.platform === "linux") {
    if (await which("wl-paste")) {
      return {
        label: "wl-paste",
        read: async () => stripTrailingNewline(await $`wl-paste -n`.text()),
      };
    }
    if (await which("xclip")) {
      return {
        label: "xclip",
        read: async () =>
          stripTrailingNewline(
            await $`xclip -selection clipboard -o`.text(),
          ),
      };
    }
  }
  throw new Error(
    "No clipboard reader found. Install wl-clipboard or xclip (Linux), or run this from WSL with PowerShell available.",
  );
}

// Name part: starts with a letter, 2-20 chars (letters, apostrophes).
// Realm part: starts with a letter, 3-30 chars (letters, apostrophes, dashes).
const NAME_RE = /^[\p{L}][\p{L}'-]{1,19}$/u;
const REALM_RE = /^[\p{L}][\p{L}'-]{2,29}$/u;

export const isPlausibleNameRealm = (
  text: string,
): { name: string; realm: string } | null => {
  if (text.length < 4 || text.length > 60) return null;
  if (/\s/.test(text)) return null;
  const p = parseNameRealm(text);
  if (!p) return null;
  if (!NAME_RE.test(p.name) || !REALM_RE.test(p.realm)) return null;
  return p;
};
