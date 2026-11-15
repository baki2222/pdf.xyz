/**
 * What the production proof (`scripts/worker-prove-tools.ts`) sends PDF to
 * PowerPoint, and how it judges the deck the DEPLOYED worker returns.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The owner found the missing pictures in a production download. The proof
 * that ran against production until 2026-10-10 sent a text-only PDF and asked
 * whether the deck opens and carries the text — true of the deck with no
 * pictures, so it was green on exactly the defect. Its input now carries a
 * picture at a known place, and its verdict fails a deck whose slide does not
 * carry that picture, as a picture, there. The round trip beside it (the deck
 * back through the worker's own PowerPoint to PDF) is judged by the fidelity
 * instrument against the same source, instead of by its page count.
 *
 * `deployment-proof.test.ts` holds the verdict to its controls: it passes the
 * engine's deck, and fails the text-only deck, a deck whose picture moved, and
 * the package PowerPoint refused.
 */
import JSZip from "jszip";
import { PDFDocument, rgb } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { decodePng } from "@/lib/png-probe";
import { readDocxBody } from "./docx-read";
import {
  docxStructureProblems,
  readDocxStructure,
  type DocxReadRun,
} from "./docx-structure";
import { inventoryPages } from "./page-inventory";
import { encodePngImage } from "./png-encode";
import { pptxProofVerdict } from "./validate-ooxml";

/** The proof's words, read back off a slide. */
export const PPTX_PROOF_TEXT = "pdf.xyz deployment proof";

/** Its picture: pixel size, and where the page shows it (points, top-left). */
export const PPTX_PROOF_PICTURE = {
  pixelWidth: 64,
  pixelHeight: 40,
  x: 60,
  y: 120,
  width: 256,
  height: 160,
} as const;

/** Its three regions' colours: a band across the top, two halves below. */
const PROOF_COLOURS = {
  band: [40, 55, 90],
  left: [230, 120, 40],
  right: [60, 150, 200],
} as const;

const PAGE = { width: 595, height: 842 } as const;

/** One A4 page: the proof's line of text and its picture. Deterministic. */
export async function pptxProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [PPTX_PROOF_TEXT]);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  page.drawText(PPTX_PROOF_TEXT, { x: 60, y: 770, size: 20, font });
  const { pixelWidth: w, pixelHeight: h } = PPTX_PROOF_PICTURE;
  const pixels = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    const y = Math.floor(p / w);
    pixels.set(
      y < h / 4
        ? PROOF_COLOURS.band
        : x < w / 2
          ? PROOF_COLOURS.left
          : PROOF_COLOURS.right,
      p * 3,
    );
  }
  const picture = await embedRasterImage(
    doc,
    encodePngImage(w, h, "rgb8", pixels),
    "png",
  );
  const box = PPTX_PROOF_PICTURE;
  await drawRasterImage(page, picture, {
    x: box.x,
    y: PAGE.height - box.y - box.height,
    width: box.width,
    height: box.height,
  });
  return doc.save();
}

/** Within this many points of where the page shows it. */
const POINTS = 1;
const EMU_PER_POINT = 12_700;

/**
 * Is `png` the proof's picture: its pixel size, and its three regions'
 * colours (opaque, within 12 levels a channel) at each region's centre?
 */
function showsProofPicture(png: Uint8Array): boolean {
  try {
    const { width, height, data } = decodePng(png);
    const box = PPTX_PROOF_PICTURE;
    if (width !== box.pixelWidth || height !== box.pixelHeight) return false;
    const at = (x: number, y: number, want: readonly number[]) => {
      const i = (y * width + x) * 4;
      return (
        data[i + 3] === 255 &&
        want.every((c, k) => Math.abs(data[i + k]! - c) <= 12)
      );
    };
    const below = Math.floor((height * 5) / 8);
    return (
      at(Math.floor(width / 2), Math.floor(height / 8), PROOF_COLOURS.band) &&
      at(Math.floor(width / 4), below, PROOF_COLOURS.left) &&
      at(Math.floor((width * 3) / 4), below, PROOF_COLOURS.right)
    );
  } catch {
    return false;
  }
}

