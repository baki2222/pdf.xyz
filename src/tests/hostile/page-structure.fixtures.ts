/**
 * Hostile inputs for the "page-structure" family (merge, merge-alternate,
 * split, extract, delete, rotate, organize, n-up, split-half, and the page
 * count / probe gate every tool goes through), each with the TRUTH a correct
 * engine must agree with.
 *
 * Built on this family's raw builders (`./page-structure.raw.ts`)
 * plus the repo's existing fixtures. Every
 * file is generated in code — deterministic, small, nothing downloaded. The
 * two decompression bombs and the 2,000-page document are the only slow
 * builders, and are marked `slow`.
 *
 * `truth` is what the matrix holds each cell's outcome to:
 *  - `not-pdf`: no engine may produce output, and none may report a count.
 *  - `pages`: the document really has `pages` pages (as a conforming reader
 *    that follows the xref sees them). Output must reload with the page count
 *    the operation implies; a refusal is acceptable (honest), a raw throw is
 *    not.
 *  - `truncated`: some prefix of a `max`-page document; any valid output of
 *    1..max pages, or a refusal.
 *  - `no-pages`: a tree with no reachable page; refusal (or a zero count)
 *    only.
 *  - `encrypted`: every pdf-lib engine must refuse with `PdfEncryptedError`,
 *    whose verdict must match `lock` when the fixture states one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { spliceStartxrefPastEnd } from "@/tests/damaged-xref";
import {
  encryptedPdf,
  ownerOnlyObjectStreamPdf,
  unknownHandlerObjectStreamPdf,
  userPasswordObjectStreamPdf,
} from "@/tests/encrypted-pdf-fixture";
import { BROKEN_CJK_SUBSET_PDF_BASE64 } from "@/tests/fixtures-broken-subset";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import {
  concatBytes,
  deepPageTreeObjects,
  latin1,
  manyPageObjects,
  noise,
  NOT_PDF,
  ONE_PAGE,
  onePagePdf,
  rawPdf,
  reflate,
  text,
  truncateAt,
  truncateAtLastEndobj,
  xrefStreamPdf,
  zeroBomb,
  type RawObject,
} from "./page-structure.raw";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

export type Truth =
  | { readonly kind: "not-pdf" }
  | {
      readonly kind: "pages";
      readonly pages: number;
      /** Viewer rotation of each page, when the fixture is about rotation. */
      readonly rotations?: readonly number[];
      /** Text the xref-selected first page draws (duplicate-object cells). */
      readonly marker?: string;
    }
  | { readonly kind: "truncated"; readonly max: number }
  | { readonly kind: "no-pages" }
  | {
      readonly kind: "encrypted";
      readonly lock: "needs-password" | "opens-without-password" | null;
      readonly pages: number | null;
    };

export interface PageStructureFixture {
  readonly id: string;
  /** The survey's hostile class, H01..H24. */
  readonly cls: string;
  readonly title: string;
  readonly truth: Truth;
  /** Generation or processing is slow by construction (bomb, 2,000 pages). */
  readonly slow?: boolean;
  /** Digital signatures a correct counter reports (`openForBatch`). */
  readonly signatures?: number;
  readonly build: () => Uint8Array | Promise<Uint8Array>;
}

/* ------------------------------------------------------------------ *
 *  Small builders local to this family.
 * ------------------------------------------------------------------ */

/** A well-formed `pages`-page document from pdf-lib, classic xref. */
export async function controlPdf(pages = 3): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const labels = Array.from(
    { length: pages },
    (_, i) => `control page ${i + 1}`,
  );
  // Through the chooser, like every module that draws text
  // (src/deploy/text-drawing-call-sites.test.ts).
  const font = await embedDrawingFont(doc, labels);
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([300, 400]);
    page.drawText(labels[i]!, { x: 20, y: 300, size: 14, font });
  }
  return doc.save({ useObjectStreams: false });
}

