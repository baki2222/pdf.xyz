// @vitest-environment jsdom
/**
 * Edit PDF's form, driven the way a person drives it.
 *
 * `src/lib/pdf/edit-placement.test.ts` proves the engine: placement in the
 * viewer's frame and the refusal of text that would be clipped. This file
 * proves the form reaches it — that the page size a person is shown is the
 * page they see, and that an over-long line is refused when it is ADDED, not
 * silently accepted into a list whose export then fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, degrees } from "pdf-lib";
import { EditRunner } from "./edit-runner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tools/edit-pdf",
  useSearchParams: () => new URLSearchParams(),
}));

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
  const { container } = render(<EditRunner />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone's file input").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
  await screen.findByText("Add content", {}, { timeout: 5000 });
}

const LONG =
  "Please review the attached figures before Friday and return any corrections to the finance team.";

describe("Edit PDF form", () => {
  it("shows the page size the reader sees on a rotated page", async () => {
    await openInRunner(await letterPdf(90));
    expect(
      await screen.findByText("Page 1 is 792 × 612 pt"),
    ).toBeInTheDocument();
  });

  it("refuses an over-long line when it is added, and accepts it once wrapped", async () => {
    await openInRunner(await letterPdf(0));
    await screen.findByText("Page 1 is 612 × 792 pt");
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: LONG },
    });
    fireEvent.click(screen.getByRole("button", { name: /add to page/i }));
    expect(
      await screen.findByText(/runs past the right edge.*Wrap width of 540 pt/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing added yet/)).toBeInTheDocument();

    // Positive control: the same text, wrapped inside the room it has.
    fireEvent.change(screen.getByLabelText("Wrap (pt)"), {
      target: { value: "540" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add to page/i }));
    expect(
      await screen.findByRole("list", { name: "Placed edits" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/runs past the right edge/)).toBeNull();
  });
});
