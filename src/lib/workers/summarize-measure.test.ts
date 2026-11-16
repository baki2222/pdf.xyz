/**
 * `judgeSummarizeRun`: one extraction decides the refusals, the pages sent
 * and the declared count (competitor audit summarize-pdf#5).
 *
 * The whole-document row is held to `countDeclaredCharacters` — the function
 * the panel declared with until 2026-11-16 — over every shape it has a rule
 * for, so the merge into one parse cannot change a whole-document price.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { selectExtraction } from "@/lib/pdf/page-selection";
import { countDeclaredCharacters } from "./ai-declared-characters";
import { judgeSummarizeRun, type SummarizeChoice } from "./summarize-measure";

/** Built from a code point (house rule). */
const EN = String.fromCharCode(0x2013);

function doc(texts: string[]): ExtractedPdfText {
  const pages = texts.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const text = texts.filter((t) => t.length > 0).join("\n\n");
  return {
    pageCount: texts.length,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

const judge = (extracted: ExtractedPdfText, choice: SummarizeChoice) =>
  judgeSummarizeRun({ ok: true, extracted, select: selectExtraction }, choice);

describe("judgeSummarizeRun: the whole document is priced exactly as before", () => {
  const ROWS: [string, ExtractedPdfText][] = [
    ["one page", doc(["Hello world."])],
    ["a blank page between", doc(["Alpha.", "", "Gamma page three."])],
    ["many pages", doc(Array.from({ length: 40 }, (_, i) => `Page ${i}.`))],
    // A count pdfjs could not make as a positive integer: undeclared.
    ["a fractional count", { ...doc(["Text."]), characterCount: 4.5 }],
  ];
  it("health: the corpus has rows", () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(4);
  });
  it.each(ROWS)("%s", async (_name, extracted) => {
    const verdict = judge(extracted, { kind: "whole" });
    expect(verdict).toEqual({
      ok: true,
      declaredCharacters: await countDeclaredCharacters(
        new Uint8Array(),
        async () => extracted,
      ),
    });
  });
});

describe("judgeSummarizeRun: chosen pages", () => {
  const four = doc(["Alpha.", "", "Gamma is longer.", "Delta."]);

  it("typed pages give canonical spans and the selection's own count", () => {
    expect(judge(four, { kind: "pages", text: "4, 3" })).toEqual({
      ok: true,
      declaredCharacters: selectExtraction(four, [[3, 4]]).characterCount,
      pages: [[3, 4]],
    });
  });

  it("a blank page between chosen pages stays inside one span (pages are physical)", () => {
    const v = judge(four, { kind: "pages", text: "1-3" });
    expect(v).toMatchObject({ ok: true, pages: [[1, 3]] });
  });

  it("every page is the whole document: no pages, the whole count", () => {
    expect(judge(four, { kind: "pages", text: "1-4" })).toEqual(
      judge(four, { kind: "whole" }),
    );
    expect(judge(four, { kind: "span", span: [1, 4] })).toEqual(
      judge(four, { kind: "whole" }),
    );
  });

  it("refusals, each before upload", () => {
    const refused = (choice: SummarizeChoice) => {
      const v = judge(four, choice);
      if (v.ok) throw new Error("accepted");
      expect(v.message.endsWith("Nothing was uploaded.")).toBe(true);
      return v;
    };
    expect(refused({ kind: "pages", text: "9" }).message).toMatch(
      /This PDF has 4 pages/,
    );
    expect(refused({ kind: "pages", text: "" }).code).toBe("invalid_request");
    expect(refused({ kind: "pages", text: "2" }).code).toBe("pdf_no_text");
    expect(refused({ kind: "span", span: [3, 5] }).message).toBe(
      `This PDF has 4 pages, so pages 3${EN}5 cannot be summarized. Nothing was uploaded.`,
    );
    const fifty = doc(Array.from({ length: 50 }, (_, i) => `p${i + 1}`));
    const odd = Array.from({ length: 21 }, (_, i) => `${2 * i + 1}`).join(",");
    const many = judge(fifty, { kind: "pages", text: odd });
    expect(many).toMatchObject({
      ok: false,
      message: "Choose at most 20 separate page ranges. Nothing was uploaded.",
    });
    // Twenty is accepted (the bound, not one short of it).
    const twenty = odd.split(",").slice(0, 20).join(",");
    expect(judge(fifty, { kind: "pages", text: twenty }).ok).toBe(true);
  });

  it("a read that threw is the preflight's refusal, by pdfjs's exception name", () => {
    const error = new Error("x");
    error.name = "PasswordException";
    expect(
      judgeSummarizeRun({ ok: false, error }, { kind: "pages", text: "1" }),
    ).toMatchObject({ ok: false, code: "pdf_password_protected" });
  });
});
