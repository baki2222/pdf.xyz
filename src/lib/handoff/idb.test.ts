// @vitest-environment node
/**
 * The IndexedDB hand-off store, on a real IndexedDB implementation
 * (`fake-indexeddb`, injected per test — never installed as a global, since
 * vitest shares globals across files here: `isolate: false`).
 *
 * The sweep that runs on every page (`purgeExpiredIfPresent`) is what makes
 * the privacy page's sentence true: "An unopened hand-off … is deleted from
 * this browser the next time a pdf.xyz page opens." Two properties:
 *
 *  - it deletes expired records and keeps live ones;
 *  - it NEVER CREATES the database. Opening one creates it, so a sweep run on
 *    every page would otherwise leave an empty `pdfxyz-handoff` database in
 *    the browser of every visitor who never handed a file anywhere.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { makeHandoffRecord } from "./record";
import {
  HANDOFF_DB_NAME,
  IndexedDbHandoffBackend,
  purgeExpiredIfPresent,
} from "./idb";

const record = (id: string, now: number, ttlMs: number) =>
  makeHandoffRecord({
    id,
    toolSlug: "merge-pdf",
    files: [
      {
        name: "a.pdf",
        size: 4,
        type: "application/pdf",
        blob: new Blob(["%PDF"]),
      },
    ],
    now,
    ttlMs,
    origin: { kind: "workspace" },
  });

const names = async (factory: IDBFactory) =>
  (await factory.databases()).map((d) => d.name);

describe("IndexedDbHandoffBackend on a real IndexedDB", () => {
  it("round-trips a record with its provenance", async () => {
    const factory = new IDBFactory();
    const backend = new IndexedDbHandoffBackend(factory);
    await backend.put({ ...record("h_1", 0, 1000), trail: ["rotate-pdf"] });
    const back = await backend.get("h_1");
    expect(back).toMatchObject({
      id: "h_1",
      origin: { kind: "workspace" },
      trail: ["rotate-pdf"],
    });
  });
});

describe("purgeExpiredIfPresent: the sweep every page runs", () => {
  it("deletes expired hand-offs and keeps live ones", async () => {
    const factory = new IDBFactory();
    const backend = new IndexedDbHandoffBackend(factory);
    await backend.put(record("h_old", 0, 1_000));
    await backend.put(record("h_new", 0, 10_000));
    expect(await purgeExpiredIfPresent(5_000, factory)).toBe(1);
    expect((await backend.getAll()).map((r) => r.id)).toEqual(["h_new"]);
  });

  it("a malformed record (no expiry) is deleted, not kept forever", async () => {
    const factory = new IDBFactory();
    const backend = new IndexedDbHandoffBackend(factory);
    const broken = { ...record("h_bad", 0, 1_000) } as Record<string, unknown>;
    delete broken.expiresAt;
    await backend.put(broken as never);
    expect(await purgeExpiredIfPresent(1, factory)).toBe(1);
  });

  it("never creates the database for a visitor who has none", async () => {
    const factory = new IDBFactory();
    expect(await names(factory)).toEqual([]);
    expect(await purgeExpiredIfPresent(Date.now(), factory)).toBe(0);
    expect(await names(factory)).toEqual([]);
  });

  it("control: storing a hand-off does create it, under the registered name", async () => {
    const factory = new IDBFactory();
    await new IndexedDbHandoffBackend(factory).put(record("h_1", 0, 1_000));
    expect(await names(factory)).toEqual([HANDOFF_DB_NAME]);
  });

  it("with no IndexedDB at all, it does nothing and does not throw", async () => {
    expect(await purgeExpiredIfPresent(0, null)).toBe(0);
  });
});
