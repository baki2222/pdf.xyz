// @vitest-environment node
/**
 * The visible-frame mapping, checked against a DIFFERENT formulation of the same
 * geometry. `placeVisibleRect` is a four-way switch; the oracle below is a
 * rotation matrix — turn the content box clockwise by `/Rotate`, then translate
 * so its lowest corner is the origin — and pdf-lib's own `rotateRectangle` turns
 * the returned anchor into the rectangle it will actually write. A sign error in
 * one arm of the switch cannot also be in the matrix.
 *
 * The consumer-side proof (pdfjs reading the saved PDF) is in
 * `workers/request-signatures/native.integration.test.ts`.
 */
import { PDFDocument, degrees, rotateRectangle } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { normalizeAngle } from "./engine";
import {
  frameFromBoxes,
  placeVisibleRect,
  readPdfFrames,
  visiblePageFrame,
  type Box,
  type VisiblePageFrame,
} from "./page-frame";

const ROTATIONS = Array.from({ length: 4 }, (_, k) => normalizeAngle(k * 90));

/** Map a content-space point into the visible frame by rotating the box clockwise. */
function contentToVisible(
  frame: VisiblePageFrame,
  x: number,
  y: number,
): [number, number] {
  const r = (frame.rotation * Math.PI) / 180;
  const cw = (px: number, py: number): [number, number] => [
    px * Math.cos(r) + py * Math.sin(r),
    -px * Math.sin(r) + py * Math.cos(r),
  ];
  const { x: bx, y: by, width, height } = frame.box;
  const corners = [
    cw(bx, by),
    cw(bx + width, by),
    cw(bx, by + height),
    cw(bx + width, by + height),
  ];
  const minX = Math.min(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const [px, py] = cw(x, y);
  return [px - minX, py - minY];
}

/** The visible-frame rectangle a content-space rectangle covers. */
function visibleRectOf(frame: VisiblePageFrame, rect: Box): Box {
  const pts = [
    contentToVisible(frame, rect.x, rect.y),
    contentToVisible(frame, rect.x + rect.width, rect.y + rect.height),
  ];
  const x = Math.min(pts[0]![0], pts[1]![0]);
  const y = Math.min(pts[0]![1], pts[1]![1]);
  return {
    x,
    y,
    width: Math.max(pts[0]![0], pts[1]![0]) - x,
    height: Math.max(pts[0]![1], pts[1]![1]) - y,
  };
}

const BOXES: { label: string; media: Box; crop: Box }[] = [
  {
    label: "letter at origin",
    media: { x: 0, y: 0, width: 612, height: 792 },
    crop: { x: 0, y: 0, width: 612, height: 792 },
  },
  {
    label: "offset MediaBox",
    media: { x: 100, y: 200, width: 612, height: 792 },
    crop: { x: 100, y: 200, width: 612, height: 792 },
  },
  {
    label: "inset CropBox",
    media: { x: 0, y: 0, width: 612, height: 792 },
    crop: { x: 36, y: 48, width: 540, height: 696 },
  },
];

describe("placeVisibleRect", () => {
  it("the oracle is not the identity: rotate 90 moves the visible origin to the content's bottom-right", () => {
    // Health check on the oracle itself — a matrix that did nothing would agree
    // with a switch that did nothing.
    const frame = frameFromBoxes(
      { x: 0, y: 0, width: 612, height: 792 },
      { x: 0, y: 0, width: 612, height: 792 },
      90,
    );
    const [vx, vy] = contentToVisible(frame, 612, 0);
    expect(vx).toBeCloseTo(0, 9);
    expect(vy).toBeCloseTo(0, 9);
    // …and turns the content's bottom-left corner up to the visible top-left.
    const [ox, oy] = contentToVisible(frame, 0, 0);
    expect(ox).toBeCloseTo(0, 9);
    expect(oy).toBeCloseTo(612, 9);
    expect(frame.width).toBe(792);
    expect(frame.height).toBe(612);
  });

  it("lands every rectangle where it was asked, on every rotation and box shape", () => {
    const wanted: Box = { x: 40, y: 30, width: 200, height: 24 };
    let checked = 0;
    for (const rotation of ROTATIONS) {
      for (const shape of BOXES) {
        const frame = frameFromBoxes(shape.media, shape.crop, rotation);
        const at = placeVisibleRect(frame, wanted);
        expect(at.rotate).toBe(rotation);
        // What pdf-lib will actually write as /Rect (no border, so no inflation).
        const written = rotateRectangle(
          { x: at.x, y: at.y, width: at.width, height: at.height },
          0,
          at.rotate,
        );
        const seen = visibleRectOf(frame, written);
        const where = `rotate ${rotation}, ${shape.label}`;
        expect(seen.x, where).toBeCloseTo(wanted.x, 6);
        expect(seen.y, where).toBeCloseTo(wanted.y, 6);
        expect(seen.width, where).toBeCloseTo(wanted.width, 6);
        expect(seen.height, where).toBeCloseTo(wanted.height, 6);
        checked += 1;
      }
    }
    expect(checked).toBe(ROTATIONS.length * BOXES.length);
  });
});

describe("frameFromBoxes", () => {
  it("swaps the visible axes on a quarter turn only", () => {
    for (const rotation of ROTATIONS) {
      const frame = frameFromBoxes(BOXES[0]!.media, BOXES[0]!.crop, rotation);
      const quarter = rotation === 90 || rotation === 270;
      expect([frame.width, frame.height]).toEqual(
        quarter ? [792, 612] : [612, 792],
      );
    }
  });

  it("normalizes any multiple of 90, including negatives", () => {
    const m = BOXES[0]!.media;
    expect(frameFromBoxes(m, m, -90).rotation).toBe(270);
    expect(frameFromBoxes(m, m, 450).rotation).toBe(90);
  });

  it("clips the CropBox to the MediaBox (the effective crop)", () => {
    const frame = frameFromBoxes(
      { x: 0, y: 0, width: 612, height: 792 },
      { x: -50, y: 100, width: 800, height: 100 },
      0,
    );
    expect(frame.box).toEqual({ x: 0, y: 100, width: 612, height: 100 });
  });

  it("reads a box written with negative extents", () => {
    const frame = frameFromBoxes(
      { x: 612, y: 792, width: -612, height: -792 },
      { x: 612, y: 792, width: -612, height: -792 },
      0,
    );
    expect(frame.box).toEqual({ x: 0, y: 0, width: 612, height: 792 });
  });
});

describe("visiblePageFrame / readPdfFrames on real pages", () => {
  it("reads the CropBox and /Rotate a page actually carries", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setCropBox(36, 48, 540, 696);
    page.setRotation(degrees(270));
    const frame = visiblePageFrame(page);
    expect(frame).toEqual({
      width: 696,
      height: 540,
      rotation: 270,
      box: { x: 36, y: 48, width: 540, height: 696 },
    });

    const read = await readPdfFrames(await doc.save());
    expect(read?.frames).toEqual([frame]);
    expect(read?.encrypted).toBe(false);
  });

  it("reports an encrypted PDF as locked rather than unreadable", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: "Standard", V: 1, R: 2, P: -4 }),
    );
    const read = await readPdfFrames(
      await doc.save({ useObjectStreams: false }),
    );
    expect(read?.encrypted).toBe(true);
    expect(read?.frames).toHaveLength(2);
  });

  it("returns null for bytes that are not a PDF", async () => {
    expect(await readPdfFrames(new TextEncoder().encode("nope"))).toBeNull();
  });
});