/**
 * The deployed deck, judged: the package readers (`pptxProofVerdict`: opens,
 * walks, carries the text) AND the picture — a `p:pic` on slide 1 at the
 * proof picture's box, whose image is the proof's picture: its pixel size
 * and, decoded, its three colours. The slide is the page's size, so page
 * points are slide points. Until 2026-10-11 only the size was read, and a
 * deployed engine writing every picture blank passed.
 */
export async function pptxDeploymentVerdict(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  const structure = await pptxProofVerdict(bytes, PPTX_PROOF_TEXT);
  if (!structure.ok) return structure;
  const zip = await JSZip.loadAsync(bytes);
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(presentation ?? "");
  const want = [PAGE.width, PAGE.height].map((v) => v * EMU_PER_POINT);
  if (
    !size ||
    Math.abs(Number(size[1]) - want[0]!) > EMU_PER_POINT ||
    Math.abs(Number(size[2]) - want[1]!) > EMU_PER_POINT
  )
    return {
      ok: false,
      detail: `the slide is ${size ? `${Number(size[1]) / EMU_PER_POINT} × ${Number(size[2]) / EMU_PER_POINT} pt` : "of no size"}, not the page's ${PAGE.width} × ${PAGE.height}`,
    };
  const slide =
    (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
  const rels =
    (await zip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string")) ?? "";
  const pictures = slide.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];
  const found: string[] = [];
  for (const pic of pictures) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(pic);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
    const embed = /<a:blip r:embed="([^"]+)"/.exec(pic)?.[1];
    if (!off || !ext || !embed) continue;
    const at = [off[1], off[2], ext[1], ext[2]].map(
      (v) => Number(v) / EMU_PER_POINT,
    );
    found.push(at.map((v) => v.toFixed(1)).join(","));
    const box = PPTX_PROOF_PICTURE;
    const target = [box.x, box.y, box.width, box.height];
    if (at.some((v, i) => Math.abs(v - target[i]!) > POINTS)) continue;
    const rel = (rels.match(/<Relationship [^>]*>/g) ?? []).find((r) =>
      r.includes(`Id="${embed}"`),
    );
    const media = rel?.split('Target="../media/')[1]?.split('"')[0];
    const image = media
      ? await zip.file(`ppt/media/${media}`)?.async("uint8array")
      : undefined;
    if (!image || image[0] !== 0x89 || image[1] !== 0x50) continue;
    if (showsProofPicture(image))
      return {
        ok: true,
        detail: `${structure.detail}; the page's picture is on slide 1 where the page shows it, at ${box.pixelWidth} × ${box.pixelHeight} px, its colours decoded`,
      };
  }
  return {
    ok: false,
    detail: `slide 1 carries no picture at the page's ${PPTX_PROOF_PICTURE.width} × ${PPTX_PROOF_PICTURE.height} pt box showing its pixels (pictures at x,y,w,h: ${found.join(" | ") || "none"})`,
  };
}

/* ------------------------------------------------------------------ *
 *  PDF to Word (since 2026-10-17)
 * ------------------------------------------------------------------ */

/** The Word proof's line under its picture. */
export const DOCX_PROOF_BELOW = "The line under the proof picture";

/**
 * The Word proof's styled line (since 2026-11-15): four words on one
 * baseline, each drawn its own way — regular, bold, red and 18 points — in
 * standard fonts, under the line under the picture.
 */
export const DOCX_PROOF_STYLED = {
  plain: "Styled",
  bold: "Boldproof",
  red: "Redproof",
  big: "Bigproof",
} as const;

/**
 * The Word proof's PDF: the proof's words, its picture under them at the
 * PowerPoint proof's box ({@link PPTX_PROOF_PICTURE}), and a line under the
 * picture. A4, whose text area (451 points wide) fits the picture as shown.
 * Until 2026-10-17 the production proof sent PDF to Word a text-only PDF
 * and asked for the words, which the .docx with no pictures passed.
 */
