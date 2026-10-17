// @vitest-environment node
// @native-canvas
/**
 * The Word picture instrument, held to its own controls before it is allowed
 * to judge an export (CLAUDE.md: every predicate gets a health check and a
 * positive control, and a bound gets the controls it must fail).
 *
 *  - POSITIVE: a .docx built BY HAND from each fixture's record
 *    (`@/tests/docx-hand-built`), sharing nothing with the engine's writer,
 *    passes. So the instrument can pass a right file it was not taught by.
 *  - NEGATIVE: the text-only .docx this tool shipped until 2026-10-17
 *    (`@/tests/docx-text-only-2026-10-17`) fails on every fixture, as
 *    missing every picture.
 *  - PARTIAL: one defect at a time, each made from the passing hand-built
 *    file — two pictures swapped, one place showing another picture's
 *    pixels, one dropped, one moved below the next paragraph, one stretched
 *    10%, one on the wrong page — and each must fail, for its own reason.
 *
 * The engine's own .docx against the same instrument is
 * `docx-pictures.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  captionedPicturesPdf,
  croppedPagePdf,
  DOCX_PICTURE_FIXTURES,
  scanBetweenPagesPdf,
  type DocxFixture,
} from "@/tests/docx-picture-fixtures";
import {
  dropPicture,
  handBuiltDocx,
  movePictureDown,
  replacePictureMedia,
  stretchFirstPicture,
  swapFirstTwoPictures,
} from "@/tests/docx-hand-built";
import { docxTextOnly20261017 } from "@/tests/docx-text-only-2026-10-17";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { compareDocxPictures, PIXEL_BOUND } from "./docx-fidelity";
import { readDocxBody } from "./docx-read";

/** The fixture as a hand-built .docx: its sequence, its pictures' files. */
async function handBuilt(fixture: DocxFixture): Promise<Uint8Array> {
  return handBuiltDocx({
    page: fixture.firstPage,
    pages: fixture.sequence.map((page) =>
      page.map((block) =>
        block.startsWith("#") ? { picture: Number(block.slice(1)) - 1 } : block,
      ),
    ),
    pictures: fixture.pictures.map((p) => {
      if (!p.file) throw new Error(`${fixture.name} has no picture file`);
      return { ...p.file, width: p.shown.width, height: p.shown.height };
    }),
  });
}

const HAND_BUILT = [captionedPicturesPdf, scanBetweenPagesPdf, croppedPagePdf];

describe("the Word picture instrument, against its controls", () => {
  it("HEALTH: it finds every fixture picture in the source and decodes it, and has text to place most by", async () => {
    for (const build of DOCX_PICTURE_FIXTURES) {
      const fixture = await build();
      const report = await compareDocxPictures(
        fixture.pdf,
        await docxTextOnly20261017((await flowStandIn(fixture.pdf)).pages),
      );
      expect(report.sourcePictures, fixture.name).toBe(fixture.pictures.length);
      expect(
        report.pictures.filter((p) => p.inconclusive),
        fixture.name,
      ).toEqual([]);
    }
  }, 120_000);

  it("POSITIVE CONTROL: a .docx built by hand from the fixture's own record passes", async () => {
    for (const build of HAND_BUILT) {
      const fixture = await build();
      const report = await compareDocxPictures(
        fixture.pdf,
        await handBuilt(fixture),
      );
      expect(report.pass, `${fixture.name}: ${report.detail}`).toBe(true);
      expect(report.matched).toBe(fixture.pictures.length);
      // Health: a picture with text above or below it on its page was
      // placed BY that text, not passed for want of any.
      const placeable = fixture.sequence.filter(
        (page) =>
          page.some((b) => b.startsWith("#")) &&
          page.some((b) => !b.startsWith("#")),
      ).length;
      expect(report.orderChecked, fixture.name).toBeGreaterThanOrEqual(
        placeable,
      );
      // The bound has room: a right picture scores well under it.
      expect(report.maxPixelScore, fixture.name).toBeLessThan(PIXEL_BOUND / 2);
    }
  }, 120_000);

  it("NEGATIVE CONTROL: the text-only .docx shipped until 2026-10-17 fails every fixture, every picture missing", async () => {
    for (const build of DOCX_PICTURE_FIXTURES) {
      const fixture = await build();
      const docx = await docxTextOnly20261017(
        (await flowStandIn(fixture.pdf)).pages,
      );
      // Health: it IS the text-only file — text, and no picture.
      const body = await readDocxBody(docx);
      expect(body.pictures).toEqual([]);
      const report = await compareDocxPictures(fixture.pdf, docx);
      expect(report.pass, fixture.name).toBe(false);
      expect(report.matched, fixture.name).toBe(0);
      expect(report.detail).toMatch(/^0 of \d+ source picture/);
    }
  }, 120_000);

  it("PARTIAL CONTROLS: swapped, replaced, dropped, moved and stretched pictures each fail, for their own reason", async () => {
    const fixture = await captionedPicturesPdf();
    const good = await handBuilt(fixture);
    // Swapped: each picture's pixels are in the DOCX, at the other's place
    // and size — so both are found, and both are in the wrong place.
    const swapped = await compareDocxPictures(
      fixture.pdf,
      await swapFirstTwoPictures(good),
    );
    expect(swapped.pass).toBe(false);
    expect(swapped.matched).toBe(3);
    expect(swapped.detail).toMatch(/wrong size: p1#1, p1#2/);
    expect(swapped.detail).toMatch(/out of order: p1#1, p1#2/);

    // Replaced: the first picture's place shows the second's pixels. The
    // first is missing, one DOCX picture matches nothing, and the bound is
    // not a hair's breadth from the wrong picture: it scores several times
    // what a right one may.
    const replaced = await compareDocxPictures(
      fixture.pdf,
      await replacePictureMedia(good, 0, fixture.pictures[1]!.file!.bytes),
    );
    expect(replaced.pass).toBe(false);
    expect(replaced.detail).toMatch(/missing: p1#1(;|$)/);
    expect(replaced.extras).toHaveLength(1);
    expect(replaced.pictures[0]!.pixels!).toBeGreaterThan(3 * PIXEL_BOUND);

    const dropped = await compareDocxPictures(
      fixture.pdf,
      await dropPicture(good, 1),
    );
    expect(dropped.pass).toBe(false);
    expect(dropped.detail).toMatch(/2 of 3 source picture/);
    expect(dropped.detail).toMatch(/missing: p1#2/);

    const moved = await compareDocxPictures(
      fixture.pdf,
      await movePictureDown(good),
    );
    expect(moved.pass).toBe(false);
    expect(moved.matched).toBe(3);
    expect(moved.detail).toMatch(/out of order: p1#1/);

    const stretched = await compareDocxPictures(
      fixture.pdf,
      await stretchFirstPicture(good),
    );
    expect(stretched.pass).toBe(false);
    expect(stretched.matched).toBe(3);
    expect(stretched.detail).toMatch(/wrong size: p1#1/);
  }, 120_000);

  it("a picture on the wrong page of the document fails, though it is next to its text", async () => {
    const fixture = await scanBetweenPagesPdf();
    // The scan on the FIRST page of the document instead of its own.
    const docx = await handBuiltDocx({
      page: fixture.firstPage,
      pages: [["Before the scan", { picture: 0 }], ["After the scan"]],
      pictures: [{ ...fixture.pictures[0]!.file!, width: 612, height: 792 }],
    });
    const report = await compareDocxPictures(fixture.pdf, docx);
    expect(report.pass).toBe(false);
    expect(report.detail).toMatch(/out of order: p2#1/);
  }, 60_000);
});
