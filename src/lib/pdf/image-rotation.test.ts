import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { apply, boxOf, drawnImages } from "@/tests/drawn-images";
import {
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
} from "@/tests/jpeg-fixtures";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  type ImagePageOptions,
} from "./image-page-layout";
import { buildImagePdf, imagesToPdf, imagesToPdfs } from "./image-to-pdf";
import {
  nextQuarterTurn,
  turnedShape,
  unturnedBox,
  type ImageQuarterTurn,
} from "./image-rotation";

/*
 * Audit png-to-pdf#2 (2026-11-08): a per-image quarter turn, chosen on the
 * card, reaches the PDF. Every assertion reads the SAVED bytes back — the
 * page's MediaBox and the matrix a viewer applies at the image's `Do`.
 */

const FIT: ImagePageOptions = {
  ...DEFAULT_IMAGE_PAGE_OPTIONS,
  pageSize: "fit",
  margin: "none",
};

const photo = (bytes: Uint8Array, rotation?: ImageQuarterTurn) => ({
  name: "photo.jpg",
  type: "image/jpeg",
  bytes,
  ...(rotation === undefined ? {} : { rotation }),
});

async function placed(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const { width, height } = doc.getPage(0).getSize();
  const [image] = await drawnImages(pdf);
  if (!image) throw new Error("no image drawn");
  // Where the STORED image's top-left corner (u 0, v 1) lands on the page.
  const topLeft = apply(image.ctm, 0, 1).map(
    (n) => Math.round(n * 1000) / 1000 + 0,
  );
  return { width, height, ctm: image.ctm, topLeft, box: boxOf(image.ctm) };
}

describe("per-image rotation (audit png-to-pdf#2)", () => {
  it("health check: with no turn the photo is landscape and its top-left is top-left", async () => {
    const p = await placed(await imagesToPdf("jpg", [photo(JPEG_30X20)], FIT));
    expect([p.width, p.height]).toEqual([JPEG_WIDTH, JPEG_HEIGHT]);
    expect(p.topLeft).toEqual([0, JPEG_HEIGHT]);
  });

  it.each([
    // turn, page shape, where the stored top-left corner ends up
    [90, [JPEG_HEIGHT, JPEG_WIDTH], [JPEG_HEIGHT, JPEG_WIDTH]], // top-right
    [180, [JPEG_WIDTH, JPEG_HEIGHT], [JPEG_WIDTH, 0]], // bottom-right
    [270, [JPEG_HEIGHT, JPEG_WIDTH], [0, 0]], // bottom-left
  ] as const)(
    "a %i° clockwise turn reshapes the page and turns the image inside it",
    async (turn, shape, corner) => {
      const p = await placed(
        await imagesToPdf("jpg", [photo(JPEG_30X20, turn)], FIT),
      );
      expect([p.width, p.height]).toEqual(shape);
      expect(p.topLeft).toEqual(corner);
      // The image fills the page exactly: nothing drawn off it.
      expect(p.box.x0).toBeCloseTo(0, 6);
      expect(p.box.y0).toBeCloseTo(0, 6);
      expect(p.box.x1).toBeCloseTo(shape[0], 6);
      expect(p.box.y1).toBeCloseTo(shape[1], 6);
    },
  );

  it("comes on top of the EXIF turn: EXIF 6 plus 90° is the upright file turned 180°", async () => {
    const exif = await placed(
      await imagesToPdf("jpg", [photo(JPEG_30X20_EXIF6, 90)], FIT),
    );
    const upright = await placed(
      await imagesToPdf("jpg", [photo(JPEG_30X20, 180)], FIT),
    );
    expect([exif.width, exif.height]).toEqual([upright.width, upright.height]);
    exif.ctm.forEach((v, i) => expect(v).toBeCloseTo(upright.ctm[i]!, 6));
  });

  it("on a fixed page, Auto orientation follows the TURNED shape and the image stays centred", async () => {
    const options: ImagePageOptions = {
      ...DEFAULT_IMAGE_PAGE_OPTIONS,
      pageSize: "a4",
      orientation: "auto",
    };
    const p = await placed(
      await imagesToPdf("jpg", [photo(JPEG_30X20, 90)], options),
    );
    // A landscape photo turned a quarter is portrait: a portrait A4.
    expect(p.height).toBeGreaterThan(p.width);
    expect((p.box.x0 + p.box.x1) / 2).toBeCloseTo(p.width / 2, 6);
    expect((p.box.y0 + p.box.y1) / 2).toBeCloseTo(p.height / 2, 6);
    expect(p.box.x1 - p.box.x0).toBeCloseTo(JPEG_HEIGHT, 6);
  });

  it("reaches the per-image PDFs and the size-limit builder too", async () => {
    const [one] = await imagesToPdfs("jpg", [photo(JPEG_30X20, 90)], FIT);
    const viaZip = await placed(one!.bytes);
    expect(viaZip.topLeft).toEqual([JPEG_HEIGHT, JPEG_WIDTH]);
    const built = await placed(
      await buildImagePdf("jpg", [photo(JPEG_30X20, 90)], FIT),
    );
    expect(built.topLeft).toEqual([JPEG_HEIGHT, JPEG_WIDTH]);
  });

  it("the geometry: four presses come back to the start, and every box fills its rect", () => {
    let turn: ImageQuarterTurn = 0;
    const seen: ImageQuarterTurn[] = [];
    for (let i = 0; i < 4; i++) seen.push((turn = nextQuarterTurn(turn)));
    expect(seen).toEqual([90, 180, 270, 0]);
    expect(turnedShape({ width: 3, height: 2 }, 90)).toEqual({
      width: 2,
      height: 3,
    });
    expect(unturnedBox({ x: 1, y: 2, width: 3, height: 4 }, 0)).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });
});
