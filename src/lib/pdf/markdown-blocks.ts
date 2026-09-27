/**
 * Every block kind the Markdown to PDF renderer draws, as a runtime list and a
 * LEAF (no imports), so the tool page's "Supported syntax" fact can be built
 * from it without pulling the renderer into every bundle that reads the facts.
 *
 * `markdown-to-pdf.ts` fails to COMPILE if its `MarkdownBlock` union and this
 * list disagree in either direction, so neither can gain or lose a kind alone.
 */
export const MARKDOWN_BLOCK_KINDS = [
  "heading",
  "paragraph",
  "list-item",
  "quote",
  "code",
] as const;

export type MarkdownBlockKind = (typeof MARKDOWN_BLOCK_KINDS)[number];
