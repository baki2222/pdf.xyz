// @vitest-environment jsdom
/**
 * `dropSheetsLive` (./drop-sheets-live) must not race the engine's MODULE
 * LOAD against its wait. It did: the wait was `waitFor`'s 1 s default, the
 * engine came through a cold `import()`, and on CI the load lost —
 * "1 drop sheet(s) have no engine yet" in runs 44164715213 and 44228410852.
 *
 * Neither check below measures time, so neither needs a slow machine to go
 * red. Each was seen red by a mutant applied to a copy of the helper:
 *  - the warm-up `await loadDropEngine()` deleted → "loads the sheet's
 *    engine with itself" fails on its first assertion, on any runner (the
 *    loader is never called while the helper loads);
 *  - the hook's `loadDropEngine()` replaced by an `import()` of its own (the
 *    review's repro of f1d8a04f: a warm-up that names a module keeps
 *    warming after the hook moves) → the same test fails on "the sheet
 *    fetched its engine by a path the helper did not warm", in any file
 *    order: it counts CALLS of the one loader, not whether a module happens
 *    to be in the cache, which an earlier file in the worker can arrange;
 *  - `{ timeout: DROP_ENGINE_WAIT_MS }` deleted (the 1 s default back) →
 *    "gives a sheet DROP_ENGINE_WAIT_MS" rejects at the first second of a
 *    FAKE clock, which no runner's speed can move.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The one loader both the hook and the helper fetch the engine by. Spied,
// not replaced: each call is counted and handed to the real one.
const LOADER = "@/components/upload/drop-engine-load";

describe("dropSheetsLive", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock(LOADER);
  });
  // Every module this file re-evaluated is dropped, so a file that shares
  // this worker (threads, isolate: false) loads its own.
  afterAll(() => vi.resetModules());

  it("loads the sheet's engine with itself, so a sheet's engine arrives in microtasks", async () => {
    vi.resetModules();
    let calls = 0;
    vi.doMock(LOADER, async (importOriginal) => {
      const real =
        await importOriginal<
          typeof import("@/components/upload/drop-engine-load")
        >();
      return {
        loadDropEngine: () => {
          calls += 1;
          return real.loadDropEngine();
        },
      };
    });
    const { dropSheetsLive } = await import("./drop-sheets-live");
    // THE PROPERTY'S CAUSE: loading the helper called the sheet's engine
    // loader, before any test could render a sheet.
    expect(calls, "the helper loaded without the sheet's engine loader").toBe(
      1,
    );

    // AT THE POINT OF CONSUMPTION: a real sheet, rendered after the helper,
    // has its engine without a single macrotask — no module load, no timer,
    // nothing a slow runner can stretch. A drain of microtasks only: no I/O
    // callback can run inside one.
    const rtl = await import("@testing-library/react");
    const React = await import("react");
    const { DropSheet } = await import("@/components/upload/drop-sheet");
    const { DROP_ENGINE_MARK } = await import("@/lib/intent/drop-engine");
    const { container } = rtl.render(
      React.createElement(DropSheet, {
        accept: ".pdf",
        multiple: false,
        title: "Drop a PDF here",
        onFiles: () => {},
        variant: "sheet",
      }),
    );
    const sheet = container.querySelector("[data-drop-sheet]");
    // Health check: a sheet was rendered, and it does NOT have its engine at
    // the commit — the arrival below is the import's, not the markup's.
    expect(sheet).not.toBeNull();
    expect(sheet!.hasAttribute(DROP_ENGINE_MARK)).toBe(false);
    for (let i = 0; i < 1_000 && !sheet!.hasAttribute(DROP_ENGINE_MARK); i++)
      await Promise.resolve();
    expect(
      sheet!.hasAttribute(DROP_ENGINE_MARK),
      "the sheet's engine needed more than microtasks (a module load) to arrive",
    ).toBe(true);
    // THE RELATIONSHIP: the sheet fetched its engine by the same loader the
    // helper warmed. Unlike the microtask check above, this does not depend
    // on what an earlier file in this worker happened to load.
    expect(
      calls,
      "the sheet fetched its engine by a path the helper did not warm",
    ).toBe(2);
    await dropSheetsLive(container);
    rtl.cleanup();
  });

  it("gives a sheet DROP_ENGINE_WAIT_MS, then names what is missing", async ({
    task,
  }) => {
    const { dropSheetsLive, DROP_ENGINE_WAIT_MS } =
      await import("./drop-sheets-live");
    // The wait stays under the default test timeout (this test sets none),
    // or a sheet whose engine never comes reports "Test timed out", which
    // names nothing, instead of the helper's line below.
    expect(task.timeout).toBeGreaterThan(0);
    expect(DROP_ENGINE_WAIT_MS).toBeLessThan(task.timeout);
    // A sheet whose engine never comes: the attribute alone, no box.
    const root = document.createElement("div");
    root.innerHTML = '<div data-drop-sheet=""></div>';
    document.body.append(root);
    vi.useFakeTimers();
    let settled: "pending" | "resolved" | Error = "pending";
    dropSheetsLive(root).then(
      () => (settled = "resolved"),
      (e: Error) => (settled = e),
    );
    // One fake millisecond short of the wait: still waiting.
    await vi.advanceTimersByTimeAsync(DROP_ENGINE_WAIT_MS - 1);
    expect(settled, "the wait gave up before DROP_ENGINE_WAIT_MS").toBe(
      "pending",
    );
    // Past it: rejected, with the helper's own message.
    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toBeInstanceOf(Error);
    expect((settled as unknown as Error).message).toContain(
      "1 drop sheet(s) have no engine yet",
    );
    root.remove();
  });
});
