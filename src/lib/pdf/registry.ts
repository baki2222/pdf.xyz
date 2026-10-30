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
  | "extract-images"
  | "compare"
  | "scan"
  | "metadata"
  | "resize"
  | "n-up";

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
  "compare-pdf": "compare",
  "scan-to-pdf": "scan",
  "edit-pdf-metadata": "metadata",
  "resize-pdf": "resize",
  "n-up-pdf": "n-up",
};

export function getRunnerKind(slug: string): RunnerKind | undefined {
  return RUNNERS[slug];
}

export function isToolSupported(slug: string): boolean {
  return slug in RUNNERS;
}

/** Slugs of every tool with a working client-side runner. */
export const supportedToolSlugs: string[] = Object.keys(RUNNERS);

/**
 * Runner kinds whose pipeline reads a PDF with pdf.js alone. pdf.js opens a
 * file whose author restricted editing (an owner password, no user password)
 * the way every viewer does; pdf-lib refuses any /Encrypt. So these tools
 * take a restricted PDF and every other runner does not — what the
 * suggestion ranking needs to know before it offers one.
 *
 * Held to the runners, both ways, by `registry-readers.test.ts`: a kind is
 * here iff the runner the dispatcher mounts for it passes `reader="pdfjs"`.
 */
export const PDFJS_READER_KINDS: ReadonlySet<RunnerKind> = new Set<RunnerKind>([
  "pdf-to-text",
  "pdf-to-markdown",
  "pdf-to-image",
]);

/** Does this tool's in-browser runner open a restricted PDF? */
export function opensRestrictedPdfs(slug: string): boolean {
  const kind = RUNNERS[slug];
  return kind !== undefined && PDFJS_READER_KINDS.has(kind);
}
