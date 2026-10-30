"use client";

import Link from "next/link";
import { ImageOff, ScanText, Wrench } from "lucide-react";
import type { Job } from "@/lib/jobs/types";
import { LITTLE_TEXT_CHARS } from "@/lib/jobs/office-export-results";
import { MAX_DOCX_PICTURES } from "@/lib/workers/pdf-office-export/picture-limits";

/*
 * Moved out of `./office-export-notices` (2026-10-17) so the panels that only
 * link a next step do not load this notice: see the note there.
 */

/** "2–5, 7" — runs of consecutive pages collapsed, for a sentence. */
export function formatPageRanges(pages: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length;) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j += 1;
    parts.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

function pageSpan(listed: readonly number[], total: number): string {
  const noun = total === 1 ? "page" : "pages";
  const more = total - listed.length;
  return `${noun} ${formatPageRanges(listed)}${more > 0 ? ` and ${more} more` : ""}`;
}

/**
 * Which pages of the PDF did not make it into the file, shown beside the
 * download.
 *
 * The export reads selectable text only, and a scanned page has none. That
 * used to be silent: a five-page scan with a typed stamp on page 1 came back as
 * a one-line DOCX under "Your DOCX file is ready.", and the only OCR hint fired
 * when the WHOLE document had no text.
 *
 * Renders from `job.results.officeExport` and nothing else. No block means the
 * worker did not report — it deploys by hand and can be older than this page —
 * so it renders nothing rather than an "every page had text" it cannot know.
 * Pages with a little text get the hedged wording, because a stamp on a scan
 * and a one-line title slide look the same from here.
 *
 * TOOL-AWARE since 2026-10-10. Until then one notice served all three exports
 * and said of a page with no text "nothing from it is in this file" — true of
 * Word, Excel and the PowerPoint export of that day. PowerPoint now keeps
 * such a page as pictures, so for it the notice says THAT, but only when the
 * worker reported `picturePageCount`: an older worker's result has no such
 * field, its deck really did leave the page empty, and it gets the old words.
 *
 * PICTURES NOT CARRIED, since 2026-10-11. A picture the worker could not put
 * on its slide (too large for its memory, or undecodable) used to leave no
 * trace, and this notice then called its page EMPTY — "One page has nothing
 * on it" about a page that held a full-page scan — and told a page with a
 * stamp that its scan "comes through as a picture" when it had not. Now the
 * result counts them, this notice says so, and neither sentence is said of
 * such a page: the empty count is the worker's own (`emptySlideCount`), and
 * the scan sentence is left out when a sparse page lost a picture.
 *
 * WORD KEEPS PICTURES TOO, since 2026-10-17. Until then a page of a Word
 * export with no text had "nothing from it in this file", which was true:
 * the document was text alone. Now its pictures are in the document, so for
 * a result that reports `picturePageCount` the notice says which pages come
 * through only as pictures, which have neither text nor a picture (only
 * those have nothing in the file, and they are not called scans: a scan IS
 * a picture), which pictures could not be carried, and that a damaged file
 * was rebuilt first. A result from an older worker has no such field, its
 * document really did leave those pages out, and it gets the old words.
 *
 * "No selectable text and no picture" is said only of the pages the worker
 * SAW to be empty (`emptyPageCount`, `pagesEmpty`), as PowerPoint's empty
 * slides are. Until the review of 2026-10-17 it was a subtraction (pages
 * without text, less the pages that came through as pictures), and it was
 * said of a page whose picture could not be decoded, beside the sentence
 * that named that picture as not carried.
 */