export async function docxProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await pptxProofPdf());
  const font = await embedDrawingFont(doc, [DOCX_PROOF_BELOW]);
  const page = doc.getPage(0);
  const box = PPTX_PROOF_PICTURE;
  page.drawText(DOCX_PROOF_BELOW, {
    x: 60,
    y: PAGE.height - (box.y + box.height + 40),
    size: 14,
    font,
  });
  const regular = await embedDrawingFont(
    doc,
    Object.values(DOCX_PROOF_STYLED),
    "sans",
  );
  const bold = await embedDrawingFont(
    doc,
    Object.values(DOCX_PROOF_STYLED),
    "sans-bold",
  );
  const w = DOCX_PROOF_STYLED;
  let x = 60;
  for (const [text, face, size, color] of [
    [w.plain, regular, 12, rgb(0, 0, 0)],
    [w.bold, bold, 12, rgb(0, 0, 0)],
    [w.red, regular, 12, rgb(1, 0, 0)],
    [w.big, regular, 18, rgb(0, 0, 0)],
  ] as const) {
    page.drawText(text, {
      x,
      y: PAGE.height - (box.y + box.height + 80),
      size,
      font: face,
      color,
    });
    x += face.widthOfTextAtSize(`${text} `, size);
  }
  // Since 2026-11-15 (#28 slice 2): a short separator, then a table BELOW
  // everything above, so the picture checks keep their paragraph indices and
  // the styled line stays outside the table. The separator has under four
  // words (a longer line above the header would trim it out, flow.ts
  // rule 5).
  const t = DOCX_PROOF_TABLE;
  const tableTop = PAGE.height - (box.y + box.height + 130);
  const texts = [t.separator, ...t.rows.flat()].filter(Boolean);
  const tRegular = await embedDrawingFont(doc, texts, "sans");
  const tBold = await embedDrawingFont(doc, texts, "sans-bold");
  page.drawText(t.separator, {
    x: 60,
    y: tableTop + 30,
    size: 11,
    font: tRegular,
  });
  t.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell)
        page.drawText(cell, {
          x: t.columns[c]!,
          y: tableTop - r * 16,
          size: 11,
          font: r === 0 ? tBold : tRegular,
        });
    }),
  );
  return doc.save();
}

/**
 * The Word proof's table (since 2026-11-15, #28 slice 2): a bold header and
 * three rows, the middle row with NO quantity, columns left-aligned at 60,
 * 250 and 400 points, under a two-word separator.
 */
export const DOCX_PROOF_TABLE = {
  separator: "Proof table",
  rows: [
    ["Part", "Units", "Cost"],
    ["Bolt", "4", "0.75"],
    ["Hinge", "", "6.20"],
    ["Latch", "2", "3.10"],
  ],
  columns: [60, 250, 400],
} as const;

/**
 * The proof's table, read back by `./docx-structure`: exactly one table of
 * 3 grid columns and 4 rows of 3 cells spanning 1; each cell the page's
 * text, the middle row's quantity an EMPTY cell (no run at all); every
 * header run bold (`w:b`, `w:bCs`) and no body run bold. Null when it holds;
 * otherwise what is wrong. (The same checks as `provesDocxTables`' 4, 5
 * and 7, asked of the deployed worker's file.)
 */
export async function tableProblem(bytes: Uint8Array): Promise<string | null> {
  const body = await readDocxStructure(bytes);
  type Tbl = Extract<(typeof body.blocks)[number], { kind: "tbl" }>;
  const tables = body.blocks.filter((b): b is Tbl => b.kind === "tbl");
  const t = DOCX_PROOF_TABLE;
  if (tables.length !== 1)
    return `the DOCX holds ${tables.length} Word table(s), not the page's one`;
  const [tbl] = tables;
  if (
    tbl!.gridCols.length !== 3 ||
    tbl!.rows.length !== t.rows.length ||
    tbl!.rows.some(
      (r) => r.cells.length !== 3 || r.cells.some((c) => c.span !== 1),
    )
  )
    return `the table is ${tbl!.gridCols.length} column(s) by ${tbl!.rows.length} row(s), not 3 by ${t.rows.length} of single cells`;
  const runs = (r: number, c: number) =>
    tbl!.rows[r]!.cells[c]!.blocks.flatMap((b) =>
      b.kind === "p" ? b.runs : [],
    );
  const read = t.rows.map((row, r) =>
    row.map((_, c) =>
      runs(r, c)
        .map((x) => x.text)
        .join(""),
    ),
  );
  const cellsOk = t.rows.every((row, r) =>
    row.every((cell, c) =>
      cell === "" ? runs(r, c).length === 0 : read[r]![c] === cell,
    ),
  );
  if (!cellsOk)
    return `the table's cells are ${JSON.stringify(read)}, not ${JSON.stringify(t.rows)} with the empty cell empty`;
  const header = [0, 1, 2].flatMap((c) => runs(0, c));
  const rest = t.rows
    .slice(1)
    .flatMap((_, r) => [0, 1, 2].flatMap((c) => runs(r + 1, c)));
  if (header.length === 0 || !header.every((x) => x.b && x.bCs))
    return "the table's header is not bold";
  if (rest.some((x) => x.b)) return "a body row of the table is bold";
  return null;
}

