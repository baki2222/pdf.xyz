import type { IconName } from "@/lib/icons";

/** Top-level tool categories used for navigation and filtering. */
export type ToolCategoryId =
  | "organize"
  | "optimize"
  | "convert-to"
  | "convert-from"
  | "edit"
  | "sign"
  | "security"
  | "ai";

/**
 * Where a tool actually runs. This is surfaced honestly in the UI so users
 * know what leaves their device.
 * - `client`  : runs fully in the browser (files never uploaded)
 * - `server`  : processed on ephemeral, auto-deleting workers
 * - `hybrid`  : client-first; an optional worker step the user starts
 * - `ai`      : the PDF's text is sent to a third-party AI provider
 */
export type ProcessingMode = "client" | "server" | "hybrid" | "ai";

/** Small marketing/status badges shown on tool cards. */
export type ToolBadge = "popular" | "new" | "ai" | "beta";

export interface ToolCategory {
  id: ToolCategoryId;
  name: string;
  short: string;
  description: string;
  icon: IconName;
}

export interface Tool {
  /** URL slug: /tools/[slug] */
  slug: string;
  name: string;
  /**
   * The page's <title> (and social title) when `name` alone misses the query
   * a searcher types — "password protect pdf" for Protect PDF, "pdf" at all
   * for AI Data Extraction. The H1, cards, nav and share-image alt keep `name`.
   * No brand suffix: the root layout's title template adds it. Every word must
   * already appear in this tool's own copy — tool-page-content.test.ts.
   */
  seoTitle?: string;
  /** Short line used on cards. */
  tagline: string;
  /**
   * The home page card's one line, in a first-time visitor's words, where the
   * tagline speaks a specialist's ("linearized", "DOCX", "TL;DR"). Read only
   * through `cardSummary()` in `./page-copy`, which falls back to the
   * tagline; the same claim guards read it as read the tagline, and
   * `card-copy.test.ts` holds its length and its vocabulary.
   */
  cardSummary?: string;
  /** Longer description used on the tool page and meta description. */
  description: string;
  category: ToolCategoryId;
  icon: IconName;
  processing: ProcessingMode;
  /** Search + SEO keywords. */
  keywords: string[];
  badge?: ToolBadge;
  featured?: boolean;
  /** Human-readable accepted input formats, e.g. ["PDF"] or ["DOCX", "DOC"]. */
  accept: string[];
  /** Human-readable output formats, e.g. ["PDF"] or ["DOCX"]. */
  outputs: string[];
  /** Slugs of related tools shown as cross-links. */
  related?: string[];
  /**
   * Where a finished file most often goes next, first — the head of the
   * result's "Continue with" row, ahead of `related` (which also orders the
   * page's Related tools cards, so it cannot be reordered for this). Every
   * entry must be a real continue target for this tool:
   * `next-steps.test.ts` fails one that is not.
   */
  next?: string[];
  /** Optional "how it works" steps for the tool page. */
  how?: string[];
}
