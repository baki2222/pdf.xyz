import { describe, expect, it } from "vitest";
import jpg from "./content/jpg-to-pdf";
import png from "./content/png-to-pdf";
import { IMAGE_ROTATION_LABELS } from "@/lib/pdf/image-rotation";
import {
  A4_SCAN_SETUP_COPY,
  IGNORED_DPI_COPY,
  MAX_PLAUSIBLE_DPI,
  MIN_PLAUSIBLE_DPI,
  PLACEHOLDER_DPIS,
} from "@/lib/pdf/image-density";
import { guides } from "@/lib/guides/catalog";
import {
  SMALL_IMAGES_CHOICES,
  SMALL_IMAGES_LABELS,
} from "@/lib/pdf/image-enlarge";

import {
  CUSTOM_PAGE_COPY,
  CUSTOM_PAGE_LABELS,
  MAX_CUSTOM_MARGIN_PT,
  MAX_CUSTOM_PAGE_PT,
  MIN_CUSTOM_PAGE_PT,
} from "@/lib/pdf/image-page-custom";
import { IMAGE_PAGE_OPTIONS_FACT } from "./tool-facts";
import { undecodableImageMessage } from "@/lib/pdf/image-intake";
import {
  IMAGE_BOOKMARKS_CHOICES,
  IMAGE_BOOKMARKS_LABELS,
  IMAGE_ORDER_LABELS,
} from "@/lib/pdf/image-bookmarks";

const ENLARGE = SMALL_IMAGES_CHOICES.find((c) => c.id === "enlarge")!.label;

/*
 * The claims JPG / PNG to PDF's pages make about the wave-3 controls (audit
 * 2026-11-06, lane w3-l05), each pinned to the constant the runner draws.
 * The behaviour behind each is held by the runner test
 * (image-to-pdf-options.test.tsx) and the engine tests named per block.
 */

/*
 * A claim that EVERY JPG or PNG that cannot be decoded is turned away. False
 * for a JPG: the check reads it only to its header (image-intake.test.ts:
 * "accepts a JPEG cut off after its frame header"). What may be said is what
 * imageDecodes refuses: a damaged, cut-off or animated PNG, or a JPG whose
 * HEADER cannot be read. The corpus is every sentence the lane shipped with
 * the claim; the test below holds it in both directions.
 */
