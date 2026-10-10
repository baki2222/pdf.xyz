// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  degrees,
  type PDFFont,
} from "pdf-lib";
import { readAsViewer, type Box } from "@/tests/pdf-viewer-read";
import { encodePng } from "./extract-images";
import { signPdf, type SignatureInput } from "./signature";
import { STAMP_POSITIONS, resolveAlign, type StampPosition } from "./stamp";

/**
 * Sign PDF, read back the way a READER receives it.
 *
 * The defect (audit at 67e8d0f): the signature was placed in the page's
 * unrotated MediaBox. Scanned landscape documents are routinely portrait pages
 * carrying `/Rotate 90`, and our own Rotate PDF writes `/Rotate`; on those a
 * "bottom-right" signature landed in another corner and read vertically. Our
 * own Crop PDF writes a CropBox; with 72 pt crop margins a signature drawn at
 * y = 24 sat entirely outside the visible page — and the tool said "PDF
 * signed" over a document with no visible signature.
 *
 * Every position below is read through pdfjs's viewport (where `/Rotate` and
 * the CropBox are applied), never from signature.ts's own arithmetic. What the
 * anchors MEAN is written here independently: "left" is the margin from the
 * visible left edge, "center" is the visible centre, and so on.
 */

const MARGIN = 24;
const TOL = 0.05;

/** A one-page Letter PDF with the page geometry our own tools write. */
async function letterPage(opts: {
  rotate: number;
  crop?: Box;
  media?: Box;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (opts.media) page.setMediaBox(...opts.media);
  if (opts.crop) page.setCropBox(...opts.crop);
  page.setRotation(degrees(opts.rotate));
  return doc.save();
}

/**
 * "uncropped" at /Rotate 0 is the positive control: a plain page, where the old
 * placement of an IMAGE was already right and the fix must agree with it — so
 * a blanket transform cannot pass. (A typed signature there moves up by its
 * descent, on purpose: the old code drew the baseline on the margin, so
 * descenders hung below it, and off the page at margin 0.) The crop is 72 pt
 * in on every side — larger than the 24 pt margin, so a MediaBox-relative
 * signature lands wholly outside it.
 */
const GEOMETRIES: { name: string; crop?: Box; media?: Box }[] = [
  { name: "uncropped" },
  { name: "cropped 72 pt in (Crop PDF)", crop: [72, 72, 468, 648] },
  { name: "offset MediaBox", media: [100, 50, 500, 700] },
];
const ROTATIONS = [0, 90, 180, 270];

/** A non-square image, so a swapped width/height axis cannot pass. */
function solidPng(width: number, height: number): Uint8Array {
  const samples = new Uint8Array(width * height * 3).fill(40);
  return encodePng(width, height, "rgb8", samples);
}
const WIDE_PNG = solidPng(4, 2);

/**
 * A real 4 x 2 baseline JPEG (Pillow, quality 90) — the shape an upload takes
 * when "Remove paper background" is off. Same aspect as {@link WIDE_PNG}.
 */
const WIDE_JPG = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4UooooA//2Q==",
    "base64",
  ),
);

/** Every image XObject in `bytes`, as its /Filter and raw stream contents. */
async function imageStreams(
  bytes: Uint8Array,
): Promise<{ filter: string; contents: Uint8Array }[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    )
    .map((obj) => ({
      filter: String(obj.dict.get(PDFName.of("Filter"))),
      contents: obj.contents,
    }));
}

/** Where an anchor says a box of `w`×`h` must sit on a `W`×`H` viewer page. */
function expectedBox(
  position: StampPosition,
  W: number,
  H: number,
  w: number,
  h: number,
): Box {
  const { h: ha, v: va } = resolveAlign(position);
  const x0 =
    ha === "left" ? MARGIN : ha === "right" ? W - MARGIN - w : W / 2 - w / 2;
  const y0 =
    va === "bottom" ? MARGIN : va === "top" ? H - MARGIN - h : H / 2 - h / 2;
  return [x0, y0, x0 + w, y0 + h];
}

function expectBox(actual: Box, expected: Box, label: string) {
  for (let i = 0; i < 4; i += 1) {
    expect(Math.abs(actual[i]! - expected[i]!), `${label} [${i}]`).toBeLessThan(
      TOL,
    );
  }
}

function expectInside(b: Box, W: number, H: number, label: string) {
  expect(b[0], `${label} left`).toBeGreaterThanOrEqual(MARGIN - TOL);
  expect(b[1], `${label} bottom`).toBeGreaterThanOrEqual(MARGIN - TOL);
  expect(b[2], `${label} right`).toBeLessThanOrEqual(W - MARGIN + TOL);
  expect(b[3], `${label} top`).toBeLessThanOrEqual(H - MARGIN + TOL);
}

let helvetica: PDFFont | null = null;
async function helv(): Promise<PDFFont> {
  helvetica ??= await (
    await PDFDocument.create()
  ).embedFont(StandardFonts.Helvetica);
  return helvetica;
}

/**
 * A typed signature's visible glyph box, from what the reader received: the
 * baseline-left and font size pdfjs reports, and the face's own advance width,
 * ascent and descent at that size.
 */
async function glyphBox(t: {
  str: string;
  x: number;
  y: number;
  size: number;
}) {
  const font = await helv();
  const width = font.widthOfTextAtSize(t.str, t.size);
  const full = font.heightAtSize(t.size);
  const ascent = font.heightAtSize(t.size, { descender: false });
  const descent = full - ascent;
  return [t.x, t.y - descent, t.x + width, t.y + ascent] as Box;
}

