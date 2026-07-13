import { PDFDocument, rgb } from "pdf-lib";
import { outputName } from "./files";
import { rasterizePdf, type RasterPage } from "./render";

const PRODUCER = "pdf.xyz";

export const GRAYSCALE_DPI_PRESETS = [
  { id: "screen", label: "Screen", dpi: 96 },
  { id: "print", label: "Print", dpi: 150 },
] as const;

export type GrayscaleDpiPreset = (typeof GRAYSCALE_DPI_PRESETS)[number]["id"];

export interface GrayscaleOptions {
  dpi?: number;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface GrayscaleResult {
  bytes: Uint8Array;
  pageCount: number;
  totalImageBytes: number;
}

export function grayscaleOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "grayscale");
}

export function grayscalePresetById(id: string): (typeof GRAYSCALE_DPI_PRESETS)[number] {
  return GRAYSCALE_DPI_PRESETS.find((preset) => preset.id === id) ?? GRAYSCALE_DPI_PRESETS[1]!;
}

export function pageSizeForRaster(page: Pick<RasterPage, "pageWidth" | "pageHeight" | "width" | "height">): [number, number] {
  const width = Number.isFinite(page.pageWidth) && page.pageWidth > 0 ? page.pageWidth : page.width;
  const height = Number.isFinite(page.pageHeight) && page.pageHeight > 0 ? page.pageHeight : page.height;
  return [Math.max(1, width), Math.max(1, height)];
}

/**
 * Convert a PDF to a grayscale PDF by rendering every page locally to grayscale
 * JPEG and rebuilding a PDF with matching page dimensions.
 *
 * Honest scope: this is a print/raster output. It intentionally flattens text,
 * vectors, forms, and annotations into page images; selectable text is not
 * preserved. Use it for print/ink workflows, not archival/editable output.
 */
export async function grayscalePdf(bytes: Uint8Array, options: GrayscaleOptions = {}): Promise<GrayscaleResult> {
  const pages = await rasterizePdf(bytes, {
    format: "jpg",
    dpi: options.dpi ?? 150,
    quality: options.quality ?? 0.88,
    grayscale: true,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  if (pages.length === 0) throw new Error("No pages could be rendered from this PDF.");

  const doc = await PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setTitle("Grayscale PDF");

  for (const page of pages) {
    const [pageWidth, pageHeight] = pageSizeForRaster(page);
    const outPage = doc.addPage([pageWidth, pageHeight]);
    outPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });
    const image = await doc.embedJpg(page.bytes);
    outPage.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }

  return {
    bytes: await doc.save(),
    pageCount: pages.length,
    totalImageBytes: pages.reduce((sum, page) => sum + page.bytes.byteLength, 0),
  };
}
