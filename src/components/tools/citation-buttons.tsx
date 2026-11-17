"use client";

import { Fragment, type ReactNode } from "react";
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
 * How a run of an answer's text is drawn: each `[p.N]` marker that cites a
 * page of THIS file made a button that shows the page (audit #30,
 * chat-with-pdf#3, 2026-11-15), read with the worker's own grammar
 * (`@/lib/jobs/chat-citations`), so a button exists for the pages
 * manifest.answer.citedPages lists. A button's text is the marker itself.
 *
 * With no counted page count, or nothing to open the page from, every marker
 * stays plain text: a button that cannot show its page, or would show another
 * file's, is a promise the panel cannot keep.
 *
 * First-load in the chat panel, and shared with the lazy formatted answer
 * (`./chat-answer`), so the buttons work whether or not the AI result views
 * chunk arrives (review, 2026-11-18: with the chunk refused, the plain answer
 * had lost every button; e2e/ai-markdown.spec.ts refuses it and presses one).
 */
export function citationLeaf(
  pageCount: number | null,
  onOpen: ((page: number) => void) | null,
): (text: string) => ReactNode {
  if (pageCount === null || onOpen === null) return (text) => text;
  return (text) =>
    citationSegments(text, pageCount).map((segment, i) =>
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
}

/**
 * The answer as it is, with its page buttons and no Markdown formatting:
 * what the chat panel draws until the formatted answer's chunk arrives, or
 * if it never does.
 */
export function PlainCitedAnswer({
  answer,
  pageCount,
  onOpen,
}: {
  answer: string;
  pageCount: number | null;
  onOpen: ((page: number) => void) | null;
}) {
  return (
    <p className="text-muted text-sm leading-relaxed whitespace-pre-wrap">
      {citationLeaf(pageCount, onOpen)(answer)}
    </p>
  );
}
