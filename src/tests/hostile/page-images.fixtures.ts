// Fixtures for the per-page image budget (`RASTER_MAX_PAGE_IMAGE_PIXELS`,
// ./pdf-page-images): pages whose images are each within the per-image
// budget and together past the page's, the long scans that must stay
// unaffected, and the structures the page map has to read through (shared
// /Resources, object streams, forms painting one image more than once).
//
// `real: false` writes each image's dictionary with its size and a few bytes
// of data: the page map reads sizes from dictionaries and never decodes an
// image, so a preflight-only test needs no pixels. `real: true` writes the
// pixels (zeros, deflated once and shared), for the tests that draw.
import { deflatedZeros, rawPdf, type RawObj } from "./conversion-out.fixtures";

const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

/** One `side` x `side` RGB Flate image's data: zeros, or a stand-in. */
async function imageData(side: number, real: boolean): Promise<Uint8Array> {
  return real ? deflatedZeros(side * side * 3) : new Uint8Array([0x78, 0x9c]);
}

const imageDict = (side: number) =>
  `/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode`;

/**
 * Where image `k` of `n` sits on a 600 x 600 page: a grid of cells, each
 * image filling its own, so a page's ink box is the grid's.
 */
function cell(k: number, n: number): string {
  const cols = Math.ceil(Math.sqrt(n));
  const size = Math.floor(500 / cols);
  const x = 50 + (k % cols) * size;
  const y = 50 + Math.floor(k / cols) * size;
  return `q ${size} 0 0 ${size} ${x} ${y} cm /Im${k} Do Q`;
}

/**
 * Pages, each `spec` an array of image sides painted on that page (empty:
 * a text page). Every image is its own object. `shared` puts every page's
 * images in ONE /Resources dictionary on the /Pages node, inherited by every
 * page (what many writers do), with the names unique across the document.
 */
export async function imagePagesPdf(
  spec: readonly (readonly number[])[],
  { real = true, shared = false }: { real?: boolean; shared?: boolean } = {},
): Promise<Uint8Array> {
  const datas = new Map<number, Uint8Array>();
  for (const side of new Set(spec.flat())) {
    datas.set(side, await imageData(side, real));
  }
  const objects: RawObj[] = [];
  const add = (o: RawObj) => {
    objects.push(o);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES"); // filled below
  const font = add(HELVETICA);
  const pageNums: number[] = [];
  const allNames: string[] = [];
  let name = 0;
  for (const sides of spec) {
    const names: string[] = [];
    const ops: string[] = [];
    sides.forEach((side, k) => {
      const num = add({ dict: imageDict(side), stream: datas.get(side)! });
      const n = `Im${name++}`;
      names.push(`/${n} ${num} 0 R`);
      ops.push(cell(k, sides.length).replace(`/Im${k} Do`, `/${n} Do`));
    });
    allNames.push(...names);
    const content = add({
      dict: "",
      stream: `BT /F1 14 Tf 60 20 Td (PAGE ${pageNums.length + 1}) Tj ET\n${ops.join("\n")}`,
    });
    const resources = shared
      ? ""
      : `/Resources << /Font << /F1 ${font} 0 R >> /XObject << ${names.join(" ")} >> >> `;
    pageNums.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] ${resources}/Contents ${content} 0 R >>`,
      ),
    );
  }
  const inherited = shared
    ? `/Resources << /Font << /F1 ${font} 0 R >> /XObject << ${allNames.join(" ")} >> >> `
    : "";
  objects[1] = `<< /Type /Pages ${inherited}/Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNums.length} >>`;
  return rawPdf(objects);
}

/**
 * The same document rewritten by pdf-lib with OBJECT STREAMS: every page
 * dictionary, the page tree and the shared /Resources move into compressed
 * object streams behind a cross-reference stream, where a byte scan of the
 * file's text cannot see them.
 */
export async function withObjectStreams(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

/**
 * One page painting a `side` x `side` image FOUR times through forms: form
 * A (painted twice by the page) paints the image and form B, and form B
 * paints the image again. pdf.js decodes the image once for the page.
 */
export async function formsPaintOneImagePdf(
  side: number,
  { real = true }: { real?: boolean } = {},
): Promise<Uint8Array> {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Fa 5 0 R >> >> /Contents 4 0 R >>",
    {
      dict: "",
      stream: "q 1 0 0 1 0 0 cm /Fa Do Q q 1 0 0 1 300 0 cm /Fa Do Q",
    },
    {
      dict: "/Type /XObject /Subtype /Form /BBox [0 0 300 600] /Resources << /XObject << /Im 7 0 R /Fb 6 0 R >> >>",
      stream: "q 250 0 0 250 25 25 cm /Im Do Q /Fb Do",
    },
    {
      dict: "/Type /XObject /Subtype /Form /BBox [0 0 300 600] /Resources << /XObject << /Im 7 0 R >> >>",
      stream: "q 250 0 0 250 25 325 cm /Im Do Q",
    },
    { dict: imageDict(side), stream: await imageData(side, real) },
  ]);
}
