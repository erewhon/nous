/**
 * Server-side password hashing using PBKDF2 (Web Crypto API).
 *
 * This is for the ACCOUNT password (authentication), NOT the encryption
 * master password. The master password never reaches the server.
 */

const ITERATIONS = 100_000; // Cloudflare Workers PBKDF2 limit is 100k
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

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

/**
 * Hash a password for storage. Returns "iterations$salt$hash" format.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const hash = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      keyMaterial,
      KEY_LENGTH * 8,
    ),
  );

  return `${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [iterStr, saltHex, hashHex] = storedHash.split("$");
  const iterations = parseInt(iterStr, 10);
  const salt = fromHex(saltHex);
  const expectedHash = fromHex(hashHex);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const actualHash = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      expectedHash.length * 8,
    ),
  );

  // Constant-time comparison
  if (actualHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash[i] ^ expectedHash[i];
  }
  return diff === 0;
}
