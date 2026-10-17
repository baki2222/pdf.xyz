// @vitest-environment node
// @native-canvas
/**
 * The round-trip proof's own logic, held to its controls without a
 * presentation engine: a stand-in "renderer" turns each deck back into the
 * PDF it would show — the source for a faithful deck, a blank page for a deck
 * with no pictures, and for a deck with one picture altered, the source with
 * that picture drawn the same wrong way (`mixedSizesPdf({ alter })`). The
 * real renderer (LibreOffice in the worker image) is
 * `pnpm worker:pptx-fidelity-proof`; this asks whether the proof READS its
 * controls right: an alteration that did not land, a partial control that
 * passed, a fixture set with nothing to alter — each must fail the proof.
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  imageCaptionPdf,
  junkAfterEofPdf,
  mixedSizesPdf,
  paintOrderPdf,
  pdftotextStandIn,
  repairStandIn,
  scannedPdf,
  vectorShapesPdf,
  type PictureAlteration,
  type PptxFixture,
} from "@/tests/pptx-fidelity-fixtures";
import { pptxTextOnly20261010 } from "@/tests/pptx-text-only-2026-10-10";
import { runPdfOfficeExport } from "./engine";
import {
  alterDeckPicture,
  PICTURE_ALTERATIONS,
  runPptxFidelityProof,
} from "./fidelity-proof";
import { pdfOfficeExportDeps } from "./native";
import { scanPdfPages } from "./page-scan";

async function blankLike(pdf: Uint8Array): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdf);
  const out = await PDFDocument.create();
  for (const page of src.getPages())
    out
      .addPage([page.getWidth(), page.getHeight()])
      .setRotation(page.getRotation());
  return out.save();
}

const slideXml = async (pptx: Uint8Array, n: number) =>
  (await (
    await JSZip.loadAsync(pptx)
  )
    .file(`ppt/slides/slide${n}.xml`)
    ?.async("string")) ?? "";

/** Which alteration a deck carries on slide 2, against the faithful deck. */
async function alterationOf(
  pptx: Uint8Array,
  faithful: Uint8Array,
): Promise<PictureAlteration | null> {
  const [a, b] = [await slideXml(pptx, 2), await slideXml(faithful, 2)];
  if (a === b) return null;
  if (/<a:srcRect [^>]*r="\d{4,}"/.test(a) && !/<a:srcRect/.test(b))
    return "crop15";
  const off = (x: string) =>
    [...x.matchAll(/<a:off x="(-?\d+)"/g)].map((m) => m[1]);
  const ext = (x: string) =>
    [...x.matchAll(/<a:ext cx="(\d+)"/g)].map((m) => m[1]);
  if (off(a).join() !== off(b).join()) return "move18pt";
  if (ext(a).join() !== ext(b).join()) return "stretch10";
  return null;
}

