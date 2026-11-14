// @vitest-environment node
// @native-canvas
/**
 * The per-page image map (`./pdf-page-images`), through the preflight every
 * pdf.js open runs (`preflightPdfjsBytes`): which pages it finds, what each
 * weighs, and that every way it cannot tell fails SAFE (the page counts as
 * past the budget). The render paths that act on it are proved in
 * src/tests/hostile/page-images.test.ts, in child processes.
 *
 * Image dictionaries here carry their sizes and a few bytes of data: the map
 * reads sizes from dictionaries and never decodes an image.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAGE_IMAGES_NOTE,
  PAGE_IMAGES_UNKNOWN_NOTE,
  RASTER_MAX_BILEVEL_PIXELS,
  RASTER_MAX_IMAGE_PIXELS,
  RASTER_MAX_PAGE_IMAGE_PIXELS,
  pageImageVerdict,
  pageImagesTooLargeMessage,
  pageImagesUnknownMessage,
  preflightPdfjsBytes,
  refuseOverBudgetPages,
  type PdfjsPreflight,
} from "./pdfjs-guard";
import { rawPdf } from "@/tests/hostile/conversion-out.fixtures";
import {
  formsBesideHeavyPagePdf,
  imagePagesPdf,
  withObjectStreams,
} from "@/tests/hostile/page-images.fixtures";
import { encryptPdf } from "@/tests/encrypted-pdf";

const STUB = new Uint8Array([0x78, 0x9c]);
const image = (w: number, h: number, extra = "") => ({
  dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode ${extra}`,
  stream: STUB,
});

/** Page weights in page order (the page objects' numbers, ascending). */
function weights(pre: PdfjsPreflight): number[] {
  expect(pre.pages, "the map was built").not.toBeNull();
  return [...pre.pages!.weights.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, w]) => w);
}

const req = createRequire(import.meta.url);
type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
const pdfjs = () =>
  (pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      req.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>);

/** The page object numbers pdf.js itself reports, in page order. */
async function pdfjsPageRefs(bytes: Uint8Array): Promise<number[]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice(), verbosity: 0 })
    .promise;
  const out: number[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    out.push((await doc.getPage(i)).ref!.num);
  }
  await doc.loadingTask.destroy();
  return out;
}

describe("the map reads what each page PAINTS", () => {
  it("ten 49 MP images on one page weigh 490 MP; one weighs 49 MP and needs no map", async () => {
    const ten = await preflightPdfjsBytes(
      await imagePagesPdf([Array<number>(10).fill(7000)], { real: false }),
    );
    expect(weights(ten)).toEqual([490_000_000]);
    // The fast path: one image can weigh no more than the page budget.
    const one = await preflightPdfjsBytes(
      await imagePagesPdf([[7000]], { real: false }),
    );
    expect(one.pages).toBeNull();
  });

  it("a shared /Resources listing 300 images, each page drawing one: every page weighs its own image, in text and in object streams", async () => {
    const scan = await imagePagesPdf(
      Array.from({ length: 300 }, () => [3000]),
      { real: false, shared: true },
    );
    for (const bytes of [scan, await withObjectStreams(scan)]) {
      const pre = await preflightPdfjsBytes(bytes);
      const w = weights(pre);
      // Health: the map found every page, through inherited resources.
      expect(w).toHaveLength(300);
      expect(new Set(w)).toEqual(new Set([9_000_000]));
      // Every page object pdf.js reports is one the map weighed.
      const refs = await pdfjsPageRefs(bytes);
      expect(refs.filter((r) => !pre.pages!.weights.has(r))).toEqual([]);
    }
  }, 60_000);

  it("an image painted four times through forms counts four times, as an inline image counts every time read", async () => {
    // History (hostile review r1, 2026-11-14): this asserted 16 MP, "pdf.js
    // decodes it once per page". It does, but every `Do` paints the decoded
    // pixels again at O(their count) on the main thread: one 16 MP image
    // painted 60 times drew for 180 s in the editor. Inverted, not deleted.
    // Plus a 45 MP page so the file weighs past the budget and the map runs.
    const pre = await preflightPdfjsBytes(
      await formsBesideHeavyPagePdf(4000, 6708, { real: false }),
    );
    expect(weights(pre)).toEqual([64_000_000, 6708 * 6708]);
    // An inline 4,000 x 4,000 image in a content stream the page lists
    // four times: pdf.js reads it four times, 64 MP.
    const inline = `BI /W 4000 /H 4000 /CS /RGB /BPC 8 ID ${"\u0001".repeat(3)} EI\n`;
    const listed = await preflightPdfjsBytes(
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents [4 0 R 4 0 R 4 0 R 4 0 R] >>",
        { dict: "", stream: inline },
      ]),
    );
    expect(weights(listed)).toEqual([64_000_000]);
  });

  it("a /Contents array is read joined: a name ending one stream and `Do` opening the next paint the image", async () => {
    const pre = await preflightPdfjsBytes(
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /A 6 0 R /B 7 0 R >> >> /Contents [4 0 R 5 0 R] >>",
        { dict: "", stream: "q 100 0 0 100 0 0 cm /A Do /B" },
        { dict: "", stream: " Do Q" },
        image(6000, 6000),
        image(5000, 5000),
      ]),
    );
    expect(weights(pre)).toEqual([61_000_000]);
  });

  it("bilevel images weigh one eighth; images pdf.js skips in a preview weigh nothing", async () => {
    const bilevel = (side: number) => ({
      dict: `/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /BitsPerComponent 1 /ColorSpace /DeviceGray /Filter /FlateDecode`,
      stream: STUB,
    });
    const page = (names: string[], first: number) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << ${names.map((n, k) => `/${n} ${first + k} 0 R`).join(" ")} >> >> /Contents ${first + names.length} 0 R >>`;
    const pre = await preflightPdfjsBytes(
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        // Two 20,000 x 20,000 bilevel scans (400 MP each, AT the bilevel
        // budget): 2 x 50 MP weighted.
        page(["S1", "S2"], 4),
        bilevel(20_000),
        bilevel(20_000),
        { dict: "", stream: "/S1 Do /S2 Do" },
      ]),
    );
    expect(pre.overBudgetImage).toBe(false);
    expect(weights(pre)).toEqual([
      2 * 400_000_000 * (RASTER_MAX_IMAGE_PIXELS / RASTER_MAX_BILEVEL_PIXELS),
    ]);
    // An image past its own budget (CO-08) is skipped in a preview before
    // it is decoded: beside two 30 MP images it weighs nothing (and the
    // output paths refuse the file for it, by the per-image rule).
    const skipped = await preflightPdfjsBytes(
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        page(["Big", "A", "B"], 4),
        image(10_000, 10_000),
        image(6000, 5000),
        image(5000, 6000),
        { dict: "", stream: "/Big Do /A Do /B Do" },
      ]),
    );
    expect(skipped.overBudgetImage).toBe(true);
    expect(weights(skipped)).toEqual([60_000_000]);
  });
});

describe("what the map cannot tell fails safe", () => {
  it("a page object pdf.js would draw that the map did not reach, or a page with no number, is past the budget", async () => {
    const pre = await preflightPdfjsBytes(
      await imagePagesPdf([[], Array<number>(10).fill(7000)], { real: false }),
    );
    const [light, heavy] = [...pre.pages!.weights.keys()].sort((a, b) => a - b);
    expect(pageImageVerdict(pre, { num: light! })).toBeNull();
    expect(pageImageVerdict(pre, { num: heavy! })).toBe(PAGE_IMAGES_NOTE);
    expect(pageImageVerdict(pre, { num: 9999 })).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
    expect(pageImageVerdict(pre, null)).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
    // Positive control: with no map (the fast path), nothing is noted.
    const light1 = await preflightPdfjsBytes(
      await imagePagesPdf([[1000]], { real: false }),
    );
    expect(pageImageVerdict(light1, null)).toBeNull();
  });

  it("content the scan cannot read (a filter it does not decode) may paint everything its resources hold, any number of times", async () => {
    const pre = await preflightPdfjsBytes(
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Resources << /XObject << /A 5 0 R /B 6 0 R >> >> /Kids [3 0 R 7 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents 4 0 R >>",
        { dict: "/Filter /RunLengthDecode", stream: "\u0080\u000b`P" },
        image(6000, 6000),
        image(5000, 5000),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents 8 0 R >>",
        { dict: "", stream: "q 10 0 0 10 0 0 cm /A Do Q" },
      ]),
    );
    // Page 1 (RunLength content): both images, as often as it likes; page
    // 2 (readable): /A once. (Until review r3 the filter here was LZW,
    // which the map now decodes, as pdf.js does: see "LZW content".)
    // History (review r3, 2026-11-14): this pinned [61 MP, 36 MP], each
    // image counted ONCE, the rule from before every paint was charged;
    // content nobody read may paint an image any number of times (see
    // "content nobody read paints ..." below). Inverted.
    expect(weights(pre)).toEqual([Number.POSITIVE_INFINITY, 36_000_000]);
    expect(pageImageVerdict(pre, { num: 3 })).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
  });

  it("an encrypted file that opens with no password is read decrypted, as pdf.js reads it: its object streams and content map exactly", async () => {
    // History (hostile review r2, 2026-11-14): this asserted that object
    // streams left the map incomplete and every page noted, "the cost of
    // failing safe". A restricted (no open password) scan of 9 MP pages,
    // the shape Acrobat and Word write, then had every Viewer page noted
    // and was refused by PDF to JPG, which main converted. Inverted.
    const plain = await imagePagesPdf(
      [Array<number>(2).fill(6000), [3000], [3000], [3000], [3000], [3000]],
      { real: false },
    );
    for (const cipher of ["rc4-128", "aes-128", "aes-256"] as const) {
      for (const objectStreams of [false, true]) {
        const enc = await encryptPdf(plain, {
          userPassword: "",
          ownerPassword: "o",
          objectStreams,
          cipher,
        });
        const pre = await preflightPdfjsBytes(enc);
        const label = `${cipher} objectStreams=${objectStreams}`;
        expect(pre.pages!.incomplete, label).toBeNull();
        // Page 1 paints two 36 MP images; the rest one 9 MP each.
        expect(weights(pre), label).toEqual([
          72_000_000,
          ...Array<number>(5).fill(9_000_000),
        ]);
        const refs = await pdfjsPageRefs(enc);
        expect(
          refs.map((r) => pageImageVerdict(pre, { num: r })),
          label,
        ).toEqual([PAGE_IMAGES_NOTE, null, null, null, null, null]);
      }
    }
    // A file that needs a password to open: nothing is decrypted, and the
    // map fails safe (object streams it cannot read: incomplete).
    const locked = await encryptPdf(plain, {
      userPassword: "u",
      ownerPassword: "o",
      objectStreams: true,
    });
    const p2 = await preflightPdfjsBytes(locked);
    expect(p2.pages!.incomplete).not.toBeNull();
    expect(pageImageVerdict(p2, { num: 3 })).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
    // History (found here, 2026-11-14): the scan read an encrypted object
    // stream as empty, so no reference to any image was seen and every
    // image counted as an orphan nothing paints: a 100 MP image in such a
    // file passed the PER-IMAGE budget too. Positive control first: plain.
    const co08 = await imagePagesPdf([[10_000]], { real: false });
    expect((await preflightPdfjsBytes(co08)).overBudgetImage).toBe(true);
    const hidden = await encryptPdf(co08, {
      userPassword: "",
      ownerPassword: "o",
      objectStreams: true,
    });
    expect((await preflightPdfjsBytes(hidden)).overBudgetImage).toBe(true);
  });
});

