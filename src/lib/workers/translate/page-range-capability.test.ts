// @vitest-environment node
// @native-canvas
/**
 * `probeTranslatePageRange` / `provesTranslatePageRange`, the start-up proof
 * published as `translatePageRange` (competitor audit #29, slice 6).
 *
 * The TRUE case runs first, with pdfjs's legacy build as the extractor
 * stand-in (the same text layer the browser counts with; it numbers pages by
 * their index in the document, blank ones included, as poppler does). Only
 * after that is green do the controls mean anything: a false from a broken
 * fixture would otherwise pass as every control at once. Each control below
 * is a mutation of the shipped path through a seam, and each must FAIL,
 * naming the step that saw it:
 *
 *   - an engine that IGNORES `pages` (the registry seam drops the key on its
 *     way to the processor: an old image's shape, and M2's);
 *   - an extractor that numbers TEXT-BEARING pages by position (the blank
 *     page dropped, so page 2's text arrives as page 1: M4's shape);
 *   - a four-page probe (health);
 *   - a recorder that records NOTHING ((1)'s "did not see page 3" is an
 *     absence and vacuously true of it, so (1)'s "saw pages 2 and 4" and the
 *     positive control must be what turn it false);
 *   - arm A answered by the stripping model (the headings step and the
 *     heading control);
 *   - an extractor that throws;
 *   - an engine whose out-of-range check is gone (the extractor seam
 *     reports as many pages as the job names, so `firstSpanBeyond` finds
 *     nothing past the end): [[6,6]] then selects no page and is refused as
 *     the chosen-pages `no_text`, with the same code, retry flag and zero
 *     calls, so only (4)'s refusal-kind check can see it (review
 *     2026-11-17: before that check the proof passed this image).
 *
 * And, where this host has a real `pdftotext` (the worker image; a dev box
 * with poppler), the proof as the daemon runs it, with no fake at all.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionRequest } from "../ai/provider";
import { resolveNativePdfTextExtractor } from "../pdf-text/native";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import type { TranslateDeps } from "./engine";
import { stripSeparatorsAnswer } from "./page-map-capability";
import {
  headedByChosenList,
  headedPageByPage,
  headingsOf,
  probeTranslatePageRange,
  provesTranslatePageRange,
  type PageRangeProbeDeps,
} from "./page-range-capability";
import { PAGE_RANGE_PROBE_PAGES } from "./probe-pdf";
import type { TranslateExtractor } from "./reading-order";

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;
const pdfjsExtract: TranslateExtractor = (bytes) =>
  extractPdfText(bytes, legacy);

const NL = String.fromCharCode(10);
const EN_DASH = String.fromCharCode(0x2013);

const deps = (over: Partial<PageRangeProbeDeps> = {}): PageRangeProbeDeps => ({
  extract: pdfjsExtract,
  ...over,
});

/** A registry whose processor never sees `pages`: an image that ignores it. */
function ignoresPages(d: TranslateDeps): ProcessorRegistry {
  const real = createTranslateProcessor(d);
  return new ProcessorRegistry().register({
    ...real,
    process: (input) => {
      const { pages: _dropped, ...options } = input.options as Record<
        string,
        unknown
      >;
      void _dropped;
      return real.process({ ...input, options });
    },
  });
}

