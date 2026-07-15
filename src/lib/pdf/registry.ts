/**
 * Registry of tools that have a real, in-browser runner implemented. The
 * dynamic tool page uses this to decide whether to render an interactive runner
 * or the polished "implementation-ready" placeholder — so shipping a new tool is
 * a one-line addition here plus a case in the runner dispatcher.
 */

export type RunnerKind =
  | "merge"
  | "split"
  | "rotate"
  | "delete-pages"
  | "extract-pages"
  | "organize"
  | "compress"
  | "pdf-to-text"
  | "pdf-to-markdown"
  | "text-to-pdf"
  | "markdown-to-pdf"
  | "image-to-pdf"
  | "pdf-to-image"
  | "page-numbers"
  | "watermark"
  | "header-footer"
  | "crop"
  | "sign"
  | "flatten"
  | "overlay"
  | "grayscale"
  | "redact"
  | "fill-forms"
  | "create-forms"
  | "annotate"
  | "edit"
  | "extract-images";

const RUNNERS: Record<string, RunnerKind> = {
  "merge-pdf": "merge",
  "split-pdf": "split",
  "rotate-pdf": "rotate",
  "remove-pages": "delete-pages",
  "extract-pages": "extract-pages",
  "organize-pages": "organize",
  "compress-pdf": "compress",
  "pdf-to-text": "pdf-to-text",
  "pdf-to-markdown": "pdf-to-markdown",
  "text-to-pdf": "text-to-pdf",
  "markdown-to-pdf": "markdown-to-pdf",
  "jpg-to-pdf": "image-to-pdf",
  "png-to-pdf": "image-to-pdf",
  "pdf-to-jpg": "pdf-to-image",
  "pdf-to-png": "pdf-to-image",
  "page-numbers": "page-numbers",
  "watermark-pdf": "watermark",
  "header-footer": "header-footer",
  "crop-pdf": "crop",
  "sign-pdf": "sign",
  "flatten-pdf": "flatten",
  "overlay-pdf": "overlay",
  "grayscale-pdf": "grayscale",
  "redact-pdf": "redact",
  "fill-forms": "fill-forms",
  "create-forms": "create-forms",
  "annotate-pdf": "annotate",
  "edit-pdf": "edit",
  "extract-images": "extract-images",
};

export function getRunnerKind(slug: string): RunnerKind | undefined {
  return RUNNERS[slug];
}

export function isToolSupported(slug: string): boolean {
  return slug in RUNNERS;
}

/** Slugs of every tool with a working client-side runner. */
export const supportedToolSlugs: string[] = Object.keys(RUNNERS);
