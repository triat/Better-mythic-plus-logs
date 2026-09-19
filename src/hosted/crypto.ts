// AES-256-GCM over WebCrypto for the members' WCL client secrets (issue #11). Format: "v1.<iv b64>.<ct+tag b64>".
export const SEALED_PREFIX = "v1.";
const IV_BYTES = 12;
const importKey = (key: Uint8Array) => crypto.subtle.importKey("raw", new Uint8Array(key), "AES-GCM", false, ["encrypt", "decrypt"]);
const b64 = (bytes: ArrayBuffer | Uint8Array): string => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");

export async function encrypt(key: Uint8Array, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(key), new TextEncoder().encode(plaintext));
  return `${SEALED_PREFIX}${b64(iv)}.${b64(ct)}`;
}

/** null on any failure (wrong key, tampering, bad format): the caller treats it as "no usable secret". */
export async function decrypt(key: Uint8Array, sealed: string): Promise<string | null> {
  if (!sealed.startsWith(SEALED_PREFIX)) return null;
  const parts = sealed.slice(SEALED_PREFIX.length).split(".");
  if (parts.length !== 2) return null;
  try {
    const iv = Buffer.from(parts[0]!, "base64");
    const ct = Buffer.from(parts[1]!, "base64");
    if (iv.length !== IV_BYTES || ct.length === 0) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, await importKey(key), new Uint8Array(ct));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
