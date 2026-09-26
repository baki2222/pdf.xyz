// @vitest-environment node
/**
 * The count a per-call AI panel declares — and, just as load-bearing, when it
 * declares nothing.
 *
 * The contract refuses a declaration of 0 (`parseCreateJobRequest`), so a panel
 * that sent the raw count of a scanned PDF would turn a job that works today
 * into a 400. And a panel that threw on a file pdfjs cannot open would refuse a
 * document the worker could read. Both must fall back to "undeclared", which
 * costs what every run cost before counting existed.
 */
import { describe, expect, it } from "vitest";
import { parseCreateJobRequest } from "@/lib/jobs";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { countDeclaredCharacters } from "./ai-declared-characters";

function extraction(characterCount: number): ExtractedPdfText {
  const text = "x".repeat(characterCount);
  return {
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount }],
    text,
    characterCount,
    hasText: characterCount > 0,
  };
}

const BYTES = new Uint8Array([1, 2, 3]);

describe("countDeclaredCharacters", () => {
  it("declares the extractor's own character count", async () => {
    expect(
      await countDeclaredCharacters(BYTES, async () => extraction(1_837)),
    ).toBe(1_837);
  });

  it("declares nothing for a document with no selectable text", async () => {
    expect(
      await countDeclaredCharacters(BYTES, async () => extraction(0)),
    ).toBeNull();
  });

  it("declares nothing when the browser cannot read the file", async () => {
    expect(
      await countDeclaredCharacters(BYTES, async () => {
        throw new Error("Invalid PDF structure");
      }),
    ).toBeNull();
  });

  it("only ever produces a value the contract accepts", async () => {
    // The relationship, not the cases: whatever this returns must parse, or a
    // readable document is refused before the worker sees it.
    for (const count of [0, 1, 1_837, 500_000]) {
      const declared = await countDeclaredCharacters(BYTES, async () =>
        extraction(count),
      );
      const parsed = parseCreateJobRequest({
        tool: "summarize-pdf",
        inputs: ["f_abc123def456"],
        options: { length: "brief", format: "paragraphs" },
        ...(declared === null ? {} : { declaredCharacters: declared }),
      });
      expect(parsed.ok, `a count of ${count} produced a refused job`).toBe(
        true,
      );
    }
  });
});
