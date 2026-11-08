"use client";

import { batchMaxFilesFor, IMAGE_BATCH_TOOLS } from "@/lib/batch/tools";
import { outputName } from "@/lib/pdf/browser";
import type { SinglePdfBatch } from "../single-pdf-runner";
import {
  ImagesBatchRunner,
  type ImagesFileOutput,
} from "./images-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

const MIME = { jpg: "image/jpeg", png: "image/png" } as const;

/** A file with no image the tool can recover: said on its row, not failed. */
export const EXTRACT_BATCH_NONE = "No extractable images found in this PDF";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Pull every image out of one file: the single-file panel's own extractor
 * (loaded when the work starts, as there), its file names and its ZIP name.
 * A file with none is a finished row with a note; images in a format the
 * tool does not recover are counted on the row, never faked.
 */
export async function extractOneFile({
  file,
  bytes,
}: OpenedPdf): Promise<ImagesFileOutput> {
  const { extractPdfImages } = await import("@/lib/pdf/extract-images");
  const { images, skipped } = await extractPdfImages(bytes);
  const altered = images.filter((image) => image.note).length;
  const notes = [
    images.length === 0
      ? skipped.length > 0
        ? `${EXTRACT_BATCH_NONE}: its images are in formats this tool doesn't recover yet`
        : EXTRACT_BATCH_NONE
      : skipped.length > 0
        ? `${plural(skipped.length, "image")} skipped, in formats this tool doesn't recover yet: open it on its own for the list`
        : "",
    altered > 0
      ? `${plural(altered, "image")} could not keep ${altered === 1 ? "its" : "their"} transparency: open it on its own for which`
      : "",
  ].filter(Boolean);
  return {
    images: images.map((image) => ({
      name: image.name,
      bytes: image.bytes,
      type: MIME[image.format],
    })),
    zipName: outputName(file.name, "images", "zip"),
    detail:
      images.length > 0
        ? `${plural(images.length, "image")} · original resolution`
        : "No images",
    ...(notes.length > 0 ? { note: notes.join(". ") } : {}),
  };
}

const process = (opened: OpenedPdf) => extractOneFile(opened);

/**
 * Extract Images' batch (batch plan P2): no settings; every image of each
 * file is pulled out in turn, at most `BATCH_LIMITS.rasterMaxFiles` files.
 * DEFLATE, as the single-file panel's ZIP: its PNGs carry uncompressed
 * pixels.
 */
export function ExtractImagesBatch(props: SinglePdfBatch) {
  return (
    <ImagesBatchRunner
      {...props}
      toolName="Extract Images"
      verb="Extract from"
      runningLabel="Scanning for images…"
      zipName={IMAGE_BATCH_TOOLS["extract-images"].zipName}
      maxFiles={batchMaxFilesFor("extract-images")}
      compression="DEFLATE"
      appliesNote="Every embedded image of each file is saved at its original resolution; a file with none says so on its row."
      restrictedRefusal="This PDF has permission restrictions, and a batch leaves a restricted file alone. Open it on its own: Extract Images takes it when its author allows copying."
      process={process}
    />
  );
}
