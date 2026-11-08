"use client";

import { useCallback, useState } from "react";
import { batchMaxFilesFor, IMAGE_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  DEFAULT_JPEG_QUALITY_ID,
  DEFAULT_RASTER_BACKGROUND,
  DEFAULT_RASTER_COLOR,
  DEFAULT_RESOLUTION_ID,
  JPEG_QUALITY_LABEL,
  RASTER_BACKGROUND_LABEL,
  RASTER_BACKGROUNDS,
  RASTER_COLORS,
  RASTER_JPEG_QUALITIES,
  RASTER_MIME,
  RASTER_RESOLUTIONS,
  jpegQualityById,
  lowerResolutionThan,
  pageImageName,
  rasterCapNote,
  resolutionById,
  skippedPagesNote,
  zipOutputName,
  type RasterBackgroundId,
  type RasterColorId,
  type RasterFormat,
  type RasterJpegQualityId,
} from "@/lib/pdf/pdf-to-image";
import { RASTER_MAX_DEVICE_PX } from "@/lib/pdf/render-utils";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { BatchChoice } from "./batch-choice";
import {
  ImagesBatchRunner,
  type ImagesFileOutput,
} from "./images-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/**
 * The choices every file is drawn with: the single-file editor's own
 * controls and starting values (`RASTER_RESOLUTIONS`, `RASTER_COLORS`, the
 * JPEG quality presets, the PNG background), every page of each file.
 */
export interface PdfToImageBatchOptions {
  format: RasterFormat;
  resolutionId: string;
  color: RasterColorId;
  qualityId: RasterJpegQualityId;
  background: RasterBackgroundId;
}

export const PDF_TO_IMAGE_BATCH_DEFAULTS = {
  resolutionId: DEFAULT_RESOLUTION_ID,
  color: DEFAULT_RASTER_COLOR,
  qualityId: DEFAULT_JPEG_QUALITY_ID,
  background: DEFAULT_RASTER_BACKGROUND,
} as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Draw every page of one file as an image, as the single-file editor does
 * (`rasterizePdf`, the same options, the same per-page pixel ceiling and
 * the same file names). A page that fails is left out and named on the
 * row; a file none of whose pages could be drawn fails its row.
 */
export async function renderOneFile(
  { file, bytes }: OpenedPdf,
  options: PdfToImageBatchOptions,
  signal: AbortSignal,
): Promise<ImagesFileOutput> {
  const { format } = options;
  const resolution = resolutionById(options.resolutionId);
  const grayscale = options.color === "gray";
  const { rasterizePdf } = await import("@/lib/pdf/render");
  const failed: number[] = [];
  let firstFailure = "";
  let total = 0;
  const pages = await rasterizePdf(bytes, {
    format,
    dpi: resolution.dpi,
    ...(format === "jpg"
      ? { quality: jpegQualityById(options.qualityId).quality }
      : {}),
    ...(format === "png" && options.background === "transparent"
      ? { transparent: true }
      : {}),
    grayscale,
    signal,
    onProgress: (_done, all) => {
      total = all;
    },
    onPageFailed: ({ index, message }) => {
      failed.push(index);
      firstFailure ||= message;
    },
  });
  if (pages.length === 0 && !signal.aborted)
    throw new Error(
      `No pages could be rendered from this PDF.${firstFailure ? ` ${firstFailure}` : ""}`,
    );
  const docPages = Math.max(total, pages.length + failed.length);
  const lower = lowerResolutionThan(resolution.id)?.label;
  const undecoded = pages.reduce((sum, p) => sum + p.undecodedImages, 0);
  const notes = [
    skippedPagesNote(failed, lower),
    rasterCapNote(pages, resolution.dpi, RASTER_MAX_DEVICE_PX),
    undecoded > 0
      ? `${plural(undecoded, "image")} could not be decoded and ${undecoded === 1 ? "is" : "are"} missing.`
      : null,
  ].filter((n): n is string => !!n);
  return {
    images: pages.map((page) => ({
      name: pageImageName(file.name, page.index, docPages, format),
      bytes: page.bytes,
      type: RASTER_MIME[format],
    })),
    zipName: zipOutputName(file.name, format),
    detail: `${plural(pages.length, "page")} · ${resolution.label}${grayscale ? " · Grayscale" : ""}`,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/**
 * PDF to JPG's and PDF to PNG's batch (batch plan P2): one resolution and
 * colour (and JPEG quality, or PNG background) for every page of every file,
 * at most `BATCH_LIMITS.rasterMaxFiles` files. Choosing pages stays in the
 * single-file editor, where each page has a tile.
 */
export function PdfToImageBatch({
  format,
  ...props
}: SinglePdfBatch & { format: RasterFormat }) {
  const slug = format === "png" ? "pdf-to-png" : "pdf-to-jpg";
  const label = format.toUpperCase();
  const [resolutionId, setResolutionId] = useState<string>(
    PDF_TO_IMAGE_BATCH_DEFAULTS.resolutionId,
  );
  const [color, setColor] = useState<RasterColorId>(
    PDF_TO_IMAGE_BATCH_DEFAULTS.color,
  );
  const [qualityId, setQualityId] = useState<RasterJpegQualityId>(
    PDF_TO_IMAGE_BATCH_DEFAULTS.qualityId,
  );
  const [background, setBackground] = useState<RasterBackgroundId>(
    PDF_TO_IMAGE_BATCH_DEFAULTS.background,
  );
  const process = useCallback(
    (opened: OpenedPdf, signal: AbortSignal) =>
      renderOneFile(
        opened,
        { format, resolutionId, color, qualityId, background },
        signal,
      ),
    [format, resolutionId, color, qualityId, background],
  );
  return (
    <ImagesBatchRunner
      {...props}
      toolName={`PDF to ${label}`}
      verb="Convert"
      runningLabel={`Rendering ${label}…`}
      zipName={
        format === "png"
          ? IMAGE_BATCH_TOOLS["pdf-to-png"].zipName
          : IMAGE_BATCH_TOOLS["pdf-to-jpg"].zipName
      }
      maxFiles={batchMaxFilesFor(slug)}
      appliesNote={`Every page of each file becomes a ${label} image; to choose pages, open one file on its own.`}
      restrictedRefusal={`This PDF has permission restrictions, and a batch leaves a restricted file alone. Open it on its own: PDF to ${label} converts a PDF that opens without a password.`}
      process={process}
      settings={
        <>
          <BatchChoice
            label="Resolution"
            value={resolutionId}
            onChange={setResolutionId}
            options={RASTER_RESOLUTIONS.map((r) => ({
              value: r.id,
              label: `${r.label} (${r.dpi} DPI)`,
            }))}
          />
          <BatchChoice
            label="Colour"
            value={color}
            onChange={setColor}
            options={RASTER_COLORS.map((c) => ({
              value: c.id,
              label: c.label,
            }))}
          />
          {format === "jpg" ? (
            <BatchChoice
              label={JPEG_QUALITY_LABEL}
              value={qualityId}
              onChange={setQualityId}
              options={RASTER_JPEG_QUALITIES.map((q) => ({
                value: q.id,
                label: `${q.label} (${Math.round(q.quality * 100)})`,
              }))}
            />
          ) : (
            <BatchChoice
              label={RASTER_BACKGROUND_LABEL}
              value={background}
              onChange={setBackground}
              options={RASTER_BACKGROUNDS.map((b) => ({
                value: b.id,
                label: b.label,
              }))}
            />
          )}
        </>
      }
    />
  );
}
