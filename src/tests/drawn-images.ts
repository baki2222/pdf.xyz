/**
 * Where a saved PDF actually PUTS its images, read back out of the bytes.
 *
 * An image XObject's /Width and /Height are the stored pixels; they say
 * nothing about how the page shows them. What a viewer shows is decided by the
 * current transformation matrix at the `Do` that paints it — the product of
 * every `cm` in force, across `q`/`Q`. This interprets exactly those operators
 * from the page's decoded content stream(s), the way a viewer does, so an
 * assertion about placement is an assertion about the file and not about the
 * call that wrote it.
 *
 * Deliberately small: it understands `q`, `Q`, `cm`, `gs` and `Do`, skips every
 * other operator and its operands, and ignores strings and inline images —
 * none of which the image tools emit. A content stream it cannot tokenize is
 * a thrown error, not an empty answer.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFPage,
} from "pdf-lib";

export type Matrix = [number, number, number, number, number, number];

export interface DrawnImage {
  /** 0-based page index. */
  page: number;
  /** The CTM in force at `Do`: unit square → page space. */
  ctm: Matrix;
  /** The XObject's stored pixel size. */
  width: number;
  height: number;
  /** The `ca` of the last ExtGState set before `Do` in this `q` scope. */
  fillOpacity: number | undefined;
}

/** m1 then m2, in PDF's row-vector convention (p' = p · m1 · m2). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/** Image space (u, v) → page space under `m`. */
export function apply(m: Matrix, u: number, v: number): [number, number] {
  return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
}

function contentText(page: PDFPage): string {
  const contents = page.node.get(PDFName.of("Contents"));
  const resolved =
    contents instanceof PDFRef ? page.doc.context.lookup(contents) : contents;
  const streams =
    resolved instanceof PDFArray
      ? resolved.asArray().map((r) => page.doc.context.lookup(r))
      : [resolved];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) {
        throw new Error("page content is not a raw stream");
      }
      return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
    })
    .join("\n");
}

function lookupDict(page: PDFPage, key: string): PDFDict | undefined {
  const resources = page.node.Resources();
  return resources?.lookupMaybe(PDFName.of(key), PDFDict);
}

/** Every image painted on every page, with the CTM a viewer applies. */
export async function drawnImages(bytes: Uint8Array): Promise<DrawnImage[]> {
  const doc = await PDFDocument.load(bytes);
  const out: DrawnImage[] = [];
  doc.getPages().forEach((page, index) => {
    const xobjects = lookupDict(page, "XObject");
    const states = lookupDict(page, "ExtGState");
    const tokens = contentText(page).match(/\/[^\s/[\]<>()]+|[^\s/[\]<>()]+/g);
    if (!tokens) throw new Error(`page ${index + 1}: empty content stream`);
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    let opacity: number | undefined;
    const stack: { ctm: Matrix; opacity: number | undefined }[] = [];
    let operands: string[] = [];
    for (const token of tokens) {
      if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(token) || token.startsWith("/")) {
        operands.push(token);
        continue;
      }
      switch (token) {
        case "q":
          stack.push({ ctm, opacity });
          break;
        case "Q": {
          const top = stack.pop();
          if (!top) throw new Error(`page ${index + 1}: unbalanced Q`);
          ({ ctm, opacity } = top);
          break;
        }
        case "cm": {
          const m = operands.slice(-6).map(Number);
          if (m.length !== 6 || m.some((n) => !Number.isFinite(n))) {
            throw new Error(`page ${index + 1}: bad cm ${operands.join(" ")}`);
          }
          ctm = multiply(m as Matrix, ctm);
          break;
        }
        case "gs": {
          const name = operands.at(-1)!.slice(1);
          const gs = states?.lookupMaybe(PDFName.of(name), PDFDict);
          const ca = gs?.lookupMaybe(PDFName.of("ca"), PDFNumber);
          if (ca) opacity = ca.asNumber();
          break;
        }
        case "Do": {
          const name = operands.at(-1)!.slice(1);
          const xobject = xobjects?.lookup(PDFName.of(name));
          if (
            xobject instanceof PDFRawStream &&
            xobject.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"
          ) {
            const num = (key: string) =>
              xobject.dict.lookup(PDFName.of(key), PDFNumber).asNumber();
            out.push({
              page: index,
              ctm,
              width: num("Width"),
              height: num("Height"),
              fillOpacity: opacity,
            });
          }
          break;
        }
      }
      operands = [];
    }
  });
  return out;
}

/** The page-space bounding box of the unit square under `m`. */
export function boxOf(m: Matrix): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const corners = [
    apply(m, 0, 0),
    apply(m, 1, 0),
    apply(m, 0, 1),
    apply(m, 1, 1),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}
