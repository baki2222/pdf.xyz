// @vitest-environment node
// @native-canvas
/**
 * The production proof's PDF to PowerPoint verdict, held to its controls
 * before it is allowed to judge a deployment: it must PASS the deck this
 * tree's engine writes from the proof PDF, and FAIL the text-only deck (the
 * owner's report), a deck whose picture moved, and the package PowerPoint
 * refused. A verdict that passed the text-only deck would be the proof that
 * was green on production while the pictures were missing.
 */
import { docxPackage } from "./docx-package";
import type { DocxDocument, DocxTableBlock } from "./docx-layout";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";
import { pptxTextOnly20261010 } from "@/tests/pptx-text-only-2026-10-10";
import { PDFDocument } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import {
  docxDeploymentVerdict,
  docxProofPdf,
  docxRoundTripVerdict,
  PPTX_PROOF_TEXT,
  pptxDeploymentVerdict,
  pptxProofPdf,
  tableProblem,
  typefaceProblem,
} from "./deployment-proof";
import {
  movePictureDown,
  replacePictureMedia,
  stretchFirstPicture,
} from "@/tests/docx-hand-built";
import { docxTextOnly20261017 } from "@/tests/docx-text-only-2026-10-17";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";
import { encodePngImage } from "./png-encode";

const PAGES = [
  {
    pageNumber: 1,
    text: PPTX_PROOF_TEXT,
    characterCount: PPTX_PROOF_TEXT.length,
  },
];

async function engineDeck(): Promise<Uint8Array> {
  const run = await runPdfOfficeExport(
    "pdf-to-powerpoint",
    await pptxProofPdf(),
    {
      extract: async () => ({
        pageCount: 1,
        pages: PAGES,
        text: PPTX_PROOF_TEXT,
        characterCount: PPTX_PROOF_TEXT.length,
        hasText: true,
      }),
      scanPages: scanPdfPages,
    },
  );
  if (!run.ok) throw new Error(run.message);
  return run.output;
}

