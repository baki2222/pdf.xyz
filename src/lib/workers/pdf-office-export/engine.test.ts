import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  runPdfOfficeExport,
  type PdfTextExtractor,
} from "./engine";
import { inspectPptxPackage } from "./pptx-package";
import { parseXml, xmlWellFormedness } from "@/tests/xml-well-formed";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const extract: PdfTextExtractor = vi.fn(async () => ({
  pageCount: 2,
  pages: [
    { pageNumber: 1, text: "Name Amount\nAlice 10", characterCount: 20 },
    { pageNumber: 2, text: "Bob 20", characterCount: 6 },
  ],
  text: "Name Amount\nAlice 10\n\nBob 20",
  characterCount: 28,
  hasText: true,
}));

async function zipEntries(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return new Set(Object.keys(zip.files));
}

describe("pdf-office-export engine", () => {
  it("declares the owned tools", () => {
    expect(PDF_OFFICE_EXPORT_TOOLS).toEqual([
      "pdf-to-word",
      "pdf-to-excel",
      "pdf-to-powerpoint",
    ]);
  });

  it("fails honestly without an extractor", async () => {
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {}),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("exports selectable PDF text to a valid DOCX package", async () => {
    const result = await runPdfOfficeExport("pdf-to-word", PDF, { extract });
    expect(result).toMatchObject({
      ok: true,
      meta: {
        tool: "pdf-to-word",
        engine: "pdftotext-office-openxml",
        pageCount: 2,
      },
    });
    if (result.ok) {
      expect(result.contentType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      const entries = await zipEntries(result.output);
      expect(entries).toContain("word/document.xml");
    }
  });

  it("exports selectable PDF text to XLSX and PPTX packages", async () => {
    const xlsx = await runPdfOfficeExport("pdf-to-excel", PDF, { extract });
    const pptx = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      extract,
    });
    expect(xlsx.ok).toBe(true);
    expect(pptx.ok).toBe(true);
    if (xlsx.ok)
      expect(await zipEntries(xlsx.output)).toContain(
        "xl/worksheets/sheet1.xml",
      );
    // ⚠️ This assertion was GREEN for every .pptx the engine wrote before
    // 2026-09-27, and PowerPoint refused every one of those files as corrupted.
    // It checks that the author wrote a slide, not that a reader can open it.
    // Kept as the envelope check; the describe block below is the real one.
    if (pptx.ok)
      expect(await zipEntries(pptx.output)).toContain("ppt/slides/slide1.xml");
  });

  it("writes well-formed XML in every Office export, even from text XML cannot carry", async () => {
    // pdftotext passes through whatever a font's ToUnicode map says, including
    // C0 controls and non-characters. XML 1.0 forbids them, and one such
    // character makes the whole part unparseable, and the file with it.
    const hostile = "Total\u0001 due\u000B now\uFFFF ok \uD800x";
    const hostileExtract: PdfTextExtractor = async () => ({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: hostile, characterCount: hostile.length }],
      text: hostile,
      characterCount: hostile.length,
      hasText: true,
    });
    for (const tool of PDF_OFFICE_EXPORT_TOOLS) {
      const run = await runPdfOfficeExport(tool, PDF, {
        extract: hostileExtract,
      });
      expect(run.ok, tool).toBe(true);
      if (!run.ok) continue;
      const zip = await JSZip.loadAsync(run.output);
      const parts = Object.keys(zip.files).filter((n) =>
        /\.(xml|rels)$/.test(n),
      );
      // Health check: the loop below must have something to assert over.
      expect(parts.length, tool).toBeGreaterThanOrEqual(3);
      for (const part of parts)
        expect(
          xmlWellFormedness(await zip.file(part)!.async("string")),
          `${tool}: ${part}`,
        ).toBeNull();
    }
  });

  it("rejects image-only PDFs and oversized inputs", async () => {
    const emptyExtractor: PdfTextExtractor = async () => ({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
      text: "",
      characterCount: 0,
      hasText: false,
    });
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, { extract: emptyExtractor }),
    ).resolves.toMatchObject({ ok: false, kind: "no_text" });
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {
        extract,
        limits: { maxInputBytes: 4 },
      }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
  });
});

