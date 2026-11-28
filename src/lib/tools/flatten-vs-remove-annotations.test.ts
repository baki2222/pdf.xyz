import { describe, expect, it } from "vitest";
import { ANNOTATION_GROUPS } from "@/lib/pdf/annotation-groups";
import { flattenPdf } from "@/lib/pdf/flatten";
import { inventoryAnnotations } from "@/lib/pdf/remove-annotations";
import { FULL_FIXTURE_GROUPS, fullFixture } from "@/tests/annotation-fixtures";
import { getToolBySlug } from "@/lib/tools";
import { FLATTEN_MARKUP_HINT } from "@/components/tools/runner/flatten-markup-copy";
import { toolContent } from "./content";

/**
 * Flatten PDF and Remove Annotations describe each other, and each sends a
 * reader to the other. Both descriptions rest on ONE behaviour: Flatten
 * works on form fields only and leaves every other annotation in the file.
 * So that behaviour is checked on Flatten's real engine, against Remove
 * Annotations' inventory, beside the sentences that state it — if Flatten
 * ever starts removing comments, both pages are wrong and this goes red.
 *
 * Since audit flatten-pdf#3 (2026-11-22) that is the DEFAULT, and the opt-in
 * "Also flatten comments and markup" draws comments into the page. Both
 * halves are checked on the engine, and both pages must say both: the
 * forms-only sentence alone would now be a claim true only of the default.
 */

const prose = (slug: string) => JSON.stringify(toolContent[slug]);

describe("Flatten is forms-only, as both pages say", () => {
  it("Flatten PDF's engine leaves every non-form annotation of the full fixture", async () => {
    const before = await inventoryAnnotations(await fullFixture());
    const flattened = await flattenPdf(await fullFixture());
    const after = await inventoryAnnotations(flattened.bytes);
    expect(before.groups["form-fields"]).toBe(1);
    expect(after.groups["form-fields"]).toBe(0);
    for (const group of ANNOTATION_GROUPS) {
      if (group.id === "form-fields") continue;
      expect(after.groups[group.id], group.id).toBe(
        FULL_FIXTURE_GROUPS[group.id],
      );
    }
  });

  it("with the opt-in, Flatten PDF draws the comments in and removes them; links and the rest stay", async () => {
    const flattened = await flattenPdf(await fullFixture(), {
      annotations: true,
    });
    const after = await inventoryAnnotations(flattened.bytes);
    // Every mark with a saved look is gone from the annotations, drawn in.
    expect(flattened.flattenedAnnotations).toBeGreaterThan(0);
    expect(after.groups.links).toBe(FULL_FIXTURE_GROUPS.links);
    expect(after.groups["form-fields"]).toBe(0);
    // Review finding 1 (2026-11-28): a pending redaction and an attachment
    // carry data, so they stay live; drawn in, the redaction looked applied.
    expect(FULL_FIXTURE_GROUPS["redaction-marks"]).toBeGreaterThan(0);
    expect(after.groups["redaction-marks"]).toBe(
      FULL_FIXTURE_GROUPS["redaction-marks"],
    );
    expect(after.groups.attachments).toBe(FULL_FIXTURE_GROUPS.attachments);
    // Whatever is left is listed, by name, with a reason: nothing vanished.
    const leftCount = ANNOTATION_GROUPS.filter(
      (g) => g.id !== "links" && g.id !== "form-fields",
    ).reduce((n, g) => n + after.groups[g.id], 0);
    expect(leftCount).toBeLessThanOrEqual(flattened.annotationsLeft.length);
  });

  it("each page says so, names the other, and links it in its visible three", () => {
    // Pinned the forms-only sentence alone until 2026-11-22; each page now
    // says forms only BY DEFAULT and names the box that changes it.
    expect(prose("remove-annotations")).toMatch(
      /Flatten PDF works on form fields only, unless you tick its Also flatten comments and markup/,
    );
    expect(prose("flatten-pdf")).toMatch(
      /By default only AcroForm fields are flattened\. Tick Also flatten comments and markup/,
    );
    expect(prose("flatten-pdf")).toContain("Remove Annotations");
    expect(prose("remove-annotations")).toContain("Flatten PDF");
    expect(getToolBySlug("flatten-pdf")!.related?.slice(0, 3)).toContain(
      "remove-annotations",
    );
    expect(getToolBySlug("remove-annotations")!.related?.slice(0, 3)).toContain(
      "flatten-pdf",
    );
  });
});

describe("Flatten PDF's lede and hint follow the comments option (review findings 1 and 5)", () => {
  /** What the served lede (catalog description) shipped until 2026-11-28. */
  const SHIPPED_LEDE = [
    "Flatten a filled PDF form in your browser, so its answers become part of the page and can't be edited. Comments and layers are kept as they are.",
  ];
  const ALWAYS_KEPT = /\bComments(?: and layers)? are (?:always )?kept\b/i;

  it("the ban catches what shipped; the lede now says comments stay unless the box is ticked", () => {
    for (const s of SHIPPED_LEDE) expect(ALWAYS_KEPT.test(s), s).toBe(true);
    const lede = getToolBySlug("flatten-pdf")!.description;
    expect(lede).not.toMatch(ALWAYS_KEPT);
    expect(lede).toMatch(/unless you/);
  });

  it("the page and the box's hint say pending redactions, attachments and media are kept", () => {
    expect(FLATTEN_MARKUP_HINT).toMatch(/redaction/i);
    expect(prose("flatten-pdf")).toMatch(
      /redaction marks not yet applied, attached files and media are kept and listed/i,
    );
  });
});
