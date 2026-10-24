// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, PageSizes } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { watermarkPdf } from "@/lib/pdf/watermark";
import { WatermarkEditor } from "./watermark-runner";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";

/**
 * What a person using Add Watermark is TOLD. The engine now shrinks text that
 * would not fit a page (see `src/lib/pdf/watermark.test.ts`, which reads the
 * output through pdfjs); a shrink the result panel does not mention is the old
 * defect's silence moved one layer up. Before this file the panel said
 * "Stamped on all N pages" whatever happened, because the runner only had the
 * bytes.
 */

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

async function pdfOf(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  return doc.save();
}

async function runWith(bytes: Uint8Array, pageCount: number, text: string) {
  const file = new File([new Uint8Array(bytes)], "doc.pdf", {
    type: "application/pdf",
  });
  render(
    <WatermarkEditor
      pdf={{
        file,
        bytes,
        pageCount,
        rotations: Array.from({ length: pageCount }, () => 0 as const),
        digitalSignatures: countDigitalSignatures(bytes),
      }}
      onReset={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^text$/i), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /add watermark/i }));
  return screen.findByRole("group", { name: /watermark added/i });
}

describe("Add Watermark runner — the result says when text was shrunk to fit", () => {
  it("names how many pages were shrunk — the engine's count, not a fixed phrase", async () => {
    // Same text, mixed sizes: fits A3, does not fit A6.
    const bytes = await pdfOf([PageSizes.A3, PageSizes.A6]);
    const text = "DRAFT - DO NOT COPY";
    const report = await watermarkPdf(bytes, text, {
      fontSize: 60,
      rotation: 45,
      opacity: 0.18,
    });
    // Health check: the fixture really exercises a partial shrink.
    expect(report.shrunkPages).toBe(1);

    const panel = await runWith(bytes, 2, text);
    expect(panel).toHaveTextContent(
      `Shrunk to fit on ${report.shrunkPages} of ${report.pages} pages`,
    );
  });

  it("positive control: text that fits everywhere mentions no shrinking", async () => {
    const bytes = await pdfOf([PageSizes.A3]);
    const panel = await runWith(bytes, 1, "CONFIDENTIAL");
    expect(panel).toHaveTextContent("Stamped on all 1 page");
    expect(panel).not.toHaveTextContent(/shrunk/i);
  });

  it("labels the size control as the ceiling it now is", async () => {
    const bytes = await pdfOf([PageSizes.A4]);
    const file = new File([new Uint8Array(bytes)], "doc.pdf", {
      type: "application/pdf",
    });
    render(
      <WatermarkEditor
        pdf={{
          file,
          bytes,
          pageCount: 1,
          rotations: [0],
          digitalSignatures: countDigitalSignatures(bytes),
        }}
        onReset={() => {}}
      />,
    );
    expect(screen.getByLabelText(/^max font size$/i)).toBeInTheDocument();
  });
});

describe("Add Watermark runner — the placement and page options reach the engine", () => {
  function mount(bytes: Uint8Array, pageCount: number) {
    const file = new File([new Uint8Array(bytes)], "doc.pdf", {
      type: "application/pdf",
    });
    render(
      <WatermarkEditor
        pdf={{
          file,
          bytes,
          pageCount,
          rotations: Array.from({ length: pageCount }, () => 0 as const),
          digitalSignatures: countDigitalSignatures(bytes),
        }}
        onReset={() => {}}
      />,
    );
  }

  it("Selected pages: the summary counts the pages the list picked", async () => {
    mount(await pdfOf([PageSizes.A4, PageSizes.A4, PageSizes.A4]), 3);
    fireEvent.click(screen.getByRole("button", { name: /pages and layer/i }));
    fireEvent.click(screen.getByRole("radio", { name: /selected pages/i }));
    const run = screen.getByRole("button", { name: /add watermark/i });
    // An empty list is not "every page": the run waits for one.
    expect(run).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByLabelText(/^pages \(1–3\)/i), {
      target: { value: "2-3" },
    });
    fireEvent.click(run);
    const panel = await screen.findByRole("group", {
      name: /watermark added/i,
    });
    expect(panel).toHaveTextContent("Stamped on 2 of 3 pages");
  });

  it("Tile: the summary counts every mark drawn", async () => {
    mount(await pdfOf([PageSizes.A4]), 1);
    fireEvent.click(screen.getByRole("checkbox", { name: /tile across/i }));
    // The grid is greyed out, not removed from the focus order.
    expect(
      screen.getByRole("radiogroup", { name: /watermark position/i }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: /add watermark/i }));
    const panel = await screen.findByRole("group", {
      name: /watermark added/i,
    });
    expect(panel).toHaveTextContent(/Stamped on all 1 page · \d+ marks in all/);
    // Positive control: without Tile there is no marks count.
    cleanup();
    mount(await pdfOf([PageSizes.A4]), 1);
    fireEvent.click(screen.getByRole("button", { name: /add watermark/i }));
    const plain = await screen.findByRole("group", {
      name: /watermark added/i,
    });
    expect(plain).not.toHaveTextContent(/marks in all/);
  });
});
