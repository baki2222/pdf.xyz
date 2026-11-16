// @vitest-environment node
// @native-canvas
/**
 * Summarize's chosen pages are PHYSICAL page numbers, end to end, in a PDF
 * whose printed labels say otherwise (review of audit summarize-pdf#5,
 * 2026-11-16).
 *
 * The fixture's /PageLabels number tree prints "i, ii, 1, 2, 3": physical
 * pages 1-2 are roman front matter and physical page 3 is labelled "1". So
 * "pages 1-2" means the front matter, and a reader that numbered by label
 * would send pages 3-4 instead. Both paths are run through the shipped
 * functions over this one PDF:
 *
 *   - typed pages: `measureSummarizeRun` → `selectExtraction` →
 *     `runSummarize` (what the provider is shown);
 *   - bookmarked sections: `readSummarySections` (pdf.js's outline,
 *     `readPdfOutline`) → `summarySections` → `measureSummarizeRun` with the
 *     section's span → `runSummarize`.
 *
 * Mutations, each run on a copy and reverted (see the PR's notes): numbering
 * the extractor's pages by label (`readPageTextItems`), or the outline's
 * starts by label (`readPdfOutline`), turns this file red.
 */
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseSummarizeOptions } from "@/lib/jobs/summarize-pdf";
import { selectExtraction } from "@/lib/pdf/page-selection";
import type { PageSpan } from "@/lib/pdf/page-spans";
import { readSummarySections } from "@/lib/pdf/summary-sections";
import { extractPdfText } from "@/lib/pdf/text";
import { extractSelectionOnDemand } from "@/lib/pdf/selection-lazy";
import { addOutline, fitDest } from "@/tests/bookmark-fixtures";
import type { AiCompletionRequest, AiProvider } from "./ai/provider";
import { runSummarize } from "./summarize/engine";
import { measureSummarizeRun, type SummarizeChoice } from "./summarize-client";

/** pdf.js's legacy build, the one Node runs. */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

/** One marker per PHYSICAL page; the label each page prints is beside it. */
const PAGES = [
  { marker: "PHYSONE", label: "i" },
  { marker: "PHYSTWO", label: "ii" },
  { marker: "PHYSTHREE", label: "1" },
  { marker: "PHYSFOUR", label: "2" },
  { marker: "PHYSFIVE", label: "3" },
];
const LABELS = PAGES.map((p) => p.label);

async function labelledPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const { marker } of PAGES) {
    const page = doc.addPage([400, 200]);
    page.drawText(`${marker} is written on this page.`, {
      x: 20,
      y: 100,
      size: 10,
      font,
    });
  }
  const ctx = doc.context;
  // /PageLabels: from index 0 lower roman, from index 2 decimal (restarting
  // at 1). "i, ii, 1, 2, 3".
  doc.catalog.set(
    PDFName.of("PageLabels"),
    ctx.obj({
      Nums: [
        PDFNumber.of(0),
        ctx.obj({ S: PDFName.of("r") }),
        PDFNumber.of(2),
        ctx.obj({ S: PDFName.of("D") }),
      ],
    }),
  );
  // "Preface" opens physical page 1 (label "i"); "Chapter Two" opens
  // physical page 4, whose printed label is "2".
  addOutline(doc, [
    { title: "Preface", dest: fitDest(doc, 0) },
    { title: "Chapter Two", dest: fitDest(doc, 3) },
  ]);
  return doc.save();
}

function recorder(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "labels-model",
    calls,
    async complete(request) {
      calls.push(request);
      return {
        ok: true,
        text: "A summary.",
        model: "labels-model",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** Panel → worker for one choice: the spans sent and the markers the model saw. */
async function chain(
  bytes: Uint8Array,
  choice: SummarizeChoice,
): Promise<{ pages: PageSpan[] | undefined; seen: string[] }> {
  const measured = await measureSummarizeRun(bytes, choice, (b) =>
    extractSelectionOnDemand(b, legacy),
  );
  if (!measured.ok) throw new Error(measured.message);
  const contract = parseSummarizeOptions({
    length: "brief",
    format: "paragraphs",
    pages: measured.pages,
  });
  if (!contract.ok) throw new Error("the contract refused the panel's body");
  const extracted = await extractPdfText(bytes, legacy);
  // The declared count is the selection over PHYSICAL pages.
  expect(measured.declaredCharacters).toBe(
    selectExtraction(extracted, measured.pages!).characterCount,
  );
  const provider = recorder();
  const run = await runSummarize(bytes, contract.value, {
    extract: async () => extracted,
    provider,
  });
  if (!run.ok) throw new Error(run.message);
  expect(run.meta.window.pagesSent).toEqual(measured.pages);
  const text = provider.calls
    .flatMap((c) => c.messages.map((m) => m.content))
    .join("\n");
  return {
    pages: measured.pages,
    seen: PAGES.map((p) => p.marker).filter((m) => text.includes(m)),
  };
}

describe("Summarize chosen pages: physical numbers in a PDF with /PageLabels", () => {
  it("POSITIVE CONTROL: pdf.js reads the labels the fixture wrote", async () => {
    const pdfjs = await legacy();
    const task = (
      pdfjs as unknown as {
        getDocument(o: object): {
          promise: Promise<{ getPageLabels(): Promise<string[] | null> }>;
          destroy(): Promise<void>;
        };
      }
    ).getDocument({ data: (await labelledPdf()).slice(), verbosity: 0 });
    try {
      expect(await (await task.promise).getPageLabels()).toEqual(LABELS);
    } finally {
      await task.destroy();
    }
  });

  it('typed "1-2" sends the front matter (labels i, ii), not the pages labelled 1 and 2', async () => {
    const bytes = await labelledPdf();
    const { pages, seen } = await chain(bytes, { kind: "pages", text: "1-2" });
    expect(pages).toEqual([[1, 2]]);
    expect(seen).toEqual(["PHYSONE", "PHYSTWO"]);
  });

  it("a bookmark's section starts on the physical page it opens", async () => {
    const bytes = await labelledPdf();
    const sections = await readSummarySections(bytes, legacy);
    expect(sections).toEqual([
      { title: "Preface", span: [1, 3] },
      { title: "Chapter Two", span: [4, 5] },
    ]);
    const chapter = sections[1]!;
    const { pages, seen } = await chain(bytes, {
      kind: "span",
      span: chapter.span,
    });
    expect(pages).toEqual([[4, 5]]);
    expect(seen).toEqual(["PHYSFOUR", "PHYSFIVE"]);
  });
});
