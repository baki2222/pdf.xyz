// @vitest-environment jsdom
/**
 * Redact PDF's "Whole pages" field (audit redact-pdf#5, 2026-11-06): a page
 * list adds one page-sized area per page, the list says so, and pressing
 * Redact PDF hands the engine exactly those boxes — the chain from the field
 * to the engine's input, not the helper alone (`redact-whole-pages.test.ts`
 * runs the engine on them).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import type { RedactionRect } from "@/lib/pdf/redact";
import { RedactEditor, redactRunnerDeps } from "./redact-runner";

const engine = { rects: null as RedactionRect[] | null };

const realFlatten = redactRunnerDeps.flatten;

beforeEach(() => {
  engine.rects = null;
  // The flatten engine needs a canvas jsdom lacks; record what it is handed.
  redactRunnerDeps.flatten = async (bytes, options) => {
    engine.rects = options.rects;
    return {
      bytes,
      pageCount: 3,
      redactionCount: options.rects.length,
      totalImageBytes: 0,
      undecodedImages: 0,
    };
  };
  URL.createObjectURL = vi.fn(() => "blob:redact-test");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  redactRunnerDeps.flatten = realFlatten;
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

/** Three pages; the second is landscape, so a size typed for one page misfits it. */
async function threePages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([842, 595]);
  doc.addPage([612, 792]);
  return doc.save();
}

async function renderEditor() {
  const bytes = await threePages();
  const file = new File([bytes], "id-scan.pdf", { type: "application/pdf" });
  render(
    <RedactEditor
      pdf={{
        file,
        bytes,
        pageCount: 3,
        rotations: [0, 0, 0],
        digitalSignatures: 0,
      }}
      onReset={() => {}}
    />,
  );
  // Page sizes are read asynchronously; the builder waits on them.
  await screen.findByText(/^Page 1 is 612 × 792 pt$/);
}

describe("Redact PDF: whole pages", () => {
  it("has a labelled page-list field and an add button", async () => {
    await renderEditor();
    expect(screen.getByLabelText("Whole pages")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add whole pages" }),
    ).toBeTruthy();
  });

  it("adds one page-sized area per listed page, and Redact PDF sends exactly those", async () => {
    await renderEditor();
    fireEvent.change(screen.getByLabelText("Whole pages"), {
      target: { value: "2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add whole pages" }));

    const list = await screen.findByRole("list", { name: "Redaction areas" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Page 2 · whole page"),
      expect.stringContaining("Page 3 · whole page"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Redact PDF/ }));
    await waitFor(() => expect(engine.rects).not.toBeNull());
    // Literal, not the helper's output: a helper that sized every box from
    // page 1 would agree with itself and cover only part of landscape page 2.
    expect(engine.rects).toEqual([
      { page: 2, x: 0, y: 0, width: 842, height: 595 },
      { page: 3, x: 0, y: 0, width: 612, height: 792 },
    ]);
  });

  it("a page past the end is refused in words, and adds nothing", async () => {
    await renderEditor();
    fireEvent.change(screen.getByLabelText("Whole pages"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add whole pages" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringMatching(/5/),
    );
    expect(screen.queryByRole("list", { name: "Redaction areas" })).toBeNull();
  });
});