/** The value written after the LAST `startxref`. */
export function startxrefOf(bytes: Uint8Array): number {
  const t = text(bytes);
  const m = /startxref\s+(\d+)/.exec(t.slice(t.lastIndexOf("startxref")));
  if (!m) throw new Error("no startxref");
  return Number(m[1]);
}

const pageWith = (extra: string, mediaBox = "[0 0 200 200]") =>
  `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Contents 4 0 R ${extra} >>`;

/** ONE_PAGE with the page dictionary replaced. */
const onePageWith = (page: string, more: RawObject[] = []) =>
  rawPdf({
    objects: [ONE_PAGE[0]!, ONE_PAGE[1]!, page, ONE_PAGE[3]!, ...more],
  });

/** Two xref sections whose trailers name each other as /Prev. */
function prevCyclePdf(): Uint8Array {
  const base = onePagePdf();
  const t = text(base);
  // "\nxref\n", not "xref\n": the latter also matches inside "startxref\n".
  const cut = t.lastIndexOf("\nxref\n") + 1;
  const body = base.slice(0, cut);
  const table = t.slice(cut, t.indexOf("trailer", cut));
  const pad = (n: number) => String(n).padStart(10, "0");
  const section = (prev: number) =>
    `${table}trailer\n<< /Size 5 /Root 1 0 R /Prev ${pad(prev)} >>\n`;
  const a = body.length;
  const b = a + section(0).length;
  return concatBytes(
    body,
    latin1(section(b)),
    latin1(section(a)),
    latin1(`startxref\n${b}\n%%EOF\n`),
  );
}

/** A form XObject chain `depth` deep (form i draws form i+1). */
function nestedFormsPdf(depth: number): Uint8Array {
  // 1 catalog, 2 pages, 3 page, 4 page content, 5.. forms
  const objs: RawObject[] = [
    ONE_PAGE[0]!,
    ONE_PAGE[1]!,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /F 5 0 R >> >> >>",
    { dict: "", stream: latin1("/F Do") },
  ];
  for (let d = 0; d < depth; d += 1) {
    const num = 5 + d;
    const last = d === depth - 1;
    objs.push({
      dict: `/Type /XObject /Subtype /Form /BBox [0 0 200 200]${last ? "" : ` /Resources << /XObject << /F ${num + 1} 0 R >> >>`}`,
      stream: latin1(last ? "0 0 m 10 10 l S" : "/F Do"),
    });
  }
  return rawPdf({ objects: objs });
}

