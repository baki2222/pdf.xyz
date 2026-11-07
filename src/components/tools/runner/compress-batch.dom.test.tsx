// @vitest-environment jsdom
/**
 * The compress batch, rendered: what a row SAYS and what its download SAVES.
 *
 * Audit #20 was fixed in `compressBatchFile`, and `compress-batch.test.ts` proves that
 * function on the real repack. Nothing proved the runner calls it, or that the row
 * reads the way the fix intends: a runner that went back to its own inline repack, or
 * a row that kept "Already lean — no change", passed every test (review of
 * 2026-11-06). So two real files go through the real runner — one the repack would
 * GROW, one it shrinks — and the rows, their download labels and the saved file are
 * read as a person gets them.
 *
 * No module is mocked (`src/tests/mock-isolation.test.ts`); the download is caught
 * at the anchor the browser would click.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CompressBatchRunner } from "./compress-batch";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

/** A minimal hand-written, classic-xref, one-page PDF the repack makes LARGER. */
function compactPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** A PDF with slack the repack removes. */
async function loosePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 20; i += 1) {
    doc.addPage([300, 200]).drawText(`Page ${i + 1}`, { x: 20, y: 100, font });
  }
  return doc.save({ useObjectStreams: false });
}

const pdfFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });

/** Catch what a download would save: the blob and the name it is saved under. */
function catchDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  let pending: Blob | null = null;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      pending = blob;
      return "blob:compress-batch-test";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (pending) saved.push({ name: this.download, blob: pending });
    pending = null;
  });
  return saved;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe(
  "CompressBatchRunner — a row that could not be made smaller",
  { timeout: 30_000 },
  () => {
    it("says so, labels its download 'unchanged', and saves the original under its own name", async () => {
      const compact = compactPdf();
      const loose = await loosePdf();
      render(
        <AppRouterContext.Provider value={router as never}>
          <CompressBatchRunner
            files={[pdfFile(compact, "tiny.pdf"), pdfFile(loose, "loose.pdf")]}
            onReset={() => {}}
          />
        </AppRouterContext.Provider>,
      );
      fireEvent.click(screen.getByRole("button", { name: /compress 2 pdfs/i }));

      const unchanged = await screen.findByRole(
        "button",
        { name: "Download unchanged tiny.pdf" },
        { timeout: 10_000 },
      );
      // POSITIVE CONTROL: the file the repack shrinks reads as compressed.
      const compressed = await screen.findByRole(
        "button",
        { name: "Download compressed loose.pdf" },
        { timeout: 10_000 },
      );
      // Exactly one row says nothing came out smaller: the tiny one.
      expect(
        screen.getAllByText("Nothing came out smaller — your file, unchanged"),
      ).toHaveLength(1);
      expect(screen.queryByText(/already lean/i)).toBeNull();

      const saved = catchDownloads();
      fireEvent.click(unchanged);
      fireEvent.click(compressed);
      await waitFor(() => expect(saved).toHaveLength(2));
      expect(saved[0]!.name).toBe("tiny.pdf");
      const original = new Uint8Array(await saved[0]!.blob.arrayBuffer());
      expect(Buffer.from(original).equals(Buffer.from(compact))).toBe(true);
      // The control's file is smaller than what went in.
      expect(saved[1]!.blob.size).toBeLessThan(loose.byteLength);
    });
  },
);
