// @vitest-environment node
/**
 * A valid JPEG must embed no matter WHERE IT SITS IN ITS BUFFER.
 *
 * pdf-lib 1.17.1's `JpegEmbedder.for` reads the header through
 *
 *     const dataView = new DataView(imageData.buffer);
 *
 * — the ArrayBuffer alone, with neither `byteOffset` nor `byteLength`. For any
 * `Uint8Array` that is a VIEW rather than a whole buffer, that reads the bytes
 * in front of the image and throws `SOI not found in JPEG` on a file that is
 * perfectly well formed. The declared parameter type is `Uint8Array`, and an
 * offset view is a `Uint8Array`, so this is a contract our engines break at
 * their own front door.
 *
 * It fails in the convenient direction, twice over:
 *
 *  - the message names the IMAGE ("SOI not found"), so it reads as the user's
 *    file being broken rather than our allocator being visible; and
 *  - `editPdf`, `imagesToPdf` and `signPdf` each catch it and re-word it as
 *    "couldn't be decoded as a JPG" / "Use a PNG image", which finishes the job
 *    of blaming the input.
 *
 * It is also SIZE-DEPENDENT in Node, which is why it looks like a bad fixture
 * rather than a bug: `Buffer` serves allocations below `Buffer.poolSize >>> 1`
 * out of a shared pool, so a small JPEG gets a non-zero `byteOffset` and a
 * large one does not. The same helper therefore passes for one image and fails
 * for another. (`Buffer.poolSize` is 65536 on Node 24 — a 32 KB threshold, not
 * the 8 KB/4 KB pairing older notes assume.)
 *
 * ── SCOPE, as measured rather than assumed ──────────────────────────────────
 *
 * `new DataView(` appears exactly ONCE in all of pdf-lib 1.17.1, on that line.
 * `PngEmbedder` routes through `@pdf-lib/upng`, whose `decode` starts with
 * `new Uint8Array(buff)` — a COPY of a typed array, offsets honoured — and
 * `PDFDocument.load` is offset-clean as well. Both are pinned below, because
 * "PNG is fine" is exactly the kind of claim that goes stale under an upgrade.
 *
 * No user-facing path reaches this today: every producer feeding our five
 * embed sites (`File.arrayBuffer()` in `readFileBytes`, `Blob.arrayBuffer()`
 * and `dataUrlToBytes` in the rasterizer) yields a whole-buffer view at offset
 * zero. That is a property of today's callers, not of the engines, and one
 * `subarray()` anywhere upstream retires it silently. These tests bind the
 * property to the engine instead.
 *
 * @pdf-lib-raw-embedder — this file calls `embedJpg`/`embedPng` directly, on
 * purpose. It is the one thing that must NOT go through `embedRasterImage`:
 * pinning the library's broken behaviour through the wrapper that hides it
 * would pin nothing. `raster-embedder-boundary.test.ts` forbids that spelling
 * everywhere else and bounds this exemption.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { editPdf } from "./edit";
import { extractPdfImages } from "./extract-images";
import { imagesToPdf } from "./image-to-pdf";
import { embedRasterImage } from "./pdf-lib";

// The same real 1×1 files the other image tests use. `Uint8Array.from` here is
// deliberate: it produces a whole-buffer array at offset 0, i.e. the ONLY shape
// the engines are exercised with anywhere else in the suite.
const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

/**
 * The same bytes, as a view starting 16 bytes into a larger buffer.
 *
 * The head is poisoned rather than zeroed so a buffer-start read cannot pass by
 * luck, and the tail is poisoned too: `JpegEmbedder` bounds its marker scan by
 * `dataView.byteLength`, which is the WHOLE buffer when the offset is dropped,
 * so a run past the image's end has somewhere wrong to go.
 */
function offsetView(bytes: Uint8Array): Uint8Array {
  const backing = new ArrayBuffer(bytes.byteLength + 32);
  new Uint8Array(backing).fill(0x41);
  const view = new Uint8Array(backing, 16, bytes.byteLength);
  view.set(bytes);
  return view;
}

/** A Node `Buffer` served out of the shared pool, i.e. `byteOffset > 0`. */
function pooled(bytes: Uint8Array): Buffer {
  // Advance the pool so the next allocation cannot land on offset 0 by luck.
  Buffer.allocUnsafe(1);
  const buf = Buffer.allocUnsafe(bytes.byteLength);
  buf.set(bytes);
  return buf;
}

/** A one-page blank PDF to edit. */
async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  return doc.save();
}

describe("the shapes a Uint8Array can arrive in", () => {
  it("offsetView really is an offset view over a poisoned buffer", () => {
    const view = offsetView(JPG_1X1);
    expect(view.byteOffset).toBe(16);
    expect(view.byteLength).toBe(JPG_1X1.byteLength);
    expect(view.buffer.byteLength).toBeGreaterThan(view.byteLength);
    expect(Buffer.from(view).equals(Buffer.from(JPG_1X1))).toBe(true);
    // The head the broken DataView would read is NOT a JPEG SOI.
    expect(new DataView(view.buffer).getUint16(0)).not.toBe(0xffd8);
  });

  it("a small Node Buffer is pooled, so byteOffset is non-zero", () => {
    // Not decoration: it is the premise of the `pooled` cases below. If Node
    // ever stops pooling, this goes red and says so, instead of those cases
    // quietly degrading into a second copy of the offset-0 tests.
    expect(JPG_1X1.byteLength).toBeLessThan(Buffer.poolSize >>> 1);
    expect(pooled(JPG_1X1).byteOffset).toBeGreaterThan(0);
  });
});

