import { encodeGrayJpeg } from "./gray-jpeg";
import {
  IMAGE_PAGE_SIZES,
  imagePageLayout,
  type ImagePageLayout,
  type ImagePageSizeId,
} from "./image-page-layout";
import { PdfEngineError } from "./engine-errors";
import { drawRasterImage, embedRasterImage, loadPdfLib } from "./pdf-lib";
import { packBits, type ScanEnhancement } from "./scan-enhance";
import {
  estimateFlateBytes,
  flateCannotWin,
  flateProbe,
} from "./scan-gray-choice";

/**
 * Scan to PDF's writer — DOM-free, so the Node tests drive the same code the
 * browser runner does. The runner turns each photo upright (the browser
 * applies its EXIF orientation as it decodes), scales it to at most
 * {@link MAX_SCAN_SIDE_PX} on its long side, applies the chosen clean-up
 * (`./scan-enhance`) and hands the pixels here:
 *
 *  - "original": a colour JPEG (the canvas encoder's), embedded as-is.
 *  - "document": a ONE-channel plane, stored as a DeviceGray image — a
 *    one-component JPEG (`./gray-jpeg`) or the lossless plane under Flate,
 *    whichever is smaller, exactly as Grayscale PDF stores its pages — except
 *    that the Flate is not made when a sample of the page shows it cannot
 *    win (`./scan-gray-choice`: measured, with its tolerance tested).
 *  - "bw": a 0/255 plane, stored as a 1-bit DeviceGray image under Flate.
 *
 * Page sizes are Image to PDF's table (`./image-page-layout`), cut to the three
 * a scan needs. The photo FILLS the page (scaled up or down, proportions kept,
 * centred, no margin): unlike Image to PDF, a scan is a page, not a picture on
 * one. "Fit to photo" gives each page the photo's shape at A4's long side.
 */

/** The long side, in pixels, each photo is scaled to (at most) before saving. */
export const MAX_SCAN_SIDE_PX = 2400;

/** JPEG quality for colour and grayscale pages. */
export const SCAN_JPEG_QUALITY = 0.85;

export type ScanPageSizeId = Extract<ImagePageSizeId, "fit" | "a4" | "letter">;

export const SCAN_PAGE_SIZES: readonly {
  id: ScanPageSizeId;
  label: string;
  size?: { width: number; height: number };
}[] = (["a4", "letter", "fit"] as const).map((id) => {
  const found = IMAGE_PAGE_SIZES.find((s) => s.id === id)!;
  return {
    id,
    label: id === "fit" ? "Fit to photo" : found.label,
    ...(found.size ? { size: found.size } : {}),
  };
});

const A4 = IMAGE_PAGE_SIZES.find((s) => s.id === "a4")!.size!;

/**
 * Where a `width` × `height` photo goes on its page. Built on
 * `imagePageLayout`, which only ever scales DOWN: the photo is first sized so
 * it is at least as large as the page, then that function fits it exactly.
 */
export function scanPageLayout(
  width: number,
  height: number,
  pageSize: ScanPageSizeId,
): ImagePageLayout {
  if (pageSize === "fit") {
    const k = A4.height / Math.max(width, height);
    return imagePageLayout(width * k, height * k, {
      pageSize: "fit",
      orientation: "auto",
      margin: "none",
    });
  }
  const size = SCAN_PAGE_SIZES.find((s) => s.id === pageSize)!.size!;
  const k = (Math.max(size.width, size.height) / Math.min(width, height)) * 2;
  return imagePageLayout(width * k, height * k, {
    pageSize,
    orientation: "auto",
    margin: "none",
  });
}

export type ScanPageInput =
  | { enhancement: "original"; jpeg: Uint8Array; width: number; height: number }
  | {
      enhancement: Exclude<ScanEnhancement, "original">;
      plane: Uint8Array;
      width: number;
      height: number;
    };

export interface ScanPageRecord {
  enhancement: ScanEnhancement;
  /** How the image is stored in the PDF. */
  encoding: "rgb-jpeg" | "gray-jpeg" | "gray-flate" | "1-bit-flate";
  imageBytes: number;
  /** Set when a sample showed Flate could not win, so it was not made. */
  flateSkipped?: true;
}

export interface ScanResult {
  bytes: Uint8Array;
  pages: ScanPageRecord[];
}

export const SCAN_TITLE = "Scanned document";

/**
 * A PDF built one page at a time: each page's photo is encoded the moment it
 * is added, so the caller can let go of its pixels before decoding the next
 * photo (a 60-photo scan held all 60 planes, ~260 MB, until the end — perf
 * sweep 2026-11-18). Nothing here yields; a caller that adds many pages
 * yields between them ({@link scansToPdf} does).
 */
export interface ScanWriter {
  addPage(input: ScanPageInput): Promise<void>;
  save(): Promise<ScanResult>;
}

