/**
 * Minimal in-memory `R2Bucket` shim for unit-testing route handlers without the
 * Workers runtime. Implements the subset used by the storage helpers:
 * `put` / `get` / `delete` / `list`. ETag-conditional `onlyIf` is ignored.
 */
export function makeTestR2(): R2Bucket {
  const store = new Map<string, Uint8Array>();

  function toBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  function makeObject(key: string, bytes: Uint8Array) {
    return {
      key,
      httpEtag: `"${key}"`,
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  const bucket = {
    async put(key: string, value: ArrayBuffer | ArrayBufferView | string) {
      const bytes = toBytes(value);
      store.set(key, bytes);
      return makeObject(key, bytes);
    },
    async get(key: string) {
      const bytes = store.get(key);
      return bytes ? makeObject(key, bytes) : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(opts?: { prefix?: string; cursor?: string }) {
      const prefix = opts?.prefix ?? "";
      const objects = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k }));
      return { objects, truncated: false, delimitedPrefixes: [] };
    },
  };

  return bucket as unknown as R2Bucket;
}
