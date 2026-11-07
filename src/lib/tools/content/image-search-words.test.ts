// @vitest-environment node
/**
 * JPG to PDF is the site's "image to PDF" page, and its title and meta
 * description say so in the words people search with.
 *
 * Audit search-demand#1 (2026-11-06): the page took JPG, JPEG, PNG, WEBP,
 * GIF, BMP and TIFF, yet served the title "JPG to PDF — Combine Photos in
 * Your Browser" and the description "Combine JPG and JPEG photos into a
 * single PDF…". It under-claimed its own formats in exactly the words
 * searchers type ("image to pdf", "photo to pdf"), and no other page had a
 * title covering images in general.
 *
 * The format rule is a RELATIONSHIP, not a string: every format in the
 * catalogue's `accept` list (JPEG folded into JPG, the same file type) must
 * be named in the description, so widening `accept` again fails here until
 * the snippet catches up. The old description is kept as the control: the
 * predicate must find it short of five formats.
 */
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { getToolContent } from "./index";

/** The formats a description fails to name, case-insensitively. */
function formatsNotNamed(accept: readonly string[], text: string): string[] {
  const named = (format: string) =>
    new RegExp(`\\b${format}\\b`, "i").test(text);
  return accept
    .filter((f) => f !== "JPEG" || !accept.includes("JPG"))
    .filter((f) => !named(f));
}

const OLD_DESCRIPTION =
  "Combine JPG and JPEG photos into a single PDF, a page per photo, arranged as you like. Built in your browser, not uploaded. Up to 25 MB a photo.";

describe("JPG to PDF answers image and photo searches", () => {
  const tool = getToolBySlug("jpg-to-pdf");
  const content = getToolContent("jpg-to-pdf");

  it("has an accept list wide enough to be worth the rule (health check)", () => {
    expect(tool?.accept.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("the predicate catches the description this audit found (positive control)", () => {
    expect(formatsNotNamed(tool!.accept, OLD_DESCRIPTION)).toEqual([
      "PNG",
      "WEBP",
      "GIF",
      "BMP",
      "TIFF",
    ]);
  });

  it("names every accepted format in the meta description", () => {
    expect(formatsNotNamed(tool!.accept, content!.metaDescription)).toEqual([]);
  });

  it("puts 'image' and 'photo' in the title, the words people search with", () => {
    expect(content!.seoTitle).toMatch(/\bimages?\b/i);
    expect(content!.seoTitle).toMatch(/\bphotos?\b/i);
  });
});
