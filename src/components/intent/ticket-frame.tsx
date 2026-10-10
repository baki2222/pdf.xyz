import type { ReactNode } from "react";

/** File rows a ticket lists before "+N more". */
export const TICKET_FILE_ROWS = 3;

/** The ticket's heading: one spelling for the region it names. */
export const TICKET_HEADING = "What you can do with these files";

/**
 * The job ticket's frame: where each part of a ticket goes, at a height that
 * what is in it cannot change.
 *
 *  - files: {@link TICKET_FILE_ROWS} rows of 24px and the "+N more" line
 *    (20px), reserved whether one file arrives or twenty-three;
 *  - suggestions: 144px — a 56px first row and two 40px rows with their
 *    gaps, which the placeholder and the "Open all N in the workspace" row
 *    take exactly;
 *  - the note: two 16px lines, clamped — one note, the reason a row is
 *    pinned, a launch that failed, or the desk's own promise when there is
 *    nothing to say (further notes go under "More");
 *  - the footer: one 32px row.
 *
 * The heading and the kicker are the same words in every state, so they wrap
 * the same at any width. WHY IT IS SHARED: the home desk lays an empty copy
 * of this frame (`ghost`) under its idle content, in the same grid cell, from
 * the server render on — so the desk is as tall as the taller of the two from
 * the first paint, and the ticket that later fills the frame is exactly that
 * tall. WAS a ticket whose height followed its content: the box grew 12px
 * at 768 for two PDFs, 56px for twenty-three, 110px for a HEIC and a stray
 * file at 1280, and everything under the desk moved with it (measured on the
 * served build, 2026-10-10). No height here is typed per breakpoint; each is
 * the sum of fixed rows, and `e2e/layout-stability.spec.ts` drops the file
 * sets that grew it at three widths and holds the box to one height.
 *
 * Whatever follows the footer (`after`: the "More" rows, opened by a press)
 * may grow the ticket — a person asked for it.
 */
export function TicketFrame({
  ghost = false,
  chunk,
  headingId,
  actions,
  summary,
  files,
  suggestions,
  note,
  footer,
  after,
}: {
  /** An empty copy that only holds the space: invisible, inert, unnamed. */
  ghost?: boolean;
  /** The lazy chunk's marker, rendered so minification keeps it. */
  chunk?: string;
  headingId?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  files?: ReactNode;
  suggestions?: ReactNode;
  note?: ReactNode;
  footer?: ReactNode;
  after?: ReactNode;
}) {
  // A ghost's heading is not a heading: it is never read, and the page's
  // outline must not gain a second, hidden "What you can do…".
  const Heading = ghost ? "p" : "h2";
  return (
    <div
      data-chunk={chunk}
      data-ticket-frame={ghost ? "ghost" : ""}
      className="flex min-w-0 flex-1 flex-col"
    >
      <div className="flex h-7 items-center justify-between gap-3">
        <p className="kicker text-faint relative truncate">
          Job ticket
          <span className="max-sm:sr-only">
            <span aria-hidden> · </span>
            <span className="sr-only">, </span>checked in this tab
          </span>
        </p>
        {actions}
      </div>
      <Heading
        id={headingId}
        className="font-display text-fg mt-1 text-lg leading-snug font-semibold tracking-tight"
      >
        {TICKET_HEADING}
      </Heading>
      <p className="figure mt-0.5 h-4 truncate text-xs leading-4">{summary}</p>
      <div data-slot="files" className="mt-2 h-[5.75rem]">
        {files}
      </div>
      <div aria-hidden className="perforation my-2.5" />
      <div data-slot="suggestions" className="h-36">
        {suggestions}
      </div>
      <div data-slot="note" className="mt-2 h-8">
        {note}
      </div>
      <div className="mt-auto pt-1">
        <div className="flex h-8 items-center justify-between gap-3">
          {footer}
        </div>
      </div>
      {after}
    </div>
  );
}
