// @vitest-environment node
/**
 * The `translatePageMap` probe, without Chromium or poppler.
 *
 * The probe runs TWO `translate-pdf` jobs through the executor's order (an
 * echo model and a marker-stripping model) and reads what the model was
 * sent, what the job record persists, the delivered ZIP and the delivered
 * PDF's text. Here the extractor is a stub returning the probe's three pages,
 * the renderer "prints" `typesetText(input)` (the exact runs Chromium is
 * given), and the reader decodes those bytes: so the PDF predicates read the
 * headings and bodies the engine typeset, through the same executor hops.
 * The real binaries are `page-map-capability.chromium.test.ts` and the
 * in-image proof (`scripts/worker-translate-page-map-proof.ts`).
 *
 * Every control asserts the EXACT set in `failed` (sorted `toEqual`, never
 * `toContain` alone, never only `ok === false`), so a check that stopped
 * looking is seen as a set that shrank (CLAUDE.md rule 5: the mutation needs
 * its own health check).
 *
 * MUTATIONS (2026-11-16, each on a scratch copy of `./page-map-capability.ts`,
 * the mutated line grepped back and diffed, then restored and `cmp`-clean):
 *  - `pdf_a`'s predicate always passes: 5 red, among them "a model that drops
 *    the markers in arm A too" (`[control, wire_a]`, not `[control, pdf_a,
 *    wire_a]`); the happy path stays green, as it must;
 *  - `zip_identity` compares arm A's file with itself: exactly 1 red, "arm A
 *    echoes and appends one extra word" (`[]`, not `[zip_identity]`);
 *  - `zip_content` always passes: 3 red, among them "arm A returns nothing"
 *    and "both arms return the same marker-free filler".
 */
