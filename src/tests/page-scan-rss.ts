/**
 * Run the PowerPoint page reader over one PDF in a FRESH process and report
 * its peak memory: `tsx src/tests/page-scan-rss.ts <file.pdf> [mode]`.
 *
 * A process's peak resident set (`resourceUsage().maxRSS`) only rises, so it
 * cannot be read inside a test runner that has already decoded other
 * fixtures. This script warms pdf.js up on a one-page PDF first (loading the
 * library and its fonts is not the page's cost), reads the peak, runs the
 * mode, and reads it again. Prints one line of JSON: numbers and an outcome.
 *
 * Modes:
 *  - `scan` (the default): `scanPdfPages` alone;
 *  - `engine`: the whole PDF to PowerPoint run (`runPdfOfficeExport`) with
 *    no repair seam — what a worker without qpdf does;
 *  - `engine-repair`: the same with a stand-in for qpdf's rewrite
 *    (`repairStandIn`) — what a worker with qpdf does, for the damage the
 *    junk-after-%%EOF fixture carries;
 *  - `floor-decode`: the CONTROL — what the scan did until 2026-10-11 with a
 *    file pdf-lib could not load: pdf.js opened at the floor ceiling and
 *    every page's images resolved by a render that paints nothing, as the
 *    scan does — which decodes each image under it. (Building the operator
 *    list alone does not: the first draft of this control measured nothing.)
 */
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { runPdfOfficeExport } from "@/lib/workers/pdf-office-export/engine";
import { scanPdfPages } from "@/lib/workers/pdf-office-export/page-scan";
import {
  canvasFactoryOf,
  MAX_DECODED_IMAGE_PIXELS,
  openNodePdf,
} from "@/lib/workers/pdf-office-export/pdfjs-node";
import { repairStandIn } from "@/tests/pptx-fidelity-fixtures";

type Mode = "scan" | "engine" | "engine-repair" | "floor-decode";

/** pdftotext's part, which the engine only asks to open the file. */
const extractStandIn = async () => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: "x", characterCount: 1 }],
  text: "x",
  characterCount: 1,
  hasText: true,
});

async function run(
  mode: Mode,
  bytes: Uint8Array,
): Promise<{ outcome: string; tooLarge?: number; pictures: number }> {
  if (mode === "floor-decode") {
    const { pdfjs, doc, close } = await openNodePdf(bytes, {
      maxImageSize: MAX_DECODED_IMAGE_PIXELS,
    });
    try {
      const factory = canvasFactoryOf(doc);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const cc = factory.create(1, 1);
        // As the scan resolves a page before it draws a layer: a render that
        // runs only the dependency loads, so every image is decoded and
        // nothing is painted (painting an 8000² image took 97 s).
        const holder: { fnArray?: number[] } = {};
        const task = page.render({
          canvas: cc.canvas as unknown as HTMLCanvasElement,
          canvasContext: cc.context as unknown as CanvasRenderingContext2D,
          viewport: page.getViewport({ scale: 1 }),
          operationsFilter: (i: number) =>
            holder.fnArray?.[i] === pdfjs.OPS.dependency,
        });
        holder.fnArray = (
          task as unknown as {
            _internalRenderTask: { operatorList: { fnArray: number[] } };
          }
        )._internalRenderTask.operatorList.fnArray;
        await task.promise;
        factory.destroy(cc);
      }
    } finally {
      await close();
    }
    return { outcome: "decoded", pictures: 0 };
  }
  if (mode === "scan") {
    const scan = await scanPdfPages(bytes);
    return {
      outcome: "scanned",
      tooLarge: scan.tooLargeImages,
      pictures: scan.pages.reduce(
        (n, p) =>
          n +
          p.items.filter((i) => i.kind === "picture" && i.role === "image")
            .length,
        0,
      ),
    };
  }
  const result = await runPdfOfficeExport("pdf-to-powerpoint", bytes, {
    extract: extractStandIn,
    scanPages: scanPdfPages,
    ...(mode === "engine-repair" ? { repairPdf: repairStandIn } : {}),
  });
  if (!result.ok) return { outcome: result.kind, pictures: 0 };
  return {
    outcome: result.coverage.repairedBeforeConversion ? "repaired" : "ok",
    tooLarge: result.coverage.picturesTooLarge ?? 0,
    pictures: 0,
  };
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const mode = (process.argv[3] ?? "scan") as Mode;
  if (!file) throw new Error("usage: page-scan-rss.ts <file.pdf> [mode]");
  const warm = await PDFDocument.create();
  const font = await embedDrawingFont(warm, ["warm"]);
  warm.addPage([200, 200]).drawText("warm", { x: 20, y: 100, size: 12, font });
  await scanPdfPages(await warm.save());
  const bytes = new Uint8Array(readFileSync(file));
  const before = process.resourceUsage().maxRSS;
  const t0 = Date.now();
  const result = await run(mode, bytes);
  const ms = Date.now() - t0;
  const after = process.resourceUsage().maxRSS;
  console.log(
    JSON.stringify({
      mode,
      warmMb: Math.round(before / 1024),
      peakMb: Math.round(after / 1024),
      ms,
      ...result,
    }),
  );
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
