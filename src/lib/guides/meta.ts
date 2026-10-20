/**
 * The four fields of a guide that search reads — the command palette's
 * index and the footer's Guides column — as a projection of the catalogue.
 *
 * Kept apart from `./catalog` on purpose: the catalogue is the whole article
 * set and imports a dozen modules for its figures, and the palette is a lazy
 * chunk with a 12 KB gz budget. `scripts/generate-guide-meta.ts` writes this
 * projection to `./meta.generated.ts`, and `meta.generated.test.ts` fails the
 * moment the two differ. Types only here: importing this module costs nothing.
 *
 * NO DESCRIPTION, though the redesign spec (C.1) listed one. Measured on the
 * first build: the descriptions were 1.1 KB gz of the palette's fetch, which
 * came to 13.07 KB against its 12 KB budget (lazy-chunks.test.ts), and the
 * search weighs a description at 1 against a title's 10 and a keyword's 5 —
 * a guide is found by its title and keywords. Nothing else reads it here.
 */
import type { Guide } from "./types";

export interface GuideMeta {
  readonly slug: string;
  readonly title: string;
  /** The tool the guide's steps walk through: its first `tools` entry. */
  readonly primary: string;
  readonly keywords: readonly string[];
}

/** The catalogue as the palette reads it, in catalogue order. */
export function projectGuideMeta(guides: readonly Guide[]): GuideMeta[] {
  return guides.map((guide) => ({
    slug: guide.slug,
    title: guide.title,
    primary: guide.tools[0] ?? "",
    keywords: [...guide.keywords],
  }));
}
