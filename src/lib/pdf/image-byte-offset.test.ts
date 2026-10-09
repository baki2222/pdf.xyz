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

/**
 * A real Node `Buffer` at a non-zero `byteOffset`, over a backing store THIS
 * FILE OWNS AND HAS POISONED.
 *
 * `offsetView` returns a `Uint8Array`; this returns a `Buffer`, which is the
 * shape our engines are actually handed. Same guarantees, and they are
 * guarantees rather than hopes — see the note on `pooled` below for what
 * happens when the backing store belongs to somebody else.
 */
function offsetBuffer(bytes: Uint8Array): Buffer {
  const backing = new ArrayBuffer(bytes.byteLength + 32);
  new Uint8Array(backing).fill(0x41);
  const buf = Buffer.from(backing, 16, bytes.byteLength);
  buf.set(bytes);
  return buf;
}

/**
 * A Node `Buffer` served out of the shared allocation pool, i.e. `byteOffset > 0`.
 *
 * ── WHY THIS IS NOT THE FIXTURE FOR A `rejects` ASSERTION ───────────────────
 *
 * It used to be, and it made this file flaky. On 2026-08-22 CI reported
 *
 *     AssertionError: promise resolved "PDFImage{...}" instead of rejecting
 *
 * for `embedJpg(pooled(JPG_1X1))`, with pdf-lib unchanged at 1.17.1, this file
 * byte-identical to `main`, and `src/lib/pdf/pdf-lib.ts` untouched. The
 * property had not changed; the FIXTURE had, silently, because its premise is
 * ambient process state that no line in this file controls. Two mechanisms,
 * both measured, both producing that exact message:
 *
 *  1. `Buffer.allocUnsafe(n)` for `n < Buffer.poolSize >>> 1` serves out of a
 *     shared 64 KB pool at the current pool offset — but when the remaining
 *     space is too small it calls `createPool()` and the allocation lands at
 *     **offset 0**. Measured on the old two-line spelling at this fixture's
 *     516 bytes: 20,000 calls, **161 at offset 0, first at iteration 123** —
 *     one in 124.2, which is just `poolSize / (8 + 520)`. At offset 0
 *     pdf-lib's `new DataView(imageData.buffer)` reads the right bytes and
 *     embeds fine.
 *
 *     (Measure it at the size you actually ship: the first run of this probe
 *     used a 725-byte payload and reported one in 89. Same spelling, same
 *     conclusion, wrong number — a rate that is a function of the payload
 *     cannot be quoted without it.)
 *
 *  2. Worse, and this one defeats the `byteOffset > 0` check outright: the pool
 *     is SHARED, so whatever landed at pool offset 0 is what
 *     `new DataView(buf.buffer).getUint16(0)` reads. Seed a JPEG there — which
 *     any `Buffer.from(base64)` of a JPEG anywhere in the suite does, at the
 *     same ~1-in-124 rate — and the NEXT pooled JPEG has `byteOffset` 584,
 *     passes every premise check in this file, and still embeds successfully,
 *     because the bytes in front of it really are a JPEG header. Measured:
 *
 *         seeded a JPEG at pool offset 0; pool head = ffd8
 *         next pooled() byteOffset = 584 (> 0, so the health check passes)
 *         but new DataView(p.buffer).getUint16(0) = ffd8
 *         RESULT: RESOLVED -> PDFImage {"width":1,"height":1}
 *
 * So the premise this file needs is not "the view starts at a non-zero offset".
 * It is **"the bytes in front of the image are not themselves a JPEG header"** —
 * exactly what `offsetView` enforces by filling its backing store with 0x41,
 * and exactly what `pooled` cannot enforce, because it does not own the pool.
 *
 * `vitest.config.ts` runs `isolate: false`, so the pool offset when this file
 * runs is the sum of every allocation made by every earlier file in the same
 * worker — and file order changes between runs. That is why it was green on
 * `main`, green on four of five local full runs, and red in CI: nothing about
 * pdf-lib varied, only the address the allocator happened to hand back.
 *
 * The helper is kept, deterministic, for the two claims it can honestly carry:
 * that a real pooled `Buffer` does arrive at a non-zero offset (so the defect
 * below is reachable in production, not a synthetic curiosity), and for the
 * `resolves` cases, where a poisoned pool head changes nothing.
 */
function pooled(bytes: Uint8Array): Buffer {
  // Retry past a pool wrap rather than hoping to miss one. An allocation that
  // lands at offset 0 has just created a fresh pool, so it has also advanced
  // it — the next attempt cannot wrap too. Bounded, and loud if it ever does.
  for (let attempt = 0; attempt < 3; attempt++) {
    Buffer.allocUnsafe(1);
    const buf = Buffer.allocUnsafe(bytes.byteLength);
    if (buf.byteOffset > 0) {
      buf.set(bytes);
      return buf;
    }
  }
  throw new Error(
    `Buffer.allocUnsafe returned offset 0 three times for ${bytes.byteLength} bytes — ` +
      `Node has stopped pooling allocations of this size, and the "pooled" cases below ` +
      `are no longer testing what their name says.`,
  );
}

/**
 * Leave the shared pool beginning with a real JPEG SOI, and return the buffer
 * that put it there so a caller can prove the poisoning landed.
 *
 * Deterministic: each iteration consumes a fixed slice of the pool, so a wrap —
 * and therefore an allocation at offset 0 — is reached within
 * `ceil(poolSize / size) + 1` iterations from ANY starting offset.
 */
