// @vitest-environment jsdom
/**
 * `dropSheetsLive` (./drop-sheets-live) must not race the engine's MODULE
 * LOAD against its wait. It did: the wait was `waitFor`'s 1 s default, the
 * engine came through a cold `import()`, and on CI the load lost —
 * "1 drop sheet(s) have no engine yet" in runs 44164715213 and 44228410852.
 *
 * Neither check below measures time, so neither needs a slow machine to go
 * red. Each was seen red by a mutant applied to a copy of the helper:
 *  - the warm-up `import "@/lib/intent/page-target"` deleted → "loads the
 *    engine's module with itself" fails on its first assertion, on any
 *    runner (the module is never asked for while the helper loads);
 *  - `{ timeout: DROP_ENGINE_WAIT_MS }` deleted (the 1 s default back) →
 *    "gives a sheet DROP_ENGINE_WAIT_MS" rejects at the first second of a
 *    FAKE clock, which no runner's speed can move.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const ENGINE = "@/lib/intent/page-target";

describe("dropSheetsLive", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock(ENGINE);
  });
  // Every module this file re-evaluated is dropped, so a file that shares
  // this worker (threads, isolate: false) loads its own.
  afterAll(() => vi.resetModules());

  it("loads the engine's module with itself, so a sheet's engine arrives in microtasks", async () => {
    vi.resetModules();
    // A spy on the module, not a replacement: it records that the module
    // was asked for and hands back the real one.
    let asked = 0;
    vi.doMock(ENGINE, async (importOriginal) => {
      asked += 1;
      return importOriginal();
    });
    const { dropSheetsLive } = await import("./drop-sheets-live");
    // THE PROPERTY'S CAUSE: loading the helper asked for the engine's
    // module, before any test could render a sheet.
    expect(asked, "the helper loaded without the engine's module").toBe(1);

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
    // The module the sheet used is the one the helper loaded: asked once.
    expect(asked).toBe(1);
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
