import { describe, expect, it } from "vitest";
import { ANNOTATION_GROUPS } from "@/lib/pdf/annotation-groups";
import { flattenPdf } from "@/lib/pdf/flatten";
import { inventoryAnnotations } from "@/lib/pdf/remove-annotations";
import { FULL_FIXTURE_GROUPS, fullFixture } from "@/tests/annotation-fixtures";
import { getToolBySlug } from "@/lib/tools";
import { toolContent } from "./content";

/**
 * Flatten PDF and Remove Annotations describe each other, and each sends a
 * reader to the other. Both descriptions rest on ONE behaviour: Flatten
 * works on form fields only and leaves every other annotation in the file.
 * So that behaviour is checked on Flatten's real engine, against Remove
 * Annotations' inventory, beside the sentences that state it — if Flatten
 * ever starts removing comments, both pages are wrong and this goes red.
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

  it("each page says so, names the other, and links it in its visible three", () => {
    expect(prose("remove-annotations")).toMatch(
      /Flatten PDF works on form fields only/,
    );
    expect(prose("flatten-pdf")).toMatch(
      /Only fillable AcroForm fields are flattened/,
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
