/**
 * Secure-context-safe UUID v4 generator.
 *
 * `crypto.randomUUID()` is only defined in a *secure context* (HTTPS or
 * localhost). The web bundle is served by the daemon over plain `http://host:port`,
 * which is an *insecure* context, so `crypto.randomUUID` is `undefined` there and
 * calling it throws — silently breaking every ID-creating action (adding views,
 * cards, properties, select options, relations). `crypto.getRandomValues`, by
 * contrast, is available in insecure contexts, so we build the UUID from it and
 * only fall back to `Math.random` if even that is missing.
 *
 * Prefer this over a bare `crypto.randomUUID()` anywhere the code may run in the
 * web bundle.
 */
export function generateId(): string {
  const c: Crypto | undefined = globalThis.crypto;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Set version (4) and variant (RFC 4122) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));

  return (
    hex[bytes[0]] +
    hex[bytes[1]] +
    hex[bytes[2]] +
    hex[bytes[3]] +
    "-" +
    hex[bytes[4]] +
    hex[bytes[5]] +
    "-" +
    hex[bytes[6]] +
    hex[bytes[7]] +
    "-" +
    hex[bytes[8]] +
    hex[bytes[9]] +
    "-" +
    hex[bytes[10]] +
    hex[bytes[11]] +
    hex[bytes[12]] +
    hex[bytes[13]] +
    hex[bytes[14]] +
    hex[bytes[15]]
  );
}
