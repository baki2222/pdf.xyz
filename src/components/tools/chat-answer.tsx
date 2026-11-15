"use client";

import { citationSegments } from "@/lib/jobs/chat-citations";

/**
 * What a citation button is called: the page it opens, and every page it
 * names. Exported for its test.
 */
export function citationLabel(pages: number[]): string {
  if (pages.length === 1) return `Show page ${pages[0]} of your PDF`;
  const list = `${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
  return `Show pages ${list} of your PDF, starting at page ${pages[0]}`;
}

/**
 * The model's answer, verbatim, with each `[p.N]` marker that cites a page of
 * THIS file made a button that shows the page (audit #30, chat-with-pdf#3,
 * 2026-11-15).
 *
 * The visible text — and so what a reader selects and copies — is the answer
 * exactly as the package ships it: a button's text is the marker itself. The
 * markers are read with the worker's own grammar (`@/lib/jobs/chat-citations`),
 * so a button exists for exactly the pages manifest.answer.citedPages lists.
 *
 * With no counted page count, or nothing to open the page from — an answer
 * picked up with Keep waiting (the panel cannot prove which file it is
 * about), an answer about a file other than the one held, a PDF the browser
 * could not count — every marker stays plain text: a button that cannot show
 * its page, or would show another file's, is a promise the panel cannot keep.
 */
export function ChatAnswer({
  answer,
  pageCount,
  onOpen,
}: {
  answer: string;
  pageCount: number | null;
  onOpen: ((page: number) => void) | null;
}) {
  if (pageCount === null || onOpen === null) {
    return (
      <p className="text-muted text-sm leading-relaxed whitespace-pre-wrap">
        {answer}
      </p>
    );
  }
  return (
    <p className="text-muted text-sm leading-relaxed whitespace-pre-wrap">
      {citationSegments(answer, pageCount).map((segment, i) =>
        segment.kind === "text" ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <button
            key={i}
            type="button"
            aria-label={citationLabel(segment.pages)}
            onClick={() => onOpen(segment.pages[0]!)}
            className="text-accent tap-y font-medium underline underline-offset-4"
          >
            {segment.text}
          </button>
        ),
      )}
    </p>
  );
}
