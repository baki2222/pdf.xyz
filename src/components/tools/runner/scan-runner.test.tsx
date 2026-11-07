// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { withAppRouter } from "@/tests/app-router";
import { SCAN_RUN_LABEL, ScanRunner } from "./scan-runner";

/*
 * jsdom has no ImageBitmap and no 2D canvas, so the browser surface Scan to
 * PDF decodes photos with is stubbed per test — globals and a prototype
 * method, restored after each, never a `vi.mock` of a module: a mocked
 * `scan-browser` would leave `scan-runner.tsx` cached bound to the stub for
 * the next file (`src/tests/mock-isolation.test.ts`). While `hold` is set, a
 * decode waits for the test to release it, so Clear can be pressed while
 * Create PDF is still running.
 */
let hold = false;
const pending: (() => void)[] = [];

beforeEach(() => {
  hold = false;
  const bitmap = () => ({ width: 4, height: 3, close() {} });
  vi.stubGlobal("createImageBitmap", () =>
    hold
      ? new Promise((_, reject) => {
          pending.push(() => reject(new Error("released by the test")));
        })
      : Promise.resolve(bitmap()),
  );
  const noop = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillRect: noop,
        translate: noop,
        rotate: noop,
        drawImage: noop,
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  for (const release of pending.splice(0)) release();
  cleanup();
  resetAnnouncer();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

async function mountWithPhoto(name: string): Promise<void> {
  const { container } = render(withAppRouter(<ScanRunner />));
  const file = new File([new Uint8Array(PNG_1X1)], name, {
    type: "image/png",
  });
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  await screen.findByText(name, undefined, { timeout: 4_000 });
}

/**
 * Audit #47 (2026-11-06), review follow-up: Clear stayed live while Create
 * PDF ran, and the photos it cleared came back as "Scan saved as PDF". The
 * shared `useAsyncRun` now drops a result that lands after a reset
 * (`use-async-run.test.tsx`); this holds the button itself, through the
 * runner, so removing its hold cannot stay green.
 */
describe("Scan to PDF · Clear", () => {
  it("is held while Create PDF runs: the photos stay", async () => {
    await mountWithPhoto("receipt.png");
    hold = true;
    fireEvent.click(screen.getByRole("button", { name: SCAN_RUN_LABEL }));
    // Health check: the run really is in flight (its hold is what is tested).
    await screen.findByText("Creating PDF…", undefined, { timeout: 4_000 });
    expect(pending.length).toBe(1);
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(clear);
    expect(screen.getByText("receipt.png")).toBeTruthy();
  });

  it("control: with no run in flight, Clear removes the photos", async () => {
    await mountWithPhoto("receipt.png");
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear.getAttribute("aria-disabled")).toBeNull();
    await act(async () => {
      fireEvent.click(clear);
    });
    expect(screen.queryByText("receipt.png")).toBeNull();
  });
});
