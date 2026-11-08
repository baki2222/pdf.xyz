// @native-canvas
/**
 * PS-13 verify (2026-11-08): pdf.js's open failure for an unknown security
 * handler / unknown encryption method is `UnknownErrorException`, which
 * `pdfjsLoadError` (src/lib/pdf/engine-errors.ts) does not translate, so
 * `countPagesWithPdfjs` (Compare PDF's card count) rethrows it raw and the
 * runner shows "unknown encryption method" as the file's rejection reason.
 *
 * This PINS THE DEFECT. When the translation lands, INVERT these assertions
 * (expect PdfEncryptedError or PdfEngineError kind "unreadable"), do not
 * delete them.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { errorMessage } from "@/components/tools/runner/runner-kit";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { countPagesWithPdfjs } from "@/lib/pdf/pdfjs-page-count";
import { unknownHandlerObjectStreamPdf } from "@/tests/encrypted-pdf-fixture";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";

async function caught(bytes: Uint8Array): Promise<unknown> {
  try {
    await countPagesWithPdfjs(bytes);
  } catch (err) {
    return err;
  }
  return undefined;
}

const cases: [string, () => Promise<Uint8Array> | Uint8Array][] = [
  ["unsupportedEncryptionPdf", unsupportedEncryptionPdf],
  ["unknownHandlerObjectStreamPdf", unknownHandlerObjectStreamPdf],
];

describe("PS-13 verify: countPagesWithPdfjs on unknown encryption", () => {
  it("positive control: a plain PDF counts", { timeout: 20_000 }, async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    expect(await countPagesWithPdfjs(await doc.save())).toBe(2);
  });

  for (const [label, build] of cases) {
    it(
      `${label}: raw UnknownErrorException reaches the caller`,
      {
        timeout: 20_000,
      },
      async () => {
        const err = await caught(await build());
        expect(err).toBeDefined();
        expect(err).not.toBeInstanceOf(PdfEngineError);
        expect((err as Error).name).toBe("UnknownErrorException");
        // What Compare PDF's rejection row prints for this file.
        expect(errorMessage(err)).toBe("unknown encryption method");
      },
    );
  }
});
