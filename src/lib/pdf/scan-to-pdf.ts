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
 *    whichever is smaller, exactly as Grayscale PDF stores its pages.
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
}

export interface ScanResult {
  bytes: Uint8Array;
  pages: ScanPageRecord[];
}

export const SCAN_TITLE = "Scanned document";

/** Build one PDF, one page per photo, in the order given. */
export async function scansToPdf(
  inputs: readonly ScanPageInput[],
  pageSize: ScanPageSizeId,
): Promise<ScanResult> {
  if (inputs.length === 0) {
    throw new PdfEngineError("Add at least one photo first.");
  }
  const lib = await loadPdfLib();
  const doc = await lib.PDFDocument.create();
  const records: ScanPageRecord[] = [];

  for (const input of inputs) {
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
      const image = await embedRasterImage(doc, input.jpeg, "jpg");
      await drawRasterImage(page, image, box);
      records.push({
        enhancement: "original",
        encoding: "rgb-jpeg",
        imageBytes: input.jpeg.length,
      });
      continue;
    }

    if (input.plane.length !== width * height) {
      throw new PdfEngineError("A photo could not be read.");
    }
    let stream;
    let encoding: ScanPageRecord["encoding"];
    if (input.enhancement === "bw") {
      stream = doc.context.flateStream(packBits(input.plane, width, height), {
        Type: "XObject",
        Subtype: "Image",
        Width: width,
        Height: height,
        ColorSpace: "DeviceGray",
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
      const flate = doc.context.flateStream(input.plane, {
        Type: "XObject",
        Subtype: "Image",
        Width: width,
        Height: height,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
      });
      if (flate.contents.length <= jpeg.length) {
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
        });
        continue;
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
  }

  doc.setTitle(SCAN_TITLE);
  doc.setProducer("pdf.xyz");
  doc.setCreator("pdf.xyz");
  return { bytes: await doc.save(), pages: records };
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