export async function createScanWriter(
  pageSize: ScanPageSizeId,
): Promise<ScanWriter> {
  const lib = await loadPdfLib();
  const doc = await lib.PDFDocument.create();
  const records: ScanPageRecord[] = [];

  const addPage = async (input: ScanPageInput): Promise<void> => {
    const { width, height } = input;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      throw new PdfEngineError("A photo could not be read.");
    }
    const layout = scanPageLayout(width, height, pageSize);
    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    const box = {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    };

    if (input.enhancement === "original") {
      // The browser's JPEG encoder made these bytes; if anything else
      // arrives, pdf-lib's own "SOI not found" must not reach the user
      // (hostile matrix CI-12).
      let image;
      try {
        image = await embedRasterImage(doc, input.jpeg, "jpg");
      } catch {
        throw new PdfEngineError("A photo could not be read.");
      }
      await drawRasterImage(page, image, box);
      records.push({
        enhancement: "original",
        encoding: "rgb-jpeg",
        imageBytes: input.jpeg.length,
      });
      return;
    }

    if (input.plane.length !== width * height) {
      throw new PdfEngineError("A photo could not be read.");
    }
    const imageDict = {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      ColorSpace: "DeviceGray",
    };
    let stream;
    let encoding: ScanPageRecord["encoding"];
    if (input.enhancement === "bw") {
      stream = doc.context.flateStream(packBits(input.plane, width, height), {
        ...imageDict,
        BitsPerComponent: 1,
      });
      encoding = "1-bit-flate";
    } else {
      const jpeg = encodeGrayJpeg(
        input.plane,
        width,
        height,
        SCAN_JPEG_QUALITY,
      );
      // The full Flate is skipped when a sample shows it cannot win
      // (`./scan-gray-choice` has the measurement and the tolerance).
      const probe = flateProbe(input.plane, width, height);
      const flateSkipped =
        probe !== null &&
        flateCannotWin(
          estimateFlateBytes(
            doc.context.flateStream(probe, {}).contents.length,
            probe.length,
            input.plane.length,
          ),
          jpeg.length,
        );
      const flate = flateSkipped
        ? null
        : doc.context.flateStream(input.plane, {
            ...imageDict,
            BitsPerComponent: 8,
          });
      if (flate && flate.contents.length <= jpeg.length) {
        stream = flate;
        encoding = "gray-flate";
      } else {
        // pdf-lib maps a one-component JPEG to DeviceGray.
        const image = await embedRasterImage(doc, jpeg, "jpg");
        await drawRasterImage(page, image, box);
        records.push({
          enhancement: "document",
          encoding: "gray-jpeg",
          imageBytes: jpeg.length,
          ...(flateSkipped ? { flateSkipped: true as const } : {}),
        });
        return;
      }
    }
    const name = page.node.newXObject("Im", doc.context.register(stream));
    page.pushOperators(
      lib.pushGraphicsState(),
      lib.concatTransformationMatrix(box.width, 0, 0, box.height, box.x, box.y),
      lib.drawObject(name),
      lib.popGraphicsState(),
    );
    records.push({
      enhancement: input.enhancement,
      encoding,
      imageBytes: stream.contents.length,
    });
  };

  const save = async (): Promise<ScanResult> => {
    if (records.length === 0) {
      throw new PdfEngineError("Add at least one photo first.");
    }
    doc.setTitle(SCAN_TITLE);
    doc.setProducer("pdf.xyz");
    doc.setCreator("pdf.xyz");
    return { bytes: await doc.save(), pages: records };
  };

  return { addPage, save };
}

/**
 * Hand the event loop a turn: a TASK, not a microtask, so input, paint and a
 * Cancel press get in between pages. A zero-delay timer, not
 * `scheduler.yield`: in Chromium 149 the work that resumes after
 * `scheduler.yield()` is never reported as a long task (measured 2026-11-18:
 * six 200 ms loops, the three after `scheduler.yield` missing from the
 * PerformanceObserver), so a page built on it would hide its own blocking
 * from every long-task instrument, ours and a visitor's browser's alike.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface ScanBuildOptions {
  /** Checked between pages; an aborted run rejects with an AbortError. */
  signal?: AbortSignal;
  /** Called after each page is made, with how many are done so far. */
  onPage?: (done: number, total: number) => void;
}

/**
 * Build one PDF, one page per photo, in the order given — one page per task:
 * the event loop gets a turn after every page (perf sweep 2026-11-18, P1: the
 * 60-page loop was ONE task of ~20 s).
 */
export async function scansToPdf(
  inputs: readonly ScanPageInput[],
  pageSize: ScanPageSizeId,
  { signal, onPage }: ScanBuildOptions = {},
): Promise<ScanResult> {
  if (inputs.length === 0) {
    throw new PdfEngineError("Add at least one photo first.");
  }
  const writer = await createScanWriter(pageSize);
  for (const [index, input] of inputs.entries()) {
    signal?.throwIfAborted();
    await writer.addPage(input);
    onPage?.(index + 1, inputs.length);
    await yieldToEventLoop();
  }
  signal?.throwIfAborted();
  return writer.save();
}

/** "scan-2026-10-30.pdf", from the day the scan was made. */
export function scanOutputName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `scan-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}

/** The size a photo is scaled to so its long side is at most the cap. */
export function scanTargetSize(
  width: number,
  height: number,
  maxSide = MAX_SCAN_SIDE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
