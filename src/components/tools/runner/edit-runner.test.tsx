// @vitest-environment jsdom
// @native-canvas
/**
 * Edit PDF's editor, driven the way a person drives it, in jsdom.
 *
 * `src/lib/pdf/editor-export.test.ts` proves the engine (positions read back
 * through pdf.js on rotated and cropped pages) and `e2e/editor-wysiwyg.spec.ts`
 * proves the whole chain in a real browser. This file proves the runner
 * reaches them: the page a person is shown is the page they see, and text is
 * laid out the way the export will draw it.
 *
 * HISTORY, kept on purpose. Until 2026-10-24 this file drove the coordinate
 * FORM that was then the editor, with two tests:
 *
 *   1. "shows the page size the reader sees on a rotated page" — asserted the
 *      line "Page 1 is 792 × 612 pt". INVERTED below: the editor no longer
 *      prints a size for you to type coordinates against; it DRAWS the page,
 *      and the sheet it draws is 792 × 612 points on a /Rotate 90 Letter page.
 *   2. "refuses an over-long line when it is added, and accepts it once
 *      wrapped" — the form had no box to wrap in, so a long line was refused
 *      and the reader told to set "Wrap (pt)". INVERTED below: every text box
 *      has a width, and the same sentence wraps inside it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { withAppRouter } from "@/tests/app-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument, degrees } from "pdf-lib";
import { EditRunner } from "./edit-runner";

// The router comes from its context (`withAppRouter`), not a module mock:
// under isolate:false a runner another file imported first stays cached bound
// to the real `next/navigation`, and a mock here would never reach it.

afterEach(() => {
  cleanup();
});

async function letterPdf(rotate: number): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).setRotation(degrees(rotate));
  const bytes = await doc.save();
  return new File([bytes.slice().buffer], "letter.pdf", {
    type: "application/pdf",
  });
}

async function openInRunner(file: File) {
  const { container } = render(withAppRouter(<EditRunner />));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone's file input").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
  await waitFor(
    () =>
      expect(
        container.querySelector('[data-editor-page="0"]'),
        "the editor drew page 1",
      ).not.toBeNull(),
    { timeout: 8000 },
  );
  return container;
}

const LONG =
  "Please review the attached figures before Friday and return any corrections to the finance team.";

describe("Edit PDF editor", () => {
  it("draws a rotated page in the frame the reader sees", async () => {
    const container = await openInRunner(await letterPdf(90));
    const sheet = container.querySelector('[data-editor-page="0"]')!;
    expect(sheet.getAttribute("data-page-pt")).toBe("792x612");
    // Positive control: the same page unrotated is the other way round.
    cleanup();
    const plain = await openInRunner(await letterPdf(0));
    expect(
      plain
        .querySelector('[data-editor-page="0"]')!
        .getAttribute("data-page-pt"),
    ).toBe("612x792");
  });

  it("wraps a long line inside its box instead of refusing it, and undo takes it away", async () => {
    const container = await openInRunner(await letterPdf(0));
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    const sheet = container.querySelector<HTMLElement>(
      '[data-editor-page="0"]',
    )!;
    fireEvent.pointerDown(sheet, { button: 0, clientX: 40, clientY: 60 });
    const box = await screen.findByLabelText("Text box text");
    fireEvent.change(box, { target: { value: LONG } });
    act(() => {
      fireEvent.blur(box);
    });
    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-object-kind="text"] text').length,
      ).toBeGreaterThan(1),
    );
    const lines = [
      ...container.querySelectorAll('[data-object-kind="text"] text'),
    ].map((t) => t.textContent ?? "");
    // Every word is kept, in order, across the lines.
    expect(lines.join(" ")).toBe(LONG);
    expect(screen.queryByText(/runs past the right edge/)).toBeNull();

    // Undo removes the box; redo brings it back.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(container.querySelector('[data-object-kind="text"]')).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() =>
      expect(
        container.querySelector('[data-object-kind="text"]'),
      ).not.toBeNull(),
    );
  });
});
