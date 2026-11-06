/**
 * Audit #41 (2026-11-06): eight user-facing sentences that were true when
 * written and went stale underneath. Each is pinned here against the thing
 * that made it false — the panel, the constant, the runner's rule — rather
 * than only against its old words, so a new synonym of the same claim fails
 * too wherever a relationship can be stated.
 *
 * The two panel sentences (Chat with PDF's context note, the PDF/A panel's
 * description) are rendered and pinned in their panels' own test files.
 */
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { getToolContent } from "@/lib/tools/content";
import { getGuideBySlug } from "@/lib/guides";
import { CROP_KEEPS_CONTENT } from "@/lib/pdf/crop-disclosure";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import { LARGE_RASTER_PAGES, defaultResolution } from "@/lib/intent/defaults";
import {
  DEFAULT_RESOLUTION_ID,
  RASTER_RESOLUTIONS,
  resolutionById,
} from "@/lib/pdf/pdf-to-image";

function served(slug: string): string {
  const c = getToolContent(slug);
  if (!c) throw new Error(`no content for ${slug}`);
  return JSON.stringify(c);
}

describe("audit #41 — stale user-facing claims", () => {
  it("Word to PDF's FAQ does not deny the upload area the panel always renders", () => {
    const faq = getToolContent("word-to-pdf")!.faqs;
    // Health check: the FAQ is there to be read.
    expect(faq.length).toBeGreaterThan(3);
    for (const { q, a } of faq) {
      expect(`${q} ${a}`).not.toMatch(/no (upload|drop) (area|zone|box)/i);
    }
    // The question the old one was really answering: why the button is off.
    expect(faq.some(({ q }) => /Convert to PDF.*greyed out/i.test(q))).toBe(
      true,
    );
  });

  it("PDF to Word's catalogue description sends scans to the in-job OCR option, not to a separate pass", () => {
    const description = getToolBySlug("pdf-to-word")!.description;
    expect(description).not.toMatch(/need OCR first/i);
    expect(description).toContain(WORD_OCR_LABEL);
  });

  it("Crop's hidden-not-deleted disclosure talks about cropping, not splitting", () => {
    expect(CROP_KEEPS_CONTENT).toContain("Redact PDF");
    expect(CROP_KEEPS_CONTENT).not.toMatch(/split/i);
  });

  it("Redact's no-upload answer names no server", () => {
    const answer = getToolContent("redact-pdf")!.faqs.find(({ q }) =>
      /uploaded/i.test(q),
    );
    expect(answer, "the no-upload FAQ exists").toBeDefined();
    expect(answer!.a).toMatch(/^No\./);
    expect(answer!.a).not.toMatch(/server/i);
    expect(answer!.a).toMatch(/pdf\.js library/);
  });

  it.each(["pdf-to-jpg", "pdf-to-png"])(
    "%s says which resolution a long PDF and a returning reader start at",
    (slug) => {
      const text = served(slug);
      const standard = resolutionById(DEFAULT_RESOLUTION_ID);
      const long = defaultResolution(
        LARGE_RASTER_PAGES + 1,
        RASTER_RESOLUTIONS,
      );
      // Positive control: the runner really does switch for a long PDF, and
      // to a different preset than the default — otherwise there is nothing
      // to say and this test would be vacuous.
      expect(long).not.toBeNull();
      expect(long!.id).not.toBe(standard.id);
      const longLabel = resolutionById(long!.id).label;
      expect(text).toContain(`${LARGE_RASTER_PAGES} pages`);
      expect(text).toContain(longLabel);
      expect(text).toMatch(/remember/i);
      // The old unconditional claims.
      expect(text).not.toMatch(/selected at the start\./);
      expect(text).not.toMatch(/\bis preselected\b/);
    },
  );

  it("the repair guide does not promise the notice names what was reconstructed", () => {
    const guide = getGuideBySlug("how-to-repair-a-damaged-pdf")!;
    const text = JSON.stringify(guide);
    expect(text).not.toMatch(/names what (was|had to be) reconstructed/i);
    // A rebuild can come back with no list (qpdf exit 3, empty stderr).
    expect(text).not.toMatch(/needed no reconstruction comes back without/i);
    // What the tool page says instead: no notice is not a clean bill.
    expect(text).toMatch(/qpdf/);
    expect(text).toMatch(/does not mean the file is (guaranteed )?intact/i);
  });
});