/** A content stream of `content` on a 1-page document. */
const contentPdf = (content: string, resources = "") =>
  rawPdf({
    objects: [
      ONE_PAGE[0]!,
      ONE_PAGE[1]!,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R ${resources} >>`,
      { dict: "", stream: latin1(content) },
    ],
  });

/** A signed revision (ByteRange covering it) and an update appended after. */
function signedThenUpdatedPdf(): Uint8Array {
  const contents = "0".repeat(64);
  const sig = `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <${contents}> >>`;
  const first = rawPdf({
    objects: [
      "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>",
      ONE_PAGE[1]!,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [5 0 R] >>",
      ONE_PAGE[3]!,
      "<< /FT /Sig /T (Sig1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R /V 6 0 R >>",
      sig,
    ],
  });
  // Patch a real ByteRange around the <contents> hole (same digit widths).
  const t = text(first);
  const open = t.indexOf(`<${contents}>`);
  const close = open + contents.length + 2;
  const range = `[0 ${String(open).padStart(10, "0")} ${String(close).padStart(10, "0")} ${String(first.length - close).padStart(10, "0")}]`;
  const signed = latin1(
    t.replace("[0 0000000000 0000000000 0000000000]", range),
  );
  // Incremental update: a new content stream for the page.
  const prev = startxrefOf(signed);
  const objAt = signed.length;
  const stream = "0 0 m 200 200 l S";
  const obj = `7 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 7 0 R /Annots [5 0 R] >>\nendobj\n`;
  const pageAt = objAt + obj.indexOf("3 0 obj");
  const xrefAt = objAt + obj.length;
  const xref =
    `xref\n3 1\n${String(pageAt).padStart(10, "0")} 00000 n \n7 1\n${String(objAt).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size 8 /Root 1 0 R /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return concatBytes(signed, latin1(obj + xref));
}

/** Two bodies for object 3; the xref names the `pick`ed one. */
function duplicatePagePdf(pick: "first" | "last"): Uint8Array {
  const page = (box: number, content: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${box} ${box}] /Contents ${content} 0 R >>`;
  const objects: RawObject[] = [
    ONE_PAGE[0]!,
    ONE_PAGE[1]!,
    page(100, 4),
    { dict: "", stream: latin1("BT /F1 12 Tf (FIRST) Tj ET") },
    { dict: "", stream: latin1("BT /F1 12 Tf (SECOND) Tj ET") },
    page(300, 5),
  ];
  const numbers = [1, 2, 3, 4, 5, 3];
  // rawPdf keeps the LAST offset for a repeated number; a first-pick xref
  // is written by rebuilding with the first body's offset spliced in.
  const last = rawPdf({ objects, numbers });
  if (pick === "last") return last;
  const t = text(last);
  const firstAt = t.indexOf("3 0 obj");
  const lastAt = t.lastIndexOf("3 0 obj");
  return latin1(
    t.replace(
      `${String(lastAt).padStart(10, "0")} 00000 n `,
      `${String(firstAt).padStart(10, "0")} 00000 n `,
    ),
  );
}

/** PDF 2.0 header, xref stream + object streams only (pdf-lib's default). */
async function pdf20ObjectStreams(): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  const bytes = await doc.save({ useObjectStreams: true });
  const t = text(bytes);
  if (!t.startsWith("%PDF-1.7")) throw new Error("unexpected pdf-lib header");
  // Same length, so every offset stays true.
  return latin1(`%PDF-2.0${t.slice("%PDF-1.7".length)}`);
}

const fixtureFile = (name: string) =>
  new Uint8Array(
    readFileSync(
      path.join(process.cwd(), "src/tests/fixtures/restricted-pdf", name),
    ),
  );

/* ------------------------------------------------------------------ *
 *  The registry.
 * ------------------------------------------------------------------ */

const P1: Truth = { kind: "pages", pages: 1 };

export const PAGE_STRUCTURE_FIXTURES: readonly PageStructureFixture[] = [
  // H01–H03: not a PDF, or barely one.
  {
    id: "H01.empty",
    cls: "H01",
    title: "zero-byte file",
    truth: { kind: "not-pdf" },
    build: NOT_PDF.empty,
  },
  {
    id: "H02.png",
    cls: "H02",
    title: "PNG magic named .pdf",
    truth: { kind: "not-pdf" },
    build: NOT_PDF.png,
  },
  {
    id: "H02.zip",
    cls: "H02",
    title: "ZIP/DOCX magic named .pdf",
    truth: { kind: "not-pdf" },
    build: NOT_PDF.zip,
  },
  {
    id: "H02.random",
    cls: "H02",
    title: "random 4 KB",
    truth: { kind: "not-pdf" },
    build: NOT_PDF.random4k,
  },
  {
    id: "H02.html",
    cls: "H02",
    title: "HTML text",
    truth: { kind: "not-pdf" },
    build: NOT_PDF.html,
  },
  {
    id: "H03.header",
    cls: "H03",
    title: "'%PDF-1.7\\n' and nothing else",
    truth: { kind: "not-pdf" },
    build: NOT_PDF.headerOnly,
  },

  // H04: truncated.
  {
    id: "H04.half",
    cls: "H04",
    title: "3-page file cut at 50%",
    truth: { kind: "truncated", max: 3 },
    build: async () => truncateAt(await controlPdf(3), 0.5),
  },
  {
    id: "H04.endobj",
    cls: "H04",
    title: "cut after the last endobj (no xref/trailer)",
    truth: { kind: "pages", pages: 3 },
    build: async () => truncateAtLastEndobj(await controlPdf(3)),
  },

  // H05: broken xref.
  {
    id: "H05.offsets",
    cls: "H05",
    title: "every xref offset 37 bytes off",
    truth: P1,
    build: () => rawPdf({ objects: ONE_PAGE, offset: (r) => r + 37 }),
  },
  {
    id: "H05.startxref",
    cls: "H05",
    title: "startxref past EOF",
    truth: P1,
    build: () => spliceStartxrefPastEnd(onePagePdf()),
  },
  {
    id: "H05.garbage",
    cls: "H05",
    title: "xref table replaced by noise",
    truth: P1,
    build: () => {
      const b = onePagePdf();
      const t = text(b);
      const from = t.lastIndexOf("\nxref\n") + 1;
      const to = t.indexOf("trailer", from);
      const junk = noise(to - from, 99).map((x) => (x === 0x0a ? 0x20 : x));
      return concatBytes(b.slice(0, from), junk, b.slice(to));
    },
  },

  // H06: /Prev loops.
  {
    id: "H06.self",
    cls: "H06",
    title: "classic trailer /Prev pointing at itself",
    truth: P1,
    build: () =>
      rawPdf({
        objects: ONE_PAGE,
        trailer: `/Prev ${startxrefOf(onePagePdf())}`,
      }),
  },
  {
    id: "H06.cycle",
    cls: "H06",
    title: "classic A->B->A /Prev cycle",
    truth: P1,
    build: prevCyclePdf,
  },
  {
    id: "H06.stream",
    cls: "H06",
    title: "xref stream /Prev pointing at itself",
    truth: P1,
    build: () =>
      xrefStreamPdf({
        objects: ONE_PAGE,
        trailer: `/Prev ${startxrefOf(xrefStreamPdf({ objects: ONE_PAGE }))}`,
      }),
  },

  // H07: self-referencing structure.
  {
    id: "H07.kidsCycle",
    cls: "H07",
    title: "two Pages nodes that are each other's only kid",
    truth: { kind: "no-pages" },
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          "<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>",
        ],
      }),
  },
  {
    id: "H07.selfKid",
    cls: "H07",
    title: "Pages /Kids containing its own ref (plus one real page)",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>",
          ONE_PAGE[2]!,
          ONE_PAGE[3]!,
        ],
      }),
  },
  {
    id: "H07.selfRef",
    cls: "H07",
    title:
      "page /Resources and /CropBox are objects whose value is a ref to themselves",
    truth: P1,
    build: () =>
      onePageWith(pageWith("/Resources 5 0 R /CropBox 6 0 R"), [
        "5 0 R",
        "6 0 R",
      ]),
  },
  {
    id: "H07.parentCycle",
    cls: "H07",
    title: "page /Parent is the page itself, no own MediaBox",
    truth: P1,
    build: () => onePageWith("<< /Type /Page /Parent 3 0 R /Contents 4 0 R >>"),
  },

  // H08: depth.
  {
    id: "H08.tree2000",
    cls: "H08",
    title: "/Kids chain 2,000 deep",
    truth: P1,
    build: () => rawPdf({ objects: deepPageTreeObjects(2000) }),
  },
  {
    id: "H08.tree50000",
    cls: "H08",
    title: "/Kids chain 50,000 deep (extra)",
    truth: P1,
    slow: true,
    build: () => rawPdf({ objects: deepPageTreeObjects(50_000) }),
  },
  {
    id: "H08.forms2000",
    cls: "H08",
    title: "Form XObjects nested 2,000 deep",
    truth: P1,
    build: () => nestedFormsPdf(2000),
  },
  {
    id: "H08.forms20000",
    cls: "H08",
    title: "Form XObjects nested 20,000 deep (extra)",
    truth: P1,
    slow: true,
    build: () => nestedFormsPdf(20_000),
  },
  {
    id: "H08.formSelf",
    cls: "H08",
    title: "a Form XObject that draws itself",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          ONE_PAGE[1]!,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /F 5 0 R >> >> >>",
          { dict: "", stream: latin1("/F Do") },
          {
            dict: "/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << /XObject << /F 5 0 R >> >>",
            stream: latin1("/F Do"),
          },
        ],
      }),
  },

  // H09: declared counts.
  {
    id: "H09.countMax",
    cls: "H09",
    title: "/Count 2147483647 with 1 real page",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          "<< /Type /Pages /Kids [3 0 R] /Count 2147483647 >>",
          ONE_PAGE[2]!,
          ONE_PAGE[3]!,
        ],
      }),
  },
  {
    id: "H09.countNeg",
    cls: "H09",
    title: "/Count -1",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          "<< /Type /Pages /Kids [3 0 R] /Count -1 >>",
          ONE_PAGE[2]!,
          ONE_PAGE[3]!,
        ],
      }),
  },
  {
    id: "H09.countFrac",
    cls: "H09",
    title: "/Count 1.5",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          "<< /Type /Pages /Kids [3 0 R] /Count 1.5 >>",
          ONE_PAGE[2]!,
          ONE_PAGE[3]!,
        ],
      }),
  },
  {
    id: "H09.countZero",
    cls: "H09",
    title: "/Count 0 with 1 real page",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          "<< /Type /Pages /Kids [3 0 R] /Count 0 >>",
          ONE_PAGE[2]!,
          ONE_PAGE[3]!,
        ],
      }),
  },

  // H10: boxes.
  {
    id: "H10.huge",
    cls: "H10",
    title: "MediaBox [0 0 1e9 1e9]",
    truth: P1,
    build: () => onePageWith(pageWith("", "[0 0 1000000000 1000000000]")),
  },
  {
    id: "H10.zero",
    cls: "H10",
    title: "MediaBox [0 0 0 0]",
    truth: P1,
    build: () => onePageWith(pageWith("", "[0 0 0 0]")),
  },
  {
    id: "H10.inverted",
    cls: "H10",
    title: "MediaBox [200 200 0 0] (inverted)",
    truth: P1,
    build: () => onePageWith(pageWith("", "[200 200 0 0]")),
  },
  {
    id: "H10.userUnit",
    cls: "H10",
    title: "14,400 pt MediaBox with /UserUnit 75000",
    truth: P1,
    build: () => onePageWith(pageWith("/UserUnit 75000", "[0 0 14400 14400]")),
  },

  // H11: image header lies.
  {
    id: "H11.image",
    cls: "H11",
    title:
      "image XObject declaring 100000x100000 RGB 8 bpc, a stream of 16 bytes",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          ONE_PAGE[1]!,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /Im 5 0 R >> >> >>",
          { dict: "", stream: latin1("q 200 0 0 200 0 0 cm /Im Do Q") },
          {
            dict: "/Type /XObject /Subtype /Image /Width 100000 /Height 100000 /ColorSpace /DeviceRGB /BitsPerComponent 8",
            stream: noise(16, 5),
          },
        ],
      }),
  },

  // H12: decompression bombs (content stream).
  {
    id: "H12.bomb",
    cls: "H12",
    title: "FlateDecode content ~1 MB -> 1 GiB",
    truth: P1,
    slow: true,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          ONE_PAGE[1]!,
          ONE_PAGE[2]!,
          { dict: "/Filter /FlateDecode", stream: zeroBomb(1024) },
        ],
      }),
  },
  {
    id: "H12.chained",
    cls: "H12",
    title: "[/FlateDecode /FlateDecode] content, small -> 1 GiB",
    truth: P1,
    slow: true,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          ONE_PAGE[1]!,
          ONE_PAGE[2]!,
          {
            dict: "/Filter [/FlateDecode /FlateDecode]",
            stream: reflate(zeroBomb(1024)),
          },
        ],
      }),
  },

  // H13: fonts.
  {
    id: "H13.truncTT",
    cls: "H13",
    title: "TrueType font whose FontFile2 is 12 bytes of a header",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          ONE_PAGE[1]!,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
          { dict: "", stream: latin1("BT /F1 12 Tf 10 100 Td (Hello) Tj ET") },
          "<< /Type /Font /Subtype /TrueType /BaseFont /Broken /FirstChar 32 /LastChar 126 /Widths [] /FontDescriptor 6 0 R >>",
          "<< /Type /FontDescriptor /FontName /Broken /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>",
          {
            dict: "/Length1 4096",
            stream: Uint8Array.from([0, 1, 0, 0, 0, 9, 0, 0x80, 0, 3, 0, 0x10]),
          },
        ],
      }),
  },
  {
    id: "H13.type3Rec",
    cls: "H13",
    title: "Type3 font whose CharProc draws with the same font",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          ONE_PAGE[1]!,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /T3 5 0 R >> >> >>",
          { dict: "", stream: latin1("BT /T3 12 Tf 10 100 Td (a) Tj ET") },
          "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a 6 0 R >> /Encoding << /Type /Encoding /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1000] /Resources << /Font << /T3 5 0 R >> >> >>",
          { dict: "", stream: latin1("1000 0 d0 BT /T3 1 Tf (a) Tj ET") },
        ],
      }),
  },
  {
    id: "H13.brokenCjk",
    cls: "H13",
    title: "BROKEN_CJK_SUBSET (bogus loca)",
    truth: P1,
    build: () =>
      new Uint8Array(Buffer.from(BROKEN_CJK_SUBSET_PDF_BASE64, "base64")),
  },

  // H14: needs a password.
  {
    id: "H14.user",
    cls: "H14",
    title: "RC4-128 with an open password",
    truth: { kind: "encrypted", lock: "needs-password", pages: 1 },
    build: () =>
      encryptedPdf({
        userPassword: "open-sesame",
        ownerPassword: "owner-secret",
      }),
  },
  {
    id: "H14.userObjStm",
    cls: "H14",
    title: "open password, page tree in an encrypted object stream",
    truth: { kind: "encrypted", lock: "needs-password", pages: 1 },
    build: userPasswordObjectStreamPdf,
  },
  {
    id: "H14.pypdfOpen",
    cls: "H14",
    title: "pypdf r3 open-password file",
    truth: { kind: "encrypted", lock: "needs-password", pages: null },
    build: () => fixtureFile("pypdf-r3-open-password.pdf"),
  },

  // H15: owner-only and unknown handlers.
  {
    id: "H15.ownerRc4",
    cls: "H15",
    title: "owner-only RC4-128 (generated)",
    truth: { kind: "encrypted", lock: "opens-without-password", pages: 1 },
    build: () =>
      encryptedPdf({ userPassword: "", ownerPassword: "owner-secret" }),
  },
  {
    id: "H15.ownerObjStm",
    cls: "H15",
    title: "owner-only, page tree in an encrypted object stream",
    truth: { kind: "encrypted", lock: "opens-without-password", pages: 1 },
    build: ownerOnlyObjectStreamPdf,
  },
  {
    id: "H15.qpdfR2",
    cls: "H15",
    title: "qpdf R2 RC4-40 owner-only",
    truth: { kind: "encrypted", lock: "opens-without-password", pages: null },
    build: () => fixtureFile("qpdf-r2-rc4-40.pdf"),
  },
  {
    id: "H15.qpdfR3",
    cls: "H15",
    title: "qpdf R3 RC4-128 owner-only",
    truth: { kind: "encrypted", lock: "opens-without-password", pages: null },
    build: () => fixtureFile("qpdf-r3-rc4-128.pdf"),
  },
  {
    id: "H15.qpdfR4",
    cls: "H15",
    title: "qpdf R4 AES-128 owner-only",
    truth: { kind: "encrypted", lock: "opens-without-password", pages: null },
    build: () => fixtureFile("qpdf-r4-aes128.pdf"),
  },
  {
    id: "H15.qpdfR6",
    cls: "H15",
    title: "qpdf R6 AES-256 owner-only",
    truth: { kind: "encrypted", lock: "opens-without-password", pages: null },
    build: () => fixtureFile("qpdf-r6-aes256.pdf"),
  },
  {
    id: "H15.unknownObjStm",
    cls: "H15",
    title: "unknown /Filter handler, object streams",
    truth: { kind: "encrypted", lock: null, pages: null },
    build: unknownHandlerObjectStreamPdf,
  },
  {
    id: "H15.unsupported",
    cls: "H15",
    title: "unknown security handler (unsupportedEncryptionPdf)",
    truth: { kind: "encrypted", lock: null, pages: null },
    build: unsupportedEncryptionPdf,
  },

  // H16: active content.
  {
    id: "H16.actions",
    cls: "H16",
    title:
      "JS /OpenAction, catalog+page /AA, /Launch link, javascript: URI, /EmbeddedFiles",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          "<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> /AA << /WC << /S /JavaScript /JS (app.alert\\(2\\)) >> >> /Names << /JavaScript << /Names [(n) << /S /JavaScript /JS (app.alert\\(3\\)) >>] >> /EmbeddedFiles << /Names [(evil.exe) 5 0 R] >> >> >>",
          ONE_PAGE[1]!,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /AA << /O << /S /JavaScript /JS (app.alert\\(4\\)) >> >> /Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 100 100] /A << /S /Launch /F (cmd.exe) >> >> << /Type /Annot /Subtype /Link /Rect [100 100 200 200] /A << /S /URI /URI (javascript:alert\\(5\\)) >> >>] >>",
          ONE_PAGE[3]!,
          "<< /Type /Filespec /F (evil.exe) /EF << /F 6 0 R >> >>",
          { dict: "/Type /EmbeddedFile", stream: latin1("MZ not really") },
        ],
      }),
  },

  // H17: signatures.
  {
    id: "H17.signedUpdate",
    cls: "H17",
    title: "signed revision (real ByteRange) + incremental update",
    truth: P1,
    signatures: 1,
    build: signedThenUpdatedPdf,
  },
  {
    id: "H17.byteRangeText",
    cls: "H17",
    title:
      "unsigned page whose content stream SHOWS '/ByteRange [0 10 20 30]' as text",
    truth: P1,
    signatures: 0,
    build: () =>
      contentPdf(
        "BT /F1 10 Tf 10 100 Td (/ByteRange [0 10 20 30]) Tj ET",
        "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>",
      ),
  },

  // H18: numbers.
  {
    id: "H18.mediaExp",
    cls: "H18",
    title: "MediaBox [0 0 1e309 792]",
    truth: P1,
    build: () => onePageWith(pageWith("", "[0 0 1e309 792]")),
  },
  {
    id: "H18.mediaJunk",
    cls: "H18",
    title: "MediaBox [-0 . --5 99999999999999999999]",
    truth: P1,
    build: () => onePageWith(pageWith("", "[-0 . --5 99999999999999999999]")),
  },
  {
    id: "H18.rotateHuge",
    cls: "H18",
    title: "/Rotate 99999999999999999999",
    truth: { kind: "pages", pages: 1, rotations: [0] },
    build: () => onePageWith(pageWith("/Rotate 99999999999999999999")),
  },
  {
    id: "H18.matrix",
    cls: "H18",
    title: "form /Matrix [1e309 0 0 1 0 0], /BBox [0 0 99999999999999999999 1]",
    truth: P1,
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          ONE_PAGE[1]!,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /F 5 0 R >> >> >>",
          { dict: "", stream: latin1("/F Do") },
          {
            dict: "/Type /XObject /Subtype /Form /Matrix [1e309 0 0 1 0 0] /BBox [0 0 99999999999999999999 1]",
            stream: latin1("0 0 m 10 10 l S"),
          },
        ],
      }),
  },
  {
    id: "H18.wJunk",
    cls: "H18",
    title: "xref stream /W [1 99999999999999999999 2]",
    truth: P1,
    build: () =>
      xrefStreamPdf({ objects: ONE_PAGE, w: "[1 99999999999999999999 2]" }),
  },

  // H19: duplicate object ids.
  {
    id: "H19.dupFirst",
    cls: "H19",
    title: "object 3 defined twice, xref names the FIRST (100 pt, 'FIRST')",
    truth: { kind: "pages", pages: 1, marker: "FIRST" },
    build: () => duplicatePagePdf("first"),
  },
  {
    id: "H19.dupLast",
    cls: "H19",
    title: "object 3 defined twice, xref names the LAST (300 pt, 'SECOND')",
    truth: { kind: "pages", pages: 1, marker: "SECOND" },
    build: () => duplicatePagePdf("last"),
  },

  // H20: PDF 2.0, object streams only.
  {
    id: "H20.pdf20",
    cls: "H20",
    title: "%PDF-2.0, xref stream + object streams, catalog compressed",
    truth: { kind: "pages", pages: 2 },
    build: pdf20ObjectStreams,
  },
  {
    id: "H20.packedCatalog",
    cls: "H20",
    title: "hand-built xref stream with catalog/pages/page packed",
    truth: P1,
    build: () =>
      xrefStreamPdf({ objects: ONE_PAGE, pack: [1, 2, 3], header: "%PDF-2.0" }),
  },

  // H21: scale.
  {
    id: "H21.pages2000",
    cls: "H21",
    title: "2,000 pages sharing one content stream",
    truth: { kind: "pages", pages: 2000 },
    slow: true,
    build: () => rawPdf({ objects: manyPageObjects(2000) }),
  },

  // H22: rotation values.
  {
    id: "H22.rot45",
    cls: "H22",
    title: "/Rotate 45",
    truth: { kind: "pages", pages: 1, rotations: [0] },
    build: () => onePageWith(pageWith("/Rotate 45")),
  },
  {
    id: "H22.rot1e9",
    cls: "H22",
    title: "/Rotate 1000000000",
    truth: { kind: "pages", pages: 1, rotations: [0] },
    build: () => onePageWith(pageWith("/Rotate 1000000000")),
  },
  {
    id: "H22.rot900",
    cls: "H22",
    title: "/Rotate 900 (= 180)",
    truth: { kind: "pages", pages: 1, rotations: [180] },
    build: () => onePageWith(pageWith("/Rotate 900")),
  },
  {
    id: "H22.rotNeg",
    cls: "H22",
    title: "/Rotate -90 (= 270)",
    truth: { kind: "pages", pages: 1, rotations: [270] },
    build: () => onePageWith(pageWith("/Rotate -90")),
  },
  {
    id: "H22.rotInherited",
    cls: "H22",
    title: "/Rotate 90 on Pages, inherited by the page",
    truth: { kind: "pages", pages: 1, rotations: [90] },
    build: () =>
      rawPdf({
        objects: [
          ONE_PAGE[0]!,
          "<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate 90 >>",
          ONE_PAGE[2]!,
          ONE_PAGE[3]!,
        ],
      }),
  },

  // H23: object stream header lies.
  {
    id: "H23.nLie",
    cls: "H23",
    title: "object stream /N 5000 holding 3 objects",
    truth: P1,
    build: () =>
      xrefStreamPdf({ objects: ONE_PAGE, pack: [1, 2, 3], objStmN: "5000" }),
  },
  {
    id: "H23.firstPast",
    cls: "H23",
    title: "object stream /First beyond the stream's length",
    truth: P1,
    build: () =>
      xrefStreamPdf({
        objects: ONE_PAGE,
        pack: [1, 2, 3],
        objStmFirst: "999999",
      }),
  },

  // H24: content operators.
  {
    id: "H24.unbalancedQ",
    cls: "H24",
    title: "content 'q' x 100,000 then 'Q' x 100,001",
    truth: P1,
    build: () =>
      contentPdf(
        `${"q ".repeat(100_000)}0 0 m 10 10 l S ${"Q ".repeat(100_001)}`,
      ),
  },
  {
    id: "H24.inlineHuge",
    cls: "H24",
    title: "inline image BI declaring 100000x100000 RGB, 6 data bytes",
    truth: P1,
    build: () =>
      contentPdf(
        "q 100 0 0 100 0 0 cm BI /W 100000 /H 100000 /BPC 8 /CS /RGB ID \x00\x01\x02\x03\x04\x05 EI Q",
      ),
  },
];