function poisonPoolHeadWithJpeg(): Buffer {
  const limit = Math.ceil(Buffer.poolSize / JPG_1X1.byteLength) + 2;
  for (let i = 0; i < limit; i++) {
    const buf = Buffer.allocUnsafe(JPG_1X1.byteLength);
    buf.set(JPG_1X1);
    if (buf.byteOffset === 0) return buf;
  }
  throw new Error(
    `could not reach a fresh Buffer pool in ${limit} allocations of ${JPG_1X1.byteLength} bytes`,
  );
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

  it("a small Node Buffer is pooled, so byteOffset is non-zero — across a wrap", () => {
    // Not decoration: it is the premise of the `pooled` cases below. If Node
    // ever stops pooling, this goes red and says so, instead of those cases
    // quietly degrading into a second copy of the offset-0 tests.
    expect(JPG_1X1.byteLength).toBeLessThan(Buffer.poolSize >>> 1);

    // A single call proves nothing: the old spelling passed this check ~123
    // times in 124 and was wrong on the 124th. Walk a window long enough to
    // cross at least one 64 KB pool boundary from any starting offset, which is
    // where the old spelling returned 0.
    const window = Math.ceil(Buffer.poolSize / JPG_1X1.byteLength) + 2;
    let boundaries = 0;
    let previous = -1;
    const zeroes: number[] = [];
    for (let i = 0; i < window; i++) {
      const offset = pooled(JPG_1X1).byteOffset;
      if (offset === 0) zeroes.push(i);
      // Positive control. Offsets march upward inside one pool and RESTART when
      // a fresh one is created, so a decrease is a boundary crossing — the
      // event the old spelling returned 0 on. Detected this way rather than by
      // probing with a raw `Buffer.allocUnsafe`, which was the first spelling
      // of this control and reported `0` on a full run: `pooled` retries past
      // the wrap and therefore CONSUMES it, so the separate probe never saw
      // one. Reading the offsets `pooled` actually returned cannot miss it,
      // whichever allocation the boundary lands on.
      if (offset < previous) boundaries += 1;
      previous = offset;
    }
    expect(
      boundaries,
      `${window} allocations of ${JPG_1X1.byteLength} bytes crossed no ${Buffer.poolSize}-byte pool boundary, so this test proved nothing`,
    ).toBeGreaterThan(0);
    expect(
      zeroes,
      "pooled() returned a whole-buffer Buffer at offset 0 — the `rejects` cases it feeds would silently become offset-0 duplicates",
    ).toEqual([]);
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
   *
   * NOT INVERTED ON 2026-08-22, and the reason is the whole point of the
   * paragraph above. This assertion went red in CI on the TASK-76 branch with
   * pdf-lib pinned at 1.17.1 in both lockfiles and this file byte-identical to
   * `main`. The temptation was to read a red `rejects` as "the property became
   * true" and flip it — which would have retired `normalizeImageBytes` on the
   * strength of a flaky fixture and re-opened the defect for every user who
   * hands us a JPEG out of a Node `Buffer`. The property is unchanged. What
   * changed was the ambient allocator state feeding `pooled`; the mechanism is
   * measured in full on that helper. The fixture here now owns its own backing
   * store, so the only thing this can still be red about is pdf-lib.
   */
  it("rejects a valid JPEG that sits at a non-zero byteOffset", async () => {
    const doc = await PDFDocument.create();
    await expect(doc.embedJpg(offsetView(JPG_1X1))).rejects.toThrow(
      /SOI not found/,
    );
    // A real Node `Buffer`, not just a `Uint8Array` — the shape the engines are
    // handed — but over a backing store this file poisoned itself.
    await expect(doc.embedJpg(offsetBuffer(JPG_1X1))).rejects.toThrow(
      /SOI not found/,
    );
    // Positive control: the identical bytes at offset 0 embed fine, so the
    // rejection above is about the OFFSET and not about the fixture.
    await expect(doc.embedJpg(JPG_1X1)).resolves.toMatchObject({
      width: 1,
      height: 1,
    });
  });

  /**
   * The regression pin for the flake itself, and it is red on the old spelling.
   *
   * `byteOffset > 0` was necessary and NOT sufficient: pdf-lib reads
   * `new DataView(imageData.buffer)` from position 0 of the WHOLE backing
   * store, so an offset JPEG sharing Node's pool with an earlier JPEG at pool
   * offset 0 embeds happily — the SOI it finds belongs to the neighbour. This
   * arranges that state on purpose and requires the rejection anyway.
   *
   * Swap `offsetBuffer` back to `pooled` here and it fails with the exact CI
   * message, every run rather than one in five.
   */
  it("rejects an offset JPEG even when the pool in front of it starts with a JPEG", async () => {
    const seed = poisonPoolHeadWithJpeg();
    // Health check on the mutation, not on the subject: if the poisoning did
    // not land, this test is a second copy of the one above and says so.
    expect(seed.byteOffset).toBe(0);
    expect(
      new DataView(seed.buffer).getUint16(0),
      "the shared pool does not begin with a JPEG SOI, so nothing here is being defeated",
    ).toBe(0xffd8);

    const shaped = offsetBuffer(JPG_1X1);
    expect(Buffer.isBuffer(shaped)).toBe(true);
    expect(shaped.byteOffset).toBeGreaterThan(0);
    // The head a buffer-start read would see is ours, not the pool's.
    expect(new DataView(shaped.buffer).getUint16(0)).not.toBe(0xffd8);

    const doc = await PDFDocument.create();
    await expect(doc.embedJpg(shaped)).rejects.toThrow(/SOI not found/);
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
    // rasterizer hands `redactPdf` a full-page JPEG per page, `grayscalePdf`
    // encodes one of its own per page, and a copy of each would be a real cost
    // paid for nothing.
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
