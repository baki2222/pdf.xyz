// @vitest-environment node
/**
 * `provesSummarizePages`, the start-up proof published as `summarizePages`.
 *
 * The TRUE case runs first, with an injected extractor: a pdf-lib →
 * page-text fake that reads each page's content stream back (the words the
 * generator drew, nothing it was told), and gives the content-less page 2 an
 * empty page exactly as `pdftotext` gives it an empty form-feed chunk. Only
 * after that is green do the controls mean anything — a false from a broken
 * fixture would otherwise pass as every control at once:
 *
 *   - an engine that IGNORES `pages` (m1's shape), through the registry seam;
 *   - an extractor that numbers TEXT-BEARING pages by position (m3's shape:
 *     the blank page dropped, so page 3's text arrives as page 2);
 *   - an extractor that throws;
 *   - an engine whose out-of-range check is gone (a registry seam whose
 *     extractor reports as many pages as the job names, so
 *     `firstSpanBeyond` finds nothing past the end): [[5,5]] then selects no
 *     page and is refused as the chosen-pages no-text refusal, with the same
 *     code, retry flag and zero calls, so only (3)'s refusal-kind check can
 *     see it (before that check the proof passed this image; found building
 *     Translate's page range, #347);
 *   - a recorder that records NOTHING: (1)'s "did not see ALPHA/DELTA" is an
 *     absence and vacuously true of it, so (1)'s "saw GAMMA" and (2) must be
 *     what turns it false — and a COPY of the probe without those two checks
 *     must turn it true (see "the checks that carry the verdict").
 *
 * And, where this host has a real `pdftotext` (the worker image; a dev box
 * with poppler), the proof as the daemon runs it, with no fake at all.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { createProcessorRegistry } from "../processor";
import { ProcessorRegistry } from "../processor/registry";
import { resolveNativePdfTextExtractor } from "../pdf-text/native";
import type { PdfTextExtractor } from "./engine";
import {
  provesSummarizePages,
  runSummarizePagesProof,
  summarizePagesProofPdf,
  SUMMARIZE_PAGES_PROOF_PAGES,
} from "./pages-capability";

const ENV = {};

/** Each page's drawn text, read back out of its content stream. */
const pdfLibPageText: PdfTextExtractor = async (
  bytes,
): Promise<ExtractedPdfText> => {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages().map((page, index) => {
    const contents = page.node.Contents();
    const streams =
      contents === undefined
        ? []
        : contents instanceof PDFArray
          ? contents.asArray().map((ref) => doc.context.lookup(ref))
          : [contents];
    let ops = "";
    for (const stream of streams)
      if (stream instanceof PDFRawStream)
        ops += new TextDecoder("latin1").decode(
          decodePDFRawStream(stream).decode(),
        );
    const text = [...ops.matchAll(/<([0-9A-Fa-f]*)> Tj/g)]
      .map((m) => Buffer.from(m[1]!, "hex").toString("latin1"))
      .join("\n");
    return { pageNumber: index + 1, text, characterCount: text.length };
  });
  const text = pages
    .map((page) => page.text)
    .filter((t) => t.length > 0)
    .join("\n\n");
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
};

/** m3's shape: blank pages dropped and the rest numbered by position. */
const positionalPageText: PdfTextExtractor = async (bytes) => {
  const real = await pdfLibPageText(bytes);
  const pages = real.pages
    .filter((page) => page.text.length > 0)
    .map((page, i) => ({ ...page, pageNumber: i + 1 }));
  return { ...real, pages };
};

/** m1's shape: the summarize processor, handed every job WITHOUT `pages`. */
const ignoringPages: typeof createProcessorRegistry = (deps) => {
  const real = createProcessorRegistry(deps);
  const summarize = real.resolve("summarize-pdf")!;
  const registry = new ProcessorRegistry();
  registry.register({
    ...summarize,
    process: (input) => {
      const { pages: _ignored, ...options } = input.options as Record<
        string,
        unknown
      >;
      return summarize.process({ ...input, options });
    },
  });
  return registry;
};

/**
 * An engine that never finds a span past the end: each summarize job's
 * extractor reports at least as many pages as the job's `pages` name, so the
 * engine's `firstSpanBeyond` returns nothing and the selection proceeds
 * (selecting no page for [[5,5]]). The page entries are unchanged.
 */
