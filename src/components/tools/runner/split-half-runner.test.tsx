// @vitest-environment jsdom
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
import { SPLIT_ORDER_CHOICES } from "@/lib/pdf/split-half";
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