export function OfficeExportCoverageNotice({
  job,
  tool,
}: {
  job: Job | undefined;
  /** The tool the result came from; PowerPoint's pictures change the words. */
  tool?: string;
}) {
  const report = job?.results?.officeExport;
  if (!report) return null;
  const missing = report.pageCount - report.textPageCount;
  const little = report.littleTextPageCount;
  const powerpoint = tool === "pdf-to-powerpoint";
  const word = tool === "pdf-to-word";
  const keepsPictures = powerpoint || word;
  const lost = keepsPictures ? (report.picturesNotCarried ?? 0) : 0;
  const lostPages = report.pagesMissingPictures ?? [];
  const flattened = powerpoint ? (report.flattenedPageCount ?? 0) : 0;
  const rebuilt = keepsPictures && report.repairedBeforeConversion === true;
  if (missing <= 0 && little <= 0 && lost <= 0 && flattened <= 0 && !rebuilt)
    return null;
  const pictures =
    keepsPictures && report.picturePageCount !== undefined
      ? {
          count: report.picturePageCount,
          pages: report.pagesAsPictures ?? [],
          // Word: the worker's own count of pages it SAW to be empty, or
          // none at all — never a subtraction, which called a page whose
          // picture was lost "no picture" (the review of 2026-10-17).
          blank: word
            ? (report.emptyPageCount ?? 0)
            : (report.emptySlideCount ??
              Math.max(0, missing - report.picturePageCount)),
        }
      : null;
  // Word: those pages by number, when the worker's list is whole (capped).
  const bare =
    word && pictures && (report.pagesEmpty ?? []).length === pictures.blank
      ? report.pagesEmpty!
      : null;
  const sparseLostPicture = (report.pagesWithLittleText ?? []).some((p) =>
    lostPages.includes(p),
  );

  return (
    <div
      role="status"
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex flex-col gap-2 border px-4 py-3 text-sm"
    >
      {(missing > 0 || little > 0) && (
        <p className="flex items-start gap-2">
          <ScanText className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">
              Text found on {report.textPageCount} of {report.pageCount}{" "}
              {report.pageCount === 1 ? "page" : "pages"}.
            </strong>
          </span>
        </p>
      )}
      {rebuilt && (
        <p className="flex items-start gap-2">
          <Wrench className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            This PDF looked damaged, so pdf.xyz rebuilt it first, the way Repair
            PDF does, and converted the rebuilt copy. Check the{" "}
            {word ? "document" : "slides"} against the PDF.
          </span>
        </p>
      )}
      {lost > 0 && <PicturesNotCarried report={report} word={word} />}
      {missing > 0 && !pictures && (
        <p className="ml-6">
          No selectable text on {pageSpan(report.pagesWithoutText, missing)}, so
          nothing from {missing === 1 ? "it" : "them"} is in this file.{" "}
          {missing === 1 ? "It looks" : "They look"} scanned: run OCR PDF first
          to include {missing === 1 ? "it" : "them"}.
        </p>
      )}
      {pictures && pictures.count > 0 && word && (
        <p className="ml-6">
          No selectable text on {pageSpan(pictures.pages, pictures.count)}, so
          only{" "}
          {pictures.count === 1 ? "its pictures come" : "their pictures come"}{" "}
          through, and the words in them are not editable text. Run OCR PDF
          first to have them as text too.
        </p>
      )}
      {word && pictures && pictures.blank > 0 && (
        <p className="ml-6">
          {bare
            ? pageSpan(bare, bare.length).replace(/^p/, "P")
            : `${pictures.blank} ${pictures.blank === 1 ? "page" : "pages"}`}{" "}
          {pictures.blank === 1 ? "has" : "have"} no selectable text and no
          picture, so nothing from {pictures.blank === 1 ? "it" : "them"} is in
          this file.
        </p>
      )}
      {pictures && pictures.count > 0 && !word && (
        <p className="ml-6">
          No selectable text on {pageSpan(pictures.pages, pictures.count)}, so{" "}
          {pictures.count === 1 ? "its slide carries" : "their slides carry"}{" "}
          the page as a picture, and the words on{" "}
          {pictures.count === 1 ? "it are" : "them are"} not editable text. Run
          OCR PDF first to have them as text too.
        </p>
      )}
      {!word && pictures && pictures.blank > 0 && (
        <p className="ml-6">
          {pictures.blank === 1
            ? "One page has"
            : `${pictures.blank} pages have`}{" "}
          nothing on {pictures.blank === 1 ? "it" : "them"}, so{" "}
          {pictures.blank === 1 ? "its slide is" : "their slides are"} empty.
        </p>
      )}
      {little > 0 && (
        <p className="ml-6">
          {pageSpan(report.pagesWithLittleText, little).replace(/^p/, "P")}{" "}
          {little === 1 ? "has" : "have"} under {LITTLE_TEXT_CHARS} characters
          of selectable text. If{" "}
          {little === 1 ? "it is a scan" : "they are scans"} with a stamp or
          header on top,{" "}
          {pictures && !sparseLostPicture
            ? "the scan comes through as a picture: run OCR PDF first to have the rest as text."
            : "run OCR PDF first to include the rest."}
        </p>
      )}
      {flattened > 0 && (
        <p className="ml-6">
          {pageSpan(report.pagesFlattened ?? [], flattened).replace(/^p/, "P")}{" "}
          {flattened === 1 ? "has" : "have"} too much overlapping drawing to
          rebuild piece by piece, so{" "}
          {flattened === 1 ? "its slide is" : "their slides are"} one picture of
          the page, with the text in invisible text boxes over it: you can
          select and search it, not see or restyle it.
        </p>
      )}
      {(missing > 0 || little > 0) && (
        <Link
          href="/tools/ocr-pdf"
          className="ml-6 self-start font-medium underline underline-offset-4"
        >
          Open OCR PDF
        </Link>
      )}
    </div>
  );
}

