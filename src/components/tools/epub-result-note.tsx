import type { Job } from "@/lib/jobs/types";

/**
 * What EPUB to PDF did with the book beyond its reading order, and with its
 * fonts, shown beside the download (audit epub-to-pdf#3 and #4, 2026-11-06).
 *
 * Built from the job's own counts (`job.results.epub`, `@/lib/jobs/epub-results`)
 * and nothing else: whether a book's fonts can be used depends on the book and
 * on the worker that printed it, which a sentence written on the page cannot
 * know. No block (a worker that does not report) and nothing worth saying are
 * both silence.
 */
export function EpubResultNote({ job }: { job: Job | undefined }) {
  const epub = job?.results?.epub;
  if (!epub) return null;
  const lines: string[] = [];
  const extra = epub.extraSections;
  if (extra > 0)
    lines.push(
      `${extra} extra section${extra === 1 ? "" : "s"} the book keeps outside its reading order, such as notes or answers, ${extra === 1 ? "is" : "are"} printed at the end, after the last chapter.`,
    );
  const lost = epub.fontsLeftOut;
  if (lost > 0)
    lines.push(
      `${lost} of the book's fonts could not be used, so the text set in ${lost === 1 ? "it" : "them"} prints in a standard font.`,
    );
  if (lines.length === 0) return null;
  return (
    <p role="status" className="text-muted text-sm leading-relaxed">
      {lines.join(" ")}
    </p>
  );
}
