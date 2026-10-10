// @vitest-environment jsdom
/**
 * The sweep the root layout mounts on every page: once the page is idle, it
 * deletes expired hand-off records — so a file someone passed to a tool and
 * never opened does not stay in their browser past its time-to-live.
 *
 * Read from what it does to a real (fake) IndexedDB, stubbed into the page's
 * global for one test at a time and restored after.
 */
import { cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexedDbHandoffBackend } from "@/lib/handoff/idb";
import { makeHandoffRecord } from "@/lib/handoff/record";
import { HandoffSweep } from "./handoff-sweep";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HandoffSweep", () => {
  it("renders nothing, then deletes expired hand-offs once the page is idle", async () => {
    const factory = new IDBFactory();
    const backend = new IndexedDbHandoffBackend(factory);
    await backend.put(
      makeHandoffRecord({
        id: "h_stale",
        toolSlug: "merge-pdf",
        files: [],
        now: 0,
        ttlMs: 1_000,
        origin: { kind: "workspace" },
      }),
    );
    vi.stubGlobal("indexedDB", factory);
    const { container } = render(<HandoffSweep />);
    expect(container.innerHTML).toBe("");
    await vi.waitFor(async () => expect(await backend.getAll()).toEqual([]), {
      timeout: 5_000,
    });
  });

  it("leaves a browser with no hand-off database without one", async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, "open");
    vi.stubGlobal("indexedDB", factory);
    render(<HandoffSweep />);
    // Health: the sweep really ran (asked to open the database) — without
    // this, an empty list after a fixed wait could mean it never started.
    await vi.waitFor(() => expect(open).toHaveBeenCalled(), { timeout: 5_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(await factory.databases()).toEqual([]);
  });
});
