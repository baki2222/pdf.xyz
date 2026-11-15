/**
 * Weaving the translated parts and the untranslatable gaps back into one
 * document, in plan order — as STRUCTURED PARTS first, then as Markdown.
 *
 * Moved out of `engine.ts` (2026-11-15) so the same parts can be rendered two
 * ways: `partsToMarkdown` is the ZIP's `translation.md`/`translation.txt` body,
 * byte-for-byte what the engine produced before the move
 * (`package-bytes.characterisation.test.ts` pins five shapes by SHA-256), and
 * `./typeset` draws the same parts as a reflowed PDF. One assembly, two
 * renderers: a PDF that disagreed with the ZIP about which pages are missing
 * would be a second opinion about one document.
 *
 * The gaps are POSITIONED — each one sits where its page sat, between the parts
 * that surround it — rather than listed at the end. A reader who meets a note
 * about page 7 after reading to the end has already believed the document was
 * complete; a reader who meets it in place has not.
 */
import type { DeliveryBound } from "@/lib/jobs/delivery-cap";
import {
  missingPageMarker,
  withheldPagesMarker,
  type DeliveryLimit,
  type TranslatePlan,
} from "./chunking";

/** One translated run of pages, exactly as the model returned it (trimmed). */
export interface TranslationBody {
  readonly kind: "body";
  /** Real page numbers, ascending; empty for an unchunked (single) document. */
  readonly pages: readonly number[];
  readonly text: string;
}

/** A place in the document where pages are NOT translated, and why. */
export type TranslationGap =
  | {
      readonly kind: "gap";
      readonly reason: "oversize";
      readonly pages: readonly number[];
      /** Characters on the page that exceeded one call. */
      readonly characters: number;
    }
  | {
      readonly kind: "gap";
      readonly reason: "interrupted";
      readonly pages: readonly number[];
    }
  | {
      readonly kind: "gap";
      readonly reason: "withheld";
      readonly pages: readonly number[];
      readonly boundBy: DeliveryBound;
      readonly limit: DeliveryLimit;
    };

export type TranslationPart = TranslationBody | TranslationGap;

/** A translated segment, carrying the pages it was made from. */
export interface TranslatedSegment {
  readonly text: string;
  readonly pages: readonly number[];
}

/**
 * The document's parts in reading order.
 *
 * Each body is placed by ITS OWN pages. Before the move, bodies were placed by
 * plan index (`parts[i]` at `plan.chunks[i]`), and `parts` holds only the
 * non-empty translations — so when an early chunk came back empty, every later
 * body slid one chunk earlier and sat under the wrong page. Carrying the pages
 * with the text makes that impossible rather than unlikely; it changes the
 * Markdown only in that case, which the characterisation fixtures do not
 * exercise (and `assembly.test.ts` pins the corrected placement).
 */
export function assembleParts(
  translated: readonly TranslatedSegment[],
  plan: TranslatePlan | null,
  interruptedPages: readonly number[],
  withheld: {
    pages: readonly number[];
    boundBy: DeliveryBound;
    limit: DeliveryLimit;
  } | null,
): TranslationPart[] {
  if (plan === null) {
    return [
      {
        kind: "body",
        pages: [],
        text: translated.map((t) => t.text).join("\n\n"),
      },
    ];
  }
  const placed: { at: number; part: TranslationPart }[] = [];
  for (const t of translated) {
    const at = t.pages[0];
    if (at !== undefined)
      placed.push({ at, part: { kind: "body", pages: t.pages, text: t.text } });
  }
  for (const page of plan.oversize) {
    placed.push({
      at: page.pageNumber,
      part: {
        kind: "gap",
        reason: "oversize",
        pages: [page.pageNumber],
        characters: page.characters,
      },
    });
  }
  if (interruptedPages.length > 0) {
    placed.push({
      at: interruptedPages[0]!,
      part: { kind: "gap", reason: "interrupted", pages: interruptedPages },
    });
  }
  // Positioned like every other gap: at the page where delivery stopped, not
  // appended at the end.
  if (withheld && withheld.pages.length > 0) {
    placed.push({
      at: withheld.pages[0]!,
      part: {
        kind: "gap",
        reason: "withheld",
        pages: withheld.pages,
        boundBy: withheld.boundBy,
        limit: withheld.limit,
      },
    });
  }
  placed.sort((a, b) => a.at - b.at);
  return placed.map((p) => p.part);
}

/** The gap left where a chunk failed part-way through a document. */
export function interruptedNotice(pages: readonly number[]): string {
  const list =
    pages.length === 1
      ? `Page ${pages[0]}`
      : `Pages ${pages[0]}–${pages[pages.length - 1]}`;
  return [
    "",
    `> ⚠️ **${list} could not be translated.**`,
    "> The AI provider stopped part-way through this document. Everything above was translated; this part was not. Try translating the remaining pages again — the rest of this file is unaffected.",
    "",
  ].join("\n");
}

/** The Markdown a gap is written as in the ZIP — the pre-move helpers, unchanged. */
export function gapMarkdown(gap: TranslationGap): string {
  switch (gap.reason) {
    case "oversize":
      return missingPageMarker({
        pageNumber: gap.pages[0]!,
        characters: gap.characters,
      });
    case "interrupted":
      return interruptedNotice(gap.pages);
    case "withheld":
      return withheldPagesMarker(gap.pages, gap.boundBy, gap.limit);
  }
}

/** The translation as one Markdown string: today's `translation.md` body. */
export function partsToMarkdown(parts: readonly TranslationPart[]): string {
  return parts
    .map((p) => (p.kind === "body" ? p.text : gapMarkdown(p)))
    .join("\n\n");
}