describe("the real-producer corpus: the map finds exactly the pages pdf.js reports", () => {
  const DIR = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
  const FILES = readdirSync(DIR)
    .filter((f) => f.endsWith(".pdf"))
    .sort();

  it("health: the corpus is the corpus", () => {
    expect(FILES.length).toBe(14);
  });

  it.each(FILES)(
    "%s: every page mapped, weights as its images, the map complete",
    async (name) => {
      const bytes = new Uint8Array(readFileSync(path.join(DIR, name)));
      // The map read directly: the preflight's fast path skips it on files
      // this light, so this is the map's own parity with pdf.js.
      const { PageImages } = await import("./pdf-page-images");
      const guard = await import("./pdfjs-guard");
      const reader = await PageImages.open(bytes, guard.pageScanTools(false));
      expect(reader).toBeInstanceOf(PageImages);
      if (!(reader instanceof PageImages)) throw new Error("no reader");
      const map = await reader.map(Infinity);
      expect(map.incomplete).toBeNull();
      const refs = await pdfjsPageRefs(bytes);
      // Every page pdf.js draws is mapped (a missing one would be noted).
      expect(refs.filter((r) => !map.pages.has(r))).toEqual([]);
      // And no page weighs past the budget: real files draw as before.
      expect(
        [...map.pages.values()].filter((w) => w > RASTER_MAX_PAGE_IMAGE_PIXELS),
      ).toEqual([]);
      // The preflight itself takes the fast path: nothing changes for them.
      expect((await preflightPdfjsBytes(bytes)).pages).toBeNull();
    },
    30_000,
  );
});

/* ------------------------------------------------------------------ *
 *  Hostile review r1/r2 (2026-11-14): what the map got wrong
 * ------------------------------------------------------------------ */

const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";
const ONE_PAGE = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";

/** One page, four 6000 x 6000 images (144 MP) as /I0../I3, painted by `content`. */
function fourImages(
  content: string | Uint8Array,
  contentDict = "",
  keys = ["I0", "I1", "I2", "I3"],
) {
  return rawPdf([
    CATALOG,
    ONE_PAGE,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << ${keys.map((k, i) => `/${k} ${5 + i} 0 R`).join(" ")} >> >> /Contents 4 0 R >>`,
    { dict: contentDict, stream: content },
    image(6000, 6000),
    image(6000, 6000),
    image(6000, 6000),
    image(6000, 6000),
  ]);
}

const grid = (names: string[]) =>
  names
    .map(
      (n, k) =>
        `q 250 0 0 250 ${50 + (k % 2) * 250} ${50 + (k >> 1) * 250} cm /${n} Do Q`,
    )
    .join("\n");

describe("a `Do` operand is looked up as pdf.js decodes it", () => {
  it("#xx-escaped names paint the images they name: each escape shape", async () => {
    // Positive control: plain names.
    const plain = await preflightPdfjsBytes(
      fourImages(grid(["I0", "I1", "I2", "I3"])),
    );
    expect(weights(plain)).toEqual([144_000_000]);
    // Every character escaped, the digit escaped, upper- and lower-case hex.
    const escaped = await preflightPdfjsBytes(
      fourImages(grid(["#49#30", "I#31", "I#32", "#49#33"])),
    );
    expect(weights(escaped)).toEqual([144_000_000]);
    expect(pageImageVerdict(escaped, { num: 3 })).toBe(PAGE_IMAGES_NOTE);
    // Escaped keys, plain operands: the same images.
    const keys = await preflightPdfjsBytes(
      fourImages(grid(["I0", "I1", "I2", "I3"]), "", [
        "#49#30",
        "I#31",
        "#49#32",
        "I#33",
      ]),
    );
    expect(weights(keys)).toEqual([144_000_000]);
  });

  it("decodes exactly as pdf.js's Lexer.getName, not as a regex: `#4#30` stays `#4#30`", async () => {
    // pdf.js reads the key `/I#234#2330` as `I#4#30` (two escapes) and the
    // operand `/I#4#30` as `I#4#30` (a `#` before one hex digit keeps it
    // and the next character), so the page paints that image. A regex
    // reads the operand as `I#40` and misses it.
    const { decodeName } = await import("./pdf-page-images");
    expect(decodeName("I#4#30")).toBe("I#4#30");
    expect(decodeName("I#234#2330")).toBe("I#4#30");
    expect(decodeName("#49#30")).toBe("I0");
    expect(decodeName("A#2a")).toBe("A*");
    expect(decodeName("A#G1")).toBe("A#G1");
    expect(decodeName("A#")).toBe("A#");
    const pre = await preflightPdfjsBytes(
      fourImages(grid(["I#4#30", "I1", "I2", "I3"]), "", [
        "I#234#2330",
        "I1",
        "I2",
        "I3",
      ]),
    );
    expect(weights(pre)).toEqual([144_000_000]);
  });
});

/** PNG `Up` rows of `columns` bytes (filter byte 2), as a writer predicts content. */
function pngUp(data: Uint8Array, columns: number): Uint8Array {
  const out: number[] = [];
  let prior = new Uint8Array(columns);
  for (let r = 0; r < data.length; r += columns) {
    const row = new Uint8Array(columns);
    row.set(data.subarray(r, r + columns));
    out.push(2, ...row.map((b, i) => (b - prior[i]! + 256) & 0xff));
    prior = row;
  }
  return Uint8Array.from(out);
}

