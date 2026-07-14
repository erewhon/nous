import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTestD1 } from "./testD1";
import {
  createStaticShare,
  getStaticShare,
  deleteStaticShare,
  listStaticSharesForUser,
} from "./queries";

const schemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

describe("static_shares queries", () => {
  let db: D1Database;
  beforeEach(() => {
    db = makeTestD1(schemaSql);
  });

  it("round-trips create then get", async () => {
    await createStaticShare(db, "abc12345", "user1", "nb1", "My Page", "academic", null, 3);
    const row = await getStaticShare(db, "abc12345");
    expect(row).not.toBeNull();
    expect(row?.id).toBe("abc12345");
    expect(row?.owner_user_id).toBe("user1");
    expect(row?.notebook_id).toBe("nb1");
    expect(row?.title).toBe("My Page");
    expect(row?.theme).toBe("academic");
    expect(row?.page_count).toBe(3);
    expect(row?.expires_at).toBeNull();
    expect(row?.created_at).toBeTruthy();
  });

  it("returns null for an unknown id", async () => {
    expect(await getStaticShare(db, "missing")).toBeNull();
  });

  it("lists only the owner's shares", async () => {
    await createStaticShare(db, "s-a1", "owner-a", null, "A1", null, null, null);
    await createStaticShare(db, "s-b1", "owner-b", null, "B1", null, null, null);
    await createStaticShare(db, "s-a2", "owner-a", null, "A2", null, null, null);
    const ids = (await listStaticSharesForUser(db, "owner-a")).map((r) => r.id);
    expect(ids).toContain("s-a1");
    expect(ids).toContain("s-a2");
    expect(ids).not.toContain("s-b1");
  });

  it("deletes a share", async () => {
    await createStaticShare(db, "del-1", "user1", null, null, null, null, null);
    await deleteStaticShare(db, "del-1");
    expect(await getStaticShare(db, "del-1")).toBeNull();
  });
});
