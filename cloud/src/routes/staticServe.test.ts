import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { makeTestD1 } from "../db/testD1";
import { makeTestR2 } from "../testR2";
import { createStaticShare } from "../db/queries";
import { putStaticFile } from "../storage/r2";

const schemaSql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function makeEnv() {
  return {
    DB: makeTestD1(schemaSql),
    STORAGE: makeTestR2(),
    JWT_SECRET: "test-secret",
    COLLAB_HMAC_SECRET: "deadbeef",
    PUBLISH_HMAC_SECRET: "00112233445566778899aabbccddeeff",
  };
}

const enc = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};

describe("GET pub.nous.page/:shareId/* (serve static share)", () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(async () => {
    env = makeEnv();
    await createStaticShare(env.DB, "abc12345", "user1", null, "T", "academic", null, 1);
    await putStaticFile(env.STORAGE, "abc12345", "index.html", enc("<h1>home</h1>"));
    await putStaticFile(env.STORAGE, "abc12345", "styles.css", enc("body{}"));
  });

  it("serves a stored file with the right content-type", async () => {
    const res = await app.request("http://pub.nous.page/abc12345/index.html", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<h1>home</h1>");

    const css = await app.request("http://pub.nous.page/abc12345/styles.css", {}, env);
    expect(css.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
  });

  it("falls back to index.html at the share root", async () => {
    const res = await app.request("http://pub.nous.page/abc12345/", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>home</h1>");
  });

  it("returns 410 for an expired share", async () => {
    await createStaticShare(env.DB, "expired1", "user1", null, "E", null, "2000-01-01 00:00:00", 1);
    await putStaticFile(env.STORAGE, "expired1", "index.html", enc("old"));
    const res = await app.request("http://pub.nous.page/expired1/", {}, env);
    expect(res.status).toBe(410);
  });

  it("returns 404 for an unknown share or missing file", async () => {
    expect((await app.request("http://pub.nous.page/nope0000/", {}, env)).status).toBe(404);
    expect(
      (await app.request("http://pub.nous.page/abc12345/missing.js", {}, env)).status,
    ).toBe(404);
  });

  it("does not intercept API-host requests", async () => {
    const res = await app.request("http://api.nous.page/", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ service: "nous-cloud" });
  });
});
