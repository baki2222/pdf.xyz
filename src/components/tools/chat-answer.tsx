"use client";

import { Fragment, type ReactNode } from "react";
import { citationSegments } from "@/lib/jobs/chat-citations";
import { MarkdownText } from "./ai-markdown";

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
 * The model's answer drawn as formatted Markdown (competitor audit #4,
 * 2026-11-17: the model writes Markdown, and until then its `**` and `-`
 * marks showed), with each `[p.N]` marker that cites a page of THIS file
 * made a button that shows the page (audit #30, chat-with-pdf#3,
 * 2026-11-15).
 *
 * The page shows the answer's text without its Markdown marks; Copy answer,
 * Copy conversation and the .md download carry the answer exactly as the
 * package ships it (`./ai-result-views`). A button's text is the marker
 * itself. The markers are read with the worker's own grammar
 * (`@/lib/jobs/chat-citations`), run by run of the formatted text, so a
 * button exists for the pages manifest.answer.citedPages lists, with one
 * deliberate exception: a marker inside a link's text stays text, since a
 * button inside a link is two controls in one (chat-answer.test.tsx).
 *
 * With no counted page count, or nothing to open the page from — an answer
 * picked up with Keep waiting (the panel cannot prove which file it is
 * about), an answer about a file other than the one held, a PDF the browser
 * could not count — every marker stays plain text: a button that cannot show
 * its page, or would show another file's, is a promise the panel cannot keep.
 *
 * Lazy: only the AI result views chunk imports this module. The panel draws
 * the answer as it is until that chunk arrives (it is fetched as the
 * question is asked, so in practice before the answer).
 *
 * The answer sits in the transcript under the panel's h2, so its shallowest
 * heading is an h3 (e2e/ai-results.spec.ts reads the served page's outline).
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
  const leaf = (text: string): ReactNode =>
    pageCount === null || onOpen === null
      ? text
      : citationSegments(text, pageCount).map((segment, i) =>
          segment.kind === "text" ? (
            <Fragment key={i}>{segment.text}</Fragment>
          ) : (
            <button
              key={i}
              type="button"
              aria-label={citationLabel(segment.pages)}
              onClick={() => onOpen(segment.pages[0]!)}
              // An IN-FLOW box, never `tap-y` (review, 2026-11-15): tap-y grows
              // a button to 44px with a negative margin, so on a touch screen
              // the boxes of markers on neighbouring lines overlapped and a tap
              // on "[p.1]" opened the page cited on the line below. As an
              // inline-flex box, `tap` (44x44 on a coarse pointer) grows the
              // LINE instead, and 1px of padding makes the desktop box 24px+
              // (axe target-size; the line is ~23px). Existing classes only:
              // the shipped stylesheet is at its ceiling.
              // e2e/chat-with-pdf-citations{,.mobile}.spec.ts measure both.
              style={{ paddingBlock: 1 }}
              className="text-accent tap inline-flex items-center justify-center font-medium underline underline-offset-4"
            >
              {segment.text}
            </button>
          ),
        );
  return (
    <MarkdownText
      text={answer}
      headingBase={3}
      leaf={leaf}
      className="text-muted flex flex-col gap-3 text-sm leading-relaxed"
    />
  );
}
