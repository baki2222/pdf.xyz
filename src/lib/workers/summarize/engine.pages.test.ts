// @vitest-environment node
/**
 * Summarize a chosen page range (audit summarize-pdf#5, slice 5), at the
 * engine and the processor.
 *
 * The fixture is the one that tells a page NUMBER from a chunk POSITION:
 * five pages, page 2 BLANK, a marker on pages 1, 3, 4 and 5. Pages with no
 * text are dropped before joining, so the second text chunk is page 3, and
 * code that selected "page 3" by position would read page 4.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { joinPageTexts, type ExtractedPdfText } from "@/lib/pdf/text";
import { selectExtraction } from "@/lib/pdf/page-selection";
import type { SummarizeOptions } from "@/lib/jobs/summarize-pdf";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import { runSummarize, type PdfTextExtractor } from "./engine";
import { createSummarizeProcessor } from "../processor/summarize";

/** Built from code points (house rule): en dash, em dash, middle dot. */
const EN = String.fromCharCode(0x2013);
const EM = String.fromCharCode(0x2014);
const MID = String.fromCharCode(0xb7);

const MARK = (page: number) => `MARKERPAGE${page}`;
/** Page texts by physical page; page 2 is blank. Each ~40 characters. */
const PAGE_TEXTS = [1, 2, 3, 4, 5].map((n) =>
  n === 2 ? "" : `${MARK(n)} ${"w".repeat(28)}`,
);

