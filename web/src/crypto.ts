/**
 * Client-side E2E encryption for Nous Cloud.
 * Copied from src/cloud/crypto.ts — only decrypt functions needed for the web viewer.
 */

const PBKDF2_ITERATIONS = 100_000;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function deriveMasterKey(
  password: string,
  saltHex: string,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const salt = fromHex(saltHex);
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_BYTES * 8,
  );

  return crypto.subtle.importKey(
    "raw",
    rawBits,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function unwrapNotebookKey(
  masterKey: CryptoKey,
  wrappedBase64: string,
): Promise<CryptoKey> {
  const wrapped = fromBase64(wrappedBase64);
  const iv = wrapped.slice(0, IV_BYTES);
  const ciphertext = wrapped.slice(IV_BYTES);

  const rawKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    masterKey,
    ciphertext,
  );

  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function decrypt(
  key: CryptoKey,
  encrypted: ArrayBuffer,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(encrypted);
  const iv = bytes.slice(0, IV_BYTES);
  const ciphertext = bytes.slice(IV_BYTES);

  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext,
    ),
  );
}

export async function decryptJSON<T = unknown>(
  key: CryptoKey,
  encrypted: ArrayBuffer,
): Promise<T> {
  const bytes = await decrypt(key, encrypted);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ─── Sharing ────────────────────────────────────────────────────────────────

function toBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

/** Export raw key bytes as base64 (for public share links). */
export async function exportKeyAsBase64(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return toBase64(raw);
}

/** Import a raw key from base64 (from URL fragment in public shares). */
export async function importKeyFromBase64(b64: string): Promise<CryptoKey> {
  const raw = fromBase64(b64);
  return crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Generate a random 16-byte hex salt for share password derivation. */
export function generateShareSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Derive a wrapping key from a share password + salt. */
export async function deriveShareKey(
  password: string,
  saltHex: string,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const salt = fromHex(saltHex);
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_BYTES * 8,
  );

  return crypto.subtle.importKey(
    "raw",
    rawBits,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Wrap a notebook key with a share password-derived key. */
export async function wrapKeyForShare(
  shareKey: CryptoKey,
  notebookKey: CryptoKey,
): Promise<string> {
  const rawKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", notebookKey),
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, shareKey, rawKey),
  );
  const wrapped = new Uint8Array(iv.length + ciphertext.length);
  wrapped.set(iv);
  wrapped.set(ciphertext, iv.length);
  return toBase64(wrapped);
}
