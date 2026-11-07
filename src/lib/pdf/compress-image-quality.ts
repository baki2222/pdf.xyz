/**
 * Image quality for deep compression (audit compress-pdf#4, 2026-11-08): the
 * JPEG axis, separate from resolution.
 *
 * Until this, the Quality chips set only a resolution, and how hard JPEG
 * squeezed the photos was whatever Ghostscript's /ebook preset fixed. The
 * Target size ladder could therefore only lower the resolution, and it ran
 * out at 72 DPI with JPEG quality never touched.
 *
 * Each level is a Ghostscript `QFactor` (higher = smaller, blurrier) with its
 * chroma subsampling. "Medium" is exactly what /ebook already uses (QFactor
 * 0.76, 2x2 subsampling), so it is the default and a Medium run sends no
 * extra argument: its argv is byte-for-byte what it was (`native.ts`).
 * "High" is /printer's 0.4 with no subsampling. "Low" and "Lowest" are
 * Acrobat Distiller's Low and Minimum JPEG settings (1.3 and 2.4).
 *
 * The factor applies to images Ghostscript writes as JPEG. Its AutoFilter
 * keeps some images lossless (Flate), and those are not affected — the hint
 * says so.
 *
 * Client-safe and feature-scoped: the Compress runner, the worker's parser,
 * argv and ladder, and the tool's copy read it. Nothing first-load imports it.
 */

export const IMAGE_QUALITY_LEVELS = [
  { id: "high", label: "High", qFactor: 0.4, subsample: false },
  { id: "medium", label: "Medium", qFactor: 0.76, subsample: true },
  { id: "low", label: "Low", qFactor: 1.3, subsample: true },
  { id: "lowest", label: "Lowest", qFactor: 2.4, subsample: true },
] as const;

export type ImageQuality = (typeof IMAGE_QUALITY_LEVELS)[number]["id"];

/** What /ebook already does; a run at this level sends no extra argument. */
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "medium";

/** The panel's words, named once so copy can quote them. */
export const IMAGE_QUALITY_LABELS = {
  disclosure: "Advanced",
  heading: "Image quality",
} as const;

export const IMAGE_QUALITY_HINT =
  "How hard photos are JPEG-compressed, separately from their resolution. Lower makes smaller files with more blur and blocky edges. Images our server keeps lossless are not affected.";

/**
 * What the panel says when the job record does not show the level it sent:
 * a worker image older than this option ignores it and compresses at the
 * preset's own level (`compression-results.ts`, `imageQuality`).
 */
export function imageQualityNotApplied(asked: ImageQuality): string {
  return `Our server did not apply your “${imageQualityLevel(asked).label}” image quality to this run; it compressed at “${imageQualityLevel(DEFAULT_IMAGE_QUALITY).label}”.`;
}

export function isImageQuality(value: unknown): value is ImageQuality {
  return IMAGE_QUALITY_LEVELS.some((level) => level.id === value);
}

export function imageQualityLevel(id: ImageQuality) {
  return IMAGE_QUALITY_LEVELS.find((level) => level.id === id)!;
}

/** The levels below `id`, highest first: the Target size ladder's last rungs. */
export function lowerImageQualities(id: ImageQuality): ImageQuality[] {
  const i = IMAGE_QUALITY_LEVELS.findIndex((level) => level.id === id);
  return IMAGE_QUALITY_LEVELS.slice(i + 1).map((level) => level.id);
}

/**
 * The PostScript Ghostscript runs (`-c … setdistillerparams`) to set one
 * level, built only from the fixed table above — never from request text.
 * Both the AutoFilter (ACS) and the plain image dictionaries are set, for
 * colour and gray, so the level holds whichever encoder path an image takes.
 */
export function imageQualityDistillerParams(id: ImageQuality): string {
  const { qFactor, subsample } = imageQualityLevel(id);
  const s = subsample ? "[2 1 1 2]" : "[1 1 1 1]";
  const dict = `<< /QFactor ${qFactor} /Blend 1 /HSamples ${s} /VSamples ${s} >>`;
  return `<< /ColorACSImageDict ${dict} /GrayACSImageDict ${dict} /ColorImageDict ${dict} /GrayImageDict ${dict} >> setdistillerparams`;
}
