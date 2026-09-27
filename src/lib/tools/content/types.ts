/**
 * Search-facing content for ONE tool page: the words that let a page rank for
 * its intent and answer the searcher before they have to ask.
 *
 * Why this exists (audit, 2026-09-27): every tool page was the same template
 * with the tool's name swapped in — 250–700 words, sibling pages sharing up to
 * 70% of their text, titles that were the bare tool name ("Organize Pages —
 * pdf.xyz", which does not even contain "PDF"). Search Console over 90 days:
 * 4 clicks. Google cannot rank a page that says nothing its siblings don't.
 *
 * Every string here is USER-FACING COPY and is held to the same honesty rules
 * as the rest of the site: a number is interpolated from the constant that
 * owns it, a capability is stated only if the code has it, and where a file
 * goes (this browser, the secure worker, an AI provider) is stated exactly.
 */
export interface ToolContent {
  /** Must equal the catalogue slug of the tool this file describes. */
  slug: string;

  /**
   * The page `<title>` WITHOUT the site suffix (the layout template appends
   * " — pdf.xyz"). Keyword-first, matches how people search, and at most 50
   * characters so the full title stays near 60.
   */
  seoTitle: string;

  /**
   * The meta description: 120–160 characters, unique to this tool, true,
   * and giving a reason to click (what is different here).
   */
  metaDescription: string;

  /**
   * Two or three short paragraphs of genuinely tool-specific explanation:
   * what it does, when you would reach for it, and how this implementation
   * behaves (where it runs, what it keeps and drops, its real limits).
   */
  intro: string[];

  /** Three to six concrete situations people use this tool for. */
  useCases: { title: string; body: string }[];

  /**
   * Three to five steps that match the ACTUAL controls on the page (button
   * labels as they appear). Used for the "How it works" section and the
   * HowTo structured data, so it must never describe UI that does not exist.
   */
  steps: { title: string; body: string }[];

  /**
   * Four to six questions a searcher genuinely asks about this task, each
   * answered truthfully from the implementation. Used for the FAQ section and
   * the FAQPage structured data.
   */
  faqs: { q: string; a: string }[];

  /** Guide slugs (from `@/lib/guides`) that genuinely cover this tool. */
  relatedGuides: string[];
}
