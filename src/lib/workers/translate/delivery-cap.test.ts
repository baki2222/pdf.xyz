// @vitest-environment node
/**
 * A job delivers what it reserved, and says which bound stopped it.
 *
 * The allowance is charged in characters against a count the CLIENT supplies.
 * A claim is not a measurement — a browser can send `1` and a twelve-page
 * document — so **without this the reservation is decorative, and decorative is
 * worse than absent because it looks enforced.**
 *
 * The cut also has to be VISIBLE and has to NAME ITS BOUND. A translation that
 * stops early and says nothing is this feature's signature failure: fluent,
 * plausible, complete-looking, and short. And the two bounds fail for different
 * reasons — `characters` rests on a chosen headroom multiplier that could be too
 * small for some real page geometry, `pages` is exact and binds only when the
 * document is not the document that was declared — so a cut that does not say
 * which one it hit hides the only evidence that the constant is wrong.
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { runTranslate, type PdfTextExtractor } from "./engine";

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};
const INPUT = new Uint8Array([1, 2, 3, 4]);

/** Characters per page in every fixture below, so the arithmetic is readable. */
const PAGE_CHARS = 2_000;

/**
 * An extractor with real per-page structure.
 *
 * Page structure is what makes the plan (and therefore the cap) possible at
 * all — `pageTextChunks` is what the engine splits on — so a fixture with
 * `pages: []` would exercise the unchunked path and prove nothing about either
 * bound.
 */
function pagedExtractor(pageCount: number): PdfTextExtractor {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1,
    text: `p${i + 1} `.padEnd(PAGE_CHARS, "x"),
    characterCount: PAGE_CHARS,
  }));
  const text = pages.map((p) => p.text).join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
  return vi.fn(async () => extracted);
}

function countingProvider(): AiProvider & { calls: number } {
  const provider = {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls: 0,
    async complete(): Promise<AiCompletionResult> {
      provider.calls += 1;
      return {
        ok: true,
        text: `translated part ${provider.calls}`,
        model: "claude-sonnet-5",
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    },
  };
  return provider;
}

async function translationText(output: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(output);
  const file = zip.file("translation.md");
  expect(file, "the package has no translation.md").not.toBeNull();
  return file!.async("string");
}

describe("the delivery cap", () => {
  it("stops at the characters the job reserved, and says so in the document", async () => {
    // Twelve pages of 2,000 characters is 24,000; a job that reserved 9,000 has
    // paid for four of them. The fifth must not be translated, and the reader
    // must be told at the point where it is missing.
    const provider = countingProvider();
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: pagedExtractor(12),
      provider,
      limits: { delivery: { characters: 9_000 } },
    });

    expect(run.ok, run.ok ? "" : `run failed: ${run.message}`).toBe(true);
    if (!run.ok) return;

    const text = await translationText(run.output);
    expect(
      text,
      "the cut is not in the document, so a short translation reads as a complete one",
    ).toContain("not translated");
    expect(
      text,
      "the cut does not name the bound, so nobody can tell an exhausted " +
        "reservation from an under-declared document",
    ).toContain("reserved");
    expect(text).toContain("9,000");
    // Pages 5–12 are the ones the reservation did not cover.
    expect(text).toContain("Pages 5–12");
  });

  it("stops at the pages the job declared, and names THAT bound instead", async () => {
    // Characters are generous here (a whole document's worth) so only the page
    // bound can bind. If the message named characters, the two bounds would be
    // indistinguishable to the reader and the diagnostic value would be nil.
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: pagedExtractor(12),
      provider: countingProvider(),
      limits: { delivery: { characters: 1_000_000, pages: 3 } },
    });

    expect(run.ok, run.ok ? "" : `run failed: ${run.message}`).toBe(true);
    if (!run.ok) return;

    const text = await translationText(run.output);
    expect(text).toContain("Pages 4–12");
    expect(
      text,
      "a page-bound cut was described as a character-bound one",
    ).not.toContain("reserved enough of the daily allowance");
    expect(text).toContain("3 pages");
  });

  it("never spends a provider call on a page it will not deliver", async () => {
    // The cap is a COST control. Translating four pages and then discarding
    // them would enforce the artifact and not the spend, which is the half that
    // matters — and it would do it invisibly, since the output would look right.
    const provider = countingProvider();
    await runTranslate(INPUT, OPTIONS, {
      extract: pagedExtractor(12),
      provider,
      limits: { delivery: { characters: 9_000 } },
    });
    // 9,000 characters is four 2,000-character pages, and the per-call ceiling
    // (10,258) packs up to five pages per call — so one call, never twelve.
    expect(
      provider.calls,
      "the engine paid the provider for pages the cap withholds",
    ).toBe(1);
  });

  it("refuses honestly when the reservation covers no page at all", async () => {
    // The liar's case: declare one character, upload twelve pages. A package
    // containing nothing but an apology is not a deliverable, and charging for
    // it would be worse than the refusal.
    const provider = countingProvider();
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: pagedExtractor(12),
      provider,
      limits: { delivery: { characters: 4 } },
    });

    expect(run.ok, "a job that could deliver nothing produced a package").toBe(
      false,
    );
    if (run.ok) return;
    expect(run.retryable).toBe(false);
    expect(
      provider.calls,
      "the engine called the provider for a job it could not deliver",
    ).toBe(0);
  });

  it("CONTROL: with no cap the whole document is still delivered", async () => {
    // The default path is every job queued before this field existed and every
    // non-AI caller. If this went red the cap would have become mandatory by
    // accident — and an absent cap reading as zero is the one failure mode that
    // would take the tool down entirely.
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: pagedExtractor(12),
      provider: countingProvider(),
      limits: {},
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const text = await translationText(run.output);
    expect(
      text,
      "an uncapped job was truncated, so absent read as zero somewhere",
    ).not.toContain("not translated");
  });

  it("CONTROL: a cap the document fits inside changes nothing", async () => {
    // The honest caller. Twelve pages of 2,000 characters against a reservation
    // that covers all of them must be indistinguishable from no cap at all —
    // otherwise the cap would be taxing the people it exists to protect.
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: pagedExtractor(12),
      provider: countingProvider(),
      limits: { delivery: { characters: 24_000, pages: 12 } },
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const text = await translationText(run.output);
    expect(
      text,
      "an honest document that fits its reservation was still cut",
    ).not.toContain("not translated");
  });

  it("HEALTH CHECK: the fixture really does exceed the caps above", async () => {
    // Every assertion in this file rests on the fixture being bigger than the
    // caps it is measured against. If the pages shrank, the truncation tests
    // would pass by delivering everything and asserting nothing — the strongest
    // possible green over an empty question.
    const extract = pagedExtractor(12);
    const extracted = await extract(INPUT);
    expect(extracted.pages).toHaveLength(12);
    expect(extracted.pages[0]!.text.length).toBe(PAGE_CHARS);
    expect(
      extracted.pages.reduce((n, p) => n + p.text.length, 0),
      "the fixture no longer exceeds the 9,000-character cap under test",
    ).toBeGreaterThan(9_000);
  });
});
