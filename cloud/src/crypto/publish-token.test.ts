import { describe, expect, it } from "vitest";
import { signPublishToken, verifyPublishToken } from "./publish-token";

const HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const now = () => Math.floor(Date.now() / 1000);

describe("publish token", () => {
  it("round-trips a valid token", async () => {
    const token = await signPublishToken({ pub: "owner-1", exp: now() + 60 }, HEX);
    const payload = await verifyPublishToken(token, HEX);
    expect(payload?.pub).toBe("owner-1");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signPublishToken({ pub: "x", exp: now() + 60 }, HEX);
    const other = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(await verifyPublishToken(token, other)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signPublishToken({ pub: "x", exp: now() + 60 }, HEX);
    const sig = token.split(".")[1];
    const forgedPayload = btoa(JSON.stringify({ pub: "admin", exp: now() + 60 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyPublishToken(`${forgedPayload}.${sig}`, HEX)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signPublishToken({ pub: "x", exp: 100 }, HEX);
    expect(await verifyPublishToken(token, HEX)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifyPublishToken("not-a-token", HEX)).toBeNull();
  });
});