describe("content behind a /DecodeParms predictor is read through it", () => {
  it("PNG Up content (Predictor 12, Columns 4) paints its four 36 MP images", async () => {
    const { deflateSync } = await import("node:zlib");
    const text = new TextEncoder().encode(grid(["I0", "I1", "I2", "I3"]));
    const pre = await preflightPdfjsBytes(
      fourImages(
        new Uint8Array(deflateSync(pngUp(text, 4))),
        "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >>",
      ),
    );
    expect(pre.pages!.incomplete).toBeNull();
    expect(weights(pre)).toEqual([144_000_000]);
    expect(pageImageVerdict(pre, { num: 3 })).toBe(PAGE_IMAGES_NOTE);
  });

  it("unpredict: PNG rows of every filter type, TIFF 2, and what pdf.js refuses", async () => {
    const { unpredict } = await import("./pdf-page-images");
    const raw = Uint8Array.from({ length: 48 }, (_, i) => (i * 37 + 11) & 0xff);
    // Each row its own PNG filter, encoded by hand (PNG spec, 9.2).
    const cols = 6;
    const bpp = 3;
    const enc: number[] = [];
    let prior = new Uint8Array(cols);
    for (let r = 0; r * cols < raw.length; r += 1) {
      const row = raw.subarray(r * cols, r * cols + cols);
      const type = r % 5;
      enc.push(type);
      for (let i = 0; i < cols; i += 1) {
        const left = i >= bpp ? row[i - bpp]! : 0;
        const up = prior[i]!;
        const ul = i >= bpp ? prior[i - bpp]! : 0;
        const p = left + up - ul;
        const paeth =
          Math.abs(p - left) <= Math.abs(p - up) &&
          Math.abs(p - left) <= Math.abs(p - ul)
            ? left
            : Math.abs(p - up) <= Math.abs(p - ul)
              ? up
              : ul;
        const pred = [0, left, up, (left + up) >> 1, paeth][type]!;
        enc.push((row[i]! - pred + 256) & 0xff);
      }
      prior = Uint8Array.from(row);
    }
    const params = { predictor: 15, colors: 3, bpc: 8, columns: 2 };
    expect([...unpredict(Uint8Array.from(enc), params)!]).toEqual([...raw]);
    // TIFF 2, 8 bits: each sample adds the one `colors` before it.
    expect([
      ...unpredict(Uint8Array.from([1, 2, 3, 1, 1, 1]), {
        predictor: 2,
        colors: 3,
        bpc: 8,
        columns: 2,
      })!,
    ]).toEqual([1, 2, 3, 2, 3, 4]);
    // A row filter pdf.js refuses, and a TIFF depth not applied: unreadable.
    expect(
      unpredict(Uint8Array.from([7, 0, 0, 0, 0, 0, 0]), params),
    ).toBeNull();
    expect(
      unpredict(new Uint8Array(4), { ...params, predictor: 2, bpc: 4 }),
    ).toBeNull();
  });

  it("the streamed predictor gives the bytes the row-at-a-time one gave, fed in any chunks, one-byte rows included", async () => {
    // History (hostile review r3, 2026-11-14): the predictor allocated two
    // arrays a row; /Columns 1 content held the main thread 8 s for 64 MB.
    // It now runs streamed, row runs at a time, with a path of its own for
    // one-byte rows. The reference is the old implementation, kept here.
    const { unpredict, Unpredictor } = await import("./pdf-page-images");
    function reference(
      data: Uint8Array,
      p: { predictor: number; colors: number; bpc: number; columns: number },
    ): Uint8Array | null {
      const { predictor, colors, bpc, columns } = p;
      if (predictor <= 1) return data;
      if (![1, 2, 4, 8, 16].includes(bpc) || !(colors >= 1) || !(columns >= 1))
        return null;
      const rowBytes = Math.ceil((colors * bpc * columns) / 8);
      const bpp = Math.ceil((colors * bpc) / 8);
      const kept = Math.min(rowBytes, data.length);
      if (predictor === 2) {
        if (bpc !== 8) return null;
        const out = data.slice();
        for (let r = 0; r < out.length; r += rowBytes) {
          const end = Math.min(out.length, r + rowBytes);
          for (let i = r + colors; i < end; i += 1) {
            out[i] = (out[i]! + out[i - colors]!) & 0xff;
          }
        }
        return out;
      }
      if (predictor < 10) return null;
      const out: number[] = [];
      let prior = new Uint8Array(kept);
      for (let r = 0; r < data.length; r += rowBytes + 1) {
        const type = data[r]!;
        const row = data.subarray(
          r + 1,
          Math.min(data.length, r + 1 + rowBytes),
        );
        const cur = new Uint8Array(kept);
        for (let i = 0; i < row.length; i += 1) {
          const left = i >= bpp ? cur[i - bpp]! : 0;
          const up = prior[i]!;
          const upLeft = i >= bpp ? prior[i - bpp]! : 0;
          let v: number;
          if (type === 0) v = row[i]!;
          else if (type === 1) v = row[i]! + left;
          else if (type === 2) v = row[i]! + up;
          else if (type === 3) v = row[i]! + ((left + up) >> 1);
          else if (type === 4) {
            const base = left + up - upLeft;
            const pa = Math.abs(base - left);
            const pb = Math.abs(base - up);
            const pc = Math.abs(base - upLeft);
            v =
              row[i]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          } else return null;
          cur[i] = v & 0xff;
          out.push(v & 0xff);
        }
        prior = cur;
      }
      return Uint8Array.from(out);
    }
    let seed = 12345;
    const rand = (n: number) => {
      // xorshift32 (an LCG product passes 2^53 in a double and loses the
      // low bits this takes the remainder of).
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % n;
    };
    let cases = 0;
    let oneByteRows = 0;
    for (const predictor of [2, 10, 11, 12, 13, 14, 15]) {
      for (const bpc of [1, 2, 4, 8, 16]) {
        for (const colors of [1, 2, 3]) {
          for (const columns of [1, 2, 3, 5, 9]) {
            const p = { predictor, colors, bpc, columns };
            const rowBytes = Math.ceil((colors * bpc * columns) / 8);
            const data = Uint8Array.from({ length: 1 + rand(200) }, () =>
              rand(256),
            );
            // PNG rows: valid filter bytes, one in eight cases with one
            // refused row (a refusal per row would refuse nearly every case
            // of short rows, and compare nothing but two nulls).
            if (predictor >= 10) {
              const rows: number[] = [];
              for (let r = 0; r < data.length; r += rowBytes + 1) {
                data[r] = rand(5);
                rows.push(r);
              }
              if (rand(8) === 0) data[rows[rand(rows.length)]!] = 5 + rand(3);
            }
            const want = reference(data, p);
            if (
              rowBytes === 1 &&
              predictor >= 10 &&
              want !== null &&
              want.length > 4
            ) {
              oneByteRows += 1;
            }
            expect(unpredict(data, p), JSON.stringify(p)).toEqual(want);
            // Streamed in random chunks: the same bytes, or the same refusal.
            const parts: number[] = [];
            const un = Unpredictor.of(p, (c) => parts.push(...c));
            if (un === null) {
              expect(want, JSON.stringify(p)).toBeNull();
            } else {
              for (let at = 0; at < data.length;) {
                const n = 1 + rand(17);
                un.feed(data.subarray(at, at + n));
                at += n;
              }
              const ok = un.end();
              expect(
                ok ? Uint8Array.from(parts) : null,
                JSON.stringify(p),
              ).toEqual(want);
            }
            cases += 1;
          }
        }
      }
    }
    // Health: the grid ran, and one-byte rows were compared as bytes, not
    // as two refusals (review r3: a mutant of that path passed when they
    // were).
    expect(cases).toBe(7 * 5 * 3 * 5);
    expect(oneByteRows).toBeGreaterThan(10);
  });
});

describe("every paint is charged: pdf.js decodes once a page, but paints per `Do`", () => {
  const repeated = (paints: number, viaForm = false) =>
    rawPdf([
      CATALOG,
      ONE_PAGE,
      viaForm
        ? "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>"
        : "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 4 0 R >>",
      {
        dict: "",
        stream: `q 500 0 0 500 50 50 cm\n${`${viaForm ? "/Fm" : "/Im0"} Do\n`.repeat(paints)}Q`,
      },
      // The form exists only where the page paints it.
      viaForm
        ? {
            dict: "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /Im0 6 0 R >> >>",
            stream: "/Im0 Do",
          }
        : null,
      image(4000, 4000),
    ]);

  it("one 16 MP image painted 20 times weighs 320 MP, through `Do` and through a form; the fast path sees it", async () => {
    // Positive control: painted once, the fast path rules every page out.
    expect((await preflightPdfjsBytes(repeated(1))).pages).toBeNull();
    for (const viaForm of [false, true]) {
      const pre = await preflightPdfjsBytes(repeated(20, viaForm));
      expect(pre.pages, `viaForm=${viaForm}: mapped`).not.toBeNull();
      expect(weights(pre)).toEqual([320_000_000]);
      expect(pageImageVerdict(pre, { num: 3 })).toBe(PAGE_IMAGES_NOTE);
    }
    // Three paints (48 MP) are within the budget: drawn.
    const three = await preflightPdfjsBytes(repeated(3));
    expect(pageImageVerdict(three, { num: 3 })).toBeNull();
  });
});