const UNDECODABLE_CLAIMS = [
  /\b(JPG|PNG)s?\b[^.]*\b(cannot|can't|could not) be decoded\b[^.]*\b(never reach|turned away|refused|left out|rejected)/i,
  /\b(JPG|PNG)s?\b[^.]*\bwhose image data (cannot|can't|could not) be read\b/i,
];
const SHIPPED_UNDECODABLE_CLAIMS = [
  // jpg-to-pdf, Create PDF step (6ae74fde)
  "Each file's contents were already checked when you added it, so a PNG saved with a .jpg name simply goes in as a PNG, and a JPG or PNG that cannot be decoded never reached the list.",
  // jpg-to-pdf, add step (6ae74fde)
  "A JPG or PNG is also tried the way Create PDF will use it, so one whose image data cannot be read, such as a PNG cut off halfway or an animated PNG, is turned away with a note naming it.",
  // png-to-pdf, Create PDF step (6ae74fde)
  "A PNG or JPG that cannot be decoded was already turned away when you added it.",
];

describe("the undecodable-image ban list and its corpus", () => {
  it("every shipped claim is caught by some pattern", () => {
    for (const s of SHIPPED_UNDECODABLE_CLAIMS)
      expect(
        UNDECODABLE_CLAIMS.some((re) => re.test(s)),
        s,
      ).toBe(true);
  });

  it("every pattern catches some shipped claim", () => {
    for (const re of UNDECODABLE_CLAIMS)
      expect(
        SHIPPED_UNDECODABLE_CLAIMS.some((s) => re.test(s)),
        String(re),
      ).toBe(true);
  });

  it("the narrowed wording is not caught", () => {
    expect(
      UNDECODABLE_CLAIMS.some((re) =>
        re.test(
          "A PNG that is cut off, damaged or animated, or a JPG whose header cannot be read, is turned away with a note naming it.",
        ),
      ),
    ).toBe(false);
  });
});

const text = (c: typeof jpg) =>
  [
    ...c.intro,
    ...c.useCases.map((u) => u.body),
    ...c.steps.map((s) => s.body),
    ...c.faqs.map((f) => f.a),
  ].join("\n");

describe.each([
  ["jpg-to-pdf", jpg],
  ["png-to-pdf", png],
] as const)("%s · wave-3 copy", (_slug, content) => {
  it("names the card's Rotate button by its label, in the order step", () => {
    const order = content.steps.find((s) => /Image order/.test(s.body));
    expect(order?.body).toContain(`(${IMAGE_ROTATION_LABELS.button})`);
    expect(order?.body).toMatch(/quarter turn clockwise/);
  });

  it("says a stated resolution sizes a Fit to image page, and which are ignored", () => {
    // image-density.test.ts: a 300 dpi A4 scan saved as PNG is an A4 page.
    expect(text(content)).toMatch(/Fit to image[^.]*resolution saved in the/);
    // CHANGED after review, 2026-11-08: the A4 claim held only with no
    // margin, and said so nowhere; a4-scan-claim.test.ts runs the margin.
    expect(text(content)).toContain(
      `${A4_SCAN_SETUP_COPY}, a 300 dpi scan of an A4 sheet saved as a`,
    );
    expect(text(content)).toContain(IGNORED_DPI_COPY);
    // INVERTED 2026-11-08: the PNG page said "Any DPI value stored inside
    // the PNG is ignored", and the JPG source that its DPI "is not read".
    expect(text(content)).not.toMatch(/DPI value stored[^.]*ignored/i);
  });

  it("names Enlarge to fit under Small images, and the default it leaves alone", () => {
    // image-enlarge.test.ts: Enlarge to fit meets the margin; the default
    // keeps a 30 x 20 image at 30 x 20.
    expect(text(content)).toContain(
      `unless you choose ${ENLARGE} under ${SMALL_IMAGES_LABELS.heading}`,
    );
    expect(text(content)).toMatch(/small (images|photos) kept at their size/);
    // INVERTED 2026-11-08: "never enlarged" was true while no choice existed.
    expect(text(content)).not.toMatch(/never enlarged/);
  });

  it("describes the Custom page size and margin, with the engine's limits", () => {
    // image-page-custom.test.ts draws 105 x 148 mm (A6) and 4 x 6 in pages.
    expect(content.intro.join(" ")).toContain(CUSTOM_PAGE_COPY);
    const setup = content.steps.find((s) => /Page size/.test(s.body))!.body;
    expect(setup).toContain(`each end in ${CUSTOM_PAGE_LABELS.chip}`);
  });

  it("names Sort by name and the Bookmarks choice by their labels", () => {
    // image-bookmarks.test.ts: one outline entry per image, file name as
    // its title, none for a single image or the per-image ZIP.
    const all = text(content);
    expect(all).toContain(
      `${IMAGE_ORDER_LABELS.sortByName}, beside the heading`,
    );
    const perImage = IMAGE_BOOKMARKS_CHOICES.find((c) => c.id === "per-image")!;
    expect(all).toContain(
      `${IMAGE_BOOKMARKS_LABELS.heading} chooses None or ${perImage.label}`,
    );
    expect(all).toMatch(/in One PDF of two or more/);
  });

  it("says an undecodable JPG or PNG is turned away as it is added, in the runner's words", () => {
    // image-to-pdf-options.test.tsx adds a cut-off and an animated PNG and
    // reads these words in the alert; image-intake.test.ts holds the engine.
    const add = content.steps[0]!.body;
    expect(add).toMatch(/could not be decoded as a (PNG|JPG) image\./);
    expect(add).toContain(
      _slug === "png-to-pdf"
        ? undecodableImageMessage("chart.png", "png")
        : undecodableImageMessage("photo.jpg", "jpg"),
    );
    // INVERTED 2026-11-08: the PNG page answered "Why did Create PDF fail
    // on a file it accepted?" with the case this check now refuses.
    expect(content.faqs.map((f) => f.q)).not.toContain(
      "Why did Create PDF fail on a file it accepted?",
    );
    // CHANGED after review, 2026-11-08: the PNG FAQ said every damaged or
    // cut-off image is refused, "exactly as Create PDF will embed it". A JPG
    // is read only to its header (image-intake.test.ts: one cut off after
    // its frame header is accepted), and Create PDF embeds a stripped copy.
    expect(text(content)).not.toMatch(/exactly as Create PDF/);
    expect(text(content)).not.toMatch(/damaged or cut-off image/);
  });

  it("claims no undecodable JPG is refused, and states the JPG limit, on both pages", () => {
    // ADDED after review, 2026-11-08: d7e4ef05 narrowed only the PNG FAQ;
    // the JPG page's add and Create PDF steps, and the PNG page's Create PDF
    // step, still said every JPG that cannot be decoded is refused.
    const sentences = text(content).split(/(?<=[.?!])\s+/);
    const claims = sentences.filter((s) =>
      UNDECODABLE_CLAIMS.some((re) => re.test(s)),
    );
    expect(claims).toEqual([]);
    // Positive control: the same split finds the sentence that must be there.
    expect(
      sentences.filter((s) => /JPG cut off after its header is not/.test(s)),
    ).toHaveLength(1);
  });

  it("the PNG FAQ states the JPG limit the check really has", () => {
    if (_slug !== "png-to-pdf") return;
    const faq = content.faqs.find((f) => /turned away/.test(f.q))!.a;
    expect(faq).toMatch(/a JPG whose header cannot be read/);
    expect(faq).toMatch(/JPG cut off after its header/);
  });

  it("no longer sends a sideways image to Rotate PDF after the fact", () => {
    // INVERTED 2026-11-08: the JPG FAQ answered a sideways photo with "open
    // the PDF in Rotate PDF"; the card's own button does it now.
    expect(text(content)).not.toMatch(/open the PDF in Rotate PDF/);
  });
});

describe("the ignored-resolution sentence is the rule's own numbers", () => {
  it("names every placeholder and both bounds", () => {
    for (const d of PLACEHOLDER_DPIS)
      expect(IGNORED_DPI_COPY).toContain(String(d));
    expect(IGNORED_DPI_COPY).toContain(
      MIN_PLAUSIBLE_DPI.toLocaleString("en-US"),
    );
    expect(IGNORED_DPI_COPY).toContain(
      MAX_PLAUSIBLE_DPI.toLocaleString("en-US"),
    );
  });

  it("the PNG and TIFF guides quote it, and no guide still says PNG DPI is ignored", () => {
    const all = JSON.stringify(guides);
    const of = (slug: string) =>
      JSON.stringify(guides.find((g) => g.slug === slug));
    expect(of("how-to-convert-png-to-pdf")).toContain(IGNORED_DPI_COPY);
    expect(of("how-to-convert-tiff-to-pdf")).toContain(IGNORED_DPI_COPY);
    expect(all).not.toMatch(/DPI value stored in the PNG is ignored/);
  });
});

describe("the Custom copy is the limits' own numbers", () => {
  it("states each bound in inches", () => {
    for (const pt of [
      MIN_CUSTOM_PAGE_PT,
      MAX_CUSTOM_PAGE_PT,
      MAX_CUSTOM_MARGIN_PT,
    ])
      expect(CUSTOM_PAGE_COPY).toContain(
        `${(pt / 72).toLocaleString("en-US")} in`,
      );
  });

  it("the Page setup fact offers Custom for both", () => {
    expect(IMAGE_PAGE_OPTIONS_FACT.match(/Custom \(/g)).toHaveLength(2);
  });
});
