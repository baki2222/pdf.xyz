// @vitest-environment jsdom
// @native-canvas
/**
 * Split PDF Pages in Half's Page order, as a person reaches it on a top and
 * bottom cut, and what the saved file then holds.
 *
 * Until 2026-11-08 the runner showed Page order only for a left and right cut
 * and the engine ignored the order on a top and bottom one, so a two-up sheet
 * whose lower page is read first could not come out in reading order. The
 * engine half is proved by `split-half.test.ts` on rendered pixels; this file
 * proves the control is there to press, and that pressing it reaches the
 * saved file: the first output page's crop box is the BOTTOM half.
 *
 * No module is mocked (`src/tests/mock-isolation.test.ts`); the download is
 * caught at the anchor the browser would click.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { ONLY_WIDER_LABELS, SPLIT_ORDER_CHOICES } from "@/lib/pdf/split-half";
import { SplitHalfEditor } from "./split-half-runner";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

const WIDTH = 400;
const HEIGHT = 600;

/** Catch what a download would save. */
function catchDownloads() {
  const saved: Blob[] = [];
  let pending: Blob | null = null;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      pending = blob;
      return "blob:split-half-test";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    if (pending) saved.push(pending);
    pending = null;
  });
  return saved;
}

async function openSheet(): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([WIDTH, HEIGHT]);
  const bytes = await doc.save();
  const file = new File([bytes.slice()], "sheet.pdf", {
    type: "application/pdf",
  });
  render(
    <AppRouterContext.Provider value={router as never}>
      <SplitHalfEditor
        pdf={{
          file,
          bytes,
          pageCount: 1,
          rotations: [0],
          digitalSignatures: 0,
        }}
        onReset={() => {}}
      />
    </AppRouterContext.Provider>,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Top and bottom" }));
}

async function splitWith(orderLabel: string | null): Promise<number> {
  const saved = catchDownloads();
  await openSheet();
  if (orderLabel) {
    fireEvent.click(screen.getByRole("radio", { name: orderLabel }));
  }
  fireEvent.click(screen.getByRole("button", { name: /split pages/i }));
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /download split pdf/i },
      { timeout: 10_000 },
    ),
  );
  expect(saved).toHaveLength(1);
  const out = await PDFDocument.load(
    new Uint8Array(await saved[0]!.arrayBuffer()),
  );
  expect(out.getPageCount()).toBe(2);
  return out.getPage(0).getCropBox().y;
}

describe("Split PDF Pages in Half — Page order on a top and bottom cut", () => {
  it("offers the order with top and bottom labels", async () => {
    await openSheet();
    expect(
      screen.getByRole("radiogroup", { name: "Page order" }),
    ).toBeInTheDocument();
    for (const choice of SPLIT_ORDER_CHOICES["top-bottom"]) {
      expect(
        screen.getByRole("radio", { name: choice.label }),
      ).toBeInTheDocument();
    }
  });

  it("Bottom half first puts the bottom half on the first page", async () => {
    // The bottom half of an unrotated page starts at y = 0.
    expect(await splitWith("Bottom half first")).toBe(0);
  });

  it("control: the default keeps the top half first", async () => {
    expect(await splitWith(null)).toBe(HEIGHT / 2);
  });
});

/** Open a 2-page PDF of `sizes` in the editor, left and right. */
async function openSpreads(sizes: [number, number][]): Promise<void> {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  const bytes = await doc.save();
  render(
    <AppRouterContext.Provider value={router as never}>
      <SplitHalfEditor
        pdf={{
          file: new File([bytes.slice()], "spreads.pdf", {
            type: "application/pdf",
          }),
          bytes,
          pageCount: sizes.length,
          rotations: sizes.map(() => 0),
          digitalSignatures: 0,
        }}
        onReset={() => {}}
      />
    </AppRouterContext.Provider>,
  );
}

/** Run, download, and read each output page's crop box width. */
async function widthsAfterRun(saved: Blob[]): Promise<number[]> {
  fireEvent.click(screen.getByRole("button", { name: /split pages/i }));
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /download split pdf/i },
      { timeout: 10_000 },
    ),
  );
  const out = await PDFDocument.load(
    new Uint8Array(await saved[0]!.arrayBuffer()),
  );
  return out.getPages().map((p) => p.getCropBox().width);
}

/**
 * Audit split-pdf-pages-in-half#1 (2026-11-22): the cut was always in the
 * middle. The reader now sets where it falls, sees it as a line on the
 * first page to be split, and can move that line with the keys.
 */