/**
 * The styled line's words, read back by `./docx-structure`: each in exactly
 * one run, carrying exactly its own properties — the regular word 12 points
 * (`w:sz` 24) and nothing else, the bold word `w:b` and `w:bCs`, the red word
 * colour FF0000, the big word 36 half-points in both sizes — and the line's
 * text in its order. Null when it holds; otherwise what is wrong.
 */
async function styledLineProblem(bytes: Uint8Array): Promise<string | null> {
  const problems = await docxStructureProblems(bytes);
  if (problems.length > 0)
    return `the DOCX has structure problems: ${problems.slice(0, 3).join("; ")}`;
  const body = await readDocxStructure(bytes);
  const w = DOCX_PROOF_STYLED;
  const line = `${w.plain} ${w.bold} ${w.red} ${w.big}`;
  const paragraphs = body.blocks.flatMap((b) => (b.kind === "p" ? [b] : []));
  const held = paragraphs.filter((p) =>
    p.runs
      .map((r) => r.text)
      .join("")
      .includes(line),
  );
  if (held.length !== 1)
    return `the styled line "${line}" is in ${held.length} paragraph(s), not one, in order`;
  const runOf = (word: string): DocxReadRun | null => {
    const runs = held[0]!.runs.filter((r) =>
      r.text.split(/\s+/).includes(word),
    );
    return runs.length === 1 ? runs[0]! : null;
  };
  const describe = (r: DocxReadRun | null) =>
    r
      ? `{${[r.b ? "b" : "", r.i ? "i" : "", r.color ? `color ${r.color}` : "", r.sz !== undefined ? `sz ${r.sz}/${r.szCs}` : ""].filter(Boolean).join(" ")}}`
      : "not in one run";
  const plain = runOf(w.plain);
  const bold = runOf(w.bold);
  const red = runOf(w.red);
  const big = runOf(w.big);
  const ok =
    plain !== null &&
    !plain.b &&
    !plain.i &&
    plain.color === undefined &&
    plain.sz === 24 &&
    bold !== null &&
    bold.b === true &&
    bold.bCs === true &&
    bold.color === undefined &&
    red !== null &&
    red.color === "FF0000" &&
    !red.b &&
    big !== null &&
    big.sz === 36 &&
    big.szCs === 36 &&
    !big.b &&
    big.color === undefined;
  return ok
    ? null
    : `the styled line's runs are not each word's own: ${w.plain} ${describe(plain)}, ${w.bold} ${describe(bold)}, ${w.red} ${describe(red)}, ${w.big} ${describe(big)}`;
}

/**
 * The deployed .docx, judged at the point a reader meets it (`./docx-read`,
 * which shares nothing with the writer): the page is A4; the proof's words,
 * then ONE picture, then the line under it, in that order; the picture's
 * extent is the page's 256 × 160 points (within a point); and its media
 * decodes to the proof's 64 × 40 pixels and three colours. The text-only
 * .docx, a picture moved below its line, resized, or blank, all fail it
 * (`deployment-proof.test.ts`).
 */