/** A registry whose provider answers but is never recorded by the proof. */
function silentRecorder(d: TranslateDeps): ProcessorRegistry {
  const unseen: AiCompletionRequest[] = [];
  return new ProcessorRegistry().register(
    createTranslateProcessor({
      ...d,
      provider: {
        id: "anthropic",
        model: "capability-probe",
        async complete(request) {
          unseen.push(request);
          const content = request.messages.map((m) => m.content).join(NL);
          const open = content.indexOf(`${NL}---${NL}`);
          const close = content.lastIndexOf(`${NL}---`);
          return {
            ok: true,
            text:
              open >= 0 && close > open ? content.slice(open + 5, close) : "",
            model: "capability-probe",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      },
    }),
  );
}

/**
 * A registry whose engine never finds a span past the end: each job's
 * extractor reports at least as many pages as the job's `pages` name, so the
 * engine's `firstSpanBeyond` returns nothing and the selection proceeds
 * (selecting no page for [[6,6]]). The page entries are unchanged.
 */
function skipsRangeCheck(d: TranslateDeps): ProcessorRegistry {
  return new ProcessorRegistry().register({
    ...createTranslateProcessor(d),
    process: (input) => {
      const spans = ((input.options as { pages?: [number, number][] }).pages ??
        []) as [number, number][];
      const named = Math.max(0, ...spans.map(([, b]) => b));
      const own = d.extract!;
      return createTranslateProcessor({
        ...d,
        extract: async (bytes, run) => {
          const read = await own(bytes, run);
          return { ...read, pageCount: Math.max(read.pageCount, named) };
        },
      }).process(input);
    },
  });
}

/** pdfjs's reading with the blank page dropped and the rest renumbered. */
const numbersByPosition: TranslateExtractor = async (bytes) => {
  const read = await pdfjsExtract(bytes);
  const pages = read.pages
    .filter((p) => p.text.trim().length > 0)
    .map((p, i) => ({ ...p, pageNumber: i + 1 }));
  const shifted: ExtractedPdfText = { ...read, pages, pageCount: pages.length };
  return shifted;
};

describe("the page-range proof passes on a sound engine (the precondition)", () => {
  it("every step passes with pdfjs as the extractor", async () => {
    const verdict = await probeTranslatePageRange(deps());
    expect(verdict.failed, verdict.lines.join(NL)).toEqual([]);
    expect(verdict.ok).toBe(true);
    // Health of the verdict itself: every step was evaluated and printed.
    const steps = new Set(verdict.lines.map((l) => /\((\w+)\)/.exec(l)?.[1]));
    expect([...steps].sort()).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(verdict.lines.length).toBeGreaterThanOrEqual(19);
    expect(verdict.lines.every((l) => l.startsWith("PASS "))).toBe(true);
  });
});

describe("the page-range proof fails, naming the step, on each defect", () => {
  it("an engine that ignores pages: page 3 and page 5 reach the model", async () => {
    const verdict = await probeTranslatePageRange(
      deps({ registry: ignoresPages }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(
      expect.arrayContaining([
        "unchosen_not_sent",
        "stored_a",
        "manifest_a",
        "sentence_a",
        "beyond",
      ]),
    );
  });

  it("an engine without its out-of-range check: (4) fails on the refusal's kind alone", async () => {
    const verdict = await probeTranslatePageRange(
      deps({ registry: skipsRangeCheck }),
    );
    // Exactly the kind check: code, retry flag and zero calls all still
    // hold, which is why the step needed it.
    expect(verdict.failed, verdict.lines.join(NL)).toEqual(["beyond_kind"]);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines.find((l) => l.startsWith("FAIL (4)"))).toContain(
      "chosen-pages no_text",
    );
  });

  it("an extractor that numbers text pages by position fails health", async () => {
    const verdict = await probeTranslatePageRange(
      deps({ extract: numbersByPosition }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(["health"]);
  });

  it("a four-page probe fails health", async () => {
    const verdict = await probeTranslatePageRange(
      deps({ pages: PAGE_RANGE_PROBE_PAGES.slice(0, 4) }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(["health"]);
  });

  it("a recorder that records nothing fails on what it did not see", async () => {
    const verdict = await probeTranslatePageRange(
      deps({ registry: silentRecorder }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(
      expect.arrayContaining(["one_request_a", "chosen_sent", "control_sent"]),
    );
    // The absence check alone is vacuously true of a silent recorder.
    expect(verdict.failed).not.toContain("unchosen_not_sent");
  });

  it("arm A answered without markers: the headings step and the control fail", async () => {
    const verdict = await probeTranslatePageRange(
      deps({ answerA: stripSeparatorsAnswer }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(
      expect.arrayContaining(["headings_a", "control_headings"]),
    );
  });

  it("an extractor that throws is false, not an exception", async () => {
    const verdict = await probeTranslatePageRange(
      deps({
        extract: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toContain("throw");
  });

  it("no extractor at all is health, false", async () => {
    const verdict = await probeTranslatePageRange({});
    expect(verdict).toMatchObject({ ok: false, failed: ["health"] });
  });
});

describe("the heading predicates tell the two arms apart", () => {
  const A = ["Title", "Page 2", "one", "Page 4", "two"].join(NL);
  const B = ["Title", "Pages 2, 4", "one two"].join(NL);
  const RANGE = ["Title", `Pages 2${EN_DASH}4`, "one two"].join(NL);
  it("each accepts its own and refuses the other's and a first-last range", () => {
    expect(headingsOf(A)).toEqual(["Page 2", "Page 4"]);
    expect(headedPageByPage(A)).toBe(true);
    expect(headedByChosenList(B)).toBe(true);
    expect(headedPageByPage(B)).toBe(false);
    expect(headedByChosenList(A)).toBe(false);
    expect(headedByChosenList(RANGE)).toBe(false);
    expect(headedPageByPage(RANGE)).toBe(false);
  });
});

describe("the proof file spends nothing", () => {
  it("holds no provider call (a recording fake only)", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/lib/workers/translate/page-range-capability.ts",
      ),
      "utf8",
    );
    expect(source.length).toBeGreaterThan(2_000);
    expect(source).not.toContain(".complete(");
    // Positive control for the grep: the shape it looks for is findable.
    expect("provider.complete(request)").toContain(".complete(");
  });
});

describe("the proof as the daemon runs it, on this host's pdftotext", () => {
  it.skipIf(!resolveNativePdfTextExtractor())(
    "provesTranslatePageRange is true with the real extractor",
    async () => {
      expect(await provesTranslatePageRange(process.env)).toBe(true);
    },
    60_000,
  );

  it("answers false where there is no pdftotext", async () => {
    expect(
      await provesTranslatePageRange({
        PDFXYZ_PDF_TEXT_BIN: "/nonexistent/pdfxyz-no-pdftotext",
      }),
    ).toBe(false);
  });
});
