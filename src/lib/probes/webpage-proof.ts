/**
 * The page the production proof of Webpage to PDF renders, and how it reads
 * the PDF it gets back.
 *
 * ── WHY A PAGE OF OURS (2026-10-09) ─────────────────────────────────────────
 *
 * The proof rendered https://example.com/ and required the text "Example
 * Domain". The site replaced its page: "Example Domain" is now only its
 * `<title>` — which a correct render never prints, because the print header is
 * exactly what the proof checks is ABSENT — and the body says to avoid relying
 * on it for testing. So the proof failed while the worker rendered correctly:
 * its expected text was a fact about someone else's page, typed beside the
 * spec, with nothing to tell it the page had moved.
 *
 * The page is now one we publish and whose text our own source DEFINES: the
 * first guide in the catalogue, at the canonical origin, with its title — the
 * `<h1>` the guide route renders — as the visible text. Renaming, reordering or
 * retitling the guides moves the proof with them; `webpage-proof.test.tsx`
 * renders that route and holds the h1 to this text and the body free of the
 * URL, so the footer check stays a check.
 *
 * ── THE 404 CONTROL ─────────────────────────────────────────────────────────
 *
 * Moved to a guide slug the catalogue does not have. The guide route sets
 * `dynamicParams = false`, so every slug outside `generateStaticParams` is a
 * real 404 — our code, held to that by `webpage-proof.test.tsx` (and measured
 * on production 2026-10-09: 404), rather than the 404 behaviour of a site that
 * has asked not to be relied on. The control asserts the job is REFUSED with
 * the site's status, which does not depend on what the 404 body says.
 */
import { getAllGuideSlugs, getGuideBySlug } from "@/lib/guides";
import { siteConfig } from "@/lib/site";

export interface WebpageProofPage {
  /** The absolute URL the worker is asked to render. */
  readonly url: string;
  /** Text the page's BODY shows — its `<h1>` — and so the rendered PDF must. */
  readonly visible: string;
}

/** The guide the proof renders: the first in the catalogue. */
export function webpageProofPage(): WebpageProofPage {
  const slug = getAllGuideSlugs()[0];
  const guide = slug === undefined ? undefined : getGuideBySlug(slug);
  if (!guide) {
    throw new Error(
      "the guides catalogue is empty, so Webpage to PDF has no page of ours to prove on",
    );
  }
  return {
    url: new URL(`/guides/${guide.slug}`, siteConfig.url).href,
    visible: guide.title,
  };
}

/** A guide slug the catalogue does not have — a 404 on our own origin. */
export const WEBPAGE_PROOF_MISSING_SLUG = "pdfxyz-proof-404";

/** The URL the 404 control asks the worker to render. */
export function webpageProof404Url(): string {
  if (getGuideBySlug(WEBPAGE_PROOF_MISSING_SLUG)) {
    throw new Error(
      `"${WEBPAGE_PROOF_MISSING_SLUG}" is a real guide now, so it is not a 404`,
    );
  }
  return new URL(`/guides/${WEBPAGE_PROOF_MISSING_SLUG}`, siteConfig.url).href;
}

/**
 * Does the text extracted from a rendered PDF show `visible`?
 *
 * Compared with whitespace removed and NFKC-normalised, because a PDF
 * extractor reads a ligature back either as its own code point ("ﬁ") or split
 * by a space ("fi les") — the split was measured on Linux Chromium output on
 * 2026-10-08 (`html-render/print-chrome.ts`), and "How to merge PDF files"
 * has an "fi" in it. Neither changes WHICH words the page shows.
 */
export function pageShowsText(extracted: string, visible: string): boolean {
  const squeeze = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");
  const want = squeeze(visible);
  return want.length > 0 && squeeze(extracted).includes(want);
}