import { describe, expect, it } from "vitest";
import { PAGE_JOIN, type ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import type { AiCompletionRequest } from "../ai/provider";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import { pageMarkerClause, type TranslatePdfDeps } from "./engine";
import { markerFor, separatorFor, separatorOverhead } from "./page-markers";
import {
  echoAnswer,
  expectedPageMap,
  headedByPage,
  headedByRange,
  pageMapInvariantsHold,
  pageMapProbeTarget,
  probeTranslatePageMap,
  stripSeparatorsAnswer,
  tokensInOrder,
  type PageMapProbeDeps,
} from "./page-map-capability";
import { PAGE_MAP_PROBE_PAGES, pageMapProbePdf } from "./probe-pdf";
import type { TranslateExtractor } from "./reading-order";
import { typesetText } from "./typeset";

const NL = String.fromCharCode(10);
const EN_DASH = String.fromCharCode(0x2013);
const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** The probe's three pages, as Translate's extractor would read them. */
const stubExtract: TranslateExtractor = async () => {
  const pages = PAGE_MAP_PROBE_PAGES.map((p, i) => ({
    pageNumber: i + 1,
    text: p.text,
    characterCount: p.text.length,
  }));
  const text = pages.map((p) => p.text).join(PAGE_JOIN);
  const extracted: ExtractedPdfText = {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
  return extracted;
};

/** A renderer that "prints" the typeset runs, so the reader sees them. */
function stubPdf(
  languages: ReadonlySet<TranslateLanguage> | null = new Set(["es", "fr"]),
): TranslatePdfDeps {
  return {
    languages: () => languages,
    render: async ({ input }) => ({
      ok: true,
      bytes: encode(`%PDF-1.7${NL}${typesetText(input)}`),
      pages: 1,
    }),
  };
}

const readPdfText = async (bytes: Uint8Array) => decode(bytes);

function deps(over: Partial<PageMapProbeDeps> = {}): PageMapProbeDeps {
  return {
    extract: stubExtract,
    pdf: stubPdf(),
    readPdfText,
    ...over,
  };
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("the page-map probe's pieces", () => {
  it("the probe PDF has three pages, and each token is on exactly one page", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(await pageMapProbePdf());
    expect(doc.getPageCount()).toBe(3);
    const all = PAGE_MAP_PROBE_PAGES.map((p) => p.text).join(NL);
    for (const page of PAGE_MAP_PROBE_PAGES)
      for (const token of page.tokens)
        expect(all.split(token).length - 1, token).toBe(1);
    expect(/pdfxyz/i.test(all.normalize("NFKC"))).toBe(false);
  });

  it("the target is DERIVED: the first CI-required printable language that is not the source", () => {
    expect(pageMapProbeTarget(new Set(["en", "es", "fr"]))).toBe("es");
    // "en" first in the list, and the probe's source: never the target.
    expect(pageMapProbeTarget(new Set(["en"]))).toBeNull();
    expect(pageMapProbeTarget(new Set(["fr", "de"]))).toBe("fr");
    expect(pageMapProbeTarget(new Set())).toBeNull();
    expect(pageMapProbeTarget(null)).toBeNull();
  });

  it("the expected arm-A block charges 21 + 21 = 42 marker characters, and both invariants hold", () => {
    expect(separatorOverhead(2) + separatorOverhead(3)).toBe(42);
    expect(expectedPageMap("a", 3).markerCharacters).toBe(42);
    expect(pageMapInvariantsHold(expectedPageMap("a", 3))).toBe(true);
    expect(pageMapInvariantsHold(expectedPageMap("b", 3))).toBe(true);
    // Control: the invariant predicate can fail.
    const broken = expectedPageMap("a", 3);
    expect(pageMapInvariantsHold({ ...broken, verified: 0 })).toBe(false);
    expect(pageMapInvariantsHold({ ...broken, marked: 0 })).toBe(false);
  });

  it("the strip arm puts every separator back to PAGE_JOIN, built from separatorFor", () => {
    const segment = ["A", "B", "C"].join(PAGE_JOIN);
    const marked = `A${separatorFor(2)}B${separatorFor(3)}C`;
    expect(stripSeparatorsAnswer(marked)).toBe(segment);
    expect(echoAnswer(marked)).toBe(marked);
    expect(stripSeparatorsAnswer(`A${separatorFor(10)}B`)).toBe(
      `A${PAGE_JOIN}B`,
    );
  });

  it("the heading predicates tell page-by-page from range, in both directions", () => {
    const [p1, p2, p3] = PAGE_MAP_PROBE_PAGES.map((p) => p.text);
    const byPage = ["Title", "Page 1", p1, "Page 2", p2, "Page 3", p3].join(NL);
    const byRange = ["Title", `Pages 1${EN_DASH}3`, p1, p2, p3].join(NL);
    expect(headedByPage(byPage)).toBe(true);
    expect(headedByRange(byRange)).toBe(true);
    expect(headedByPage(byRange)).toBe(false);
    expect(headedByRange(byPage)).toBe(false);
    // A page's tokens under the wrong heading.
    expect(
      headedByPage(["Page 1", p2, "Page 2", p1, "Page 3", p3].join(NL)),
    ).toBe(false);
    // A range heading over an empty body.
    expect(headedByRange([p1, p2, p3, `Pages 1${EN_DASH}3`].join(NL))).toBe(
      false,
    );
    // A heading twice.
    expect(
      headedByPage(
        ["Page 1", p1, "Page 1", "Page 2", p2, "Page 3", p3].join(NL),
      ),
    ).toBe(false);
    expect(tokensInOrder([p1, p2, p3].join(NL))).toBe(true);
    expect(tokensInOrder([p2, p1, p3].join(NL))).toBe(false);
    expect(tokensInOrder([p1, p3].join(NL))).toBe(false);
  });
});

describe("probeTranslatePageMap — both arms through the executor's order", () => {
  it("both arms hold: ok, nothing failed, target derived, each arm's wire block exact", async () => {
    const verdict = await probeTranslatePageMap(deps());
    expect(verdict.failed).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.target).toBe("es");
    expect(verdict.arms?.a.pageMap).toEqual(expectedPageMap("a", 3));
    expect(verdict.arms?.b.pageMap).toEqual(expectedPageMap("b", 3));
    expect(verdict.arms?.a.headings).toEqual(["Page 1", "Page 2", "Page 3"]);
    expect(verdict.arms?.b.headings).toEqual([`Pages 1${EN_DASH}3`]);
    expect(verdict.arms?.a.requests).toBe(1);
  });

  it("POSITIVE CONTROL: a model that drops the markers in arm A too → exactly control, pdf_a, wire_a", async () => {
    // wire_a: verified 0, missing 1. pdf_a: arm A's PDF is now range-headed.
    // control: arm B's predicate now PASSES on arm A's PDF. markers_sent and
    // prompt_a still hold (the engine sent them), and the ZIPs still agree.
    const verdict = await probeTranslatePageMap(
      deps({ answerA: stripSeparatorsAnswer }),
    );
    expect(sorted(verdict.failed)).toEqual(["control", "pdf_a", "wire_a"]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: arm B ALONE broken (its model keeps the markers) → exactly control, pdf_b, wire_b", async () => {
    const verdict = await probeTranslatePageMap(deps({ answerB: echoAnswer }));
    expect(sorted(verdict.failed)).toEqual(["control", "pdf_b", "wire_b"]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: a registry without translate → both stages, and everything downstream of them", async () => {
    const verdict = await probeTranslatePageMap(
      deps({ registry: () => new ProcessorRegistry() }),
    );
    // zip_clean is the one check that holds: nothing was delivered, so no
    // text carries the brand; zip_content is what keeps that from passing as
    // proof of anything.
    expect(sorted(verdict.failed)).toEqual([
      "control",
      "markers_sent",
      "pdf_a",
      "pdf_b",
      "prompt_a",
      "stage_a",
      "stage_b",
      "wire_a",
      "wire_b",
      "zip_content",
      "zip_identity",
    ]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: no pdf dep, no reader, no settled language set, or no target → exactly pdf_unavailable", async () => {
    for (const over of [
      { pdf: undefined },
      { readPdfText: undefined },
      { pdf: stubPdf(null) },
      { pdf: stubPdf(new Set(["en"])) },
    ] as Partial<PageMapProbeDeps>[]) {
      const verdict = await probeTranslatePageMap(deps(over));
      expect(verdict.failed).toEqual(["pdf_unavailable"]);
      expect(verdict.ok).toBe(false);
    }
  });

  it("no extractor → the probe is false", async () => {
    const verdict = await probeTranslatePageMap(deps({ extract: undefined }));
    expect(verdict.failed).toEqual(["throw"]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: a reader that returns the same text for both arms → control fails", async () => {
    const verdict = await probeTranslatePageMap(
      deps({ readPdfText: async () => "the same text either way" }),
    );
    expect(verdict.failed).toContain("control");
    expect(sorted(verdict.failed)).toEqual(["control", "pdf_a", "pdf_b"]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: arm A echoes and appends one extra word → exactly zip_identity", async () => {
    // The only control under which zip_identity alone can fail: arm A still
    // verifies (the last piece is non-empty), both PDFs still head as they
    // should, and arm A's ZIP still holds every token in order.
    const verdict = await probeTranslatePageMap(
      deps({ answerA: (segment) => `${segment} Extra` }),
    );
    expect(verdict.failed).toEqual(["zip_identity"]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: arm A returns nothing → its stage, and every check that reads its output", async () => {
    // A marked reply that is empty is `unanswered`, and a one-chunk job with
    // nothing translated fails: no ZIP, no PDF, no record from arm A.
    const verdict = await probeTranslatePageMap(deps({ answerA: () => "" }));
    expect(sorted(verdict.failed)).toEqual([
      "control",
      "pdf_a",
      "stage_a",
      "wire_a",
      "zip_content",
      "zip_identity",
    ]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: both arms return the same marker-free filler → zip_content, not a pass on two equal ZIPs", async () => {
    // Two delivered, IDENTICAL, clean ZIPs: zip_identity and zip_clean both
    // hold, and only zip_content says neither carries the document.
    const filler = () => "Lorem ipsum.";
    const verdict = await probeTranslatePageMap(
      deps({ answerA: filler, answerB: filler }),
    );
    expect(verdict.failed).not.toContain("zip_identity");
    expect(verdict.failed).not.toContain("zip_clean");
    expect(sorted(verdict.failed)).toEqual([
      "control",
      "pdf_a",
      "pdf_b",
      "wire_a",
      "zip_content",
    ]);
  });

  it("POSITIVE CONTROL: an engine that sends the markers WITHOUT the instruction → exactly prompt_a", async () => {
    // Injected at the registry seam: the provider the engine calls receives
    // the request with the marker clause removed — what an engine that hung
    // the clause off the part clause would send for this one-chunk job. The
    // echo model ignores the prompt, so only prompt_a can see it.
    const verdict = await probeTranslatePageMap(
      deps({
        registry: (d) =>
          new ProcessorRegistry().register(
            createTranslateProcessor({
              ...d,
              provider: {
                ...d.provider!,
                complete: (request: AiCompletionRequest) =>
                  d.provider!.complete({
                    ...request,
                    messages: request.messages.map((m) => ({
                      ...m,
                      content: m.content.split(pageMarkerClause(2)).join(""),
                    })),
                  }),
              },
            }),
          ),
      }),
    );
    expect(verdict.failed).toEqual(["prompt_a"]);
    expect(verdict.ok).toBe(false);
  });

  it("POSITIVE CONTROL: a marker that reaches a reader's text → exactly zip_clean", async () => {
    // The engine strips every marker it recognises, so no model answer can
    // plant one in the ZIP or the PDF through the arms. The check is shown
    // to bite by planting one where no stripping runs: in the PDF text the
    // reader hands back. Nothing else moves, because the line is a strict
    // marker line no heading predicate reads.
    const verdict = await probeTranslatePageMap(
      deps({
        readPdfText: async (bytes) => `${decode(bytes)}${NL}${markerFor(2)}`,
      }),
    );
    expect(verdict.failed).toContain("zip_clean");
    expect(sorted(verdict.failed)).toEqual(["zip_clean"]);
  });

  it("a probe that throws is false, never a throw", async () => {
    const verdict = await probeTranslatePageMap(
      deps({
        extract: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(verdict.ok).toBe(false);
    // The engine turns an extractor throw into a failed job, not a throw.
    expect(verdict.failed).toContain("stage_a");
  });
});
