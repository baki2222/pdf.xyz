// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { currentActivity, resetActivityForTests } from "@/lib/activity/bus";
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
        // The run reads the drawn photo back (a blank 4 x 3 page here).
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(255),
        }),
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  for (const release of pending.splice(0)) release();
  cleanup();
  resetAnnouncer();
  resetActivityForTests();
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

/**
 * Perf sweep 2026-11-18, P2: a ~30 s Create PDF on 60 photos could not be
 * stopped — no Cancel, and nothing on the run path took a signal. Cancel
 * returns to the idle runner: the photos stay, no result, no error.
 */
describe("Scan to PDF · Cancel", () => {
  it("is offered while Create PDF runs and stops it with no result and no error", async () => {
    await mountWithPhoto("receipt.png");
    hold = true;
    fireEvent.click(screen.getByRole("button", { name: SCAN_RUN_LABEL }));
    await screen.findByText("Creating PDF…", undefined, { timeout: 4_000 });
    // Health check: the run really is in flight.
    expect(pending.length).toBe(1);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.getAttribute("aria-disabled")).toBeNull();
    await act(async () => {
      fireEvent.click(cancel);
    });
    // The decode the run was waiting on settles after the press (here, as a
    // failure): a cancelled run reports nothing either way.
    await act(async () => {
      for (const release of pending.splice(0)) release();
    });
    await screen.findByRole("button", { name: SCAN_RUN_LABEL });
    expect(screen.queryByText("Creating PDF…")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Scan saved as PDF")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText("receipt.png")).toBeTruthy();
  });

  it("control: with no run in flight there is no Cancel", async () => {
    await mountWithPhoto("receipt.png");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

/**
 * Review of the first fix (2026-11-18): a Cancel pressed while "Saving the
 * PDF…" showed was ignored — nothing checked the signal after the save, so
 * "Scan saved as PDF" was drawn anyway (12 x 12 MP photos, a Cancel in the
 * frame that showed the save: 1 result after Cancel). And once the run
 * stopped, the Cancel button the keyboard was on unmounted and focus fell
 * to the top of the page; and the stopped run told the masthead and a
 * hidden tab's title "done". Here the real run goes all the way to the save
 * on a 4 x 3 photo, and the save is held until the test lets it go.
 */
describe("Scan to PDF · Cancel while the PDF is being saved", () => {
  async function holdSave() {
    const realSave = PDFDocument.prototype.save;
    const held: { saves: number; release: () => void } = {
      saves: 0,
      release: () => {},
    };
    vi.spyOn(PDFDocument.prototype, "save").mockImplementation(function (
      this: PDFDocument,
      ...args: Parameters<PDFDocument["save"]>
    ) {
      held.saves += 1;
      return new Promise<Uint8Array>((resolve) => {
        held.release = () => resolve(realSave.apply(this, args));
      });
    });
    return held;
  }

  it("shows no result, reports no 'done', and puts the keyboard on Create PDF", async () => {
    const held = await holdSave();
    await mountWithPhoto("receipt.png");
    fireEvent.click(screen.getByRole("button", { name: SCAN_RUN_LABEL }));
    await screen.findByText("Saving the PDF…", undefined, { timeout: 4_000 });
    // Health check: the run is inside the save the test is holding.
    expect(held.saves).toBe(1);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    await act(async () => {
      fireEvent.click(cancel);
    });
    await act(async () => {
      held.release();
    });
    await waitFor(
      () => expect(screen.queryByText("Creating PDF…")).toBeNull(),
      { timeout: 4_000 },
    );
    expect(screen.queryByText("Scan saved as PDF")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(currentActivity().state).toBe("idle");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: SCAN_RUN_LABEL }),
    );
    expect(screen.getByText("receipt.png")).toBeTruthy();
  });

  it("control: left alone, the same held save ends in the result", async () => {
    const held = await holdSave();
    await mountWithPhoto("receipt.png");
    fireEvent.click(screen.getByRole("button", { name: SCAN_RUN_LABEL }));
    await screen.findByText("Saving the PDF…", undefined, { timeout: 4_000 });
    expect(held.saves).toBe(1);
    await act(async () => {
      held.release();
    });
    await screen.findByText("Scan saved as PDF", undefined, {
      timeout: 4_000,
    });
    expect(currentActivity().state).toBe("done");
  });
});
