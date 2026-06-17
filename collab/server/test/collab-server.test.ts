import { env, runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Doc, applyUpdate } from "yjs";
import type { CollabServer } from "../src/index";

const STORAGE_KEY = "yjs-state";

function stub(name: string): DurableObjectStub<CollabServer> {
  return env.CollabServer.get(env.CollabServer.idFromName(name));
}

/**
 * Minimal stand-in for partyserver's Connection with the same hibernation-safe
 * state semantics: setState writes the WebSocket attachment, state reads it.
 */
function fakeConn(id: string, initial: unknown = null) {
  let st: unknown = initial;
  return {
    id,
    readyState: 1, // OPEN
    get state() {
      return st;
    },
    setState(v: unknown) {
      st = typeof v === "function" ? (v as (p: unknown) => unknown)(st) : v;
      return st;
    },
    send() {},
    close() {},
  };
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mint a session token matching the server's verifyToken format. */
async function mintToken(secretHex: string, payload: object): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexDecode(secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return `${payloadB64}.${b64url(new Uint8Array(sig))}`;
}

function decodeStored(stored: ArrayBuffer | undefined): Doc {
  expect(stored).toBeTruthy();
  const doc = new Doc();
  applyUpdate(doc, new Uint8Array(stored!));
  return doc;
}

describe("DL-10: read-only enforcement survives hibernation", () => {
  it("isReadOnly reads permissions from the connection attachment, not a module map", async () => {
    await runInDurableObject(stub("nb:dl10-read"), async (instance) => {
      // The attachment is what partyserver rehydrates after hibernation, so
      // reading it (rather than an in-memory Map populated only at onConnect)
      // is what keeps a read-only guest read-only across an eviction.
      expect(instance.isReadOnly(fakeConn("a", { permissions: "r" }) as never)).toBe(true);
      expect(instance.isReadOnly(fakeConn("b", { permissions: "rw" }) as never)).toBe(false);
      // Fail closed: a missing/garbled attachment must NOT grant write access.
      expect(instance.isReadOnly(fakeConn("c", null) as never)).toBe(true);
      expect(instance.isReadOnly(fakeConn("d", { permissions: "bogus" }) as never)).toBe(true);
    });
  });

  it("onConnect persists permissions to the connection attachment (read-only)", async () => {
    await runInDurableObject(stub("nb:dl10-page"), async (instance, state) => {
      await instance.setName("nb:dl10-page");
      await state.storage.deleteAlarm();

      const token = await mintToken(env.COLLAB_HMAC_SECRET, {
        scope_type: "page",
        scope_id: "dl10-page",
        notebook_id: "nb",
        permissions: "r",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const conn = fakeConn("ro1");
      const ctx = { request: new Request(`https://party.nous.page/?token=${token}`) };

      await instance.onConnect(conn as never, ctx as never);

      // Permission landed in the hibernation-safe attachment, and enforcement reads it.
      expect((conn.state as { permissions?: string } | null)?.permissions).toBe("r");
      expect(instance.isReadOnly(conn as never)).toBe(true);
      // And an active session scheduled the DL-11 durable flush alarm.
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("onConnect persists a writable grant for an rw token", async () => {
    await runInDurableObject(stub("nb:dl10-rw"), async (instance, state) => {
      await instance.setName("nb:dl10-rw");
      const token = await mintToken(env.COLLAB_HMAC_SECRET, {
        scope_type: "page",
        scope_id: "dl10-rw",
        notebook_id: "nb",
        permissions: "rw",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const conn = fakeConn("rw1");
      const ctx = { request: new Request(`https://party.nous.page/?token=${token}`) };

      await instance.onConnect(conn as never, ctx as never);

      expect((conn.state as { permissions?: string } | null)?.permissions).toBe("rw");
      expect(instance.isReadOnly(conn as never)).toBe(false);
    });
  });
});

describe("DL-11: durable flush backstops", () => {
  it("onSave/onLoad round-trips the Yjs doc through DO storage", async () => {
    await runInDurableObject(stub("nb:dl11-rt"), async (instance, state) => {
      instance.document.getMap("m").set("k", "v");
      await instance.onSave();
      const doc = decodeStored(await state.storage.get<ArrayBuffer>(STORAGE_KEY));
      expect(doc.getMap("m").get("k")).toBe("v");
    });
  });

  it("onClose flushes trailing edits and cancels the alarm when the last client leaves", async () => {
    await runInDurableObject(stub("nb:dl11-close"), async (instance, state) => {
      instance.document.getMap("m").set("trailing", "edit");
      await (instance as unknown as { ensureFlushAlarm(): Promise<void> }).ensureFlushAlarm();
      expect(await state.storage.getAlarm()).not.toBeNull();

      // No live connections → this is the last disconnect.
      await instance.onClose(fakeConn("gone") as never, 1000, "", true);

      const doc = decodeStored(await state.storage.get<ArrayBuffer>(STORAGE_KEY));
      expect(doc.getMap("m").get("trailing")).toBe("edit");
      // Alarm cancelled — no active session to flush.
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("onClose does NOT flush/cancel while other clients remain", async () => {
    await runInDurableObject(stub("nb:dl11-close2"), async (instance, state) => {
      (instance as unknown as { getConnections: () => unknown[] }).getConnections = () => [
        fakeConn("other"),
      ];
      await state.storage.deleteAlarm();
      await (instance as unknown as { ensureFlushAlarm(): Promise<void> }).ensureFlushAlarm();
      const before = await state.storage.getAlarm();

      await instance.onClose(fakeConn("gone") as never, 1000, "", true);

      // "other" is still connected → alarm left in place.
      expect(await state.storage.getAlarm()).toBe(before);
    });
  });

  it("onAlarm flushes the live doc; no reschedule when idle", async () => {
    await runInDurableObject(stub("nb:dl11-alarm"), async (instance, state) => {
      instance.document.getMap("m").set("edited", 1);
      await state.storage.deleteAlarm();

      await instance.onAlarm();

      const doc = decodeStored(await state.storage.get<ArrayBuffer>(STORAGE_KEY));
      expect(doc.getMap("m").get("edited")).toBe(1);
      // No connections → does not reschedule.
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("onAlarm reschedules itself while a session remains active", async () => {
    await runInDurableObject(stub("nb:dl11-alarm2"), async (instance, state) => {
      (instance as unknown as { getConnections: () => unknown[] }).getConnections = () => [
        fakeConn("live"),
      ];
      await state.storage.deleteAlarm();

      await instance.onAlarm();

      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("ensureFlushAlarm schedules once and is idempotent", async () => {
    await runInDurableObject(stub("nb:dl11-ensure"), async (instance, state) => {
      await state.storage.deleteAlarm();
      const ensure = (instance as unknown as { ensureFlushAlarm(): Promise<void> }).ensureFlushAlarm.bind(instance);

      await ensure();
      const first = await state.storage.getAlarm();
      expect(first).not.toBeNull();

      await ensure();
      const second = await state.storage.getAlarm();
      expect(second).toBe(first); // did not reschedule / extend
    });
  });
});
