// @vitest-environment node
/**
 * The withheld-pages notice offers page choice IF AND ONLY IF choosing those
 * pages next time works (competitor audit #29, slice 7), read from the ZIP a
 * reader downloads (`translation.md`), through `runTranslate` and through the
 * processor that wires the per-job condition.
 *
 * The condition (`withheldRemedy`, `./engine`): this worker proved
 * `translatePageRange` (`deps.pageChoice`, from `./page-range-proved` via
 * `./native`), the job did not ask for OCR (the processor turns it off: no
 * Pages field for a scan), the bound was the characters reserved, and no
 * withheld page is longer than one pass. Every arm where one of those fails
 * keeps main's sentence, byte for byte.
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { createProcessorRegistry } from "../processor/index";
import type { ProcessorInput } from "../processor/types";
import { WITHHELD_CHOOSE_PAGES, WITHHELD_SEPARATE_DOCUMENT } from "./chunking";
import {
  runTranslate,
  withheldRemedy,
  type PdfTextExtractor,
  type TranslateDeps,
} from "./engine";
import {
  recordTranslatePageRange,
  resetTranslatePageRangeForTests,
  settledTranslatePageRange,
} from "./page-range-proved";
import { translateDeps } from "./native";
import { provesTranslatePageRange } from "./page-range-capability";

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};
const INPUT = new Uint8Array([1, 2, 3, 4]);
const PAGE_CHARS = 2_000;
const NOW = () => "2026-11-17T00:00:00.000Z";

function extraction(sizes: readonly number[]): ExtractedPdfText {
  const pages = sizes.map((size, i) => ({
    pageNumber: i + 1,
    text: size === 0 ? "" : `p${i + 1} `.padEnd(size, "x"),
    characterCount: size,
  }));
  const text = pages
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("\n\n");
  return {
    pageCount: sizes.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

const extractorOf = (sizes: readonly number[]): PdfTextExtractor =>
  vi.fn(async () => extraction(sizes));

function provider(): AiProvider {
  let n = 0;
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete(): Promise<AiCompletionResult> {
      n += 1;
      return {
        ok: true,
        text: `translated part ${n}`,
        model: "claude-sonnet-5",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

async function markdown(output: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(output);
  return zip.file("translation.md")!.async("string");
}

async function notice(
  deps: Partial<TranslateDeps>,
  sizes: readonly number[],
  delivery: { characters: number; pages?: number },
  options: TranslateOptions = OPTIONS,
): Promise<string> {
  const run = await runTranslate(INPUT, options, {
    extract: extractorOf(sizes),
    provider: provider(),
    now: NOW,
    ...deps,
    limits: { delivery },
  });
  expect(run.ok, run.ok ? "" : run.message).toBe(true);
  if (!run.ok) return "";
  const md = await markdown(run.output);
  // Health: a notice is there to read, in exactly one of its two spellings.
  expect(md).toContain("not translated.**");
  expect(
    [WITHHELD_CHOOSE_PAGES, WITHHELD_SEPARATE_DOCUMENT].filter((s) =>
      md.includes(s),
    ),
  ).toHaveLength(1);
  return md;
}

const TWELVE = Array.from({ length: 12 }, () => PAGE_CHARS);
const CHARACTERS_BOUND = { characters: 9_000 };
const offersChoice = (md: string) => md.includes(WITHHELD_CHOOSE_PAGES);

describe("the withheld-pages notice offers page choice iff choosing works", () => {
  it("offers it when proved, characters bound, every withheld page fits a pass", async () => {
    const md = await notice(
      { pageChoice: () => true },
      TWELVE,
      CHARACTERS_BOUND,
    );
    expect(offersChoice(md)).toBe(true);
    expect(md).not.toContain(WITHHELD_SEPARATE_DOCUMENT);
  });

  it("keeps main's sentence when the proof is false, unsettled, or absent", async () => {
    for (const deps of [
      { pageChoice: () => false },
      { pageChoice: () => null },
      {},
    ] as Partial<TranslateDeps>[]) {
      const md = await notice(deps, TWELVE, CHARACTERS_BOUND);
      expect(offersChoice(md)).toBe(false);
      expect(md).toContain(WITHHELD_SEPARATE_DOCUMENT);
    }
  });

  it("keeps main's sentence for a pages bound, even when proved", async () => {
    const md = await notice({ pageChoice: () => true }, TWELVE, {
      characters: 1_000_000,
      pages: 4,
    });
    expect(md).toContain("submitted as 4 pages of text");
    expect(offersChoice(md)).toBe(false);
  });

  it("keeps main's sentence when a withheld page is longer than one pass, even when proved", async () => {
    // Pages 1-4 fit; page 6 alone is over one pass (~10k). The cap stops at
    // page 5, so pages 5-8 are withheld and page 6 is among them: choosing
    // it next time would not make it any shorter.
    const sizes = [2_000, 2_000, 2_000, 2_000, 2_000, 20_000, 2_000, 2_000];
    const md = await notice({ pageChoice: () => true }, sizes, {
      characters: 9_000,
    });
    expect(md).toContain(`Pages 5${String.fromCharCode(0x2013)}8`);
    expect(offersChoice(md)).toBe(false);
  });

  it("a selection: the notice names only the remaining CHOSEN pages, and offers them", async () => {
    // Eight pages, pages 2, 4, 6 and 8 chosen; the reservation covers two.
    const md = await notice(
      { pageChoice: () => true },
      Array.from({ length: 8 }, () => PAGE_CHARS),
      { characters: 4_500 },
      {
        ...OPTIONS,
        pages: [
          [2, 2],
          [4, 4],
          [6, 6],
          [8, 8],
        ],
      },
    );
    expect(md).toContain("**Pages 6, 8 are not translated.**");
    expect(md).toContain("the pages you chose hold more.");
    expect(offersChoice(md)).toBe(true);
    // Never a page the person did not choose.
    for (const unchosen of [5, 7])
      expect(md).not.toMatch(
        new RegExp(`\\b${unchosen}\\b[^\\d]*not translated`),
      );
  });

  it("the decision itself, every arm (the predicate the engine runs)", () => {
    const base = {
      pageChoice: true as boolean | null | undefined,
      boundBy: "characters" as const,
      withheldSizes: [100, 200],
      ceilingCharacters: 1_000,
    };
    expect(withheldRemedy(base)).toBe("choose-pages");
    expect(withheldRemedy({ ...base, pageChoice: false })).toBe(
      "separate-document",
    );
    expect(withheldRemedy({ ...base, pageChoice: null })).toBe(
      "separate-document",
    );
    expect(withheldRemedy({ ...base, pageChoice: undefined })).toBe(
      "separate-document",
    );
    expect(withheldRemedy({ ...base, boundBy: "pages" })).toBe(
      "separate-document",
    );
    expect(withheldRemedy({ ...base, withheldSizes: [100, 1_001] })).toBe(
      "separate-document",
    );
  });
});

describe("the processor: an OCR job never offers page choice", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const SCAN = enc("%PDF-1.7\n% scan\n%%EOF\n");
  const SEARCHABLE = enc("%PDF-1.7\n% ocr layer\n%%EOF\n");
  const TYPED = enc("%PDF-1.7\n% typed\n%%EOF\n");
  const same = (a: Uint8Array, b: Uint8Array) =>
    Buffer.from(a).equals(Buffer.from(b));

  function processorWith(pageChoice: () => boolean | null) {
    const extract: PdfTextExtractor = async (bytes) =>
      same(bytes, SCAN) ? extraction([0]) : extraction(TWELVE);
    const registry = createProcessorRegistry({
      ocr: {
        runner: async ({ options }) => ({
          artifacts: [
            {
              filename: "scan-ocr.pdf",
              contentType: "application/pdf",
              bytes: SEARCHABLE,
            },
          ],
          meta: buildOcrResultMeta({
            engine: "ocrmypdf",
            languages: options.languages,
            outputMode: options.outputMode,
            producedSearchablePdf: true,
            producedTextSidecar: false,
            pageCount: 12,
          }),
        }),
        engines: { ocrmypdf: true, tesseract: true },
      },
      translate: { extract, provider: provider(), now: NOW, pageChoice },
    });
    return registry.resolve("translate-pdf")!;
  }

  function job(options: Record<string, unknown>, bytes: Uint8Array) {
    return {
      tool: "translate-pdf",
      options: { targetLanguage: "fr", ...options },
      inputs: [
        {
          fileId: "f",
          filename: "doc.pdf",
          contentType: "application/pdf",
          bytes,
        },
      ],
      delivery: CHARACTERS_BOUND,
    } as ProcessorInput;
  }

  async function md(
    result: Awaited<ReturnType<ReturnType<typeof processorWith>["process"]>>,
  ) {
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    if (!result.ok) return "";
    return markdown(result.artifacts[0]!.bytes);
  }

  it("control: a typed PDF on a proved worker is offered page choice", async () => {
    const text = await md(
      await processorWith(() => true).process(job({}, TYPED)),
    );
    expect(offersChoice(text)).toBe(true);
  });

  it("a scan recognised by OCR, on the same proved worker, keeps main's sentence", async () => {
    const text = await md(
      await processorWith(() => true).process(
        job({ ocr: true, languages: ["eng"] }, SCAN),
      ),
    );
    expect(text).toContain("not translated.**");
    expect(offersChoice(text)).toBe(false);
    expect(text).toContain(WITHHELD_SEPARATE_DOCUMENT);
  });
});

describe("the wiring: the engine reads this process's own proof", () => {
  it("the heartbeat's prover records the verdict it returns", async () => {
    resetTranslatePageRangeForTests();
    try {
      // With no extractor configured the proof cannot run and returns false;
      // whatever it returns is what the engine must read.
      const verdict = await provesTranslatePageRange({});
      expect(settledTranslatePageRange()).toBe(verdict);
      expect(settledTranslatePageRange()).not.toBeNull();
    } finally {
      resetTranslatePageRangeForTests();
    }
  });

  it("a proof that throws records false, not nothing", async () => {
    resetTranslatePageRangeForTests();
    try {
      // An environment that throws on every read: the proof cannot start.
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error("unreadable environment");
          },
        },
      ) as Record<string, string | undefined>;
      expect(await provesTranslatePageRange(hostile)).toBe(false);
      expect(settledTranslatePageRange()).toBe(false);
    } finally {
      resetTranslatePageRangeForTests();
    }
  });

  it("translateDeps' pageChoice is the recorded verdict, null until one is recorded", () => {
    resetTranslatePageRangeForTests();
    try {
      const deps = translateDeps({});
      expect(deps.pageChoice).toBe(settledTranslatePageRange);
      expect(deps.pageChoice!()).toBeNull();
      recordTranslatePageRange(true);
      expect(deps.pageChoice!()).toBe(true);
      recordTranslatePageRange(false);
      expect(deps.pageChoice!()).toBe(false);
    } finally {
      resetTranslatePageRangeForTests();
    }
  });
});
