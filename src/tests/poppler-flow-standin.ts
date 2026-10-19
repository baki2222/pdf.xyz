/**
 * What poppler's `pdftotext -bbox-layout` would hand PDF to Word, for runs
 * where poppler is not installed: CI's unit job, and the Windows host this
 * repository is developed on (its `pdftotext` is Xpdf 4.00, which has no
 * `-bbox-layout`). The worker image has the real one, and
 * `pnpm worker:docx-pictures-proof` runs the real one there.
 *
 * ── WHAT IT IMITATES, AND WHERE IT IS SIMPLER ───────────────────────────────
 *
 * The FRAME is poppler's, not pdf.js's: points from the top left of the MEDIA
 * box with the page's /Rotate applied. That is what `printDocBBox` in
 * poppler's `pdftotext.cc` asks for (`displayPage(…, useMediaBox = true …)`),
 * read from its source, not measured here; pdf.js's frame is the crop box.
 * The two differ only on a page whose crop box is not its media box, and the
 * engine maps one into the other (`../lib/workers/pdf-office-export/docx-layout.ts`).
 * Positions come from pdf.js's text content (user space) through that frame,
 * so a cropped fixture reads here as it would from poppler.
 *
 * The GROUPING is simpler than poppler's: a text item joins the line before
 * it when it shares its baseline and follows it; a line joins the block
 * above it when it is the same size, starts at the same left edge, and sits
 * within a line's gap of it. One flow per page. That is enough for the
 * picture-order tests it serves, which ask where a picture lands among
 * paragraphs, not how poppler cuts a hard page into blocks — `flow.test.ts`
 * holds the paragraph rules to poppler's REAL output (`poppler-samples.ts`).
 *
 * It refuses as the runner does: a PDF pdf.js cannot open for want of a
 * password throws `PdfTextOpenError("needs-password")`, any other refusal
 * `PdfTextOpenError("unreadable")`.
 */
import { PDFDocument } from "pdf-lib";
import { PdfEncryptedError } from "@/lib/pdf/engine";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { flowText, type PdfFlowText } from "@/lib/workers/pdf-text/flow";
import type {
  FlowBlock,
  FlowLine,
  FlowPage,
  PdfFlowLayout,
} from "@/lib/workers/pdf-text/parse";
import { PdfTextOpenError } from "@/lib/workers/pdf-text/errors";
import {
  displayTransform,
  unlockObjectStreams,
} from "@/lib/workers/pdf-office-export/page-inventory";
import {
  loadNodePdfjs,
  nodePdfjsAssetDirs,
} from "@/lib/workers/pdf-office-export/pdfjs-node";

type Matrix = number[];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0]! * x + m[2]! * y + m[4]!,
  m[1]! * x + m[3]! * y + m[5]!,
];

/** Each page's media box and /Rotate, read by pdf-lib (null when it cannot). */
async function mediaFrames(
  pdf: Uint8Array,
): Promise<{ transform: Matrix }[] | null> {
  try {
    const doc = await PDFDocument.load(pdf, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    await unlockObjectStreams(doc);
    return doc.getPages().map((page) => {
      const m = page.getMediaBox();
      return displayTransform(
        [m.x, m.y, m.x + m.width, m.y + m.height],
        page.getRotation().angle,
      );
    });
  } catch {
    return null;
  }
}

/** poppler's `-bbox-layout` hierarchy for `pdf`, imitated (see above). */
export async function popplerFlowStandIn(
  pdf: Uint8Array,
): Promise<PdfFlowLayout> {
  const pdfjs = await loadNodePdfjs();
  const task = pdfjs.getDocument({
    data: pdf.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...nodePdfjsAssetDirs(),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    enableXfa: false,
    maxImageSize: 1,
  });
  let doc: Awaited<(typeof task)["promise"]>;
  try {
    doc = await awaitPdfjsDocument(task);
  } catch (error) {
    await task.destroy().catch(() => {});
    throw new PdfTextOpenError(
      error instanceof PdfEncryptedError ? "needs-password" : "unreadable",
    );
  }
  try {
    const frames = await mediaFrames(pdf);
    const pages: FlowPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const frame =
        frames?.[n - 1]?.transform ??
        Array.from(page.getViewport({ scale: 1 }).transform);
      const content = await page.getTextContent();
      const lines: (FlowLine & { size: number; baseline: number })[] = [];
      for (const item of content.items as {
        str?: string;
        transform?: number[];
        width?: number;
      }[]) {
        const str = item.str ?? "";
        if (!str.trim() || !item.transform) continue;
        const t = item.transform;
        const size = Math.hypot(t[2]!, t[3]!) || 1;
        const [x, baseline] = apply(frame, t[4]!, t[5]!);
        const charWidth = (item.width ?? 0) / Math.max(1, str.length);
        const prev = lines[lines.length - 1];
        const line =
          prev &&
          Math.abs(prev.baseline - baseline) < 0.3 * size &&
          x >= prev.xMax - 1 &&
          x - prev.xMax < 2 * size
            ? prev
            : (() => {
                const fresh = {
                  words: [],
                  xMin: Infinity,
                  yMin: baseline - 0.8 * size,
                  xMax: -Infinity,
                  yMax: baseline + 0.2 * size,
                  size,
                  baseline,
                };
                lines.push(fresh);
                return fresh;
              })();
        let at = 0;
        for (const word of str.split(/(\s+)/)) {
          const x0 = x + at * charWidth;
          at += word.length;
          if (!word.trim()) continue;
          const x1 = x0 + word.length * charWidth;
          line.words.push({
            text: word,
            xMin: x0,
            yMin: line.yMin,
            xMax: x1,
            yMax: line.yMax,
          });
          line.xMin = Math.min(line.xMin, x0);
          line.xMax = Math.max(line.xMax, x1);
        }
      }
      const blocks: FlowBlock[] = [];
      let last: (typeof lines)[number] | null = null;
      for (const line of [...lines]
        .filter((l) => l.words.length)
        .sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)) {
        const height = line.yMax - line.yMin;
        const joins =
          last !== null &&
          Math.abs(last.size - line.size) < 0.5 &&
          Math.abs(last.xMin - line.xMin) < 2 * line.size &&
          line.yMin - last.yMax >= -0.5 * height &&
          line.yMin - last.yMax < 0.8 * height;
        if (joins) blocks[blocks.length - 1]!.lines.push(line);
        else blocks.push({ flow: 0, lines: [line] });
        last = line;
      }
      pages.push({ pageNumber: n, blocks });
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await task.destroy().catch(() => {});
  }
}

/** A PDF to Word flow extractor over {@link popplerFlowStandIn}. */
export async function flowStandIn(pdf: Uint8Array): Promise<PdfFlowText> {
  return flowText(await popplerFlowStandIn(pdf));
}
