// @vitest-environment jsdom
// @native-canvas
/**
 * PDF to Text's result line as the reader gets it, for text holding astral
 * characters (audit #50, pdf-to-text#2, 2026-11-06).
 *
 * The helper (`extractedTextSummary`, text-summary.test.ts) counted code points
 * correctly while nothing held the RUNNER to it: putting the line back to
 * `${result.characterCount} characters from …` left every test green. This
 * reads the rendered panel.
 *
 * pdf-lib's standard fonts cannot draw an astral character, so the runner's
 * `extract` seam is handed an extraction built through the module's own
 * assembly (`assembleExtraction`), the shape `extractPdfText` returns. Not a
 * `vi.mock`: under `isolate: false` that would leave the runner bound to the
 * stub for later files (mock-isolation.test.ts). The file is still a real
 * PDF, loaded by the real runner.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assembleExtraction } from "@/lib/pdf/text";
import { PdfToTextRunner } from "./pdf-to-text-runner";

const MATH_A = String.fromCodePoint(0x1d400);
const MATH_B = String.fromCodePoint(0x1d401);
const GRIN = String.fromCodePoint(0x1f600);

afterEach(cleanup);

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

async function onePagePdf(): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText("x", { x: 40, y: 200, size: 14, font });
  return new File([new Uint8Array(await doc.save())], "one.pdf", {
    type: "application/pdf",
  });
}

async function resultLineFor(pageText: string): Promise<string> {
  const extract = async () =>
    assembleExtraction(1, [
      { pageNumber: 1, text: pageText, characterCount: pageText.length },
    ]);
  const { container } = render(
    <AppRouterContext.Provider value={router as never}>
      <PdfToTextRunner extract={extract} />
    </AppRouterContext.Provider>,
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  fireEvent.change(input, { target: { files: [await onePagePdf()] } });
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /extract text/i },
      { timeout: 10_000 },
    ),
  );
  await screen.findByText("Text extracted", undefined, { timeout: 10_000 });
  const line = (container.textContent ?? "").match(
    /[\d,]+ characters from [^.]*?page/,
  );
  if (!line) throw new Error("no result line rendered");
  return line[0];
}

describe("PDF to Text's rendered result line counts characters, not UTF-16 units", () => {
  it("says 9 characters for text holding three astral characters", async () => {
    const text = `graph ${MATH_A}${MATH_B}${GRIN}`;
    // Health check: the fixture really has astral characters to miscount.
    expect([...text].length).toBe(9);
    expect(text.length).toBe(12);
    expect(await resultLineFor(text)).toBe("9 characters from 1 page");
  }, 30_000);

  it("CONTROL: plain text, where both counts agree", async () => {
    expect(await resultLineFor("graph AB")).toBe("8 characters from 1 page");
  }, 30_000);
});
