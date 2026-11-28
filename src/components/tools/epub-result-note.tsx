import type { Job } from "@/lib/jobs/types";
import { EPUB_MAX_SPINE_ITEMS } from "@/lib/workers/epub/native-config";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * What EPUB to PDF did with the book beyond its reading order, and with its
 * fonts, as one sentence (audit epub-to-pdf#3 and #4, 2026-11-06), or null
 * when there is nothing to say.
 *
 * Built from the job's own counts (`job.results.epub`, `@/lib/jobs/epub-results`)
 * and nothing else: whether a book's fonts can be restored depends on the book
 * and on the worker that printed it, which a sentence written on the page
 * cannot know. No block (a worker that does not report) and nothing worth
 * saying are both silence.
 *
 * ONE sentence for both places a finished book is shown: the single-file
 * result card ({@link EpubResultNote}) and each row of the batch (the
 * panel's `rowNote`). Until the wave 3 review only the card said it, so a
 * batch row whose fonts were left out said nothing while the FAQ promised
 * the note would.
 *
 * Fonts are spoken of as RESTORED, not used: a font restored and then
 * refused by Chromium still prints in a fallback font, and nothing counts
 * that (wave 3 review, mutant idpf-1024).
 */
export function epubResultSentence(job: Job | undefined): string | null {
  const epub = job?.results?.epub;
  if (!epub) return null;
  const lines: string[] = [];
  const extra = epub.extraSections;
  if (extra > 0)
    lines.push(
      `${extra} extra ${plural(extra, "section", "sections")} the book keeps outside its reading order, such as notes or answers, ${plural(extra, "is", "are")} printed at the end, after the last chapter.`,
    );
  const skipped = epub.extraSectionsLeftOut ?? 0;
  if (skipped > 0)
    lines.push(
      `${skipped} ${extra > 0 ? "more " : ""}extra ${plural(skipped, "section was", "sections were")} left out, because a book can have at most ${EPUB_MAX_SPINE_ITEMS} chapter files.`,
    );
  const lost = epub.fontsLeftOut;
  if (lost > 0)
    lines.push(
      `${lost} of the book's fonts could not be restored, so the text set in ${plural(lost, "it", "them")} prints in a standard font.`,
    );
  return lines.length === 0 ? null : lines.join(" ");
}

/** {@link epubResultSentence}, beside the download of a single book. */
export function EpubResultNote({ job }: { job: Job | undefined }) {
  const sentence = epubResultSentence(job);
  if (sentence === null) return null;
  return (
    <p role="status" className="text-muted text-sm leading-relaxed">
      {sentence}
    </p>
  );
}
