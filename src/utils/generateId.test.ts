import { describe, it, expect, afterEach } from "vitest";
import { generateId } from "./generateId";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: realCrypto,
    configurable: true,
    writable: true,
  });
});

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("generateId", () => {
  it("uses crypto.randomUUID when available (secure context)", () => {
    const id = generateId();
    expect(id).toMatch(UUID_RE);
  });

  it("falls back to getRandomValues when randomUUID is missing (insecure http context)", () => {
    // Simulate a page served over plain http:// where randomUUID is undefined
    // but getRandomValues still exists.
    setCrypto({
      getRandomValues: (arr: Uint8Array) => realCrypto.getRandomValues(arr),
    });
    const id = generateId();
    expect(id).toMatch(UUID_RE);
  });

  it("falls back to Math.random when crypto is entirely absent", () => {
    setCrypto(undefined);
    const id = generateId();
    expect(id).toMatch(UUID_RE);
  });

  it("produces unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });
});
