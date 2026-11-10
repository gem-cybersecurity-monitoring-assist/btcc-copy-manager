// Server-only envelope encryption for exchange connection credentials.
//
// AES-256-GCM with a 96-bit random IV per seal. The key comes from a server
// environment variable (never the browser or the repository). Each sealed value
// is bound, through GCM additional authenticated data, to the owner, the
// connection row and the venue, so a ciphertext copied onto another row or user
// fails to open. Key versions allow rotation: values sealed with the previous
// key still open and are re-sealed with the current key on the next refresh.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SEAL_PREFIX = "gcs1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 4096;

export type SecretKey = { version: number; key: Buffer };
export type Keyring = { current: SecretKey; previous: SecretKey | null };
export type SecretBinding = { userId: string; connectionId: string; venue: string };
export type KeyringStatus = { keyring: Keyring | null; missing: string[]; invalid: string[] };

function decodeKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return key.length === KEY_BYTES ? key : null;
}

function decodeVersion(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d{1,4}$/.test(raw.trim())) return null;
  const version = Number(raw.trim());
  return version >= 1 && version <= 1000 ? version : null;
}

/**
 * Reads CONNECTION_SECRETS_KEY (32 bytes, base64/base64url or 64 hex chars),
 * CONNECTION_SECRETS_KEY_VERSION (default 1) and, for rotation, the optional
 * CONNECTION_SECRETS_PREVIOUS_KEY / CONNECTION_SECRETS_PREVIOUS_KEY_VERSION.
 * Reports variable names only, never values.
 */
export function readKeyring(env: Record<string, string | undefined>): KeyringStatus {
  const missing: string[] = [];
  const invalid: string[] = [];
  if (!env.CONNECTION_SECRETS_KEY?.trim()) missing.push("CONNECTION_SECRETS_KEY");
  const key = decodeKey(env.CONNECTION_SECRETS_KEY);
  if (env.CONNECTION_SECRETS_KEY?.trim() && !key) invalid.push("CONNECTION_SECRETS_KEY");
  const version = decodeVersion(env.CONNECTION_SECRETS_KEY_VERSION, 1);
  if (version === null) invalid.push("CONNECTION_SECRETS_KEY_VERSION");
  let previous: SecretKey | null = null;
  if (env.CONNECTION_SECRETS_PREVIOUS_KEY?.trim()) {
    const previousKey = decodeKey(env.CONNECTION_SECRETS_PREVIOUS_KEY);
    const previousVersion = decodeVersion(env.CONNECTION_SECRETS_PREVIOUS_KEY_VERSION, -1);
    if (!previousKey) invalid.push("CONNECTION_SECRETS_PREVIOUS_KEY");
    if (previousVersion === null || previousVersion === -1 || previousVersion === version)
      invalid.push("CONNECTION_SECRETS_PREVIOUS_KEY_VERSION");
    else if (previousKey) previous = { version: previousVersion, key: previousKey };
  }
  if (!key || version === null || invalid.length) return { keyring: null, missing, invalid };
  return { keyring: { current: { version, key }, previous }, missing, invalid };
}

function aad(binding: SecretBinding): Buffer {
  for (const [name, value] of Object.entries(binding)) {
    if (typeof value !== "string" || !value || value.length > 160 || value.includes("|"))
      throw new Error(`Invalid secret binding: ${name}.`);
  }
  return Buffer.from(
    [SEAL_PREFIX, binding.userId.toLowerCase(), binding.connectionId.toLowerCase(), binding.venue].join("|"),
    "utf8",
  );
}

/** Seals a JSON object. The result contains no plaintext and is safe to store. */
export function sealSecret(keyring: Keyring, plaintext: Record<string, string>, binding: SecretBinding): string {
  const data = Buffer.from(JSON.stringify(plaintext), "utf8");
  if (data.length > MAX_PLAINTEXT_BYTES) throw new Error("Secret is too large to seal.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyring.current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SEAL_PREFIX, String(keyring.current.version), iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

export function sealedKeyVersion(sealed: string): number | null {
  const match = /^gcs1\.(\d{1,4})\./.exec(sealed);
  return match ? Number(match[1]) : null;
}

/**
 * Opens a sealed value. Throws a generic error for an unknown key version,
 * tampering, a wrong key or a binding mismatch; never echoes the input.
 */
export function openSecret(keyring: Keyring, sealed: string, binding: SecretBinding): Record<string, string> {
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  if (parts.length !== 5 || parts[0] !== SEAL_PREFIX) throw new Error("Stored credential is not in a recognised format.");
  const version = Number(parts[1]);
  const secretKey = [keyring.current, keyring.previous].find((candidate) => candidate?.version === version);
  if (!secretKey) throw new Error("Stored credential uses an unavailable key version.");
  try {
    const iv = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    const tag = Buffer.from(parts[4], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("bad lengths");
    const decipher = createDecipheriv("aes-256-gcm", secretKey.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad shape");
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== "string") throw new Error("bad value");
      result[name] = value;
    }
    return result;
  } catch {
    throw new Error("Stored credential could not be decrypted.");
  }
}
