"use client";

import Link from "next/link";
import { ImageOff, ScanText } from "lucide-react";
import type { Job } from "@/lib/jobs/types";
import { UNLOCK_TOOL_HREF } from "@/lib/pdf/encryption";
import { errorNoteLinksUnlock } from "./runner/runner-kit";
import {
  LITTLE_TEXT_CHARS,
  OFFICE_EXPORT_ERROR_CODES,
} from "@/lib/jobs/office-export-results";

type OfficeExportErrorCode =
  (typeof OFFICE_EXPORT_ERROR_CODES)[keyof typeof OFFICE_EXPORT_ERROR_CODES];

/**
 * The tool that fixes each document-level failure. Typed as a total record
 * over the shared codes, so adding a code without a next step does not compile.
 */
export const OFFICE_EXPORT_NEXT_STEPS: Record<
  OfficeExportErrorCode,
  { href: string; label: string }
> = {
  [OFFICE_EXPORT_ERROR_CODES.noText]: {
    href: "/tools/ocr-pdf",
    label: "Open OCR PDF",
  },
  [OFFICE_EXPORT_ERROR_CODES.passwordProtected]: {
    href: UNLOCK_TOOL_HREF,
    label: "Open Unlock PDF",
  },
  [OFFICE_EXPORT_ERROR_CODES.unreadable]: {
    href: "/tools/repair-pdf",
    label: "Open Repair PDF",
  },
};

function nextStepFor(code: string | undefined) {
  return code && Object.hasOwn(OFFICE_EXPORT_NEXT_STEPS, code)
    ? OFFICE_EXPORT_NEXT_STEPS[code as OfficeExportErrorCode]
    : undefined;
}

/**
 * The tool that fixes a failed export, linked by error CODE. The messages say
 * the same thing in words, but a link keyed on message text breaks silently the
 * first time someone edits the sentence.
 */
export function OfficeExportNextStep({
  code,
  from,
  message,
}: {
  code: string | undefined;
  /**
   * The failure's sentence, when the panel shows it in an {@link ErrorNote}.
   * That note links Unlock PDF by itself whenever the sentence names it
   * (`errorNoteLinksUnlock`), so the same link here would be the second one
   * on screen. Found at the merge of wave-1 L03 with the integration branch
   * (2026-09-28): each side added one of the two links.
   */
  message?: string;
  /**
   * The slug of the tool the user is on. A next step that is this tool is not
   * a next step: Repair PDF failing with "unreadable" must not say "Open
   * Repair PDF".
   */
  from?: string;
}) {
  const step = nextStepFor(code);
  if (!step || (from && step.href === `/tools/${from}`)) return null;
  if (
    step.href === UNLOCK_TOOL_HREF &&
    message !== undefined &&
    errorNoteLinksUnlock(message)
  )
    return null;
  return (
    <Link
      href={step.href}
      className="text-fg self-start text-sm font-medium underline underline-offset-4"
    >
      {step.label}
    </Link>
  );
}

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
  const lost = powerpoint ? (report.picturesNotCarried ?? 0) : 0;
  const lostPages = report.pagesMissingPictures ?? [];
  const flattened = powerpoint ? (report.flattenedPageCount ?? 0) : 0;
  if (missing <= 0 && little <= 0 && lost <= 0 && flattened <= 0) return null;
  const pictures =
    powerpoint && report.picturePageCount !== undefined
      ? {
          count: report.picturePageCount,
          pages: report.pagesAsPictures ?? [],
          blank:
            report.emptySlideCount ??
            Math.max(0, missing - report.picturePageCount),
        }
      : null;
  const sparseLostPicture = (report.pagesWithLittleText ?? []).some((p) =>
    lostPages.includes(p),
  );

  return (
    <div
      role="status"
      className="border-warn/40 bg-warn/10 text-warn flex flex-col gap-2 rounded-[4px] border px-4 py-3 text-sm"
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
      {lost > 0 && <PicturesNotCarried report={report} />}
      {missing > 0 && !pictures && (
        <p className="ml-6">
          No selectable text on {pageSpan(report.pagesWithoutText, missing)}, so
          nothing from {missing === 1 ? "it" : "them"} is in this file.{" "}
          {missing === 1 ? "It looks" : "They look"} scanned: run OCR PDF first
          to include {missing === 1 ? "it" : "them"}.
        </p>
      )}
      {pictures && pictures.count > 0 && (
        <p className="ml-6">
          No selectable text on {pageSpan(pictures.pages, pictures.count)}, so{" "}
          {pictures.count === 1 ? "its slide carries" : "their slides carry"}{" "}
          the page as a picture, and the words on{" "}
          {pictures.count === 1 ? "it are" : "them are"} not editable text. Run
          OCR PDF first to have them as text too.
        </p>
      )}
      {pictures && pictures.blank > 0 && (
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
 * "2 pictures on page 3 are not on its slide: …" — the pictures a page
 * paints that the worker could not carry, and why. Rendered only when the
 * worker counted them (`picturesNotCarried`).
 */
function PicturesNotCarried({
  report,
}: {
  report: NonNullable<NonNullable<Job["results"]>["officeExport"]>;
}) {
  const lost = report.picturesNotCarried ?? 0;
  const tooLarge = Math.min(lost, report.picturesTooLarge ?? 0);
  const undecoded = lost - tooLarge;
  const pages = report.pagesMissingPictures ?? [];
  const onePage = pages.length === 1;
  const noun = lost === 1 ? "picture" : "pictures";
  const where = `on ${pages.length > 0 ? pageSpan(pages, pages.length) : "the PDF's pages"}`;
  const slides = onePage ? "its slide" : "their slides";
  const reason =
    undecoded === 0
      ? `${lost === 1 ? "it was" : "they were"} too large for the worker to carry`
      : tooLarge === 0
        ? `${lost === 1 ? "its" : "their"} image data could not be decoded, and may be damaged`
        : `${tooLarge} ${tooLarge === 1 ? "was" : "were"} too large for the worker to carry, and ${undecoded} could not be decoded`;
  return (
    <p className="flex items-start gap-2">
      <ImageOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">
          {lost} {noun} {where} {lost === 1 ? "is" : "are"} not on {slides}
        </strong>
        : {reason}. Check {onePage ? "that page" : "those pages"} against the
        PDF.
      </span>
    </p>
  );
}