function fixture(): ExtractedPdfText {
  const pages = PAGE_TEXTS.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const text = joinPageTexts(pages);
  return {
    pageCount: 5,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}
const extract: PdfTextExtractor = async () => fixture();

function recorder(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "probe-model",
    calls,
    async complete(request): Promise<AiCompletionResult> {
      calls.push(request);
      return {
        ok: true,
        text: "A summary.",
        model: "probe-model",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

const sent = (request: AiCompletionRequest) =>
  [request.system ?? "", ...request.messages.map((m) => m.content)].join("\n");

const BRIEF: SummarizeOptions = { length: "brief", format: "paragraphs" };
const INPUT = new Uint8Array([1, 2, 3, 4]);

async function unzip(output: Uint8Array) {
  const zip = await JSZip.loadAsync(output);
  const read = async (name: string) => (await zip.file(name)?.async("string"))!;
  return {
    manifest: JSON.parse(await read("manifest.json")) as {
      source: {
        pagesSent: unknown;
        selectionNotice: unknown;
        characters: number;
      };
    },
    markdown: await read("summary.md"),
    readme: await read("README.txt"),
  };
}

describe("the fixture tells a page number from a chunk position", () => {
  it("has a blank page 2 and a marker on every other page", () => {
    const f = fixture();
    expect(f.pages[1]!.text).toBe("");
    for (const n of [1, 3, 4, 5]) expect(f.text).toContain(MARK(n));
  });
});

describe("pages [[3,4]] on the blank-page fixture", () => {
  it("sends only pages 3 and 4, and names them everywhere a reader looks", async () => {
    const provider = recorder();
    const run = await runSummarize(
      INPUT,
      { ...BRIEF, pages: [[3, 4]] },
      { extract, provider },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(provider.calls).toHaveLength(1);
    const request = provider.calls[0]!;
    const text = sent(request);
    expect(text).toContain(MARK(3));
    expect(text).toContain(MARK(4));
    expect(text).not.toContain(MARK(1));
    expect(text).not.toContain(MARK(5));

    // The window describes the SELECTION: its characters, its pages.
    const selected = selectExtraction(fixture(), [[3, 4]]).text.trim();
    expect(run.meta.window.pagesSent).toEqual([[3, 4]]);
    expect(run.meta.window.charactersTotal).toBe(selected.length);
    expect(run.meta.window.totalPages).toBe(5);
    expect(run.meta.sourceCharacters).toBe(selected.length);
    expect(run.meta.selectedPages).toBe(2);
    expect(run.meta.pageCount).toBe(5);

    // The model is told, and its "This summarises …" names the right pages.
    expect(request.system).toContain(
      `The text above covers pages 3${EN}4 of 5, the pages the user chose; no other page was sent.`,
    );
    expect(request.system).toContain(`This summarises pages 3${EN}4 of 5`);
    expect(request.system).not.toMatch(/pages 1-/);
    expect(request.messages[0]!.content).toContain(
      "(Only the pages the user chose are included.)",
    );

    const pkg = await unzip(run.output);
    expect(pkg.manifest.source.pagesSent).toEqual([[3, 4]]);
    expect(pkg.manifest.source.selectionNotice).toBe(
      `This summary covers pages 3${EN}4 of 5, the pages you chose.`,
    );
    expect(pkg.manifest.source.characters).toBe(selected.length);
    expect(pkg.markdown).toContain(
      `> **This summary covers pages 3${EN}4 of 5, the pages you chose.**`,
    );
    // Directly under the "> Pages: 5 · Source characters" line.
    const lines = pkg.markdown.split("\n");
    const at = lines.findIndex((l) => l.startsWith(`> Pages: 5 ${MID} `));
    expect(lines.slice(at + 1, at + 3)).toEqual([
      ">",
      `> **This summary covers pages 3${EN}4 of 5, the pages you chose.**`,
    ]);
    expect(pkg.readme).toContain(
      `Pages: This summary covers pages 3${EN}4 of 5, the pages you chose.`,
    );
  });

  it("ORDER: the window is computed over the selection, not the document", async () => {
    const provider = recorder();
    const run = await runSummarize(
      INPUT,
      { ...BRIEF, pages: [[3, 4]] },
      { extract, provider },
    );
    if (!run.ok) throw new Error(run.message);
    expect(run.meta.window.charactersTotal).not.toBe(
      fixture().text.trim().length,
    );
  });

  it("CONTROL: no pages sends every page and names none", async () => {
    const provider = recorder();
    const run = await runSummarize(INPUT, BRIEF, { extract, provider });
    if (!run.ok) throw new Error(run.message);
    const text = sent(provider.calls[0]!);
    for (const n of [1, 3, 4, 5]) expect(text).toContain(MARK(n));
    expect(run.meta.window).not.toHaveProperty("pagesSent");
    expect(run.meta.selectedPages).toBeNull();
    expect(provider.calls[0]!.system).not.toContain("IMPORTANT");
    const pkg = await unzip(run.output);
    expect(pkg.manifest.source.pagesSent).toBeNull();
    expect(pkg.manifest.source.selectionNotice).toBeNull();
    expect(pkg.readme).not.toContain("Pages:");
  });
});

describe("refusals before any provider call", () => {
  it("pages [[6,6]] on a 5-page PDF: pages_out_of_range, not retryable, no call", async () => {
    const provider = recorder();
    const run = await runSummarize(
      INPUT,
      { ...BRIEF, pages: [[6, 6]] },
      { extract, provider },
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("pages_out_of_range");
    expect(run.retryable).toBe(false);
    expect(run.message).toBe(
      "This PDF has 5 pages, so page 6 cannot be summarized. Nothing was sent to the AI model.",
    );
    expect(run.usage).toBeUndefined();
    expect(run.window).toBeUndefined();
    expect(provider.calls).toHaveLength(0);
  });

  it("names the first span past the end, as a range when it is one", async () => {
    const run = await runSummarize(
      INPUT,
      {
        ...BRIEF,
        pages: [
          [1, 1],
          [4, 9],
        ],
      },
      { extract, provider: recorder() },
    );
    expect(run.ok ? "" : run.message).toBe(
      `This PDF has 5 pages, so pages 4${EN}9 cannot be summarized. Nothing was sent to the AI model.`,
    );
  });

  it("pages [[2,2]] (blank): no_text with the chosen-pages sentence, no call", async () => {
    const provider = recorder();
    const run = await runSummarize(
      INPUT,
      { ...BRIEF, pages: [[2, 2]] },
      { extract, provider },
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("no_text");
    expect(run.message).toBe(
      "The pages you chose have no selectable text. Choose other pages, or run OCR PDF first.",
    );
    expect(provider.calls).toHaveLength(0);
  });

  it("neither refusal says or implies that nothing was charged (they come after the reservation)", async () => {
    const charged =
      /nothing (was )?charged|not (been )?charged|did not count|free of charge/i;
    const messages: string[] = [];
    for (const pages of [[[6, 6]], [[2, 2]]] as [number, number][][]) {
      const run = await runSummarize(
        INPUT,
        { ...BRIEF, pages },
        { extract, provider: recorder() },
      );
      messages.push(run.ok ? "" : run.message);
    }
    expect(messages.every((m) => m.length > 0)).toBe(true);
    for (const m of messages) expect(m).not.toMatch(charged);
    // POSITIVE CONTROL: the regex is not blind.
    expect(
      "Choosing pages is not available on our server right now, so nothing was charged.",
    ).toMatch(charged);
  });
});

describe("a selection longer than the read limit", () => {
  it("truncates INSIDE the selection and names the chosen pages read", async () => {
    // Pages 3–5 hold ~124 characters; a 60-character limit cuts inside page 4.
    const provider = recorder();
    const run = await runSummarize(
      INPUT,
      { ...BRIEF, pages: [[3, 5]] },
      { extract, provider, limits: { maxInputChars: 60 } },
    );
    if (!run.ok) throw new Error(run.message);
    const text = sent(provider.calls[0]!);
    expect(text).toContain(MARK(3));
    expect(text).not.toContain(MARK(1));
    expect(text).not.toContain(MARK(5));
    expect(run.meta.window.truncated).toBe(true);
    expect(run.meta.window.pagesSent).toEqual([[3, 4]]);
    expect(run.meta.truncationNotice).toBe(
      `Only pages 3${EN}4 of the pages you chose could be read, cut mid-page ${EM} they hold more text than the limit, so anything after that was not considered.`,
    );
    expect(provider.calls[0]!.messages[0]!.content).toContain(
      "(Only the first part of the pages the user chose is included.)",
    );
    expect(provider.calls[0]!.system).toContain(`pages 3${EN}4 of 5`);
  });
});

describe("the processor", () => {
  const processor = createSummarizeProcessor({ extract, provider: recorder() });
  const job = (options: Record<string, unknown>) =>
    processor.process({
      tool: "summarize-pdf",
      options,
      inputs: [
        {
          fileId: "f_pages",
          filename: "doc.pdf",
          contentType: "application/pdf",
          bytes: INPUT,
        },
      ],
    });

  it("maps pages_out_of_range to a NON-retryable unprocessable_entity", async () => {
    const result = await job({ ...BRIEF, pages: [[6, 6]] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unprocessable_entity");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain("page 6 cannot be summarized");
  });

  it("carries pagesSent on the job record and a page COUNT (never spans) in meta", async () => {
    const result = await job({ ...BRIEF, pages: [[3, 4]] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results?.ai?.truncation.pagesSent).toEqual([[3, 4]]);
    expect(result.meta?.selectedPages).toBe(2);
    expect(JSON.stringify(result.meta)).not.toContain("[3");
  });

  it("a whole-document run's meta has no selectedPages key", async () => {
    const result = await job({ ...BRIEF });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.meta).not.toHaveProperty("selectedPages");
  });
});
