// @vitest-environment jsdom
// @native-canvas
/**
 * PDF to Text works out the download's size ONCE per result (audit
 * pdf-to-text#4, 2026-11-06).
 *
 * The Download TXT button showed its size through
 * `new TextEncoder().encode(result.text)` written inline in the render, so
 * every re-render of the result (any state change above it) encoded the whole
 * text again: on a book, megabytes of work per keystroke or scroll. The size
 * now comes from the result's one kept output file (`textOutputFile`, kept
 * per result), which encodes the text once and is also what Download writes.
 *
 * Counted, not timed: a spy on `TextEncoder.prototype.encode` counts the
 * calls that were handed the extracted text. The extraction comes through the
 * runner's `extract` seam (see pdf-to-text-result-line.test.tsx for why not
 * `vi.mock`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  type RenderResult,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assembleExtraction, type ExtractedPdfText } from "@/lib/pdf/text";
import { formatBytes } from "@/lib/utils";
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

// Non-ASCII on purpose: the size must be the UTF-8 byte count, not the
// character count, so a "fix" that used `text.length` would show the wrong
// figure and fail the size assertion below.
const PAGES = ["Rechnung Nr. 1042 — Größe", "Danke für Ihre Bestellung."];

function tree(extract: () => Promise<ExtractedPdfText>) {
  return (
    <AppRouterContext.Provider value={router as never}>
      <PdfToTextRunner extract={extract} />
    </AppRouterContext.Provider>
  );
}

describe("PDF to Text encodes the extracted text once per result", () => {
  it("one encode when the result appears, none on a re-render, and the size shown is the UTF-8 size", async () => {
    const extract = async () =>
      assembleExtraction(
        2,
        PAGES.map((text, i) => ({
          pageNumber: i + 1,
          text,
          characterCount: text.length,
        })),
      );
    const whole = (await extract()).text;
    // Health check of the fixture: its UTF-8 size differs from its length.
    const utf8 = new TextEncoder().encode(whole).byteLength;
    expect(utf8).toBeGreaterThan(whole.length);

    const seen: string[] = [];
    const original = TextEncoder.prototype.encode;
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (
      this: TextEncoder,
      input?: string,
    ) {
      seen.push(input ?? "");
      return original.call(this, input);
    });
    const encodesOfText = () => seen.filter((s) => s === whole).length;

    const view: RenderResult = render(tree(extract));
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="file"]');
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

    // Positive control: the spy sees the result's encode (a spy that saw
    // nothing would pass every "0" below).
    expect(encodesOfText()).toBe(1);
    const button = screen.getByRole("button", { name: /Download TXT/ });
    expect(button.textContent).toContain(`(${formatBytes(utf8)})`);

    // Unrelated re-renders: the same tree rendered again, three times.
    for (let i = 0; i < 3; i += 1) {
      view.rerender(tree(extract));
    }
    expect(screen.getByText("Text extracted")).toBeTruthy();
    expect(encodesOfText()).toBe(1);
  }, 30_000);
});