export async function docxDeploymentVerdict(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  let body: Awaited<ReturnType<typeof readDocxBody>>;
  try {
    body = await readDocxBody(bytes);
  } catch (error) {
    return {
      ok: false,
      detail: `the DOCX cannot be read: ${(error as Error).message}`,
    };
  }
  const at = (text: string) =>
    body.paragraphs.findIndex((p) => p.text.includes(text));
  const words = at(PPTX_PROOF_TEXT);
  const below = at(DOCX_PROOF_BELOW);
  if (words < 0 || below < 0)
    return {
      ok: false,
      detail: `word/document.xml has ${body.paragraphs.length} paragraph(s) and ${words < 0 ? `none carries "${PPTX_PROOF_TEXT}"` : `none carries "${DOCX_PROOF_BELOW}"`}`,
    };
  const page = [body.page.width, body.page.height];
  if (
    !body.page.declared ||
    Math.abs(page[0]! - PAGE.width) > POINTS ||
    Math.abs(page[1]! - PAGE.height) > POINTS
  )
    return {
      ok: false,
      detail: `the Word page is ${body.page.declared ? `${page[0]!.toFixed(0)} × ${page[1]!.toFixed(0)} pt` : "not declared"}, not the PDF's ${PAGE.width} × ${PAGE.height}`,
    };
  const box = PPTX_PROOF_PICTURE;
  const found = body.pictures.map(
    (p) =>
      `paragraph ${p.paragraph}, ${p.width.toFixed(1)} × ${p.height.toFixed(1)} pt`,
  );
  if (body.pictures.length !== 1)
    return {
      ok: false,
      detail: `the DOCX holds ${body.pictures.length} picture(s), not the page's one${found.length ? ` (${found.join(" | ")})` : ""}`,
    };
  const [pic] = body.pictures;
  if (!(words < pic!.paragraph && pic!.paragraph < below))
    return {
      ok: false,
      detail: `the picture is not between the proof's words and the line under it (${found[0]}; words at ${words}, line at ${below})`,
    };
  if (
    Math.abs(pic!.width - box.width) > POINTS ||
    Math.abs(pic!.height - box.height) > POINTS
  )
    return {
      ok: false,
      detail: `the picture is ${found[0]}, not the page's ${box.width} × ${box.height} pt`,
    };
  if (!pic!.bytes || !showsProofPicture(pic!.bytes))
    return {
      ok: false,
      detail: `the picture's image is not the proof's ${box.pixelWidth} × ${box.pixelHeight} px with its three colours`,
    };
  // Since 2026-11-15: each word keeps its formatting (`docxRunStyles`).
  const styled = await styledLineProblem(bytes);
  if (styled) return { ok: false, detail: styled };
  // Since 2026-11-15 (#28 slice 2): the table is a Word table (`docxTables`).
  const table = await tableProblem(bytes);
  if (table) return { ok: false, detail: table };
  return {
    ok: true,
    detail: `${body.paragraphs.length} paragraph(s), fixture text found; the page's picture is between its words and the line under it, at ${box.width} × ${box.height} pt, its ${box.pixelWidth} × ${box.pixelHeight} px and colours decoded; the styled line's bold, red and 18 pt words each carry exactly their own run properties; the table is one 3 × 4 Word table, each value in its column, the empty cell empty, the header bold`,
  };
}

/**
 * The Word proof's .docx after the worker's own LibreOffice laid it out
 * (Word to PDF, on the same deployment): a REAL word processor read the
 * document and painted its picture. Word reflows, so the page is not
 * compared with the source; what is asked is that the PDF paints exactly
 * one picture, at the 256 × 160 points the .docx gives it (within a
 * point), read from the file itself (`./page-inventory`). A .docx whose
 * picture LibreOffice could not resolve paints none.
 */
export async function docxRoundTripVerdict(
  pdf: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  const pages = await inventoryPages(pdf);
  if (!pages) return { ok: false, detail: "the PDF cannot be read by pdf-lib" };
  const shown = pages.flatMap((p) =>
    p.placements
      .filter((pl) => !p.images[pl.image]?.mask)
      .map((pl) => ({
        page: p.pageNumber,
        w: pl.box[2] - pl.box[0],
        h: pl.box[3] - pl.box[1],
      })),
  );
  const box = PPTX_PROOF_PICTURE;
  const list = shown
    .map((s) => `p${s.page} ${s.w.toFixed(1)} × ${s.h.toFixed(1)} pt`)
    .join(" | ");
  if (shown.length !== 1)
    return {
      ok: false,
      detail: `LibreOffice laid the DOCX out as ${pages.length} page(s) painting ${shown.length} picture(s)${list ? ` (${list})` : ""}, not the one`,
    };
  const [only] = shown;
  const ok =
    Math.abs(only!.w - box.width) <= POINTS &&
    Math.abs(only!.h - box.height) <= POINTS;
  return {
    ok,
    detail: ok
      ? `LibreOffice laid the DOCX out as ${pages.length} page(s) painting its one picture at ${box.width} × ${box.height} pt`
      : `LibreOffice painted the picture at ${list}, not ${box.width} × ${box.height} pt`,
  };
}
