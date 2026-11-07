import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  addPageNumbers,
  DEFAULT_PAGE_NUMBER_FORMAT,
  numberedOutputName,
  PAGE_NUMBER_TOKENS,
  previewPageNumber,
  validatePageNumberFormat,
} from "./page-numbers";
import { applyTokens } from "./stamp";

/** Build a blank multi-page PDF for exercising the stamp helpers. */
async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

describe("page-numbers", () => {
  it("rejects an empty format", () => {
    expect(() => validatePageNumberFormat("   ")).toThrow(PdfEngineError);
    expect(() => validatePageNumberFormat("   ")).toThrow(/format/);
  });

  // Audit #28 (2026-11-06): page numbers pass no date, so applyTokens erased
  // {date} to nothing — "Printed {date} - Page {n}" stamped "Printed  - Page
  // 1" with no warning — and a token from another tool ({p}) printed as is.
  it("refuses a token it cannot fill, naming the ones it can", () => {
    for (const bad of [
      "Printed {date} - Page {n}",
      "Page {p}",
      "{N} of {count}",
      "{date:6}",
    ]) {
      expect(() => validatePageNumberFormat(bad), bad).toThrow(PdfEngineError);
    }
    expect(() => validatePageNumberFormat("Printed {date} {n}")).toThrow(
      /"\{date\}".*\{n\}.*\{total\}/,
    );
    // Positive controls: every token the engine fills, in any case, padded
    // or not, and literal braces that are not a token at all.
    for (const good of [
      "Page {n} of {total}",
      "{PAGE} / {Pages}",
      "{n:6}",
      "{pages:3}",
      "Sheet {n} {1} { } {}",
    ]) {
      expect(() => validatePageNumberFormat(good), good).not.toThrow();
    }
  });

  /**
   * Review of audit #28 (2026-11-06): `PAGE_NUMBER_TOKENS` is a typed list
   * kept beside the fill table it describes (`TOKEN_PATTERNS` in stamp.ts,
   * shared with Header & Footer). Nothing tied the two: a token removed from
   * the table would still be accepted and print as nothing or as typed, the
   * original #28 defect. The table's vocabulary is DISCOVERED from stamp.ts,
   * each discovered token is proven live through `applyTokens`, and then both
   * directions are held: every listed token is filled, every other is refused.
   */
  it("accepts exactly the tokens it fills: PAGE_NUMBER_TOKENS against stamp.ts's fill table", () => {
    const source = readFileSync(new URL("./stamp.ts", import.meta.url), "utf8");
    const table = source.match(/const TOKEN_PATTERNS[\s\S]*?\n\];/)?.[0];
    expect(table, "TOKEN_PATTERNS not found in stamp.ts").toBeDefined();
    const known = [...table!.matchAll(/\\\{(\w+)\\\}/g)].map((m) =>
      m[1]!.toLowerCase(),
    );
    // Bound: n, page, total, pages, date today. A scan that finds fewer than
    // three has stopped reading the table (a lower floor than five, so a
    // token dropped from the table fails on its own name below, not here).
    expect(known.length).toBeGreaterThanOrEqual(3);
    // Health check: each discovered token really is one `applyTokens` fills
    // (given no value, it is erased; an unknown word is left as typed).
    for (const t of known) expect(applyTokens(`{${t}}`, {}), t).toBe("");
    expect(applyTokens("{nonesuch}", {})).toBe("{nonesuch}");

    for (const t of PAGE_NUMBER_TOKENS) {
      expect(known, `{${t}} is listed but stamp.ts cannot fill it`).toContain(
        t,
      );
      for (const format of [`{${t}}`, `{${t.toUpperCase()}}`, `{${t}:3}`]) {
        expect(() => validatePageNumberFormat(format), format).not.toThrow();
        const label = previewPageNumber(format, 2, 5);
        expect(label, format).not.toBe("");
        expect(label, format).not.toMatch(/[{}]/);
      }
    }
    const refused = known.filter(
      (t) => !(PAGE_NUMBER_TOKENS as readonly string[]).includes(t),
    );
    // Positive control for the refusal side: {date} is the one known today.
    expect(refused).toContain("date");
    for (const t of refused) {
      expect(() => validatePageNumberFormat(`Page {n} {${t}}`), t).toThrow(
        PdfEngineError,
      );
    }
  });

  it("previews the label a page will show", () => {
    expect(previewPageNumber(DEFAULT_PAGE_NUMBER_FORMAT, 2, 5)).toBe(
      "Page 2 of 5",
    );
  });

  it("stamps every page while preserving the page count", async () => {
    const input = await blankPdf(3);
    const output = await addPageNumbers(input, { fontSize: 12 });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    // stamping adds content, so the file must grow
    expect(output.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("stamps our creator metadata", async () => {
    const output = await addPageNumbers(await blankPdf(1));
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("can start numbering on a later page without changing page count", async () => {
    const input = await blankPdf(4);
    const output = await addPageNumbers(input, { startPage: 2, startAt: 1 });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(4);
  });

  it("supports every corner position", async () => {
    const input = await blankPdf(1);
    for (const position of [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as const) {
      const output = await addPageNumbers(input, { position });
      const doc = await PDFDocument.load(output);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it("names the download from the source", () => {
    expect(numberedOutputName("report.pdf")).toBe("report-numbered.pdf");
    expect(numberedOutputName("")).toBe("document-numbered.pdf");
  });
});
