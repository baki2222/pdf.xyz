import type { PDFDocument, PDFRawStream } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { PdfEngineError } from "./engine";

/**
 * Honest compression analysis for the "Compress PDF" tool.
 *
 * pdf-lib (our in-browser engine) cannot re-encode or downsample embedded
 * images, which is where real compression lives — so we do NOT fake a
 * compression ratio. Instead we:
 *   1. Measure how much of the file is image data (the compressible part).
 *   2. Run a genuine *lossless* structural repack and report the real delta.
 *   3. Recommend, honestly, whether a secure image-downsampling worker would
 *      meaningfully help (see docs/ENGINE_ROADMAP.md).
 *
 * Everything here is pdf-lib-only and isomorphic, so it is fully unit-testable.
 */

const PRODUCER = "pdf.xyz";

/** Lossless repack must trim at least this fraction to be worth surfacing. */
export const LOSSLESS_MIN_RATIO = 0.03;

/** At/above this image share, server-side downsampling is the real win. */
export const IMAGE_HEAVY_SHARE = 0.4;

/** Raw, numeric findings from analyzing a PDF. Serializable and pure to reason about. */
export interface PdfAnalysis {
  pageCount: number;
  /** Original file size in bytes. */
  originalBytes: number;
  /** Number of image XObjects found. */
  imageCount: number;
  /** Summed encoded byte length of those image streams. */
  imageBytes: number;
  /** File size after a lossless structural repack. */
  optimizedBytes: number;
}

/** Analysis plus the actual losslessly-optimized bytes, ready to download. */
export interface AnalyzeResult {
  analysis: PdfAnalysis;
  optimized: Uint8Array;
}

export type OptimizeRecommendation =
  "lossless-helps" | "needs-worker" | "already-lean";

/** Derived, display-ready metrics + an honest recommendation. */
export interface OptimizationSummary {
  /** Fraction of the file that is image data (0–1). */
  imageShare: number;
  /** Bytes saved by the lossless repack (never negative). */
  savedBytes: number;
  /** Fraction saved by the lossless repack (0–1). */
  savedRatio: number;
  recommendation: OptimizeRecommendation;
}

async function loadDoc(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const { PDFDocument } = await loadPdfLib();
    return await PDFDocument.load(bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/encrypt/i.test(message)) {
      throw new PdfEngineError(
        "This PDF is password-protected. Unlock it first, then try again.",
      );
    }
    throw new PdfEngineError(
      "This file couldn't be read as a PDF — it may be corrupted or not a PDF.",
    );
  }
}

function isImageStream(lib: PdfLibModule, obj: unknown): obj is PDFRawStream {
  if (!(obj instanceof lib.PDFRawStream)) return false;
  const subtype = obj.dict.get(lib.PDFName.of("Subtype"));
  return subtype instanceof lib.PDFName && subtype.asString() === "/Image";
}

/**
 * Lossless structural repack: re-serialize with object streams and refresh the
 * producer. Never changes rendered content — only how objects are packed.
 */
export async function optimizeLossless(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  return doc.save({ useObjectStreams: true });
}

/**
 * Inspect a PDF and losslessly repack it, returning both the numeric analysis
 * and the optimized bytes. Does a single parse for the analysis and one repack.
 */
export async function analyzePdf(bytes: Uint8Array): Promise<AnalyzeResult> {
  const lib = await loadPdfLib();
  const doc = await loadDoc(bytes);

  let imageCount = 0;
  let imageBytes = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (isImageStream(lib, obj)) {
      imageCount += 1;
      imageBytes += obj.contents.length;
    }
  }

  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  const optimized = await doc.save({ useObjectStreams: true });

  return {
    analysis: {
      pageCount: doc.getPageCount(),
      originalBytes: bytes.byteLength,
      imageCount,
      imageBytes,
      optimizedBytes: optimized.byteLength,
    },
    optimized,
  };
}

/** Pure: derive display metrics + an honest recommendation from raw findings. */
export function summarizeAnalysis(analysis: PdfAnalysis): OptimizationSummary {
  const originalBytes = Math.max(0, analysis.originalBytes);
  const imageShare =
    originalBytes > 0
      ? Math.min(1, Math.max(0, analysis.imageBytes) / originalBytes)
      : 0;
  const savedBytes = Math.max(
    0,
    analysis.originalBytes - analysis.optimizedBytes,
  );
  const savedRatio = originalBytes > 0 ? savedBytes / originalBytes : 0;

  let recommendation: OptimizeRecommendation;
  if (savedRatio >= LOSSLESS_MIN_RATIO) {
    recommendation = "lossless-helps";
  } else if (imageShare >= IMAGE_HEAVY_SHARE) {
    recommendation = "needs-worker";
  } else {
    recommendation = "already-lean";
  }

  return { imageShare, savedBytes, savedRatio, recommendation };
}
