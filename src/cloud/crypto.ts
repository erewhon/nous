/**
 * Client-side E2E encryption for Nous Cloud.
 *
 * Architecture:
 *   Master Password → PBKDF2 → Master Key (AES-256-GCM)
 *   Master Key wraps per-notebook keys (AES-256-GCM)
 *   Notebook keys encrypt page data and metadata (AES-256-GCM)
 *
 * The master password and all derived keys NEVER leave the client.
 * The server only stores:
 *   - The PBKDF2 salt (not secret, needed to re-derive on other devices)
 *   - Wrapped (encrypted) notebook keys
 *   - Encrypted page/meta blobs
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM nonce
const KEY_BYTES = 32; // AES-256

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ─── Salt ────────────────────────────────────────────────────────────────────

/** Generate a random 16-byte salt, returned as hex. */
export function generateSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

// ─── Master Key Derivation ───────────────────────────────────────────────────

/**
 * Derive a master AES-256-GCM key from a password and salt.
 * The returned CryptoKey can wrap/unwrap notebook keys and encrypt/decrypt data.
 */
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

// ─── Notebook Key Management ─────────────────────────────────────────────────

/** Generate a random AES-256-GCM key for a notebook. */
export async function generateNotebookKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable, so we can export raw bytes for wrapping
    ["encrypt", "decrypt"],
  );
}

/**
 * Wrap (encrypt) a notebook key with the master key.
 * Returns a base64 string: IV (12 bytes) + ciphertext (32 bytes key + 16 bytes GCM tag).
 * This is what gets stored on the server as `encrypted_notebook_key`.
 */
export async function wrapNotebookKey(
  masterKey: CryptoKey,
  notebookKey: CryptoKey,
): Promise<string> {
  const rawKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", notebookKey),
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, masterKey, rawKey),
  );

  // Concatenate IV + ciphertext
  const wrapped = new Uint8Array(iv.length + ciphertext.length);
  wrapped.set(iv);
  wrapped.set(ciphertext, iv.length);

  return toBase64(wrapped);
}

/**
 * Unwrap (decrypt) a notebook key using the master key.
 * Takes the base64 string from `wrapNotebookKey`.
 */
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

// ─── Data Encryption / Decryption ────────────────────────────────────────────

/**
 * Encrypt arbitrary data with a notebook key.
 * Returns an ArrayBuffer: IV (12 bytes) + ciphertext + GCM tag (16 bytes).
 * This is the format uploaded to R2.
 */
export async function encrypt(
  key: CryptoKey,
  data: Uint8Array,
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      data.buffer as ArrayBuffer,
    ),
  );

  const result = new Uint8Array(iv.length + ciphertext.length);
  result.set(iv);
  result.set(ciphertext, iv.length);

  return result.buffer;
}

/**
 * Decrypt data encrypted with `encrypt`.
 * Takes the raw ArrayBuffer from R2.
 */
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

// ─── Convenience: JSON encrypt/decrypt ───────────────────────────────────────

/** Encrypt a JSON-serializable value. */
export async function encryptJSON(
  key: CryptoKey,
  value: unknown,
): Promise<ArrayBuffer> {
  const json = JSON.stringify(value);
  return encrypt(key, new TextEncoder().encode(json));
}

/** Decrypt to a parsed JSON value. */
export async function decryptJSON<T = unknown>(
  key: CryptoKey,
  encrypted: ArrayBuffer,
): Promise<T> {
  const bytes = await decrypt(key, encrypted);
  return JSON.parse(new TextDecoder().decode(bytes));
}