describe("pdf-lib 1.17.1, unwrapped — pins, not endorsements", () => {
  /**
   * INVERT THIS, do not delete it, when it starts failing.
   *
   * The property it stands for is "pdf-lib's JpegEmbedder honours the
   * byteOffset of the view it is handed" — NOT "we upgraded pdf-lib". If this
   * `rejects` assertion ever fails, that property has become true and
   * `normalizeImageBytes` can retire; flip the assertion to `resolves` and say
   * which version made it so. Retiring the normalizer on the strength of a
   * version bump instead of this test is how a fix gets un-fixed.
   */
  it("rejects a valid JPEG that sits at a non-zero byteOffset", async () => {
    const doc = await PDFDocument.create();
    await expect(doc.embedJpg(offsetView(JPG_1X1))).rejects.toThrow(
      /SOI not found/,
    );
    await expect(doc.embedJpg(pooled(JPG_1X1))).rejects.toThrow(
      /SOI not found/,
    );
    // Positive control: the identical bytes at offset 0 embed fine, so the
    // rejection above is about the OFFSET and not about the fixture.
    await expect(doc.embedJpg(JPG_1X1)).resolves.toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it("accepts an offset PNG — the defect is JPEG-shaped", async () => {
    const doc = await PDFDocument.create();
    await expect(doc.embedPng(offsetView(PNG_1X1))).resolves.toMatchObject({
      width: 1,
      height: 1,
    });
    await expect(doc.embedPng(pooled(PNG_1X1))).resolves.toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it("parses an offset PDF — the defect is not in the loader", async () => {
    const base = await blankPdf();
    const doc = await PDFDocument.load(offsetView(base));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("embedRasterImage — the one place the offset is normalized", () => {
  it("embeds an offset JPEG and an offset PNG", async () => {
    const doc = await PDFDocument.create();
    await expect(
      embedRasterImage(doc, offsetView(JPG_1X1), "jpg"),
    ).resolves.toMatchObject({ width: 1, height: 1 });
    await expect(
      embedRasterImage(doc, offsetView(PNG_1X1), "png"),
    ).resolves.toMatchObject({ width: 1, height: 1 });
  });

  it("does not copy bytes that are already a whole buffer at offset 0", async () => {
    // The normalization must be free on every path we actually ship — the
    // rasterizer hands `grayscalePdf` a full-page JPEG per page, and a copy of
    // each would be a real cost paid for nothing.
    const doc = await PDFDocument.create();
    const image = await embedRasterImage(doc, JPG_1X1, "jpg");
    const out = await extractPdfImages(await withImage(doc, image));
    expect(out.images).toHaveLength(1);
    expect(Buffer.from(out.images[0]!.bytes).equals(Buffer.from(JPG_1X1))).toBe(
      true,
    );
  });
});

/** Draw an embedded image onto a fresh page and save. */
async function withImage(
  doc: PDFDocument,
  image: Awaited<ReturnType<typeof embedRasterImage>>,
): Promise<Uint8Array> {
  const page = doc.addPage([100, 100]);
  page.drawImage(image, { x: 0, y: 0, width: 100, height: 100 });
  return doc.save();
}

describe("the engines, composed — an offset view must survive the whole chain", () => {
  it("imagesToPdf embeds an offset JPEG, byte-for-byte", async () => {
    const bytes = await imagesToPdf("jpg", [
      { name: "pixel.jpg", type: "image/jpeg", bytes: offsetView(JPG_1X1) },
    ]);
    // Not just "it did not throw": read the image back out of the PDF and
    // compare it to the source. An embed that silently landed the wrong bytes
    // would pass a rejects/resolves check and fail this one.
    const out = await extractPdfImages(bytes);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]!.format).toBe("jpg");
    expect({
      width: out.images[0]!.width,
      height: out.images[0]!.height,
    }).toEqual({ width: 1, height: 1 });
    expect(Buffer.from(out.images[0]!.bytes).equals(Buffer.from(JPG_1X1))).toBe(
      true,
    );
  });

  it("imagesToPdf embeds a pooled Node Buffer JPEG", async () => {
    const bytes = await imagesToPdf("jpg", [
      { name: "pixel.jpg", type: "image/jpeg", bytes: pooled(JPG_1X1) },
    ]);
    const out = await extractPdfImages(bytes);
    expect(out.images).toHaveLength(1);
    expect(Buffer.from(out.images[0]!.bytes).equals(Buffer.from(JPG_1X1))).toBe(
      true,
    );
  });

  it("imagesToPdf embeds an offset PNG", async () => {
    const bytes = await imagesToPdf("png", [
      { name: "pixel.png", type: "image/png", bytes: offsetView(PNG_1X1) },
    ]);
    const out = await extractPdfImages(bytes);
    expect(out.images).toHaveLength(1);
    expect({
      width: out.images[0]!.width,
      height: out.images[0]!.height,
    }).toEqual({ width: 1, height: 1 });
  });

  it("editPdf flattens an offset JPEG onto a page", async () => {
    const result = await editPdf(await blankPdf(), [
      {
        type: "image",
        page: 1,
        x: 40,
        y: 40,
        width: 120,
        height: 120,
        format: "jpg",
        bytes: offsetView(JPG_1X1),
      },
    ]);
    expect(result.counts.image).toBe(1);
    const out = await extractPdfImages(result.bytes);
    expect(out.images).toHaveLength(1);
    expect(Buffer.from(out.images[0]!.bytes).equals(Buffer.from(JPG_1X1))).toBe(
      true,
    );
  });

  it("editPdf flattens a pooled Node Buffer JPEG", async () => {
    const result = await editPdf(await blankPdf(), [
      {
        type: "image",
        page: 1,
        x: 40,
        y: 40,
        width: 120,
        height: 120,
        format: "jpg",
        bytes: pooled(JPG_1X1),
      },
    ]);
    expect(result.counts.image).toBe(1);
  });
});