describe("pptxDeploymentVerdict", () => {
  it("POSITIVE CONTROL: passes the deck this tree's engine writes", async () => {
    const verdict = await pptxDeploymentVerdict(await engineDeck());
    expect(verdict.detail).toMatch(/picture is on slide 1/);
    expect(verdict.ok).toBe(true);
  });

  it("NEGATIVE CONTROL: fails the text-only deck — opens, walks, has the text, no picture", async () => {
    const verdict = await pptxDeploymentVerdict(
      await pptxTextOnly20261010(PAGES),
    );
    expect(verdict.ok).toBe(false);
    // It fails for the right reason: the slide size first (16:9, not A4).
    expect(verdict.detail).toMatch(/not the page's/);
  });

  it("NEGATIVE CONTROL: fails a deck whose picture moved half an inch", async () => {
    const zip = await JSZip.loadAsync(await engineDeck());
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const moved = xml.replace(
      /(<p:pic>[\s\S]*?<a:off x=")(\d+)/,
      (_, head: string, x: string) => `${head}${Number(x) + 457_200}`,
    );
    expect(moved).not.toBe(xml);
    zip.file("ppt/slides/slide1.xml", moved);
    const verdict = await pptxDeploymentVerdict(
      new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/carries no picture at the page's/);
  });

  it("NEGATIVE CONTROL: fails the package PowerPoint refused", async () => {
    const verdict = await pptxDeploymentVerdict(
      await pptxBefore20260927(PAGES),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/^PowerPoint cannot open this deck/);
  });
});

/**
 * The verdict decodes the picture (2026-10-11). It read only the PNG
 * signature and the IHDR size, so a deployed engine that wrote every
 * picture blank — a 64 × 40 PNG of transparent black at the right box —
 * passed it with "the page's picture is on slide 1".
 */
describe("pptxDeploymentVerdict decodes the picture", () => {
  async function deckWithBlankPicture(
    layout: "rgba8" | "rgb8",
  ): Promise<Uint8Array> {
    const run = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      await pptxProofPdf(),
      {
        extract: async () => ({
          pageCount: 1,
          pages: PAGES,
          text: PPTX_PROOF_TEXT,
          characterCount: PPTX_PROOF_TEXT.length,
          hasText: true,
        }),
        scanPages: async (bytes, options) => {
          const scan = await scanPdfPages(bytes, options);
          for (const item of scan.pages[0]!.items)
            if (item.kind === "picture" && item.role === "image") {
              const { pixelWidth: w, pixelHeight: h } = item.media;
              item.media = {
                ...item.media,
                bytes: encodePngImage(
                  w,
                  h,
                  layout,
                  new Uint8Array(w * h * (layout === "rgba8" ? 4 : 3)),
                ),
                ext: "png",
              };
            }
          return scan;
        },
      },
    );
    if (!run.ok) throw new Error(run.message);
    return run.output;
  }

  it("NEGATIVE CONTROL: fails a deck whose picture is a transparent PNG of the right size", async () => {
    const verdict = await pptxDeploymentVerdict(
      await deckWithBlankPicture("rgba8"),
    );
    expect(verdict.ok).toBe(false);
  });

  it("NEGATIVE CONTROL: fails a deck whose picture is a black PNG of the right size", async () => {
    const verdict = await pptxDeploymentVerdict(
      await deckWithBlankPicture("rgb8"),
    );
    expect(verdict.ok).toBe(false);
  });
});

/**
 * The production proof's PDF to Word verdict (2026-10-17), held to its
 * controls the same way: it passes the .docx this tree's engine writes from
 * the proof PDF, and fails the text-only .docx production returned that
 * day, a picture moved below its line, resized, or blank. The text is read
 * by the stand-in for poppler here; production's worker runs poppler.
 */
describe("docxDeploymentVerdict", () => {
  async function engineDocx(): Promise<Uint8Array> {
    const run = await runPdfOfficeExport("pdf-to-word", await docxProofPdf(), {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    if (!run.ok) throw new Error(run.message);
    return run.output;
  }

  it("POSITIVE CONTROL: passes the .docx this tree's engine writes", async () => {
    const verdict = await docxDeploymentVerdict(await engineDocx());
    expect(verdict.detail).toMatch(/picture is between its words/);
    expect(verdict.detail).toMatch(
      /each carry exactly their own run properties/,
    );
    expect(verdict.detail).toMatch(/one 3 × 4 Word table/);
    expect(verdict.ok).toBe(true);
  });

  // 2026-11-15 (#28 slice 4): the verdict also reads each word's typeface.
  describe("the typefaces (docxTypefaces)", () => {
    /** The real engine's .docx, its document.xml edited after writing. */
    const edited = async (edit: (xml: string) => string) => {
      const zip = await JSZip.loadAsync(await engineDocx());
      const xml = await zip.file("word/document.xml")!.async("string");
      const changed = edit(xml);
      if (changed === xml) throw new Error("the edit did not land");
      zip.file("word/document.xml", changed);
      return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    };

    it("health: the engine's .docx passes typefaceProblem on its own", async () => {
      expect(await typefaceProblem(await engineDocx())).toBeNull();
    });

    it("POSITIVE CONTROL: the verdict names the three faces", async () => {
      const verdict = await docxDeploymentVerdict(await engineDocx());
      expect(verdict.ok).toBe(true);
      expect(verdict.detail).toMatch(
        /Arial, the Times line in Times New Roman and the Courier line in Courier New/,
      );
    });

    it("NEGATIVE CONTROL: fails every w:rFonts stripped", async () => {
      const verdict = await docxDeploymentVerdict(
        await edited((xml) => xml.replace(/<w:rFonts [^>]*\/>/g, "")),
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toMatch(/typeface/);
    });

    it("NEGATIVE CONTROL: fails Times New Roman and Courier New swapped", async () => {
      const verdict = await docxDeploymentVerdict(
        await edited((xml) =>
          xml
            .replaceAll("Times New Roman", "\u0000")
            .replaceAll("Courier New", "Times New Roman")
            .replaceAll("\u0000", "Courier New"),
        ),
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toMatch(/not Times New Roman/);
    });

    it("NEGATIVE CONTROL: fails a w:eastAsia added", async () => {
      const verdict = await docxDeploymentVerdict(
        await edited((xml) =>
          xml.replace(
            / w:cs="Arial"\/>/,
            ' w:eastAsia="SimSun" w:cs="Arial"/>',
          ),
        ),
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toMatch(/eastAsia/);
    });
  });

  // 2026-11-15 (#28 slice 2): the verdict also reads the table.
  describe("the table (docxTables)", () => {
    const writing = async (
      change: (t: DocxTableBlock) => DocxDocument["pages"][number][number][],
    ) => {
      const run = await runPdfOfficeExport(
        "pdf-to-word",
        await docxProofPdf(),
        {
          extractFlow: flowStandIn,
          scanPages: scanPdfPages,
          writeDocx: (doc) =>
            docxPackage({
              ...doc,
              pages: doc.pages.map((blocks) =>
                blocks.flatMap((b) => (b.kind === "table" ? change(b) : [b])),
              ),
            }),
        },
      );
      if (!run.ok) throw new Error(run.message);
      return run.output;
    };
    const text = (runs: readonly { text: string }[]) =>
      runs.map((r) => r.text).join("");

    it("health: the engine's .docx passes tableProblem on its own", async () => {
      expect(await tableProblem(await engineDocx())).toBeNull();
    });

    it("NEGATIVE CONTROL: fails the table written as tabbed paragraphs", async () => {
      const tabbed = await writing((t) =>
        t.rows.map((r) => {
          const cells = r.slots.flatMap((s) => s ?? []);
          return { kind: "text" as const, cells: cells.map(text), runs: cells };
        }),
      );
      const verdict = await docxDeploymentVerdict(tabbed);
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toMatch(/0 Word table\(s\)/);
    });

    it("NEGATIVE CONTROL: fails the empty cell dropped and the cost shifted left", async () => {
      const shifted = await writing((t) => [
        {
          ...t,
          rows: t.rows.map((r) => ({
            slots: [
              ...r.slots.filter((s) => s !== null),
              ...r.slots.map(() => null),
            ].slice(0, r.slots.length),
          })),
        },
      ]);
      const verdict = await docxDeploymentVerdict(shifted);
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toMatch(/the table's cells are/);
    });

    it("NEGATIVE CONTROL: fails a header written without its bold", async () => {
      const plain = await writing((t) => [
        {
          ...t,
          rows: t.rows.map((r, k) =>
            k === 0
              ? {
                  slots: r.slots.map(
                    (s) =>
                      s?.map((runs) =>
                        runs.map((x) => ({ ...x, style: null })),
                      ) ?? null,
                  ),
                }
              : r,
          ),
        },
      ]);
      const verdict = await docxDeploymentVerdict(plain);
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toMatch(/header is not bold/);
    });
  });

  it("NEGATIVE CONTROL: fails the text-only .docx — the words, no picture", async () => {
    const text = await docxTextOnly20261017(
      (await flowStandIn(await docxProofPdf())).pages,
    );
    const verdict = await docxDeploymentVerdict(text);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/not declared|0 picture/);
  });

  // 2026-11-15: the verdict also reads the styled line's runs.
  it("NEGATIVE CONTROL: fails an unstyled .docx — every word in Word's default style — and one with bold on the whole line", async () => {
    const plainWriter = async (pdf: Uint8Array, bold: boolean) => {
      const run = await runPdfOfficeExport("pdf-to-word", pdf, {
        extractFlow: flowStandIn,
        scanPages: scanPdfPages,
        writeDocx: (doc) =>
          docxPackage({
            ...doc,
            pages: doc.pages.map((blocks) =>
              blocks.map((b) =>
                b.kind !== "text"
                  ? b
                  : bold
                    ? {
                        ...b,
                        runs: b.runs?.map((cell) =>
                          cell.map((r) => ({
                            ...r,
                            style: { ...r.style, bold: true as const },
                          })),
                        ),
                      }
                    : { ...b, runs: undefined },
              ),
            ),
          }),
      });
      if (!run.ok) throw new Error(run.message);
      return run.output;
    };
    const pdf = await docxProofPdf();
    const unstyled = await docxDeploymentVerdict(await plainWriter(pdf, false));
    expect(unstyled.ok).toBe(false);
    expect(unstyled.detail).toMatch(
      /styled line's runs are not each word's own/,
    );
    const smeared = await docxDeploymentVerdict(await plainWriter(pdf, true));
    expect(smeared.ok).toBe(false);
    expect(smeared.detail).toMatch(/Styled \{b sz 24\/24\}/);
  });

  it("NEGATIVE CONTROL: fails a picture moved below its line, resized, or blank", async () => {
    const good = await engineDocx();
    const moved = await docxDeploymentVerdict(await movePictureDown(good));
    expect(moved.ok).toBe(false);
    expect(moved.detail).toMatch(/not between/);
    const stretched = await docxDeploymentVerdict(
      await stretchFirstPicture(good),
    );
    expect(stretched.ok).toBe(false);
    expect(stretched.detail).toMatch(/not the page's 256 × 160/);
    const blank = await docxDeploymentVerdict(
      await replacePictureMedia(
        good,
        0,
        encodePngImage(64, 40, "rgb8", new Uint8Array(64 * 40 * 3)),
      ),
    );
    expect(blank.ok).toBe(false);
    expect(blank.detail).toMatch(/not the proof's/);
  });
});

/**
 * The Word round trip's verdict, held to controls built here (no word
 * processor in CI's unit job: the real LibreOffice output is judged by the
 * production proof and `pnpm worker:docx-pictures-proof`).
 */
describe("docxRoundTripVerdict", () => {
  async function pdfShowing(
    sizes: readonly [number, number][],
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const png = encodePngImage(64, 40, "rgb8", new Uint8Array(64 * 40 * 3));
    const image = await embedRasterImage(doc, png, "png");
    let y = 700;
    for (const [width, height] of sizes) {
      await drawRasterImage(page, image, {
        x: 72,
        y: y - height,
        width,
        height,
      });
      y -= height + 20;
    }
    return doc.save();
  }

  it("POSITIVE CONTROL: passes a PDF painting the one picture at its size", async () => {
    const verdict = await docxRoundTripVerdict(await pdfShowing([[256, 160]]));
    expect(verdict.ok, verdict.detail).toBe(true);
  });

  it("NEGATIVE CONTROL: fails a PDF with no picture, two, or one at another size", async () => {
    for (const sizes of [
      [],
      [
        [256, 160],
        [256, 160],
      ],
      [[300, 160]],
    ] as const) {
      const verdict = await docxRoundTripVerdict(
        await pdfShowing(sizes as readonly [number, number][]),
      );
      expect(verdict.ok, JSON.stringify(sizes)).toBe(false);
    }
  });
});
