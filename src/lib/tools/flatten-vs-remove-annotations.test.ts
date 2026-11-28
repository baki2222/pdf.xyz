import { describe, expect, it } from "vitest";
import { ANNOTATION_GROUPS } from "@/lib/pdf/annotation-groups";
import { flattenPdf } from "@/lib/pdf/flatten";
import { inventoryAnnotations } from "@/lib/pdf/remove-annotations";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  FULL_FIXTURE_GROUPS,
  apStream,
  fullFixture,
} from "@/tests/annotation-fixtures";
import { getToolBySlug, tools } from "@/lib/tools";
import { guides } from "@/lib/guides/catalog";
import { pageFaq } from "./page-copy";
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
    // Verify finding (2026-11-28): the full fixture's Redact and attachment
    // marks had no /AP, so they were kept as "nothing to draw" whether or not
    // the kept-kinds check existed, and the assertions below were decoration.
    // Each gets a saved look here, so only that check keeps them.
    const doc = await PDFDocument.load(await fullFixture());
    let given = 0;
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots"));
      if (!(annots instanceof PDFArray)) continue;
      for (const ref of annots.asArray()) {
        const dict = doc.context.lookup(ref);
        if (!(dict instanceof PDFDict)) continue;
        const kind = dict.lookup(PDFName.of("Subtype"));
        if (
          kind instanceof PDFName &&
          /^\/(Redact|FileAttachment)$/.test(kind.toString())
        ) {
          dict.set(
            PDFName.of("AP"),
            doc.context.obj({ N: apStream(doc.context, "LOOK") }),
          );
          given++;
        }
      }
    }
    expect(given).toBe(
      FULL_FIXTURE_GROUPS["redaction-marks"] + FULL_FIXTURE_GROUPS.attachments,
    );
    const flattened = await flattenPdf(await doc.save(), {
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

  /**
   * Verify finding (2026-11-28): the ban above read ONE named surface (the
   * lede) while the served page also carried tool-facts' FAQ answer, word
   * for word "saved as they were", which the pattern could not match. So the
   * subjects are now DISCOVERED: every string leaf of every tool's catalog
   * entry, authored content and served FAQ (pageFaq, which feeds the visible
   * FAQ and the FAQPage JSON-LD), and of every guide. A block is in scope if
   * it is on Flatten PDF's own page or names Flatten PDF. In scope, a
   * sentence saying comments are kept must sit in a block that names the
   * opt-in; without it the sentence is true only of the default.
   */
  const SHIPPED_KEPT = [
    ...SHIPPED_LEDE,
    // tool-facts.ts factFaq "Does Flatten PDF flatten comments and annotations too?"
    "No — only fillable form fields: text boxes, checkboxes, radio buttons, dropdowns, list boxes and push buttons. Comments, ink drawings and layers are saved as they were.",
    // remove-annotations.ts intro
    "It is not Flatten PDF. Flatten PDF draws a filled form's answers into the page and then removes the fields, and leaves comments as they are.",
    // guides/catalog.ts "Signing and locking the finished form"
    "When the answers are final, Flatten PDF locks the fillable fields into the page itself so their values can no longer be edited, while other annotations and layers are kept as-is.",
  ];
  /** Each alternative is exercised by a shipped sentence (checked below). */
  const KEPT_ALTERNATIVES = [
    /\b(?:comments|annotations|markup|ink drawings|layers|highlights)\b[^.;]*?\b(?:are|is) (?:always )?(?:kept|saved|left)\b/i,
    /\b(?:comments|annotations|markup|highlights)\b[^.;]*?\b(?:stays?|remains?)\b/i,
    /\bleaves?\b[^.;]*?\b(?:comments|annotations|highlights|markup)\b/i,
  ];
  const keptClaim = (s: string) => KEPT_ALTERNATIVES.some((re) => re.test(s));
  const OPT_IN =
    /Also flatten comments and markup|unless you (?:tick|flatten)/i;
  const sentences = (block: string) =>
    block.split(/(?<=[.!?])\s+(?=[A-Z"“])/).filter(Boolean);
  const leaves = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) leaves(v, out);
    else if (value && typeof value === "object")
      for (const v of Object.values(value)) leaves(v, out);
    return out;
  };
  /** Blocks that break the rule: a kept-claim with no opt-in beside it. */
  const offenders = (blocks: readonly string[]) =>
    blocks.filter((b) => !OPT_IN.test(b) && sentences(b).some(keptClaim));

  const flattenPage = (() => {
    const tool = getToolBySlug("flatten-pdf")!;
    return leaves([tool, toolContent["flatten-pdf"], pageFaq(tool)]);
  })();
  const naming = leaves([
    tools.map((t) => [t, toolContent[t.slug], pageFaq(t)]),
    guides,
  ]).filter((b) => /\bFlatten PDF\b/.test(b));
  const inScope = [...new Set([...flattenPage, ...naming])];

  it("the corpus: every shipped sentence is caught, and every alternative catches one", () => {
    for (const s of SHIPPED_KEPT) {
      expect(keptClaim(s), s).toBe(true);
      expect(offenders([s]), s).toEqual([s]);
    }
    for (const re of KEPT_ALTERNATIVES) {
      const hits = [...SHIPPED_KEPT, getToolBySlug("flatten-pdf")!.description]
        .flatMap(sentences)
        .filter((s) => re.test(s));
      expect(hits.length, String(re)).toBeGreaterThan(0);
    }
    // Positive control: the same sentence beside the opt-in passes.
    expect(
      offenders([`${SHIPPED_KEPT[1]} Tick Also flatten comments and markup.`]),
    ).toEqual([]);
  });

  it("the discovered set is the size of the real surfaces", () => {
    // Health checks: an empty or collapsed walk would pass vacuously.
    expect(flattenPage.length).toBeGreaterThan(30);
    expect(naming.length).toBeGreaterThan(10);
    expect(naming.length).toBeLessThan(400);
    // Each surface a verify pass found stale is a member of the set.
    for (const where of [
      (b: string) => b.startsWith("It is not Flatten PDF."),
      (b: string) => /Flatten PDF locks the fillable fields/.test(b),
      (b: string) =>
        pageFaq(getToolBySlug("flatten-pdf")!).some((f) => f.answer === b),
    ])
      expect(inScope.some(where)).toBe(true);
  });

  it("no served block says Flatten PDF keeps comments without naming the opt-in", () => {
    expect(offenders(inScope)).toEqual([]);
  });

  it("the page and the box's hint say pending redactions, attachments and media are kept", () => {
    expect(FLATTEN_MARKUP_HINT).toMatch(/redaction/i);
    expect(prose("flatten-pdf")).toMatch(
      /redaction marks not yet applied, attached files and media are kept and listed/i,
    );
  });
});