async function setUp(
  fixtures: PptxFixture[],
  {
    honest = true,
    repair = true,
    damage = junkAfterEofPdf,
  }: {
    honest?: boolean;
    /** Wire a repair engine (a stand-in for qpdf) into the export's deps. */
    repair?: boolean;
    /** How the damaged fixture is made from the first fixture. */
    damage?: (pdf: Uint8Array) => Uint8Array;
  } = {},
) {
  // The damaged fixture: the first fixture, damaged, standing for it.
  const source = fixtures[0]!;
  const damaged = damage(source.pdf);
  const standIn = new Map(fixtures.map((f) => [f.pdf, pdftotextStandIn(f)]));
  standIn.set(damaged, pdftotextStandIn(source));
  const owner = new Map<Uint8Array, PptxFixture>(
    fixtures.map((f) => [f.pdf, f]),
  );
  owner.set(damaged, source);
  const exportDeps = {
    ...pdfOfficeExportDeps(),
    extract: async (pdf: Uint8Array) => standIn.get(pdf)!,
    ...(repair ? { repairPdf: repairStandIn } : {}),
  };
  // The faithful deck of each fixture, to tell an altered deck from it.
  const faithful = new Map<string, Uint8Array>();
  for (const f of fixtures) {
    const run = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      f.pdf,
      exportDeps,
    );
    if (!run.ok) throw new Error(run.message);
    faithful.set(f.name, run.output);
  }
  let current: PptxFixture | null = null;
  return {
    deps: {
      exportDeps: {
        ...exportDeps,
        extract: async (pdf: Uint8Array) => {
          current = owner.get(pdf) ?? current;
          return standIn.get(pdf)!;
        },
      },
      toPdf: async (pptx: Uint8Array) => {
        const fixture = current!;
        const zip = await JSZip.loadAsync(pptx);
        const slides = await Promise.all(
          Object.keys(zip.files)
            .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
            .map((n) => zip.file(n)!.async("string")),
        );
        if (!slides.some((s) => s.includes("<p:pic>")))
          return blankLike(fixture.pdf);
        const kind = await alterationOf(pptx, faithful.get(fixture.name)!);
        if (kind && honest) return (await mixedSizesPdf({ page: 2, kind })).pdf;
        return fixture.pdf;
      },
      fixtures: fixtures.map((f) => ({ name: f.name, pdf: f.pdf })),
      damaged: {
        name: `${source.name} (damaged)`,
        pdf: damaged,
        source: { name: source.name, pdf: source.pdf },
      },
      textOnlyDeck: pptxTextOnly20261010,
      blankDeck: (n: number) =>
        pptxTextOnly20261010(
          Array.from({ length: n }, (_, i) => ({
            pageNumber: i + 1,
            text: "",
            characterCount: 0,
          })),
        ),
    },
  };
}

