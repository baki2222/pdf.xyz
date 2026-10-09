import { describe, expect, it } from "vitest";
import { MemoryHandoffBackend, type HandoffBackend } from "./backend";
import { HandoffStore } from "./store";
import type { HandoffFileEntry, HandoffRecord } from "./types";

/** The meta every record now carries; the store does not default it. */
const FROM_WORKSPACE = { origin: { kind: "workspace" } } as const;

function entry(name: string): HandoffFileEntry {
  return {
    name,
    size: 4,
    type: "application/pdf",
    blob: new Blob([new Uint8Array(4)]),
  };
}

/** A store with a controllable clock and deterministic, sequential ids. */
function makeStore(
  overrides?: Partial<ConstructorParameters<typeof HandoffStore>[0]>,
) {
  let clock = 0;
  let seq = 0;
  const store = new HandoffStore({
    backend: new MemoryHandoffBackend(),
    now: () => clock,
    idFactory: () => `h_${++seq}`,
    ttlMs: 1_000,
    ...overrides,
  });
  return {
    store,
    setNow: (n: number) => {
      clock = n;
    },
    advance: (n: number) => {
      clock += n;
    },
  };
}

describe("HandoffStore — create + claim", () => {
  it("creates a record with a generated id and returns it", async () => {
    const { store } = makeStore();
    const record = await store.create(
      "merge-pdf",
      [entry("a.pdf"), entry("b.pdf")],
      FROM_WORKSPACE,
    );
    expect(record).not.toBeNull();
    expect(record!.id).toBe("h_1");
    expect(record!.toolSlug).toBe("merge-pdf");
    expect(record!.files).toHaveLength(2);
  });

  it("claim returns the record then deletes it — single use", async () => {
    const { store } = makeStore();
    const created = await store.create(
      "compress-pdf",
      [entry("a.pdf")],
      FROM_WORKSPACE,
    );
    const first = await store.claim(created!.id);
    expect(first?.id).toBe(created!.id);
    // A second claim of the same id finds nothing.
    expect(await store.claim(created!.id)).toBeNull();
  });

  it("peek does not consume the record", async () => {
    const { store } = makeStore();
    const created = await store.create(
      "rotate-pdf",
      [entry("a.pdf")],
      FROM_WORKSPACE,
    );
    expect((await store.peek(created!.id))?.id).toBe(created!.id);
    // Still claimable after peeking.
    expect((await store.claim(created!.id))?.id).toBe(created!.id);
  });

  it("claiming an unknown id is null", async () => {
    const { store } = makeStore();
    expect(await store.claim("h_nope")).toBeNull();
  });
});

describe("HandoffStore — expiry", () => {
  it("an expired record claims as null and is purged", async () => {
    const { store, setNow } = makeStore();
    const created = await store.create(
      "merge-pdf",
      [entry("a.pdf")],
      FROM_WORKSPACE,
    );
    setNow(1_000); // exactly at expiry (inclusive)
    expect(await store.peek(created!.id)).toBeNull();
    expect(await store.claim(created!.id)).toBeNull();
  });

  it("create purges already-expired records first", async () => {
    const { store, setNow } = makeStore();
    const stale = await store.create(
      "merge-pdf",
      [entry("a.pdf")],
      FROM_WORKSPACE,
    );
    setNow(2_000);
    // Creating a new handoff triggers a purge of the stale one.
    await store.create("compress-pdf", [entry("b.pdf")], FROM_WORKSPACE);
    expect(await store.peek(stale!.id)).toBeNull();
  });

  it("purgeExpired removes only expired records and reports the count", async () => {
    const { store, setNow } = makeStore();
    const a = await store.create("merge-pdf", [entry("a.pdf")], FROM_WORKSPACE); // expires at 1000
    setNow(500);
    const b = await store.create("merge-pdf", [entry("b.pdf")], FROM_WORKSPACE); // expires at 1500
    setNow(1_200); // a expired, b still live
    expect(await store.purgeExpired()).toBe(1);
    expect(await store.peek(a!.id)).toBeNull();
    expect((await store.peek(b!.id))?.id).toBe(b!.id);
  });
});

describe("HandoffStore — delete + clear", () => {
  it("delete removes a single handoff", async () => {
    const { store } = makeStore();
    const created = await store.create(
      "merge-pdf",
      [entry("a.pdf")],
      FROM_WORKSPACE,
    );
    await store.delete(created!.id);
    expect(await store.peek(created!.id)).toBeNull();
  });

  it("clear removes everything", async () => {
    const { store } = makeStore();
    const a = await store.create("merge-pdf", [entry("a.pdf")], FROM_WORKSPACE);
    const b = await store.create(
      "compress-pdf",
      [entry("b.pdf")],
      FROM_WORKSPACE,
    );
    await store.clear();
    expect(await store.peek(a!.id)).toBeNull();
    expect(await store.peek(b!.id)).toBeNull();
  });
});

describe("HandoffStore — fail-safe", () => {
  /** A backend whose writes always throw, to prove create degrades to null. */
  const throwingBackend: HandoffBackend = {
    put: async () => {
      throw new Error("quota");
    },
    get: async () => undefined,
    delete: async () => {},
    getAll: async () => [],
    clear: async () => {},
  };

  it("create returns null when the backend write fails", async () => {
    const store = new HandoffStore({ backend: throwingBackend, now: () => 0 });
    expect(
      await store.create("merge-pdf", [entry("a.pdf")], FROM_WORKSPACE),
    ).toBeNull();
  });

  it("reads swallow backend errors into null", async () => {
    const flaky: HandoffBackend = {
      put: async () => {},
      get: async () => {
        throw new Error("read fail");
      },
      delete: async () => {},
      getAll: async () => {
        throw new Error("list fail");
      },
      clear: async () => {},
    };
    const store = new HandoffStore({ backend: flaky, now: () => 0 });
    expect(await store.peek("h_1")).toBeNull();
    expect(await store.purgeExpired()).toBe(0);
  });

  it("round-trips a record's bytes through a real claim", async () => {
    const { store } = makeStore();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const created = await store.create(
      "compress-pdf",
      [
        {
          name: "x.pdf",
          size: bytes.byteLength,
          type: "application/pdf",
          blob: new Blob([bytes]),
        },
      ],
      FROM_WORKSPACE,
    );
    const claimed = (await store.claim(created!.id)) as HandoffRecord;
    const roundTripped = new Uint8Array(
      await claimed.files[0]!.blob.arrayBuffer(),
    );
    expect([...roundTripped]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("HandoffStore — provenance travels with the bytes", () => {
  it("a claimed record carries the origin, trail and pending step it was made with", async () => {
    const { store } = makeStore();
    const created = await store.create("compress-pdf", [entry("a.pdf")], {
      origin: { kind: "result", fromSlug: "merge-pdf" },
      trail: ["merge-pdf"],
      pending: { toolSlug: "sign-pdf", parkedId: null },
    });
    const claimed = await store.claim(created!.id);
    expect(claimed).toMatchObject({
      origin: { kind: "result", fromSlug: "merge-pdf" },
      trail: ["merge-pdf"],
      pending: { toolSlug: "sign-pdf", parkedId: null },
    });
  });
});