/**
 * What "one conversion carries" means, for a picture left out over budget
 * (PDF to Word only): the picture count, the size of one file, and the time
 * one conversion may take.
 */
const OVER_BUDGET_LIMITS = `${MAX_DOCX_PICTURES.toLocaleString("en-US")} pictures, the size of one file, or the time one conversion may take`;

/**
 * "2 pictures on page 3 are not on its slide: …" — the pictures a page
 * paints that the worker could not carry, and why. Rendered only when the
 * worker counted them (`picturesNotCarried`).
 */
function PicturesNotCarried({
  report,
  word,
}: {
  report: NonNullable<NonNullable<Job["results"]>["officeExport"]>;
  /** A Word document has no slides: its pictures are "in the document". */
  word: boolean;
}) {
  const lost = report.picturesNotCarried ?? 0;
  const overBudget = Math.min(lost, report.picturesOverBudget ?? 0);
  const tooLarge = Math.min(lost - overBudget, report.picturesTooLarge ?? 0);
  const undecoded = lost - overBudget - tooLarge;
  const pages = report.pagesMissingPictures ?? [];
  const onePage = pages.length === 1;
  const noun = lost === 1 ? "picture" : "pictures";
  const where = `on ${pages.length > 0 ? pageSpan(pages, pages.length) : "the PDF's pages"}`;
  const slides = word ? "the document" : onePage ? "its slide" : "their slides";
  const was = (n: number) => (n === 1 ? "was" : "were");
  // One reason in the words for it alone; several, each with its count.
  const reasons = [
    overBudget > 0 &&
      (overBudget === lost
        ? `${lost === 1 ? "it" : "they"} would have taken the document past what one conversion carries: ${OVER_BUDGET_LIMITS}. All of the text is there`
        : `${overBudget} would have taken the document past what one conversion carries (${OVER_BUDGET_LIMITS})`),
    tooLarge > 0 &&
      (tooLarge === lost
        ? `${lost === 1 ? "it was" : "they were"} too large for our server to carry`
        : `${tooLarge} ${was(tooLarge)} too large for our server to carry`),
    undecoded > 0 &&
      (undecoded === lost
        ? `${lost === 1 ? "its" : "their"} image data could not be decoded, and may be damaged`
        : `${undecoded} could not be decoded`),
  ].filter((r): r is string => typeof r === "string");
  const reason =
    reasons.length < 3
      ? reasons.join(", and ")
      : `${reasons.slice(0, -1).join(", ")}, and ${reasons.at(-1)}`;
  return (
    <p className="flex items-start gap-2">
      <ImageOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">
          {lost} {noun} {where} {lost === 1 ? "is" : "are"} not{" "}
          {word ? "in" : "on"} {slides}
        </strong>
        : {reason}. Check {onePage ? "that page" : "those pages"} against the
        PDF.
      </span>
    </p>
  );
}
