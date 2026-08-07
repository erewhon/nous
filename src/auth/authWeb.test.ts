// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  base64Url,
  fetchMe,
  parseCallback,
  pkceChallenge,
} from "./authWeb";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pkceChallenge", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    // verifier → S256 challenge from the spec.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});

describe("base64Url", () => {
  it("is URL-safe with no padding", () => {
    // 0xfb 0xef 0xff encodes to "++//" territory in plain base64.
    const encoded = base64Url(new Uint8Array([0xfb, 0xef, 0xff, 0x01]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toBe("--__AQ");
  });
});

describe("parseCallback", () => {
  it("returns the code on the happy path", () => {
    expect(parseCallback("?code=abc&state=xyz", "xyz")).toBe("abc");
  });

  it("throws the provider's error description", () => {
    expect(() =>
      parseCallback(
        "?error=access_denied&error_description=User%20cancelled",
        "xyz"
      )
    ).toThrow("User cancelled");
    expect(() => parseCallback("?error=access_denied", "xyz")).toThrow(
      /access_denied/
    );
  });

  it("throws when the code or the stashed state is missing", () => {
    expect(() => parseCallback("?state=xyz", "xyz")).toThrow(/state was lost/);
    expect(() => parseCallback("?code=abc&state=xyz", undefined)).toThrow(
      /state was lost/
    );
  });

  it("throws on a state mismatch (CSRF guard)", () => {
    expect(() => parseCallback("?code=abc&state=evil", "xyz")).toThrow(
      /state mismatch/
    );
  });
});

describe("fetchMe", () => {
  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }))
    );
  }

  it("returns the user on 200", async () => {
    stubFetch(200, { userId: "u1", username: "a", displayName: null, role: "member", status: "active" });
    const me = await fetchMe();
    expect(me).toMatchObject({ userId: "u1" });
  });

  it("returns null on 401 (session wanted, none present)", async () => {
    stubFetch(401, { error: "unauthorized" });
    expect(await fetchMe()).toBeNull();
  });

  it("returns 'unavailable' on 404 (legacy daemon)", async () => {
    stubFetch(404, { error: "multi-user mode is not enabled" });
    expect(await fetchMe()).toBe("unavailable");
  });

  it("returns 'unavailable' on a shapeless 200 (dev server index fallback)", async () => {
    stubFetch(200, "<!doctype html>");
    expect(await fetchMe()).toBe("unavailable");
  });

  it("returns 'unavailable' when fetch itself fails (daemon down)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("NetworkError");
      })
    );
    expect(await fetchMe()).toBe("unavailable");
  });
});
