"use client";

import { MarkdownText } from "./ai-markdown";
import { citationLeaf } from "./citation-buttons";

export { citationLabel } from "./citation-buttons";

/**
 * The model's answer drawn as formatted Markdown (competitor audit #4,
 * 2026-11-17: the model writes Markdown, and until then its `**` and `-`
 * marks showed), with each `[p.N]` marker that cites a page of THIS file
 * made a button that shows the page (audit #30, chat-with-pdf#3,
 * 2026-11-15).
 *
 * The page shows the answer's text without its Markdown marks; Copy answer,
 * Copy conversation and the .md download carry the answer exactly as the
 * package ships it (`./ai-result-views`). The buttons are `./citation-buttons`
 * (first-load in the panel, which draws the answer plain with them until this
 * chunk arrives), applied run by run of the formatted text, so a button exists
 * for the pages manifest.answer.citedPages lists, with one deliberate
 * exception: a marker inside a link's text stays text, since a button inside
 * a link is two controls in one (chat-answer.test.tsx).
 *
 * Lazy: only the AI result views chunk imports this module.
 *
 * The answer sits in the transcript under the panel's h2, so its shallowest
 * heading is an h3 (outlineBreaks in e2e/ai-markdown.spec.ts reads the served
 * page's outline).
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
  const leaf = citationLeaf(pageCount, onOpen);
  return (
    <MarkdownText
      text={answer}
      headingBase={3}
      leaf={leaf}
      className="text-muted flex flex-col gap-3 text-sm leading-relaxed"
    />
  );
}
