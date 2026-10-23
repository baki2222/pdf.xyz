import type { Tool } from "./types";

/**
 * A tool card's one-line summary: the authored `cardSummary` where the
 * tagline is a specialist's, else the tagline. Every card renders this and
 * the claim guards (`claims-vs-capability`, `capability-hedges`) read it, so
 * a summary is held to the same capability facts as the tagline it replaces.
 *
 * Its own module, importing nothing but a type: the card renders inside the
 * /tools explorer, a client component, and `./page-copy` (which re-exports
 * this) imports the authored content and the worker constants it carries —
 * imported from there, the card shipped all of it, pdf-lib included, to
 * /tools (bundle-budget and lazy-chunks, 2026-10-23).
 */
export function cardSummary(tool: Tool): string {
  return tool.cardSummary ?? tool.tagline;
}