const skipsRangeCheck: typeof createProcessorRegistry = (deps = {}) => {
  const summarize = createProcessorRegistry(deps).resolve("summarize-pdf")!;
  const registry = new ProcessorRegistry();
  registry.register({
    ...summarize,
    process: (input) => {
      const spans =
        (input.options as { pages?: [number, number][] }).pages ?? [];
      const named = Math.max(0, ...spans.map(([, last]) => last));
      const own = deps.summarize!.extract!;
      const hidesTheEnd: PdfTextExtractor = async (bytes) => {
        const read = await own(bytes);
        return { ...read, pageCount: Math.max(read.pageCount, named) };
      };
      return createProcessorRegistry({
        ...deps,
        summarize: { ...deps.summarize, extract: hidesTheEnd },
      })
        .resolve("summarize-pdf")!
        .process(input);
    },
  });
  return registry;
};

/** Answers every request normally and records none of them. */
const nullRecorder = (): AiProvider => ({
  id: "openai",
  model: "capability-probe",
  async complete(): Promise<AiCompletionResult> {
    return {
      ok: true,
      text: "Probe summary.",
      model: "capability-probe",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
});

const failures = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the fixture the proof runs on", () => {
  it("draws ALPHA, nothing, GAMMA, DELTA on pages 1-4, and the fake reads them back there", async () => {
    const read = await pdfLibPageText(await summarizePagesProofPdf());
    expect(read.pageCount).toBe(4);
    expect(read.pages.map((p) => p.text)).toEqual(
      SUMMARIZE_PAGES_PROOF_PAGES.map((t) => t ?? ""),
    );
  });
});

