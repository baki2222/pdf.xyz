import { describe, expect, it } from "vitest";
import jpg from "./content/jpg-to-pdf";
import png from "./content/png-to-pdf";
import { IMAGE_ROTATION_LABELS } from "@/lib/pdf/image-rotation";
import {
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
    expect(text(content)).toMatch(
      /Fit to image[^.]*resolution saved in the[^.]*300 dpi scan of an A4 sheet[^.]*A4 page/,
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
