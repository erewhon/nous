import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { makeTestD1 } from "../db/testD1";
import { makeTestR2 } from "../testR2";
import { getStaticShare } from "../db/queries";
import { signPublishToken } from "../crypto/publish-token";

const schemaSql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const PUBLISH_SECRET_HEX =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

function makeEnv() {
  return {
    DB: makeTestD1(schemaSql),
    STORAGE: makeTestR2(),
    JWT_SECRET: "test-jwt-secret",
    COLLAB_HMAC_SECRET: "deadbeef",
    PUBLISH_HMAC_SECRET: PUBLISH_SECRET_HEX,
  };
}

async function bearer(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await signPublishToken({ pub: sub, exp: now + 3600 }, PUBLISH_SECRET_HEX);
  return `Bearer ${token}`;
}

describe("PUT /shares/:id/static/* (publish static file)", () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    env = makeEnv();
  });

  it("creates the record on first upload and stores the file", async () => {
    const res = await app.request(
      "/shares/abc12345/static/index.html",
      {
        method: "PUT",
        headers: { Authorization: await bearer("user1"), "Content-Type": "text/html" },
        body: "<h1>hi</h1>",
      },
      env,
    );
    expect(res.status).toBe(200);

    const rec = await getStaticShare(env.DB, "abc12345");
    expect(rec?.owner_user_id).toBe("user1");

    const obj = await env.STORAGE.get("pub/abc12345/index.html");
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe("<h1>hi</h1>");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await app.request(
      "/shares/abc12345/static/index.html",
      { method: "PUT", body: "x" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a non-owner with 403", async () => {
    await app.request(
      "/shares/abc12345/static/index.html",
      { method: "PUT", headers: { Authorization: await bearer("owner") }, body: "a" },
      env,
    );
    const res = await app.request(
      "/shares/abc12345/static/other.html",
      { method: "PUT", headers: { Authorization: await bearer("intruder") }, body: "b" },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("does not let a traversal path escape the share prefix", async () => {
    const res = await app.request(
      "/shares/abc12345/static/%2e%2e/evil.html",
      { method: "PUT", headers: { Authorization: await bearer("user1") }, body: "x" },
      env,
    );
    // Rejected — either the in-handler `..` guard (400) or, because the URL
    // layer normalizes `..` away before routing, a non-matching route (404).
    expect(res.status).toBeGreaterThanOrEqual(400);
    // Nothing was written outside the share's own prefix.
    expect(await env.STORAGE.get("pub/evil.html")).toBeNull();
  });
});

describe("DELETE /shares/:id/static (unpublish)", () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    env = makeEnv();
  });

  async function publish(sub: string) {
    await app.request(
      "/shares/abc12345/static/index.html",
      { method: "PUT", headers: { Authorization: await bearer(sub) }, body: "<h1>hi</h1>" },
      env,
    );
    await app.request(
      "/shares/abc12345/static/app.css",
      { method: "PUT", headers: { Authorization: await bearer(sub) }, body: "body{}" },
      env,
    );
  }

  it("removes the record and all files for the owner", async () => {
    await publish("owner");
    const res = await app.request(
      "/shares/abc12345/static",
      { method: "DELETE", headers: { Authorization: await bearer("owner") } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await getStaticShare(env.DB, "abc12345")).toBeNull();
    expect(await env.STORAGE.get("pub/abc12345/index.html")).toBeNull();
    expect(await env.STORAGE.get("pub/abc12345/app.css")).toBeNull();
  });

  it("rejects a non-owner with 403 and keeps the share", async () => {
    await publish("owner");
    const res = await app.request(
      "/shares/abc12345/static",
      { method: "DELETE", headers: { Authorization: await bearer("intruder") } },
      env,
    );
    expect(res.status).toBe(403);
    expect(await getStaticShare(env.DB, "abc12345")).not.toBeNull();
  });

  it("returns 404 for an unknown share", async () => {
    const res = await app.request(
      "/shares/missing0/static",
      { method: "DELETE", headers: { Authorization: await bearer("owner") } },
      env,
    );
    expect(res.status).toBe(404);
  });
});