describe("the round-trip proof reads its controls right", () => {
  it("alters ONE picture on slide 2 three ways, each read back from the slide", async () => {
    const fixture = await mixedSizesPdf();
    const run = await runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, {
      ...pdfOfficeExportDeps(),
      extract: async () => pdftotextStandIn(fixture),
    });
    if (!run.ok) throw new Error(run.message);
    for (const kind of PICTURE_ALTERATIONS) {
      const altered = await alterDeckPicture(run.output, 2, kind);
      expect(altered.landed, altered.detail).toBe(true);
      expect(await alterationOf(altered.bytes, run.output)).toBe(kind);
      // Only slide 2 changed.
      for (const n of [1, 3, 4])
        expect(await slideXml(altered.bytes, n)).toBe(
          await slideXml(run.output, n),
        );
    }
  });

  it("says an alteration did not land when the slide has no picture to alter", async () => {
    const fixture = await vectorShapesPdf();
    const run = await runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, {
      ...pdfOfficeExportDeps(),
      extract: async () => pdftotextStandIn(fixture),
    });
    if (!run.ok) throw new Error(run.message);
    const altered = await alterDeckPicture(run.output, 2, "stretch10");
    expect(altered.landed).toBe(false);
  });

  it("PROVES with an honest renderer: faithful decks pass, every control fails", async () => {
    const fixtures = await Promise.all(
      [imageCaptionPdf, scannedPdf, paintOrderPdf, () => mixedSizesPdf()].map(
        (b) => b(),
      ),
    );
    const { deps } = await setUp(fixtures);
    const result = await runPptxFidelityProof(deps);
    expect(
      result.lines.filter((l) =>
        /control PASSED|broken|never ran|export FAILED|no repair engine is wired|proves nothing|not refused as damaged/.test(
          l,
        ),
      ),
    ).toEqual([]);
    // The damaged fixture was rebuilt, converted, and faithful to its source;
    // and with no repair engine the same file was refused.
    expect(
      result.lines.some((l) =>
        /^imageCaptionPdf \(damaged\): rebuilt deck PASS/.test(l),
      ),
    ).toBe(true);
    expect(
      result.lines.some((l) =>
        /^imageCaptionPdf \(damaged\): with no repair engine, refused as damaged/.test(
          l,
        ),
      ),
    ).toBe(true);
    for (const kind of PICTURE_ALTERATIONS)
      expect(
        result.lines.some((l) =>
          new RegExp(`mixedSizesPdf: ${kind} on slide 2 control FAIL`).test(l),
        ),
        kind,
      ).toBe(true);
    expect(result.ok).toBe(true);
  }, 120_000);

  it("FAILS when the renderer shows the altered picture as if it were right: a partial control passed", async () => {
    const fixtures = await Promise.all(
      [imageCaptionPdf, scannedPdf, paintOrderPdf, () => mixedSizesPdf()].map(
        (b) => b(),
      ),
    );
    const { deps } = await setUp(fixtures, { honest: false });
    const result = await runPptxFidelityProof(deps);
    expect(result.ok).toBe(false);
    expect(result.lines.filter((l) => /control PASSED/.test(l))).toHaveLength(
      PICTURE_ALTERATIONS.length,
    );
  }, 120_000);

  it("FAILS when no fixture has a second slide to alter: the partial controls never ran", async () => {
    const fixtures = await Promise.all(
      [imageCaptionPdf, scannedPdf, paintOrderPdf, vectorShapesPdf].map((b) =>
        b(),
      ),
    );
    const { deps } = await setUp(fixtures);
    const result = await runPptxFidelityProof(deps);
    expect(result.ok).toBe(false);
    expect(result.lines).toContain(
      "no multi-page fixture: the partial controls never ran",
    );
  }, 120_000);

  /*
   * 2026-10-11, after the second re-review: a PDF the page reader cannot
   * read is rebuilt with the worker's Repair PDF engine (qpdf) before it is
   * scanned. The image is the one place qpdf runs under CI, so the proof
   * converts a damaged fixture there too — and fails where it cannot.
   */
  it("FAILS when no repair engine is wired: a damaged PDF would be refused, not rebuilt", async () => {
    const fixtures = await Promise.all(
      [imageCaptionPdf, scannedPdf, paintOrderPdf, () => mixedSizesPdf()].map(
        (b) => b(),
      ),
    );
    const { deps } = await setUp(fixtures, { repair: false });
    const result = await runPptxFidelityProof(deps);
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => /no repair engine is wired/.test(l))).toBe(
      true,
    );
  }, 120_000);

  it("FAILS when the 'damaged' fixture converts without a rebuild: it would prove nothing", async () => {
    const fixtures = await Promise.all(
      [imageCaptionPdf, scannedPdf, paintOrderPdf, () => mixedSizesPdf()].map(
        (b) => b(),
      ),
    );
    const { deps } = await setUp(fixtures, { damage: (pdf) => pdf.slice() });
    const result = await runPptxFidelityProof(deps);
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => /proves nothing/.test(l))).toBe(true);
  }, 120_000);

  it("FAILS when the damaged file is converted with no repair engine: the control saw no refusal", async () => {
    // A reader that mends the file itself before scanning: the regression
    // where a damaged PDF is read anyway. With no repair engine the control
    // must then see a conversion, and the proof must fail on it.
    const fixtures = await Promise.all(
      [imageCaptionPdf, scannedPdf, paintOrderPdf, () => mixedSizesPdf()].map(
        (b) => b(),
      ),
    );
    const { deps } = await setUp(fixtures);
    const lenient: typeof scanPdfPages = async (bytes, options) =>
      scanPdfPages((await repairStandIn(bytes)) ?? bytes, options);
    const result = await runPptxFidelityProof({
      ...deps,
      exportDeps: { ...deps.exportDeps, scanPages: lenient },
    });
    expect(result.ok).toBe(false);
    expect(
      result.lines.some((l) =>
        /with no repair engine it was converted, not refused as damaged/.test(
          l,
        ),
      ),
    ).toBe(true);
  }, 120_000);
});