describe("the map's work is bounded on the main thread", () => {
  /** P pages naming one content stream (3.9 million `Q` after one `Do`, by default). */
  async function sharedOps(
    pages: number,
    distinctResources: boolean,
    text = `/A Do\n${"Q\n".repeat(3_900_000)}`,
    xobjectsOnFirstOnly = false,
  ) {
    const { deflateSync } = await import("node:zlib");
    const ops = new Uint8Array(deflateSync(Buffer.from(text)));
    const kids = Array.from({ length: pages }, (_, i) => 6 + i);
    return rawPdf([
      CATALOG,
      `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`,
      {
        // A predictor of 1 changes nothing, but the scan does not count
        // content with /DecodeParms: the map reads it itself.
        dict: `/Filter /FlateDecode${xobjectsOnFirstOnly ? " /DecodeParms << /Predictor 1 >>" : ""}`,
        stream: ops,
      },
      image(5500, 5500),
      image(5500, 5500),
      ...kids.map(
        (_, i) =>
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << ${!xobjectsOnFirstOnly || i === 0 ? "/XObject << /A 4 0 R /B 5 0 R >>" : ""}${distinctResources ? ` /Properties << /P${i} 1 >>` : ""} >> /Contents 3 0 R >>`,
      ),
    ]);
  }

  it("200 pages sharing one stream and one /Resources text: walked once, every page weighed, in seconds", async () => {
    const bytes = await sharedOps(200, false);
    const t0 = Date.now();
    const pre = await preflightPdfjsBytes(bytes);
    const ms = Date.now() - t0;
    expect(pre.pages!.incomplete).toBeNull();
    expect(weights(pre)).toHaveLength(200);
    expect(new Set(weights(pre))).toEqual(new Set([5500 * 5500]));
    // Before: 6.4 s for 200 pages, 87.5 s for 2,000 (hostile review r1).
    expect(ms).toBeLessThan(5_000);
  }, 30_000);

  it("...and with a distinct /Resources on every page: a weight walks only what paints, so the 3.9 million `Q` cost nothing past their one read", async () => {
    // History (review r3, 2026-11-14): this file stopped at the walk's bound
    // ("content work") and every page failed safe. A weight never needed
    // `q`, `Q` or `cm` (only placements do), and the map no longer holds or
    // walks them: the same file now has every page weighed.
    const bytes = await sharedOps(200, true);
    const t0 = Date.now();
    const pre = await preflightPdfjsBytes(bytes);
    const ms = Date.now() - t0;
    expect(pre.pages!.incomplete).toBeNull();
    expect(new Set(weights(pre))).toEqual(new Set([5500 * 5500]));
    expect(ms).toBeLessThan(5_000);
  }, 30_000);

  it("...and one name run 400,000 times, or one inline image read 200,000 times, is weighed once a page: every page complete and measured", async () => {
    // History (hostile review r3, 2026-11-14): these two files were this
    // describe's bound controls. Every `Do` was a step and every inline
    // image a visit, so both ended the map ("paint steps", "content work")
    // and every page failed safe; so did 400 pages of 6,000 icon paints.
    // A weight is a sum: a name is looked up once and its paint counted as
    // often as it runs. Inverted; the controls below reach the bounds by
    // what still costs work, distinct names and distinct inline images.
    for (const [text, each, verdict] of [
      ["/A Do\n".repeat(400_000), 400_000 * 5500 * 5500, PAGE_IMAGES_NOTE],
      [
        `/A Do\n${"BI /W 1 /H 1 /BPC 8 /CS /G ID x EI\n".repeat(200_000)}`,
        5500 * 5500 + 200_000,
        null,
      ],
    ] as const) {
      const bytes = await sharedOps(200, true, text);
      const t0 = Date.now();
      const pre = await preflightPdfjsBytes(bytes);
      const ms = Date.now() - t0;
      expect(pre.pages!.incomplete).toBeNull();
      expect(weights(pre)).toHaveLength(200);
      expect(new Set(weights(pre))).toEqual(new Set([each]));
      expect(pageImageVerdict(pre, { num: 6 })).toBe(verdict);
      expect(ms).toBeLessThan(5_000);
    }
  }, 60_000);

  it.each([
    // 12,000 distinct names a page, each a lookup: 2.4 million steps.
    [
      "paint steps",
      Array.from({ length: 12_000 }, (_, i) => `/N${i} Do`).join("\n"),
      false,
    ],
    // 120,000 distinct names a page, looked up only where there is an
    // /XObject (the first page): 24 million entries walked. (The scan
    // cannot count this content, so no page is weighed from its counts.)
    [
      "content work",
      `/A Do\n${Array.from({ length: 120_000 }, (_, i) => `/N${i} Do`).join("\n")}`,
      true,
    ],
  ] as const)(
    "...but what does paint is walked per page, and the walk stops at its bound (%s) with every page failing safe",
    async (bound, text, firstOnly) => {
      const bytes = await sharedOps(200, true, text, firstOnly);
      const t0 = Date.now();
      const pre = await preflightPdfjsBytes(bytes);
      const ms = Date.now() - t0;
      expect(pre.pages!.incomplete).toBe(bound);
      expect(pageImageVerdict(pre, { num: 6 })).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
      expect(ms).toBeLessThan(5_000);
    },
    30_000,
  );
});

/** A JPEG 2000 codestream's first bytes: SOC, then SIZ for `w` x `h`, 3 components. */
function jpxHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(4 + 38 + 9);
  const v = new DataView(b.buffer);
  v.setUint16(0, 0xff4f);
  v.setUint16(2, 0xff51);
  v.setUint16(4, 38 + 9); // Lsiz
  v.setUint16(6, 0); // Rsiz
  v.setUint32(8, w);
  v.setUint32(12, h);
  v.setUint32(16, 0);
  v.setUint32(20, 0);
  v.setUint32(24, w);
  v.setUint32(28, h);
  v.setUint32(32, 0);
  v.setUint32(36, 0);
  v.setUint16(40, 3);
  return b;
}

describe("a JPEG 2000 image costs its codestream's size, which pdf.js prefers to the dictionary", () => {
  const jpx = (w: number, h: number) => ({
    dict: "/Type /XObject /Subtype /Image /Width 100 /Height 100 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /JPXDecode",
    stream: jpxHeader(w, h),
  });
  const page = (n: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << ${Array.from({ length: n }, (_, i) => `/I${i} ${5 + i} 0 R`).join(" ")} >> >> /Contents 4 0 R >>`;

  it("four images declared 100 x 100 whose codestreams are 6000 x 6000 weigh 144 MP", async () => {
    const pre = await preflightPdfjsBytes(
      rawPdf([
        CATALOG,
        ONE_PAGE,
        page(4),
        { dict: "", stream: grid(["I0", "I1", "I2", "I3"]) },
        jpx(6000, 6000),
        jpx(6000, 6000),
        jpx(6000, 6000),
        jpx(6000, 6000),
      ]),
    );
    expect(weights(pre)).toEqual([144_000_000]);
    // Control: codestreams that agree with the dictionary need no map.
    const agree = await preflightPdfjsBytes(
      rawPdf([
        CATALOG,
        ONE_PAGE,
        page(1),
        { dict: "", stream: grid(["I0"]) },
        jpx(100, 100),
      ]),
    );
    expect(agree.pages).toBeNull();
    expect(agree.overBudgetImage).toBe(false);
  });

  it("one declared 100 x 100 with a 10,000 x 10,000 codestream is over the per-image budget; a preview skips it by its dictionary size", async () => {
    const pre = await preflightPdfjsBytes(
      rawPdf([
        CATALOG,
        ONE_PAGE,
        page(1),
        { dict: "", stream: grid(["I0"]) },
        jpx(10_000, 10_000),
      ]),
    );
    expect(pre.overBudgetImage).toBe(true);
    // pdf.js compares `maxImageSize` with the DICTIONARY's 100 x 100.
    expect(pre.previewOptions.maxImageSize).toBe(100 * 100 - 1);
  });
});

describe("an image whose size the scan cannot read reaches the page budget", () => {
  it("ten 49 MP images whose /Width sits in an object stream: the map is built and the page weighs 490 MP", async () => {
    const { PDFDocument, PDFName, PDFNumber, PDFRawStream } =
      await import("pdf-lib");
    const doc = await PDFDocument.load(
      await imagePagesPdf([Array<number>(10).fill(7000)], { real: false }),
    );
    let changed = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
      obj.dict.set(
        PDFName.of("Width"),
        doc.context.register(PDFNumber.of(7000)),
      );
      changed += 1;
    }
    expect(changed).toBe(10);
    const pre = await preflightPdfjsBytes(
      await doc.save({ useObjectStreams: true }),
    );
    // The scan cannot read the width: the image is over budget by rule.
    expect(pre.overBudgetImage).toBe(true);
    expect(weights(pre)).toEqual([490_000_000]);
    const [num] = [...pre.pages!.weights.keys()];
    expect(pageImageVerdict(pre, { num: num! })).toBe(PAGE_IMAGES_NOTE);
  });
});

describe("a page counted by a bound is never called past the budget as a fact", () => {
  /** 12 pages, one shared /Resources of twelve 9 MP images, each page painting one. */
  const sharedScan = (unread: boolean) => {
    const kids = Array.from({ length: 12 }, (_, i) => 15 + 2 * i);
    const xobjects = Array.from(
      { length: 12 },
      (_, i) => `/S${i} ${3 + i} 0 R`,
    ).join(" ");
    return rawPdf([
      CATALOG,
      `<< /Type /Pages /Resources << /XObject << ${xobjects} >> >> /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count 12 >>`,
      ...Array.from({ length: 12 }, () => image(3000, 3000)),
      ...kids.flatMap((k, i) => [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents ${k + 1} 0 R >>`,
        unread
          ? { dict: "/Filter /RunLengthDecode", stream: "\u0080\u000b`P" }
          : { dict: "", stream: `q 500 0 0 500 50 50 cm /S${i} Do Q` },
      ]),
    ]);
  };

  it("content the map cannot read: each page may paint all twelve, any number of times, so the note says MAY, not IS", async () => {
    const pre = await preflightPdfjsBytes(sharedScan(true));
    // History (review r3): pinned 108 MP, each of the twelve once; content
    // nobody read may paint them any number of times. Inverted.
    expect(new Set(weights(pre))).toEqual(new Set([Number.POSITIVE_INFINITY]));
    expect(pageImageVerdict(pre, { num: 15 })).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
    // Positive control: readable, each page paints its own 9 MP: drawn.
    const plain = await preflightPdfjsBytes(sharedScan(false));
    expect(new Set(weights(plain))).toEqual(new Set([9_000_000]));
    expect(pageImageVerdict(plain, { num: 15 })).toBeNull();
  });

  it("the output paths refuse a bounded or unmatched page with the could-not-be-read copy, a measured one with the too-large copy", async () => {
    const bounded = await preflightPdfjsBytes(sharedScan(true));
    await expect(
      refuseOverBudgetPages(bounded, [0], async () => ({ ref: { num: 15 } })),
    ).rejects.toThrow(pageImagesUnknownMessage(1));
    // An unmatched page (no ref) is refused the same way, never as too large.
    await expect(
      refuseOverBudgetPages(bounded, [4], async () => ({ ref: null })),
    ).rejects.toThrow(pageImagesUnknownMessage(5));
    const measured = await preflightPdfjsBytes(
      await imagePagesPdf([Array<number>(10).fill(7000)], { real: false }),
    );
    const [num] = [...measured.pages!.weights.keys()];
    await expect(
      refuseOverBudgetPages(measured, [0], async () => ({
        ref: { num: num! },
      })),
    ).rejects.toThrow(pageImagesTooLargeMessage(1));
    // The two copies say different things.
    expect(pageImagesUnknownMessage(1)).not.toBe(pageImagesTooLargeMessage(1));
    expect(pageImagesUnknownMessage(1)).toMatch(/may add up to more than/);
  });
});

/* ------------------------------------------------------------------ *
 *  Hostile review r3 (2026-11-14): what the fix round still got wrong.
 *  The oracle is pdf.js itself: what `getOperatorList` paints.
 * ------------------------------------------------------------------ */

/** How many times pdf.js paints an image XObject on `page` (1-based). */
async function pdfjsPaints(bytes: Uint8Array, page = 1): Promise<number> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice(), verbosity: 0 })
    .promise;
  const ol = await (await doc.getPage(page)).getOperatorList();
  const n = ol.fnArray.filter((f) => f === lib.OPS.paintImageXObject).length;
  await doc.loadingTask.destroy();
  return n;
}

