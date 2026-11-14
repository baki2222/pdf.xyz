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
  preflightPdfjsBytes,
  type PdfjsPreflight,
} from "./pdfjs-guard";
import { rawPdf } from "@/tests/hostile/conversion-out.fixtures";
import {
  formsPaintOneImagePdf,
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

  it("an image painted four times through forms counts once; an inline image counts every time read", async () => {
    // Plus a 45 MP page so the file weighs past the budget and the map runs.
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(
      await formsPaintOneImagePdf(4000, { real: false }),
    );
    const extra = await PDFDocument.load(
      await imagePagesPdf([[6708]], { real: false }),
    );
    doc.addPage((await doc.copyPages(extra, [0]))[0]!);
    const pre = await preflightPdfjsBytes(
      await doc.save({ useObjectStreams: false }),
    );
    expect(weights(pre)).toEqual([16_000_000, 6708 * 6708]);
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

  it("content the scan cannot read (a filter it does not decode) counts everything its resources hold", async () => {
    const pre = await preflightPdfjsBytes(
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Resources << /XObject << /A 5 0 R /B 6 0 R >> >> /Kids [3 0 R 7 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents 4 0 R >>",
        { dict: "/Filter /LZWDecode", stream: "\u0080\u000b`P" },
        image(6000, 6000),
        image(5000, 5000),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents 8 0 R >>",
        { dict: "", stream: "q 10 0 0 10 0 0 cm /A Do Q" },
      ]),
    );
    // Page 1 (LZW content): both images; page 2 (readable): only /A.
    expect(weights(pre)).toEqual([61_000_000, 36_000_000]);
  });

  it("an encrypted file's content is ciphertext: each page counts what its resources hold, and object streams leave the map incomplete", async () => {
    const plain = await imagePagesPdf([Array<number>(2).fill(6000), [3000]], {
      real: false,
    });
    const enc = await encryptPdf(plain, {
      userPassword: "",
      ownerPassword: "o",
    });
    const pre = await preflightPdfjsBytes(enc);
    // Per-page resources: page 1 holds two 36 MP images, page 2 one 9 MP.
    expect(weights(pre)).toEqual([72_000_000, 9_000_000]);
    const packed = await encryptPdf(plain, {
      userPassword: "",
      ownerPassword: "o",
      objectStreams: true,
    });
    const p2 = await preflightPdfjsBytes(packed);
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
