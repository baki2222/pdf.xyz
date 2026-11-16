// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult } from "../ai/provider";
import { runTranslate } from "./engine";
import { assembleParts, partsToMarkdown } from "./assembly";

/**
 * Each translated body sits under ITS OWN pages.
 *
 * FOUND 2026-11-15 while moving the assembly out of `engine.ts`: bodies were
 * placed by plan index (`parts[i]` at `plan.chunks[i]`) while `parts` held only
 * the NON-EMPTY translations. An empty first chunk therefore slid every later
 * body one chunk earlier — chunk 2's translation appeared at page 1, followed
 * by a notice saying pages 1–5 could not be translated. The reflowed PDF heads
 * each section with its page range, which would have printed that wrong number
 * on the page. Observed red on the pre-move engine (fb562946).
 *
 * INVERTED FOR THE ZIP, 2026-11-15 (review r1). The exit property for this
 * branch is that the ZIP at artifacts[0] is byte-identical to main for EVERY
 * job, and this was the one shape where it was not. The corrected placement
 * now feeds the PDF only (`engine.test.ts`, "an empty early chunk"), whose
 * page-range headings need it; the ZIP keeps main's order until the
 * correction is ruled on as its own change. The test below asserted the
 * corrected ZIP order; it now pins main's, and `assembleParts` itself still
 * places by own pages (the last test in this block).
 */
describe("the assembly places each body by its own pages", () => {
  const perPage = "a".repeat(2000);
  const pages = Array.from({ length: 20 }, (_, i) => ({
    pageNumber: i + 1,
    text: perPage,
    characterCount: perPage.length,
  }));
  const joined = pages.map((p) => p.text).join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: 20,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };

  it("the ZIP keeps main's order for an empty first chunk: the second chunk's text, then the gap", async () => {
    let n = 0;
    const run = await runTranslate(
      new Uint8Array([1]),
      { targetLanguage: "fr", sourceLanguage: "auto" },
      {
        extract: async () => extracted,
        provider: {
          id: "anthropic",
          model: "claude-sonnet-5",
          async complete(): Promise<AiCompletionResult> {
            n += 1;
            return {
              ok: true,
              text: n === 1 ? " " : `Partie ${n}`,
              model: "claude-sonnet-5",
            };
          },
        },
      },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const txt = await (
      await JSZip.loadAsync(run.output)
    )
      .file("translation.txt")!
      .async("string");
    const gap = txt.indexOf("could not be translated");
    const second = txt.indexOf("Partie 2");
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(second, "main's ZIP order: chunk 2's text first").toBeLessThan(gap);
  });

  it("partsToMarkdown joins bodies and gap markers in reading order", () => {
    const parts = assembleParts(
      [{ text: "B", pages: [3] }],
      {
        chunks: [
          {
            index: 0,
            pages: [3],
            text: "x",
            characters: 1,
            marked: false,
            markerFallback: null,
          },
        ],
        oversize: [{ pageNumber: 2, characters: 99_999 }],
        pages: [2, 3],
      },
      [],
      null,
    );
    expect(parts.map((p) => p.kind)).toEqual(["gap", "body"]);
    expect(partsToMarkdown(parts)).toMatch(
      /Page 2 is not translated[\s\S]*\n\nB$/,
    );
  });
});