/** A real 4000 x 4000 grey image (16 MP), which pdf.js decodes and paints. */
async function real16mp() {
  const { deflateSync } = await import("node:zlib");
  return {
    dict: "/Type /XObject /Subtype /Image /Width 4000 /Height 4000 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode",
    stream: new Uint8Array(deflateSync(new Uint8Array(4000 * 4000))),
  };
}
const MP16 = 16_000_000;

describe("a /Crypt filter decrypts where pdf.js decrypts it", () => {
  /** One page painting /Im (16 MP) four times, its content's dictionary `dict`. */
  async function cryptFixture(
    dict: string,
    cipher: "rc4-128" | "aes-128" | "aes-256",
  ) {
    const body = [0, 1, 2, 3]
      .map((i) => `q 100 0 0 100 ${i * 120} 0 cm /Im Do Q`)
      .join(" ");
    const plain = rawPdf([
      CATALOG,
      ONE_PAGE,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>",
      { dict, stream: body },
      await real16mp(),
    ]);
    return encryptPdf(plain, { userPassword: "", ownerPassword: "o", cipher });
  }

  it("content whose first filter is /Crypt /Name /StdCF is read decrypted: 4 paints, 64 MP, noted (RC4, AES-128, AES-256)", async () => {
    // History (hostile review r3): the map took such a stream for plain
    // text, lexed its ciphertext, found no `Do`, and weighed the page 0:
    // drawn in previews and written by the output paths.
    for (const cipher of ["rc4-128", "aes-128", "aes-256"] as const) {
      for (const dict of [
        "",
        "/Filter /Crypt /DecodeParms << /Name /StdCF >>",
      ]) {
        const bytes = await cryptFixture(dict, cipher);
        const label = `${cipher} ${dict || "(control: no /Crypt)"}`;
        expect(await pdfjsPaints(bytes), label).toBe(4);
        const pre = await preflightPdfjsBytes(bytes);
        expect(pre.pages!.weights.get(3), label).toBe(4 * MP16);
        expect(pageImageVerdict(pre, { num: 3 }), label).toBe(PAGE_IMAGES_NOTE);
      }
    }
  }, 60_000);

  it("a /Crypt stage after another filter is not read here: the page fails safe, as MAY", async () => {
    const bytes = await cryptFixture(
      "/Filter [/ASCIIHexDecode /Crypt] /DecodeParms [null << /Name /StdCF >>]",
      "aes-128",
    );
    const pre = await preflightPdfjsBytes(bytes);
    expect(pageImageVerdict(pre, { num: 3 })).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
  }, 30_000);
});

describe("a form's paint is remembered with the forms on its path", () => {
  it.each([["/A Do /B Do"], ["/B Do /A Do"]])(
    "a cycle through a shared form weighs what pdf.js paints, in either order (%s)",
    async (content) => {
      // A = Im, Im, C; B = C; C = A. pdf.js paints A's two (C's A is A's
      // own ancestor: refused) and B's C's A's two (no ancestor there): 4.
      // History (hostile review r3): the memo key left out the path, so
      // the page weighed 32 MP or 96 MP by the order of its `Do`s.
      const res =
        "/Resources << /XObject << /A 5 0 R /B 6 0 R /C 7 0 R /Im 8 0 R >> >>";
      const form = (body: string) => ({
        dict: `/Type /XObject /Subtype /Form /BBox [0 0 600 600] ${res}`,
        stream: body,
      });
      const bytes = rawPdf([
        CATALOG,
        "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] ${res} /Contents 4 0 R >>`,
        { dict: "", stream: content },
        form(
          "q 100 0 0 100 0 0 cm /Im Do Q q 100 0 0 100 200 0 cm /Im Do Q /C Do",
        ),
        form("/C Do"),
        form("/A Do"),
        await real16mp(),
        // A second page past the per-image budget, so the file needs a map.
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /H 11 0 R >> >> /Contents 10 0 R >>",
        { dict: "", stream: "/H Do" },
        image(7000, 7000),
      ]);
      expect(await pdfjsPaints(bytes)).toBe(4);
      const pre = await preflightPdfjsBytes(bytes);
      expect(pre.pages!.weights.get(3)).toBe(4 * MP16);
      expect(pageImageVerdict(pre, { num: 3 })).toBe(PAGE_IMAGES_NOTE);
    },
    30_000,
  );
});

describe("an encrypted file's JPEG 2000 images cost their decrypted codestream's size", () => {
  it("four declared 100 x 100 with 6000 x 6000 codestreams weigh 144 MP whatever the cipher", async () => {
    // History (hostile review r3): the scan reads only ciphertext, and the
    // map took the scan's sizes: 40,000 pixels in an RC4 or AES file, drawn.
    const jpx = {
      dict: "/Type /XObject /Subtype /Image /Width 100 /Height 100 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /JPXDecode",
      stream: jpxHeader(6000, 6000),
    };
    const plain = rawPdf([
      CATALOG,
      ONE_PAGE,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /I0 5 0 R /I1 6 0 R /I2 7 0 R /I3 8 0 R >> >> /Contents 4 0 R >>",
      { dict: "", stream: grid(["I0", "I1", "I2", "I3"]) },
      jpx,
      jpx,
      jpx,
      jpx,
    ]);
    for (const cipher of ["none", "rc4-128", "aes-128", "aes-256"] as const) {
      const bytes =
        cipher === "none"
          ? plain
          : await encryptPdf(plain, {
              userPassword: "",
              ownerPassword: "o",
              cipher,
            });
      const pre = await preflightPdfjsBytes(bytes);
      expect(pre.pages!.weights.get(3), cipher).toBe(144_000_000);
      expect(pageImageVerdict(pre, { num: 3 }), cipher).toBe(PAGE_IMAGES_NOTE);
    }
  }, 30_000);
});

describe("content nobody read paints what it reaches an unknown number of times", () => {
  it("RunLength content painting one 16 MP image four times is MAY past the budget, not 16 MP and drawn", async () => {
    // RunLength: literal runs of at most 128 bytes, then 128 (end).
    const text = new TextEncoder().encode(
      [0, 1, 2, 3]
        .map((i) => `q 100 0 0 100 ${i * 120} 0 cm /Im Do Q`)
        .join(" "),
    );
    const runs: number[] = [];
    for (let i = 0; i < text.length; i += 128) {
      const run = text.subarray(i, i + 128);
      runs.push(run.length - 1, ...run);
    }
    runs.push(128);
    const bytes = rawPdf([
      CATALOG,
      ONE_PAGE,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>",
      { dict: "/Filter /RunLengthDecode", stream: Uint8Array.from(runs) },
      await real16mp(),
    ]);
    // The oracle: pdf.js decodes RunLength and paints four times.
    expect(await pdfjsPaints(bytes)).toBe(4);
    // History (found in review r3): counted once, the rule from before every
    // paint was charged: 16 MP, drawn.
    const pre = await preflightPdfjsBytes(bytes);
    expect(pre.pages!.weights.get(3)).toBeGreaterThanOrEqual(4 * MP16);
    expect(pageImageVerdict(pre, { num: 3 })).toBe(PAGE_IMAGES_UNKNOWN_NOTE);
  }, 30_000);
});