describe("Split PDF Pages in Half — where the cut falls", () => {
  it("a 40% cut reaches the saved file: halves of 40% and 60%", async () => {
    const saved = catchDownloads();
    await openSpreads([[800, 500]]);
    fireEvent.change(screen.getByLabelText("Cut position"), {
      target: { value: "40" },
    });
    expect(await widthsAfterRun(saved)).toEqual([320, 480]);
  });

  it("control: untouched, the cut is the middle", async () => {
    const saved = catchDownloads();
    await openSpreads([[800, 500]]);
    expect(await widthsAfterRun(saved)).toEqual([400, 400]);
  });

  it("shows the cut as a line on the page, which the arrow keys move", async () => {
    await openSpreads([[800, 500]]);
    const line = await screen.findByRole("slider", { name: "Cut line" });
    expect(line).toHaveAttribute("aria-valuenow", "50");
    expect(line.style.left).toBe("50%");
    fireEvent.keyDown(line, { key: "ArrowLeft" });
    fireEvent.keyDown(line, { key: "ArrowLeft", shiftKey: true });
    expect(line).toHaveAttribute("aria-valuenow", "39");
    expect(line.style.left).toBe("39%");
    // The slider and the line are one value.
    expect(
      Number((screen.getByLabelText("Cut position") as HTMLInputElement).value),
    ).toBe(39);
  });

  // The FAQ and guide say "drag the dashed line"; until the review of lane
  // w1a (2026-11-28) nothing dragged it, and PROOF_LIMITS named a Node test
  // with no pointer code as the proof. A no-op pointer move stayed green.
  it("dragging the line with a pointer moves the cut, and the saved file is cut there", async () => {
    const saved = catchDownloads();
    await openSpreads([[800, 500]]);
    const line = await screen.findByRole("slider", { name: "Cut line" });
    const sheet = document.querySelector<HTMLElement>("[data-split-sheet]")!;
    // jsdom lays nothing out: the sheet is given the box a browser would.
    sheet.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 200, height: 125 }) as DOMRect;
    // Health: jsdom's pointer events carry clientX, or the drag below
    // would measure nothing and pass on the default.
    expect(new PointerEvent("pointermove", { clientX: 7 }).clientX).toBe(7);
    // A move without a press is not a drag.
    fireEvent.pointerMove(line, { clientX: 180, pointerId: 1 });
    expect(line).toHaveAttribute("aria-valuenow", "50");
    fireEvent.pointerDown(line, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(line, { clientX: 160, pointerId: 1 });
    expect(line).toHaveAttribute("aria-valuenow", "30");
    // Past the sheet's edge, the cut stops at the engine's bound.
    fireEvent.pointerMove(line, { clientX: 90, pointerId: 1 });
    expect(line).toHaveAttribute("aria-valuenow", "10");
    fireEvent.pointerMove(line, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(line, { clientX: 150, pointerId: 1 });
    // Released: a later move does nothing.
    fireEvent.pointerMove(line, { clientX: 260, pointerId: 1 });
    expect(line).toHaveAttribute("aria-valuenow", "25");
    expect(await widthsAfterRun(saved)).toEqual([200, 600]);
  });
});

describe("Split PDF Pages in Half — Booklet scan and the shape option", () => {
  it("offers Booklet scan with what it does", async () => {
    await openSpreads([[800, 500]]);
    fireEvent.click(screen.getByRole("radio", { name: "Booklet scan" }));
    expect(screen.getByText(/folded booklet scanned one sheet/)).toBeTruthy();
  });

  it("labels the shape option as the engine and the page name it, on each cut", async () => {
    await openSpreads([[800, 500]]);
    expect(
      screen.getByRole("checkbox", {
        name: new RegExp(`^${ONLY_WIDER_LABELS["left-right"]}`),
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Top and bottom" }));
    expect(
      screen.getByRole("checkbox", {
        name: new RegExp(`^${ONLY_WIDER_LABELS["top-bottom"]}`),
      }),
    ).toBeInTheDocument();
  });

  it("Only split pages wider than tall leaves a portrait page whole", async () => {
    const saved = catchDownloads();
    await openSpreads([
      [800, 500],
      [400, 600],
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /only split pages wider than tall/i,
      }),
    );
    expect(await widthsAfterRun(saved)).toEqual([400, 400, 400]);
  });
});