describe("Sign PDF places the signature where the reader sees it", () => {
  for (const g of GEOMETRIES) {
    for (const rotate of ROTATIONS) {
      it(`image signature — ${g.name}, /Rotate ${rotate}`, async () => {
        const base = await letterPage({ rotate, crop: g.crop, media: g.media });
        for (const position of STAMP_POSITIONS) {
          const out = await signPdf(
            base,
            { kind: "image", bytes: WIDE_PNG, format: "png" },
            { pageIndex: 0, position, width: 200, margin: MARGIN },
          );
          const read = await readAsViewer(out);
          // Health: the reader found the one thing drawn. A blind reader would
          // pass every placement assertion below vacuously.
          expect(read.imageFrames.length, position).toBe(1);
          const img = read.imageFrames[0]!;
          expect(img.decoded, `${position} decoded`).toBe(true);
          expect(img.upright, `${position} upright`).toBe(true);
          expectBox(
            img.box,
            expectedBox(position, read.width, read.height, 200, 100),
            position,
          );
          expectInside(img.box, read.width, read.height, position);
        }
      });

      it(`typed signature — ${g.name}, /Rotate ${rotate}`, async () => {
        const base = await letterPage({ rotate, crop: g.crop, media: g.media });
        const input: SignatureInput = {
          kind: "typed",
          text: "Ada Lovelace",
          style: "print",
        };
        for (const position of STAMP_POSITIONS) {
          const out = await signPdf(base, input, {
            pageIndex: 0,
            position,
            width: 200,
            margin: MARGIN,
          });
          const read = await readAsViewer(out);
          expect(
            read.texts.map((t) => t.str),
            position,
          ).toEqual(["Ada Lovelace"]);
          const t = read.texts[0]!;
          expect(t.upright, `${position} upright`).toBe(true);
          const box = await glyphBox(t);
          // The requested size is the signature's width on the page. (pdfjs's
          // own advance for Helvetica differs from the AFM by under 1%.)
          expect(box[2] - box[0], `${position} width`).toBeCloseTo(200, 1);
          expect(Math.abs(t.width - 200) / 200).toBeLessThan(0.01);
          expectBox(
            box,
            expectedBox(
              position,
              read.width,
              read.height,
              box[2] - box[0],
              box[3] - box[1],
            ),
            position,
          );
          expectInside(box, read.width, read.height, position);
        }
      });
    }
  }

  it("a JPEG signature (paper kept) is embedded as that JPEG and placed where the reader sees it", async () => {
    const base = await letterPage({ rotate: 90, crop: [72, 72, 468, 648] });
    const out = await signPdf(
      base,
      { kind: "image", bytes: WIDE_JPG, format: "jpg" },
      { pageIndex: 0, position: "bottom-right", width: 200, margin: MARGIN },
    );
    // Embedded as the JPEG it was handed — not re-encoded, not as a PNG.
    const streams = await imageStreams(out);
    expect(streams.map((st) => st.filter)).toEqual(["/DCTDecode"]);
    expect(
      Buffer.from(streams[0]!.contents).equals(Buffer.from(WIDE_JPG)),
    ).toBe(true);
    // And a reader decodes it, upright, at the anchored box.
    const read = await readAsViewer(out);
    expect(read.imageFrames.map((f) => [f.decoded, f.upright])).toEqual([
      [true, true],
    ]);
    expectBox(
      read.imageFrames[0]!.box,
      expectedBox("bottom-right", read.width, read.height, 200, 100),
      "jpeg",
    );
  });

  it("shrinks a tall image to fit the visible page, keeping its shape", async () => {
    // 1:4 portrait image at 400 pt wide would be 1600 pt tall; the page the
    // reader sees (Letter at /Rotate 90) is 612 pt tall.
    const base = await letterPage({ rotate: 90 });
    const out = await signPdf(
      base,
      { kind: "image", bytes: solidPng(2, 8), format: "png" },
      { pageIndex: 0, position: "top-left", width: 400, margin: MARGIN },
    );
    const read = await readAsViewer(out);
    expect([read.width, read.height]).toEqual([792, 612]);
    const img = read.imageFrames[0]!;
    expectInside(img.box, read.width, read.height, "tall image");
    const w = img.box[2] - img.box[0];
    const h = img.box[3] - img.box[1];
    expect(h).toBeCloseTo(612 - 2 * MARGIN, 1);
    expect(h / w).toBeCloseTo(4, 3);
    expectBox(img.box, expectedBox("top-left", 792, 612, w, h), "tall image");
  });

  it("refuses a typed signature that cannot fit at a legible size", async () => {
    const base = await letterPage({ rotate: 0, crop: [200, 200, 150, 400] });
    await expect(
      signPdf(
        base,
        {
          kind: "typed",
          text: "Alexandra Constance Featherstonehaugh-Montgomery",
          style: "print",
        },
        { pageIndex: 0, position: "bottom-left", width: 48, margin: MARGIN },
      ),
    ).rejects.toThrow(/does not fit/i);
    // Control: a short name on the same small page is signed.
    await expect(
      signPdf(
        base,
        { kind: "typed", text: "Ada", style: "print" },
        { pageIndex: 0, position: "bottom-left", width: 48, margin: MARGIN },
      ),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