describe("the map's cost is linear in what pages name", () => {
  it("one /Contents array of 20,000 references shared by 40 pages: every page weighed, in well under the 33 s it took", async () => {
    // History (hostile review r3): quadratic per page; this 127 KB file held
    // the main thread for 33 s.
    const pages = 40;
    const refs = 20_000;
    const bytes = rawPdf([
      CATALOG,
      `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${6 + i} 0 R`).join(" ")}] /Count ${pages} >>`,
      image(7000, 7000),
      { dict: "", stream: " /H Do " },
      `[${"4 0 R ".repeat(refs)}]`,
      ...Array.from(
        { length: pages },
        () =>
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /H 3 0 R >> >> /Contents 5 0 R >>",
      ),
    ]);
    const t0 = Date.now();
    const pre = await preflightPdfjsBytes(bytes);
    const ms = Date.now() - t0;
    expect(pre.pages!.incomplete).toBeNull();
    expect(pre.pages!.weights.size).toBe(pages);
    // Each page paints the 49 MP image 20,000 times.
    expect(new Set(pre.pages!.weights.values())).toEqual(
      new Set([refs * 49_000_000]),
    );
    expect(ms).toBeLessThan(3_000);
  }, 60_000);
});

describe("a predictor's row length is bounded by its data", () => {
  it("/Columns past the data reads as one short row, the same bytes as a row exactly the data's length", async () => {
    const { unpredict } = await import("./pdf-page-images");
    const data = Uint8Array.from([2, 5, 6, 7, 8, 9, 10]);
    const p = (columns: number) =>
      unpredict(data, { predictor: 12, colors: 1, bpc: 8, columns });
    expect(p(1e12)).toEqual(p(data.length));
    expect(p(1e9)).toEqual(p(data.length));
    // A length no integer can hold is not read.
    expect(p(Infinity)).toBeNull();
  });

  it("content behind /Columns 1e12 is weighed, not thrown out of the preflight untyped", async () => {
    // History (hostile review r3): two terabyte buffers, a RangeError.
    const { deflateSync } = await import("node:zlib");
    const content = new Uint8Array(deflateSync(Buffer.from("\u0002/A Do")));
    const pre = await preflightPdfjsBytes(
      rawPdf([
        CATALOG,
        ONE_PAGE,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /A 5 0 R /B 6 0 R >> >> /Contents 4 0 R >>",
        {
          dict: "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 1000000000000 >>",
          stream: content,
        },
        image(7000, 7000),
        image(7000, 7000),
      ]),
    );
    expect(pre.pages!.incomplete).toBeNull();
    expect(pre.pages!.weights.get(3)).toBe(49_000_000);
  });
});

describe("a heavy document of drawings is read whole: no bound summed over the document ends the map", () => {
  /** `pages` pages, each one 9 MP photo and `groups` drawn `q cm m l S Q` groups. */
  async function drawings(pages: number, groups: number) {
    const { deflateSync } = await import("node:zlib");
    const lines: string[] = [];
    for (let i = 0; i < groups; i += 1) {
      lines.push(
        `q 1 0 0 1 ${((i * 7) % 560) + 20} ${((i * 13) % 760) + 20} cm 0 0 m 3 2 l S Q`,
      );
    }
    const vector = new Uint8Array(deflateSync(Buffer.from(lines.join("\n"))));
    const objects: Parameters<typeof rawPdf>[0] = [CATALOG, "PAGES"];
    const kids: number[] = [];
    for (let p = 0; p < pages; p += 1) {
      const at = objects.length;
      objects.push(image(3000, 3000));
      objects.push({ dict: "/Filter /FlateDecode", stream: vector });
      objects.push({ dict: "", stream: "q 200 0 0 200 50 50 cm /Im0 Do Q" });
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Im0 ${at + 1} 0 R >> >> /Contents [${at + 2} 0 R ${at + 3} 0 R] >>`,
      );
      kids.push(at + 4);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
    return { bytes: rawPdf(objects), kids };
  }

  it("150 pages of 12,000 groups and one 9 MP photo each: every page drawn, every page's photo placed", async () => {
    // History (hostile review r3): the 4 million operators the map may hold
    // were counted over the whole document and, past them, ended the map:
    // all 150 pages were noted "could not be fully read" and PDF to JPG,
    // Grayscale and Redact refused a file main converts. Auto-crop placed
    // pages 1 and 75 and kept page 150 whole.
    const { bytes, kids } = await drawings(150, 12_000);
    const pre = await preflightPdfjsBytes(bytes);
    expect(pre.pages, "the map is built").not.toBeNull();
    expect(pre.pages!.incomplete).toBeNull();
    expect(kids.map((num) => pageImageVerdict(pre, { num }))).toEqual(
      kids.map(() => null),
    );
    await expect(
      refuseOverBudgetPages(pre, [0, 149], async (i) => ({
        ref: { num: kids[i]! },
      })),
    ).resolves.toBeUndefined();
    // Every page placed, in order: what is held is let go, not counted on.
    const { imagePlacements } = await import("./pdfjs-guard");
    const placed: string[] = [];
    for (const num of kids) {
      placed.push(JSON.stringify(await imagePlacements(bytes, { num }, 0)));
    }
    expect(new Set(placed)).toEqual(new Set(["[[50,50,250,250]]"]));
  }, 120_000);
});

