// STAMP-01 verify: a header-only "PDF" (the 9 bytes "%PDF-1.7" + LF, no
// catalog) through the
// stamping engines and the upload intake. PINS THE DEFECT as observed on
// 8201b17a: invert these expectations when loadPdf types a catalog-less doc.
import { describe, expect, it } from "vitest";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import { watermarkPdf } from "@/lib/pdf/watermark";
import { addHeaderFooter } from "@/lib/pdf/header-footer";
import { overlayPdf } from "@/lib/pdf/overlay";
import { signPdf } from "@/lib/pdf/signature";
import { PdfEngineError } from "@/lib/pdf/engine";
import { errorMessage } from "@/components/tools/runner/runner-kit";
import { PDFDocument, StandardFonts } from "pdf-lib";

const HEADER_ONLY = () => new TextEncoder().encode("%PDF-1.7\n");

async function good(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawText("x", { font: await d.embedFont(StandardFonts.Helvetica) });
  return d.save();
}

async function outcome(run: () => Promise<unknown>) {
  try {
    await run();
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      name: (err as Error)?.constructor?.name,
      typed: err instanceof PdfEngineError,
      shown: errorMessage(err),
    };
  }
}

describe("STAMP-01 header-only PDF through stamping engines", () => {
  const cells: Array<[string, () => Promise<unknown>]> = [
    ["page-numbers", () => addPageNumbers(HEADER_ONLY())],
    [
      "bates",
      () => addPageNumbers(HEADER_ONLY(), { format: "ABC{n}" } as never),
    ],
    ["watermark", () => watermarkPdf(HEADER_ONLY(), "DRAFT")],
    [
      "header-footer",
      () =>
        addHeaderFooter(HEADER_ONLY(), { header: { center: "Hi" } } as never),
    ],
    ["overlay base", async () => overlayPdf(HEADER_ONLY(), await good())],
    ["overlay overlay", async () => overlayPdf(await good(), HEADER_ONLY())],
    [
      "sign typed",
      () =>
        signPdf(
          HEADER_ONLY(),
          { kind: "typed", text: "Jane" } as never,
          {
            pageIndex: 0,
            x: 10,
            y: 10,
            width: 80,
          } as never,
        ),
    ],
  ];
  for (const [name, run] of cells) {
    it(name, { timeout: 15_000 }, async () => {
      const o = await outcome(run);
      console.log("STAMP-01", name, JSON.stringify(o));
      expect(o.ok).toBe(false);
    });
  }

  it(
    "point of consumption: upload intake shows the same raw TypeError",
    { timeout: 15_000 },
    async () => {
      const { validatePdfFile } = await import("@/lib/pdf/files");
      const { readPageBoard } =
        await import("@/components/tools/runner/use-single-pdf");
      const file = new File([HEADER_ONLY()], "scan.pdf", {
        type: "application/pdf",
      });
      expect(validatePdfFile(file).ok).toBe(true);
      const o = await outcome(() => readPageBoard(HEADER_ONLY(), "pdf-lib"));
      console.log("STAMP-01 intake", JSON.stringify(o));
      expect(o.ok).toBe(false);
      if (!o.ok) expect(o.shown).toMatch(/reading 'Pages'/);
    },
  );

  it(
    "positive control: a good PDF numbers fine",
    { timeout: 15_000 },
    async () => {
      const out = await addPageNumbers(await good());
      expect(out.byteLength).toBeGreaterThan(100);
    },
  );
});