/**
 * ── PDF TO POWERPOINT MUST WRITE A FILE POWERPOINT OPENS ─────────────────────
 *
 * Until 2026-09-27 pptx() wrote presentation.xml and one slide per page, and no
 * slide master, slide layout or theme. PowerPoint 16.0 for Windows refused
 * every such file through COM `Presentations.Open` with "The file or directory
 * is corrupted and unreadable" (0x80070570), while a deck PowerPoint saved
 * itself reopened in the same run. The test above stayed green throughout.
 *
 * These read the file the way a consumer does: from the package root, through
 * the relationship chain, with a real XML parser, never by guessing a filename.
 * `scripts/prove-pptx-opens.ts` is the check against PowerPoint itself; this is
 * the part of it CI can run.
 */
describe("pdf-to-powerpoint package", () => {
  const PAGES = [
    { pageNumber: 1, text: "Quarterly review\nRevenue & costs <draft>" },
    { pageNumber: 2, text: "" },
    { pageNumber: 3, text: '  Next steps "quoted"  \n\nThanks  ' },
  ];
  const threePages: PdfTextExtractor = async () => ({
    pageCount: PAGES.length,
    pages: PAGES.map((p) => ({ ...p, characterCount: p.text.length })),
    text: PAGES.map((p) => p.text).join("\n\n"),
    characterCount: PAGES.reduce((n, p) => n + p.text.length, 0),
    hasText: true,
  });

  async function exportDeck(): Promise<Uint8Array> {
    const run = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      extract: threePages,
    });
    if (!run.ok) throw new Error(`export failed: ${run.message}`);
    return run.output;
  }

  it("carries the slide master → layout → theme chain, every relationship resolving", async () => {
    const inspection = await inspectPptxPackage(await exportDeck(), {
      wellFormed: xmlWellFormedness,
    });
    expect(inspection.problems).toEqual([]);
    // `problems: []` is only a pass next to counts that could not be zero: a
    // walk that reached nothing has nothing to complain about.
    expect(inspection.counts).toMatchObject({
      masters: 1,
      themes: 1,
      slides: PAGES.length,
    });
    expect(inspection.counts.layouts).toBeGreaterThanOrEqual(1);
    expect(inspection.counts.reached).toBe(inspection.counts.parts);
  });

  it("puts each page's lines on its own slide, in presentation order", async () => {
    const zip = await JSZip.loadAsync(await exportDeck());
    const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const R =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const xml = async (name: string) =>
      parseXml(await zip.file(name)!.async("string"));

    // Follow the chain a reader follows: sldIdLst order → rels → part.
    const presentation = await xml("ppt/presentation.xml");
    const rels = await xml("ppt/_rels/presentation.xml.rels");
    const targetOf = new Map(
      [...rels.getElementsByTagName("Relationship")].map((r) => [
        r.getAttribute("Id"),
        r.getAttribute("Target"),
      ]),
    );
    const slideParts = [...presentation.getElementsByTagNameNS(P, "sldId")].map(
      (s) => `ppt/${targetOf.get(s.getAttributeNS(R, "id"))}`,
    );
    expect(slideParts).toHaveLength(PAGES.length);

    const slideTexts: string[][] = [];
    for (const part of slideParts) {
      const slide = await xml(part);
      slideTexts.push(
        [...slide.getElementsByTagNameNS(A, "p")]
          .map((p) =>
            [...p.getElementsByTagNameNS(A, "t")]
              .map((t) => t.textContent)
              .join(""),
          )
          .filter((line) => line.length > 0),
      );
    }
    expect(slideTexts).toEqual([
      ["Quarterly review", "Revenue & costs <draft>"],
      [],
      ['Next steps "quoted"', "Thanks"],
    ]);
  });
});