describe("review r3 (2026-11-14): never worse than main", () => {
  type Obj = string | { dict: string; stream: string | Uint8Array } | null;

  /** A lattice of `levels` levels of two forms each, each painting both of the next level's; the last paints a 1 MP image. */
  function lattice(levels: number, where: "content" | "normal" | "down") {
    const objects: Obj[] = [
      CATALOG,
      "PAGES",
      "PAGE",
      "CONTENT",
      image(1000, 1000),
    ];
    // Level k (1-based): A at 6 + 2(k-1), B at 7 + 2(k-1).
    for (let k = 1; k <= levels; k += 1) {
      const next =
        k < levels
          ? `/Resources << /XObject << /A ${6 + 2 * k} 0 R /B ${7 + 2 * k} 0 R >> >>`
          : "/Resources << /XObject << /Im 5 0 R >> >>";
      const body = k < levels ? "/A Do /B Do" : "/Im Do";
      for (let f = 0; f < 2; f += 1) {
        objects.push({
          dict: `/Type /XObject /Subtype /Form /BBox [0 0 1 1] ${next}`,
          stream: body,
        });
      }
    }
    const small = objects.length + 1;
    objects.push({
      dict: "/Type /XObject /Subtype /Form /BBox [0 0 1 1]",
      stream: "",
    });
    const annot = objects.length + 1;
    const ap =
      where === "normal"
        ? "/N 6 0 R"
        : where === "down"
          ? `/N ${small} 0 R /D 6 0 R /R 6 0 R`
          : "";
    objects.push(
      `<< /Type /Annot /Subtype /Widget /Rect [0 0 100 100] /AP << ${ap} >> >>`,
    );
    objects[2] =
      where === "content"
        ? "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /A 6 0 R >> >> /Contents 4 0 R >>"
        : `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Annots [${annot} 0 R] /Contents 4 0 R >>`;
    objects[3] = {
      dict: "",
      stream: where === "content" ? "/A Do" : "BT (Hello) Tj ET",
    };
    // A second page past the per-image budget, so every file needs a map.
    const second = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /H ${second + 2} 0 R >> >> /Contents ${second + 1} 0 R >>`,
    );
    objects.push({ dict: "", stream: "/H Do" });
    objects.push(image(7000, 7000));
    objects[1] = `<< /Type /Pages /Kids [3 0 R ${second} 0 R] /Count 2 >>`;
    return rawPdf(objects);
  }

  it("a diamond lattice of forms is walked once a form: 22 levels weigh 2^21 paints, complete, in well under a second", async () => {
    // History (hostile review r3): the memo key held every form on the
    // path, so the k-th level was reached by 2^(k-1) distinct keys: 5.2 s
    // and 690 MB of main thread, then "paint steps" ended the map and every
    // page was noted. Acyclic paths now share one remembered paint.
    const t0 = Date.now();
    const pre = await preflightPdfjsBytes(lattice(22, "content"));
    const ms = Date.now() - t0;
    expect(pre.pages!.incomplete).toBeNull();
    expect(pre.pages!.weights.get(3)).toBe(2 ** 21 * 1_000_000);
    expect(pre.pages!.exact.get(3)).toBe(2 ** 21 * 1_000_000);
    expect(ms).toBeLessThan(2_000);
  }, 30_000);

  it("an annotation's /D and /R appearances are never drawn by pdf.js, so they weigh nothing; its /N is weighed", async () => {
    const down = lattice(22, "down");
    // The oracle: pdf.js paints no image on the page.
    expect(await pdfjsPaints(down)).toBe(0);
    const pre = await preflightPdfjsBytes(down);
    expect(pre.pages!.incomplete).toBeNull();
    expect(pre.pages!.weights.get(3)).toBe(0);
    expect(pageImageVerdict(pre, { num: 3 })).toBeNull();
    // Positive control: the same lattice as the normal appearance counts.
    const normal = await preflightPdfjsBytes(lattice(22, "normal"));
    expect(normal.pages!.incomplete).toBeNull();
    expect(normal.pages!.weights.get(3)).toBe(2 ** 21 * 1_000_000);
  }, 30_000);

  it("a cyclic lattice (every bottom form painting the top again) stays small: paths past the few remembered take the bound read with none", async () => {
    const levels = 18;
    const objects: Obj[] = [
      CATALOG,
      ONE_PAGE,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /A 6 0 R >> >> /Contents 4 0 R >>",
      { dict: "", stream: "/A Do" },
      image(1000, 1000),
    ];
    for (let k = 1; k <= levels; k += 1) {
      const next =
        k < levels
          ? `/Resources << /XObject << /A ${6 + 2 * k} 0 R /B ${7 + 2 * k} 0 R >> >>`
          : "/Resources << /XObject << /Im 5 0 R /T 6 0 R >> >>";
      for (let f = 0; f < 2; f += 1) {
        objects.push({
          dict: `/Type /XObject /Subtype /Form /BBox [0 0 1 1] ${next}`,
          stream: k < levels ? "/A Do /B Do" : "/Im Do /T Do",
        });
      }
    }
    const t0 = Date.now();
    const pre = await preflightPdfjsBytes(rawPdf(objects));
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(pre.pages!.incomplete).toBeNull();
    // At least what pdf.js paints: 2^17 bottom forms, each its image once
    // (each one's /T is the top form, its own ancestor: refused).
    expect(pre.pages!.weights.get(3)).toBeGreaterThanOrEqual(
      2 ** 17 * 1_000_000,
    );
    expect(pageImageVerdict(pre, { num: 3 })).not.toBeNull();
  }, 30_000);

  it("a Type3 bitmap font with no /Resources is counted once a glyph, not doubled a glyph", async () => {
    // History (legit-corpus review r3): a glyph procedure with no
    // /Resources paints with its page's, whose indirect paint was being
    // summed: the sum so far was returned into itself and the page doubled
    // a glyph (24 glyphs, 1,735 MP; a dvips paper 2.0e80 MP), noted and
    // refused where main draws it.
    const glyphs = 24;
    const mask = "ÿ".repeat(20);
    const pageDict =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /Font << /T3 6 0 R >> /XObject << /Ph 5 0 R >> >> /Contents 4 0 R >>";
    const objects: Obj[] = [
      CATALOG,
      // A second page past the per-image budget, so the file needs a map.
      `<< /Type /Pages /Kids [3 0 R ${7 + glyphs} 0 R] /Count 2 >>`,
      pageDict,
      { dict: "", stream: "BT /T3 12 Tf (ab) Tj ET /Ph Do" },
      image(3000, 3000),
      `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 10 10] /FontMatrix [0.1 0 0 0.1 0 0] /CharProcs << ${Array.from({ length: glyphs }, (_, i) => `/g${i} ${7 + i} 0 R`).join(" ")} >> /Encoding << /Type /Encoding /Differences [97 /g0 /g1] >> /FirstChar 97 /LastChar 98 /Widths [10 10] >>`,
      ...Array.from({ length: glyphs }, (_, i) => ({
        dict: "",
        stream: `10 0 0 0 10 10 d1 BI /W 10 /H 16 /BPC 1 /IM true ID ${mask} EI % ${i}`,
      })),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /H ${9 + glyphs} 0 R >> >> /Contents ${8 + glyphs} 0 R >>`,
      { dict: "", stream: "/H Do" },
      image(7000, 7000),
    ];
    const pre = await preflightPdfjsBytes(rawPdf(objects));
    expect(pre.pages, "the map is built").not.toBeNull();
    expect(pre.pages!.incomplete).toBeNull();
    // The photo, and each glyph's small mask once: linear in the glyphs.
    const w = pre.pages!.weights.get(3)!;
    expect(w).toBeGreaterThan(9_000_000);
    expect(w).toBeLessThan(9_000_000 + glyphs * 1_000);
    expect(pageImageVerdict(pre, { num: 3 })).toBeNull();
  }, 30_000);

  it("thirty tiling patterns whose /Resources is the page's own dictionary count once each", async () => {
    const patterns = 30;
    const objects: Obj[] = [
      CATALOG,
      ONE_PAGE,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources 6 0 R /Contents 4 0 R >>",
      { dict: "", stream: "/Ph Do /Ph Do /Ph Do /Ph Do /Ph Do /Ph Do" },
      image(3000, 3000),
      `<< /XObject << /Ph 5 0 R /T 7 0 R >> /Pattern << ${Array.from({ length: patterns }, (_, i) => `/P${i} ${8 + i} 0 R`).join(" ")} >> >>`,
      image(100, 100),
      ...Array.from({ length: patterns }, () => ({
        dict: "/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources 6 0 R",
        stream: "/T Do",
      })),
    ];
    const pre = await preflightPdfjsBytes(rawPdf(objects));
    expect(pre.pages!.incomplete).toBeNull();
    // Six photo paints, and each pattern's tile once: linear, not doubled.
    expect(pre.pages!.weights.get(3)).toBe(6 * 9_000_000 + patterns * 10_000);
  }, 30_000);

  it("an unencrypted file whose text says /Encrypt, or that carries a protected PDF as an attachment, is read as the plain file it is", async () => {
    // History (hostile review r3): the WORD /Encrypt anywhere made the file
    // encrypted; every stream read as ciphertext and every image page was
    // noted "could not be fully read" and refused, where main draws them.
    const page = (k: number) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Im ${k + 1} 0 R >> >> /Contents ${k} 0 R >>`;
    const said = rawPdf([
      CATALOG,
      "<< /Type /Pages /Kids [3 0 R 6 0 R 9 0 R] /Count 3 >>",
      page(4),
      {
        dict: "",
        stream:
          "BT (The trailer names /Encrypt when a file is protected) Tj ET /Im Do",
      },
      image(7000, 7000),
      page(7),
      { dict: "", stream: "/Im Do" },
      image(7000, 7000),
      page(10),
      { dict: "", stream: "/Im Do" },
      image(7000, 7000),
    ]);
    const inner = await encryptPdf(
      rawPdf([
        CATALOG,
        ONE_PAGE,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /X 5 0 R >> >> /Contents 4 0 R >>",
        { dict: "", stream: "/X Do /X Do /X Do /X Do /X Do /X Do" },
        image(6000, 6000),
      ]),
      { userPassword: "", ownerPassword: "o", cipher: "aes-128" },
    );
    const attached = rawPdf([
      "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(locked.pdf) 13 0 R] >> >> >>",
      "<< /Type /Pages /Kids [3 0 R 6 0 R 9 0 R] /Count 3 >>",
      page(4),
      { dict: "", stream: "/Im Do" },
      image(7000, 7000),
      page(7),
      { dict: "", stream: "/Im Do" },
      image(7000, 7000),
      page(10),
      { dict: "", stream: "/Im Do" },
      image(7000, 7000),
      { dict: "/Type /EmbeddedFile", stream: inner },
      "<< /Type /Filespec /F (locked.pdf) /EF << /F 12 0 R >> >>",
    ]);
    for (const [label, bytes] of [
      ["text", said],
      ["attachment", attached],
    ] as const) {
      const pre = await preflightPdfjsBytes(bytes);
      expect(pre.pages, label).not.toBeNull();
      expect(pre.pages!.incomplete, label).toBeNull();
      // Exactly the file's three pages (an attached file's page is data).
      expect(
        [...pre.pages!.weights.keys()].sort((a, b) => a - b),
        label,
      ).toEqual([3, 6, 9]);
      for (const num of [3, 6, 9]) {
        expect(pre.pages!.weights.get(num), label).toBe(49_000_000);
        expect(pageImageVerdict(pre, { num }), label).toBeNull();
      }
    }
    // Positive control: the attachment opened on its own IS encrypted, and
    // read decrypted (six paints of 36 MP).
    const own = await preflightPdfjsBytes(inner);
    expect(own.pages!.incomplete).toBeNull();
    expect([...own.pages!.weights.values()]).toEqual([6 * 36_000_000]);
  }, 60_000);

  it("LZW content (Acrobat 2 and 3 era) is read as pdf.js reads it, at either /EarlyChange", async () => {
    /** PDF LZW, tracking the decoder's code width as pdf.js computes it. */
    function lzw(data: Uint8Array, earlyChange: number): Uint8Array {
      const out: number[] = [];
      let acc = 0;
      let bits = 0;
      let width = 9;
      let decNext = 258;
      let first = true;
      const emit = (code: number) => {
        acc = (acc << width) | code;
        bits += width;
        while (bits >= 8) {
          out.push((acc >>> (bits - 8)) & 0xff);
          bits -= 8;
        }
        acc &= (1 << bits) - 1;
        if (code === 256) {
          width = 9;
          decNext = 258;
          first = true;
          return;
        }
        if (!first) {
          decNext += 1;
          const c = decNext + earlyChange;
          if ((c & (c - 1)) === 0) width = Math.min(Math.log2(c) + 1, 12);
        }
        first = false;
      };
      const table = new Map<string, number>();
      let next = 258;
      emit(256);
      let w = "";
      for (const b of data) {
        const wc = w + String.fromCharCode(b);
        if (w === "" || table.has(wc)) {
          w = wc;
          continue;
        }
        emit(w.length === 1 ? w.charCodeAt(0) : table.get(w)!);
        table.set(wc, next++);
        w = String.fromCharCode(b);
      }
      if (w !== "") emit(w.length === 1 ? w.charCodeAt(0) : table.get(w)!);
      emit(257);
      if (bits > 0) out.push((acc << (8 - bits)) & 0xff);
      return Uint8Array.from(out);
    }
    const lines: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      lines.push(`${i % 97} ${(i * 7) % 113} m ${(i * 13) % 89} ${i % 61} l S`);
    }
    for (let i = 0; i < 4; i += 1) {
      lines.push(`q 100 0 0 100 ${i * 120} 0 cm /Im Do Q`);
    }
    const text = new TextEncoder().encode(lines.join("\n"));
    for (const earlyChange of [1, 0]) {
      const coded = lzw(text, earlyChange);
      // Health: past 511 codes, so the 10-bit (and later) widths were used.
      expect(coded.length * 8).toBeGreaterThan(9 * 600);
      const bytes = rawPdf([
        CATALOG,
        ONE_PAGE,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>",
        {
          dict: `/Filter /LZWDecode${earlyChange === 0 ? " /DecodeParms << /EarlyChange 0 >>" : ""}`,
          stream: coded,
        },
        await real16mp(),
      ]);
      // The oracle: pdf.js decodes it and paints four times.
      expect(await pdfjsPaints(bytes), `EarlyChange ${earlyChange}`).toBe(4);
      const pre = await preflightPdfjsBytes(bytes);
      expect(pre.pages!.incomplete).toBeNull();
      expect(pre.pages!.weights.get(3), `EarlyChange ${earlyChange}`).toBe(
        4 * MP16,
      );
      expect(pre.pages!.exact.get(3)).toBe(4 * MP16);
      expect(pageImageVerdict(pre, { num: 3 })).toBe(PAGE_IMAGES_NOTE);
    }
  }, 60_000);

  it("content behind /Predictor 12 /Columns 1 is read in a fraction of the 8 s that 64 MB took", async () => {
    const { deflateSync } = await import("node:zlib");
    // Filter byte 0 and value 0, every row.
    const zeros = new Uint8Array(64 << 20);
    const bytes = rawPdf([
      CATALOG,
      "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents 4 0 R >>",
      {
        dict: "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 1 >>",
        stream: new Uint8Array(deflateSync(zeros)),
      },
      image(7000, 7000),
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /H 5 0 R >> >> /Contents 7 0 R >>",
      { dict: "", stream: "/H Do" },
    ]);
    const t0 = Date.now();
    const pre = await preflightPdfjsBytes(bytes);
    const ms = Date.now() - t0;
    expect(pre.pages!.incomplete).toBeNull();
    expect(pre.pages!.weights.get(3)).toBe(0);
    expect(ms).toBeLessThan(4_000);
  }, 60_000);

  it("a form painted 120,000 times a page is looked up once a page: a 20-page map completes, every page measured", async () => {
    // History (legit-corpus review r3): every `Do` was a step of the map's
    // document-wide bound: 2.4 million symbol paints over 20 pages ended it
    // ("paint steps"), every page was noted MAY, preflight 6x main.
    const { deflateSync } = await import("node:zlib");
    const pages = 20;
    const content = (p: number) =>
      new Uint8Array(
        deflateSync(
          Buffer.from(
            `% sheet ${p}\n${Array.from(
              { length: 120_000 },
              (_, i) => `q 1 0 0 1 ${i % 600} ${(i * 7) % 800} cm /S Do Q`,
            ).join("\n")}`,
          ),
        ),
      );
    // 1 catalog, 2 pages, 3 form, 4 icon, 5 photo, 6 photo content; then
    // per sheet: its content, its page.
    const objects: Obj[] = [
      CATALOG,
      "PAGES",
      {
        dict: "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /I 4 0 R >> >>",
        stream: "/I Do",
      },
      image(32, 32),
      image(1500, 2000),
      { dict: "", stream: "/Ph Do" },
    ];
    const kids: number[] = [];
    for (let p = 0; p < pages; p += 1) {
      objects.push({ dict: "/Filter /FlateDecode", stream: content(p) });
      const c = objects.length;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /S 3 0 R /Ph 5 0 R >> >> /Contents [${c} 0 R 6 0 R] >>`,
      );
      kids.push(objects.length);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
    const pre = await preflightPdfjsBytes(rawPdf(objects));
    expect(pre.pages!.incomplete).toBeNull();
    expect(pre.pages!.weights.size).toBe(pages);
    for (const num of kids) {
      expect(pre.pages!.weights.get(num)).toBe(120_000 * 1024 + 3_000_000);
      expect(pre.pages!.exact.get(num)).toBe(120_000 * 1024 + 3_000_000);
    }
  }, 120_000);
});

