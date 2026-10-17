// @vitest-environment node
// @native-canvas
/**
 * The in-image Word pictures proof (`./docx-pictures-proof`), run here with
 * poppler and LibreOffice stood in for — so what is tested is the PROOF:
 * that it passes the engine's .docx, and that it fails when the instrument,
 * a control, or the word processor's layout says it should. The run that
 * counts is `pnpm worker:docx-pictures-proof` inside the worker image
 * (`src/deploy/worker-docx-pictures-proof.test.ts` walks its wiring).
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import {
  DOCX_PICTURE_FIXTURES,
  captionedPicturesPdf,
} from "@/tests/docx-picture-fixtures";
import { dropPicture } from "@/tests/docx-hand-built";
import { docxTextOnly20261017 } from "@/tests/docx-text-only-2026-10-17";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { junkAfterEofPdf, repairStandIn } from "@/tests/pptx-fidelity-fixtures";
import { readDocxBody } from "./docx-read";
import {
  PROOF_CORPUS,
  runDocxPicturesProof,
  type DocxPicturesProofInput,
} from "./docx-pictures-proof";
import { runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";

/**
 * A stand-in for LibreOffice's layout: one page per picture, each painted at
 * its .docx extent. `keep` decides which pictures it paints.
 */
function layOut(keep: (index: number) => boolean = () => true) {
  return async (docx: Uint8Array): Promise<Uint8Array> => {
    const body = await readDocxBody(docx);
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    for (const pic of body.pictures) {
      if (!keep(pic.index) || !pic.bytes) continue;
      const jpeg = pic.part?.endsWith(".jpeg") ?? false;
      const image = await embedRasterImage(
        doc,
        pic.bytes,
        jpeg ? "jpg" : "png",
      );
      const page = doc.addPage([
        Math.max(72, pic.width + 72),
        Math.max(72, pic.height + 72),
      ]);
      await drawRasterImage(page, image, {
        x: 36,
        y: 36,
        width: pic.width,
        height: pic.height,
      });
    }
    return doc.save();
  };
}

async function input(
  overrides: Partial<DocxPicturesProofInput> = {},
): Promise<DocxPicturesProofInput> {
  const fixtures = await Promise.all(
    DOCX_PICTURE_FIXTURES.map(async (build) => {
      const f = await build();
      return { name: f.name, pdf: f.pdf, pictures: f.pictures.length };
    }),
  );
  return {
    exportDeps: {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
      repairPdf: repairStandIn,
    },
    toPdf: layOut(),
    fixtures,
    damaged: {
      name: "captionedPicturesPdf (junk after %%EOF)",
      pdf: junkAfterEofPdf((await captionedPicturesPdf()).pdf),
      source: await captionedPicturesPdf(),
    },
    textOnlyDocx: (pages) => docxTextOnly20261017(pages),
    dropOnePicture: (docx) => dropPicture(docx, 0),
    ...overrides,
  };
}

describe("the in-image Word pictures proof", () => {
  it("POSITIVE CONTROL: proves this tree's engine on every fixture, with every control failing as it must", async () => {
    const result = await runDocxPicturesProof(await input());
    expect(result.ok, result.lines.join("\n")).toBe(true);
    // Health: every fixture was judged, with both controls and the layout.
    const fixtures = DOCX_PICTURE_FIXTURES.length;
    expect(
      result.lines.filter((l) => /control, text-only/.test(l)),
    ).toHaveLength(fixtures);
    expect(
      result.lines.filter((l) => /one picture removed fails/.test(l)),
    ).toHaveLength(fixtures);
    expect(result.lines.filter((l) => /LibreOffice laid/.test(l))).toHaveLength(
      fixtures,
    );
    expect(result.lines.some((l) => /rebuilt first/.test(l))).toBe(true);
  }, 180_000);

  it("fails when the word processor paints fewer pictures than the .docx holds", async () => {
    const result = await runDocxPicturesProof(
      await input({ toPdf: layOut((i) => i !== 0) }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(
      /LibreOffice painted \d+ of the \.docx's/,
    );
  }, 180_000);

  it("fails when a control passes: the 'text-only' file is the engine's own", async () => {
    const base = await input();
    const captioned = await captionedPicturesPdf();
    const run = await runPdfOfficeExport(
      "pdf-to-word",
      captioned.pdf,
      base.exportDeps,
    );
    if (!run.ok) throw new Error(run.message);
    const result = await runDocxPicturesProof({
      ...base,
      fixtures: [
        {
          name: captioned.name,
          pdf: captioned.pdf,
          pictures: captioned.pictures.length,
        },
      ],
      textOnlyDocx: async () => run.output,
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join(" ")).toMatch(
      /CONTROL the text-only .docx passed/,
    );
  }, 180_000);

  it("fails without a rebuild for the damaged fixture", async () => {
    const base = await input();
    const result = await runDocxPicturesProof({
      ...base,
      fixtures: base.fixtures.slice(0, 1),
      exportDeps: { ...base.exportDeps, repairPdf: undefined },
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(/not converted \(unreadable/);
  }, 180_000);
});

/**
 * The review of 2026-10-17: a proof over a corpus that quietly shrank
 * reports the strongest pass there is ("[] ⊆ X", CLAUDE.md rule 4). The
 * proof bounds the corpus it is handed, both ways, and says so when it is
 * implausible — while still judging what it was given.
 */
describe("the in-image Word pictures proof bounds its corpus", () => {
  it("fails on an implausibly small corpus, though every fixture in it passes", async () => {
    const base = await input();
    const result = await runDocxPicturesProof({
      ...base,
      fixtures: base.fixtures.slice(0, 1),
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(
      /FAIL the corpus holds 1 fixture\(s\), implausibly few/,
    );
    // Health: the one fixture was still judged, and passed.
    expect(
      result.lines.some((l) => /^ok {3}\w+: \d+ of \d+ source/.test(l)),
    ).toBe(true);
  }, 180_000);

  it("HEALTH: the committed corpus is inside the bound", () => {
    expect(DOCX_PICTURE_FIXTURES.length).toBeGreaterThanOrEqual(
      PROOF_CORPUS.min,
    );
    expect(DOCX_PICTURE_FIXTURES.length).toBeLessThanOrEqual(PROOF_CORPUS.max);
  });
});
