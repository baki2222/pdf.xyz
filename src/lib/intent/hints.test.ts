// @vitest-environment node
/**
 * The preflight hint table (redesign E.9), held row by row: each row fires on
 * its fixture and stays silent on a control that differs from the fixture in
 * the one fact the row is about — so a row that fired on everything, or on
 * nothing, is caught by the half that should not have changed.
 *
 * The corpus is the spec's table, typed here once ({@link E9}), and the
 * module's own table is held to it both ways: a row the module adds that the
 * spec does not name fails, and so does a spec row the module dropped.
 */
import { describe, expect, it } from "vitest";
import type { PdfProbe } from "@/lib/pdf/probe-result";
import { getToolBySlug } from "@/lib/tools";
import { HINT_TOOLS, hintFor, hintNeedFor, type HintReason } from "./hints";

function probe(over: Partial<PdfProbe> = {}): PdfProbe {
  return {
    read: "ok",
    lock: "none",
    pages: 3,
    formFields: 0,
    sample: ["text", "text", "text"],
    ...over,
  };
}

/** E.9, as written: which tools, on which condition. */
const E9: Record<HintReason, readonly string[]> = {
  "image-only": ["pdf-to-text", "pdf-to-markdown", "compare-pdf"],
  "form-fields": ["sign-pdf", "edit-pdf", "annotate-pdf"],
};

/** Each condition's fixture, and its control: the same file, minus the fact. */
const FIXTURE: Record<HintReason, { on: PdfProbe; off: PdfProbe[] }> = {
  "image-only": {
    on: probe({ sample: ["image-only", "image-only", "image-only"] }),
    off: [
      // One page with text: the claim names pages 1–3, so it cannot hold.
      probe({ sample: ["image-only", "text", "image-only"] }),
      // A page the probe could not classify is a doubt, and doubt is silent.
      probe({ sample: ["image-only", "unknown", "image-only"] }),
      probe({ sample: [] }),
      probe(),
    ],
  },
  "form-fields": {
    on: probe({ formFields: 4 }),
    off: [probe({ formFields: 0 }), probe({ formFields: null })],
  },
};

const REASONS = Object.keys(E9) as HintReason[];

describe("hintFor: every row of E.9 fires on its fixture and not on its control", () => {
  for (const reason of REASONS)
    for (const slug of E9[reason])
      it(`${slug} · ${reason}`, () => {
        const hint = hintFor(slug, FIXTURE[reason].on);
        expect(hint, "fixture").not.toBeNull();
        expect(hint!.reason).toBe(reason);
        for (const control of FIXTURE[reason].off)
          expect(hintFor(slug, control), JSON.stringify(control)).toBeNull();
      });

  it("the module's table is the spec's, both ways", () => {
    const fromModule = Object.fromEntries(
      REASONS.map((r) => [
        r,
        [...HINT_TOOLS].filter(([, x]) => x === r).map(([slug]) => slug),
      ]),
    );
    expect(fromModule).toEqual(
      Object.fromEntries(REASONS.map((r) => [r, [...E9[r]]])),
    );
    // Health: the corpus is the size the spec's table is.
    expect(HINT_TOOLS.size).toBe(6);
    for (const slug of HINT_TOOLS.keys())
      expect(getToolBySlug(slug), slug).toBeDefined();
  });

  it("a tool outside a row stays silent on that row's fixture", () => {
    for (const reason of REASONS) {
      expect(hintFor("rotate-pdf", FIXTURE[reason].on)).toBeNull();
      const other = REASONS.find((r) => r !== reason)!;
      for (const slug of E9[other])
        expect(hintFor(slug, FIXTURE[reason].on), slug).toBeNull();
    }
  });

  it("a locked or unread file gets no hint: its facts were not read", () => {
    const scanAndForm = {
      sample: ["image-only"] as const,
      formFields: 4,
    };
    for (const over of [
      { lock: "restricted" as const },
      { lock: "password-required" as const },
      { read: "too-large" as const },
      { read: "unreadable" as const },
    ]) {
      expect(hintFor("pdf-to-text", probe({ ...scanAndForm, ...over }))).toBe(
        null,
      );
      expect(hintFor("sign-pdf", probe({ ...scanAndForm, ...over }))).toBe(
        null,
      );
    }
    expect(hintFor("pdf-to-text", null)).toBeNull();
    expect(hintFor("pdf-to-text", undefined)).toBeNull();
  });
});

describe("the hint's words", () => {
  it("say the spec's sentence, with the probe's own numbers", () => {
    expect(hintFor("pdf-to-text", FIXTURE["image-only"].on)!.text).toBe(
      "No selectable text on pages 1–3 — OCR PDF makes it searchable first",
    );
    expect(
      hintFor("pdf-to-text", probe({ pages: 1, sample: ["image-only"] }))!.text,
    ).toBe("No selectable text on page 1 — OCR PDF makes it searchable first");
    expect(hintFor("sign-pdf", FIXTURE["form-fields"].on)!.text).toBe(
      "This PDF has 4 fillable fields — Fill Forms keeps them fillable",
    );
    expect(hintFor("edit-pdf", probe({ formFields: 1 }))!.text).toBe(
      "This PDF has 1 fillable field — Fill Forms keeps it fillable",
    );
  });

  it("send the file to the tool the sentence names", () => {
    expect(hintFor("compare-pdf", FIXTURE["image-only"].on)!.toolSlug).toBe(
      "ocr-pdf",
    );
    expect(hintFor("annotate-pdf", FIXTURE["form-fields"].on)!.toolSlug).toBe(
      "fill-forms",
    );
  });
});

describe("hintNeedFor: what the probe must read, per tool", () => {
  it("is the row's condition, or nothing for a tool with no row", () => {
    for (const reason of REASONS)
      for (const slug of E9[reason]) expect(hintNeedFor(slug)).toBe(reason);
    expect(hintNeedFor("rotate-pdf")).toBeNull();
    expect(hintNeedFor("")).toBeNull();
  });
});
