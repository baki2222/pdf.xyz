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
 * - `hybrid`  : client-first with an optional server fallback
 * - `ai`      : uses an AI model on secure infrastructure
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
  /** Tailwind gradient token pair used for accents (from-… to-…). */
  gradient: string;
}

export interface Tool {
  /** URL slug: /tools/[slug] */
  slug: string;
  name: string;
  /** Short line used on cards. */
  tagline: string;
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
  /** Optional "how it works" steps for the tool page. */
  how?: string[];
}
