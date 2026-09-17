/**
 * The guides catalogue's shapes. A guide is long-form, indexable instruction
 * for one primary tool (plus the neighbours a reader doing that task needs),
 * rendered at /guides/[slug] and shipped to crawlers as HowTo + FAQPage
 * JSON-LD — the channel that once carried fabricated pricing, which is why
 * this catalogue registers into the same copy walls as the tool catalogue
 * (copy-surface, the numbers census, legal-pages' overclaim scan).
 */

export interface GuideSection {
  /** In-page anchor id — kebab-case, unique within the guide. */
  readonly id: string;
  readonly heading: string;
  /** Paragraphs. */
  readonly body: readonly string[];
}

export interface GuideFaqEntry {
  readonly question: string;
  readonly answer: string;
}

export interface Guide {
  /** URL slug: /guides/[slug] */
  readonly slug: string;
  /** Natural-language how-to title; doubles as the <title> and the H1. */
  readonly title: string;
  /** Meta description — SERP ceiling-bounded by the catalogue test. */
  readonly description: string;
  /**
   * Tool slugs this guide teaches. The FIRST is the primary — the tool the
   * steps walk through; the rest are the neighbours the article links. Every
   * entry must resolve in the tools catalogue (pinned by the catalogue test),
   * and the tool page's Guides band DISCOVERS its guides through this field —
   * the relationship is the link, never a hand-typed list of hrefs.
   */
  readonly tools: readonly string[];
  readonly keywords: readonly string[];
  /** Lead paragraphs. */
  readonly intro: readonly string[];
  /**
   * Imperative steps — the numbered list on the page AND the HowTo JSON-LD.
   * For a primary tool that runs in the browser these never claim an upload;
   * for a worker/AI primary they must be free to — the same per-capability
   * scoping structured-steps.test.ts enforces for the tool catalogue.
   */
  readonly steps: readonly string[];
  readonly sections: readonly GuideSection[];
  readonly faq: readonly GuideFaqEntry[];
  /** ISO date (yyyy-mm-dd) this guide first shipped. */
  readonly published: string;
  /** ISO date (yyyy-mm-dd) of the last substantive edit. */
  readonly updated: string;
}