describe("the map takes the scan's own reading of a stream instead of reading it again", () => {
  /** The map read directly, with the scan's counts or without, counting what it decodes. */
  async function mapWith(bytes: Uint8Array, counted: boolean) {
    const { PageImages } = await import("./pdf-page-images");
    const guard = await import("./pdfjs-guard");
    const scan = await guard.scanPdfStreams(bytes);
    const tools = guard.pageScanTools(
      scan.encrypted,
      scan.jpx,
      counted ? scan.contentCounts : new Map(),
    );
    let decodes = 0;
    const decodeTo = tools.decodeTo;
    tools.decodeTo = (...args) => {
      decodes += 1;
      return decodeTo(...args);
    };
    const reader = await PageImages.open(bytes, tools);
    if (!(reader instanceof PageImages)) throw new Error("no reader");
    const map = await reader.map(Infinity);
    return { map, decodes };
  }

  it("the same weights either way, over the legit corpus and the shapes above, and the counted map decodes no content the scan read", async () => {
    // History (legit-corpus review r3, 2026-11-14): the map decoded and
    // lexed every content stream again after the scan had: 3x main's
    // preflight on drawings. Its reading is now the scan's where the scan
    // read what pdf.js reads; this holds the two equal.
    const dir = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
    const corpus = readdirSync(dir)
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => new Uint8Array(readFileSync(path.join(dir, f))));
    const shapes = [
      await formsBesideHeavyPagePdf(4000, 6708, { real: false }),
      await imagePagesPdf(
        Array.from({ length: 12 }, () => [3000]),
        { real: false, shared: true },
      ),
      rawPdf([
        CATALOG,
        ONE_PAGE,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /A 6 0 R /B 7 0 R >> >> /Contents [4 0 R 5 0 R] >>",
        { dict: "", stream: "q 100 0 0 100 0 0 cm /A Do /B" },
        { dict: "", stream: " Do Q /A Do" },
        image(6000, 6000),
        image(5000, 5000),
      ]),
    ];
    // Health: a corpus, not an empty set.
    expect(corpus.length).toBeGreaterThan(5);
    let read = 0;
    for (const bytes of [...corpus, ...shapes]) {
      const plain = await mapWith(bytes, false);
      const counted = await mapWith(bytes, true);
      expect(counted.map.incomplete).toBe(plain.map.incomplete);
      expect([...counted.map.pages]).toEqual([...plain.map.pages]);
      expect([...counted.map.exact]).toEqual([...plain.map.exact]);
      expect(counted.decodes).toBeLessThanOrEqual(plain.decodes);
      read += plain.decodes;
    }
    // Health: the uncounted maps really read content.
    expect(read).toBeGreaterThan(20);
  }, 120_000);

  it("a page of drawings and one photo: its content is decoded by the scan alone", async () => {
    const { deflateSync } = await import("node:zlib");
    const lines: string[] = ["q 300 0 0 300 50 50 cm /Ph Do Q"];
    for (let i = 0; i < 20_000; i += 1) {
      lines.push(
        `${i % 500} ${(i * 3) % 700} m ${(i * 7) % 500} ${i % 700} l S`,
      );
    }
    const bytes = rawPdf([
      CATALOG,
      "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Ph 5 0 R >> >> /Contents 4 0 R >>",
      {
        dict: "/Filter /FlateDecode",
        stream: new Uint8Array(deflateSync(Buffer.from(lines.join("\n")))),
      },
      image(3000, 2000),
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Ph 5 0 R >> >> /Contents 7 0 R >>",
      { dict: "", stream: "/Ph Do" },
    ]);
    const counted = await mapWith(bytes, true);
    expect(counted.decodes).toBe(0);
    expect(counted.map.pages.get(3)).toBe(6_000_000);
    // Positive control: without the scan's counts, the map decodes the
    // drawing again (the unfiltered stream it hands on as it is).
    const plain = await mapWith(bytes, false);
    expect(plain.decodes).toBe(1);
    expect(plain.map.pages.get(3)).toBe(6_000_000);
  }, 30_000);
});
