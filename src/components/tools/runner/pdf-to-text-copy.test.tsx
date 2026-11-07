// @vitest-environment jsdom
// @native-canvas
/**
 * PDF to Text has a one-press "Copy text" beside Download TXT (audit
 * pdf-to-text#5, 2026-11-07).
 *
 * The page's first use case is pasting the text into an email, a spreadsheet
 * or a translation tool, yet the only way to get it there was to select a
 * whole document inside a 18rem scroll box — on a touch screen, close to
 * impossible. Driven through the real runner with a real PDF; the
 * extraction comes through the runner's `extract` seam (not `vi.mock`, see
 * pdf-to-text-result-line.test.tsx for why).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assembleExtraction } from "@/lib/pdf/text";
import { COPY_STATUS } from "../copy-text-button";
import { PdfToTextRunner } from "./pdf-to-text-runner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

async function twoPagePdf(): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i += 1) {
    doc.addPage([300, 300]).drawText("x", { x: 40, y: 200, size: 14, font });
  }
  return new File([new Uint8Array(await doc.save())], "two.pdf", {
    type: "application/pdf",
  });
}

const PAGES = ["Invoice 1042\nTotal due: 120.00", "Thank you for your order."];

async function extractedRunner() {
  const extract = async () =>
    assembleExtraction(
      2,
      PAGES.map((text, i) => ({
        pageNumber: i + 1,
        text,
        characterCount: text.length,
      })),
    );
  const { container } = render(
    <AppRouterContext.Provider value={router as never}>
      <PdfToTextRunner extract={extract} />
    </AppRouterContext.Provider>,
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  fireEvent.change(input, { target: { files: [await twoPagePdf()] } });
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /extract text/i },
      { timeout: 10_000 },
    ),
  );
  await screen.findByText("Text extracted", undefined, { timeout: 10_000 });
  return extract;
}

describe("PDF to Text copies the whole extracted text with one press", () => {
  it("Copy text puts exactly the TXT's text on the clipboard and says so", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const extract = await extractedRunner();
    const expected = (await extract()).text;
    // Health check: the fixture spans both pages, so a copy of one page
    // (or of the preview's first screen) could not pass.
    for (const page of PAGES) expect(expected).toContain(page);

    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await waitFor(() =>
      expect(screen.getByText(COPY_STATUS.copied)).toBeTruthy(),
    );
    expect(writeText).toHaveBeenCalledWith(expected);
    // Positive control: the download is still offered beside it.
    expect(screen.getByRole("button", { name: /Download TXT/ })).toBeTruthy();
  }, 30_000);

  it("a browser without the clipboard API is told how to copy instead", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    await extractedRunner();
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await waitFor(() =>
      expect(screen.getByText(COPY_STATUS.failed)).toBeTruthy(),
    );
    expect(screen.queryByText(COPY_STATUS.copied)).toBeNull();
  }, 30_000);
});