describe("provesSummarizePages", () => {
  it("TRUE with the injected extractor, asserted first so the controls below mean something", async () => {
    const result = await runSummarizePagesProof(ENV, {
      extract: pdfLibPageText,
    });
    expect(failures(result.lines)).toEqual([]);
    expect(result.ok).toBe(true);
    // Every step reported, so a step silently skipped cannot pass.
    for (const step of ["0", "1", "2", "3"])
      expect(result.lines.some((l) => l.includes(`(${step})`))).toBe(true);
    expect(
      await provesSummarizePages({ env: ENV, extract: pdfLibPageText }),
    ).toBe(true);
  });

  it("FALSE for an engine that ignores pages (m1), at step (1)", async () => {
    const result = await runSummarizePagesProof(ENV, {
      extract: pdfLibPageText,
      build: ignoringPages,
    });
    expect(result.ok).toBe(false);
    expect(failures(result.lines).some((l) => l.startsWith("FAIL (1)"))).toBe(
      true,
    );
  });

  it("FALSE for an engine without its out-of-range check, at (3)'s refusal-kind check alone", async () => {
    const result = await runSummarizePagesProof(ENV, {
      extract: pdfLibPageText,
      build: skipsRangeCheck,
    });
    expect(result.ok).toBe(false);
    // Exactly the kind check: code, retry flag and zero calls all still
    // hold, which is why the step needed it.
    expect(failures(result.lines)).toEqual([
      "FAIL (3) pages [[5,5]] is the out-of-range refusal, told apart from the chosen-pages no-text refusal (chosen-pages no_text)",
    ]);
    expect(
      result.lines.some((l) =>
        /^PASS \(3\) pages \[\[5,5\]\] fails as unprocessable_entity \(retryable false\) with 0 provider calls/.test(
          l,
        ),
      ),
    ).toBe(true);
  });

  it("FALSE for page numbers that are chunk positions (m3), at the health step", async () => {
    const result = await runSummarizePagesProof(ENV, {
      extract: positionalPageText,
    });
    expect(result.ok).toBe(false);
    expect(failures(result.lines)[0]).toMatch(/^FAIL \(0\)/);
  });

  it("FALSE on a throw (an extractor that throws mid-proof)", async () => {
    expect(
      await provesSummarizePages({
        env: ENV,
        extract: async () => {
          throw new Error("boom");
        },
      }),
    ).toBe(false);
  });

  it("FALSE where the image has no text extractor", async () => {
    expect(
      await provesSummarizePages({
        env: { PDFXYZ_PDF_TEXT_BIN: "/nonexistent/pdfxyz-no-pdftotext" },
      }),
    ).toBe(false);
  });

  it("FALSE for a recorder that records nothing, at (1)'s presence checks and (2), never a throw", async () => {
    const result = await runSummarizePagesProof(ENV, {
      extract: pdfLibPageText,
      provider: nullRecorder,
    });
    expect(result.ok).toBe(false);
    const red = failures(result.lines);
    expect(red).toContain("FAIL (1) the provider saw page 3's text");
    expect(red).toContain(
      'FAIL (1) the system prompt the model received says "page 3 of 4"',
    );
    expect(red.some((l) => l.startsWith("FAIL (2)"))).toBe(true);
    expect(red).toHaveLength(3);
    // The absence check is vacuously green against it — which is the point.
    expect(result.lines).toContain(
      "PASS (1) the provider saw neither page 1's nor page 4's text",
    );
  });

  it.skipIf(!resolveNativePdfTextExtractor())(
    "TRUE on this host's REAL pdftotext, as the daemon runs it",
    async () => {
      const result = await runSummarizePagesProof(process.env);
      expect(failures(result.lines)).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );
});

describe("the checks that carry the verdict against a null recorder", () => {
  /**
   * In a COPY of the probe with the three checks that read what the recorder
   * captured deleted — (1)'s "saw page 3", (1)'s "the system prompt says
   * page 3 of 4", and step (2) — the null recorder must give TRUE: that is
   * what shows those checks, and only they, stand between a recorder that
   * captures nothing and a green proof. (The brief named two; the first run
   * of this mutant found the third, the system-prompt check, still red.)
   *
   * The copy is written OUTSIDE the source tree (a tree-walking guard
   * running in parallel must never see it) with every import rewritten to
   * an absolute path, and each deletion is grepped back before the verdict
   * is trusted.
   */
  it("deleting them turns the null recorder green", async () => {
    const file = fileURLToPath(
      new URL("./pages-capability.ts", import.meta.url),
    );
    const source = readFileSync(file, "utf8");
    const saw = /\n  check\("1", chosen\.sent\.includes\(GAMMA\),[^\n]*\n/;
    const prompt =
      /\n  check\(\n    "1",\n    chosen\.system\.includes\(NAMES_PAGE_3\),\n[^\n]*\n  \);\n/;
    const control = /\n  \/\/ \(2\) POSITIVE CONTROL[\s\S]*?\n  \/\/ \(3\)/;
    expect(source, "the 'saw page 3' check moved").toMatch(saw);
    expect(source, "the system-prompt check moved").toMatch(prompt);
    expect(source, "step (2) moved").toMatch(control);
    const dir = path.dirname(file);
    const src = path.resolve(dir, "../../..");
    const absolute = (spec: string) =>
      spec.startsWith("@/")
        ? path.join(src, spec.slice(2))
        : path.resolve(dir, spec);
    const mutant = source
      .replace(saw, "\n")
      .replace(prompt, "\n")
      .replace(control, "\n  // (3)")
      .replace(
        /from "((?:\.\.?\/|@\/)[^"]+)"/g,
        (_m, spec: string) =>
          `from ${JSON.stringify(absolute(spec).replace(/\\/g, "/"))}`,
      );
    // Grep the mutation back: all three are gone, everything else is not.
    expect(mutant).not.toMatch(saw);
    expect(mutant).not.toContain("chosen.system.includes(NAMES_PAGE_3)");
    expect(mutant).not.toContain("POSITIVE CONTROL: no pages");
    expect(mutant).toContain('check(\n    "3",');
    expect(mutant).toContain("chosen.sent.includes(ALPHA)");
    expect(mutant).not.toMatch(/from "\.\.?\//);

    const scratch = mkdtempSync(path.join(tmpdir(), "pdfxyz-pages-mutant-"));
    const copy = path.join(scratch, "pages-capability.mutant.ts");
    writeFileSync(copy, mutant);
    try {
      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(copy).href
      )) as {
        runSummarizePagesProof: typeof runSummarizePagesProof;
      };
      const result = await mod.runSummarizePagesProof(ENV, {
        extract: pdfLibPageText,
        provider: nullRecorder,
      });
      expect(failures(result.lines)).toEqual([]);
      expect(result.ok).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
