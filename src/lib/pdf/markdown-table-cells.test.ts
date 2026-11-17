// @vitest-environment node
/**
 * Markdown to PDF's table cells, read back from the PDF it writes (backlog
 * #24). Until then a cell was plain text: its bold, italics and code printed
 * in the row's one face, and a link printed its address but did not open.
 * `***both***` anywhere came out bold and upright, because there was no
 * bold-italic face.
 *
 * Everything here is read from the saved file, not asked of the renderer:
 * the face each run is drawn in is the /BaseFont of the font resource its
 * `Tf` selects, its width comes from that standard face's own metrics, the
 * cell borders are the rule lines the page draws, and a link is a /Link
 * annotation with a /URI action.
 */
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFFont,
} from "pdf-lib";
import {
  markdownToPdf,
  parseMarkdownBlocks,
  tableCellRuns,
  type MarkdownBlock,
} from "./markdown-to-pdf";
import { useNodeFontSource } from "@/tests/unicode-fonts";

const winAnsi = new TextDecoder("windows-1252");

interface Run {
  page: number;
  text: string;
  face: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

/** A table rule as drawn: a vertical one has x1 === x2. */
interface Rule {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Link {
  page: number;
  uri: string;
  rect: [number, number, number, number];
}

function inflateMaybe(raw: Uint8Array): string {
  try {
    return inflateSync(Buffer.from(raw)).toString("latin1");
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}

function pageContent(doc: PDFDocument, index: number): string {
  const page = doc.getPages()[index]!;
  const contents = page.node.lookup(PDFName.of("Contents"));
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => inflateMaybe(s.getContents()))
    .join("\n");
}

/** The table rule colour, as markdown-to-pdf strokes it. */
const RULE_STROKE = "0.78 0.8 0.85 RG";

async function readPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const scratch = await PDFDocument.create();
  const metrics = new Map<string, PDFFont>();
  const runs: Run[] = [];
  const rules: Rule[] = [];
  const links: Link[] = [];
  for (const [index, page] of doc.getPages().entries()) {
    const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const faces = new Map<string, string>();
    for (const [name, ref] of fonts.entries()) {
      const dict = doc.context.lookup(ref as PDFRef, PDFDict);
      faces.set(
        name.asString(),
        dict.lookup(PDFName.of("BaseFont"), PDFName).decodeText(),
      );
    }
    const content = pageContent(doc, index);
    let face = "";
    let size = 0;
    let x = NaN;
    let y = NaN;
    for (const op of content.matchAll(
      /(\/[^\s/]+)\s+([\d.]+)\s+Tf|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9A-Fa-f]*)>\s*Tj|\[[^\]]*\]\s*TJ|\([^)]*\)\s*Tj/g,
    )) {
      if (op[1]) {
        face = faces.get(op[1]) ?? "";
        size = Number(op[2]);
        if (!face) throw new Error(`no font resource ${op[1]}`);
      } else if (op[3] !== undefined) {
        x = Number(op[3]);
        y = Number(op[4]);
      } else if (op[5] !== undefined) {
        if (!(Object.values(StandardFonts) as string[]).includes(face)) {
          throw new Error(`not a standard face: ${face}`);
        }
        let font = metrics.get(face);
        if (!font) {
          font = await scratch.embedFont(face as StandardFonts);
          metrics.set(face, font);
        }
        const text = winAnsi.decode(Buffer.from(op[5], "hex"));
        runs.push({
          page: index,
          text,
          face,
          x,
          y,
          size,
          width: font.widthOfTextAtSize(text, size),
        });
      } else {
        // A text shape this reader cannot place would be a run it skipped.
        throw new Error(`unread text operator: ${op[0].slice(0, 40)}`);
      }
    }
    for (const m of content.matchAll(
      new RegExp(
        `${RULE_STROKE.replace(/\./g, "\\.")}\\s+[\\d.]+ w\\s+\\[\\] 0 d\\s+([\\d.]+) ([\\d.]+) m\\s+[\\d.]+ [\\d.]+ m\\s+([\\d.]+) ([\\d.]+) l`,
        "g",
      ),
    )) {
      rules.push({
        page: index,
        x1: Number(m[1]),
        y1: Number(m[2]),
        x2: Number(m[3]),
        y2: Number(m[4]),
      });
    }
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray) {
      for (const ref of annots.asArray()) {
        const annot = doc.context.lookup(ref);
        if (!(annot instanceof PDFDict)) continue;
        if (annot.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) {
          continue;
        }
        const action = annot.lookup(PDFName.of("A"));
        const uri =
          action instanceof PDFDict ? action.lookup(PDFName.of("URI")) : null;
        const rect = annot.lookup(PDFName.of("Rect"), PDFArray);
        links.push({
          page: index,
          uri: uri instanceof PDFString ? uri.decodeText() : "",
          rect: rect.asArray().map((n) => Number(n.toString())) as Link["rect"],
        });
      }
    }
  }
  return { runs, rules, links };
}

type Box = { page: number; x1: number; y1: number; x2: number; y2: number };

/**
 * The cell that holds `box` whole, from the drawn rules: two neighbouring
 * vertical rules at its sides, both spanning its height. Null when the box
 * crosses a rule, or sits outside every column; `clearance` is how far from
 * a rule its sides must stay.
 */
function cellHolding(
  rules: readonly Rule[],
  box: Box,
  clearance: number,
): { left: number; right: number; top: number; bottom: number } | null {
  const spanning = rules.filter(
    (r) =>
      r.page === box.page &&
      r.x1 === r.x2 &&
      Math.min(r.y1, r.y2) <= box.y1 &&
      Math.max(r.y1, r.y2) >= box.y2,
  );
  const edges = [...new Set(spanning.map((r) => r.x1))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < edges.length; i++) {
    const left = edges[i]!;
    const right = edges[i + 1]!;
    if (box.x1 >= left + clearance && box.x2 <= right - clearance) {
      const side = spanning.find((r) => r.x1 === left)!;
      return {
        left,
        right,
        top: Math.max(side.y1, side.y2),
        bottom: Math.min(side.y1, side.y2),
      };
    }
  }
  return null;
}

/** A drawn run's ink box: baseline to cap height, start to advance. */
const runBox = (run: Run): Box => ({
  page: run.page,
  x1: run.x,
  x2: run.x + run.width,
  y1: run.y - run.size * 0.25,
  y2: run.y + run.size * 0.75,
});

/** Runs not held whole by one table cell, described. */
function overflowing(rules: readonly Rule[], runs: readonly Run[]): string[] {
  return runs
    .filter((run) => run.text.trim() && !cellHolding(rules, runBox(run), 1))
    .map(
      (run) =>
        `p${run.page + 1} ${run.face} x=${run.x.toFixed(1)}..${(run.x + run.width).toFixed(1)} y=${run.y} "${run.text.slice(0, 40)}"`,
    );
}

const TABLE = [
  "| Kind | Sample *head* |",
  "| --- | --- |",
  "| plain words | **b** |",
  "| italic | *i* |",
  "| both | ***bi*** |",
  "| both again | **_bu_** |",
  "| mono | `code` |",
  "| link | [link](https://example.com) |",
].join("\n");

/** The runs inside the table: below the title, above the page number. */
const tableRuns = (runs: readonly Run[]) =>
  runs.filter((run) => run.size === 10);

describe("the PDF reader (health and controls)", () => {
  it("reads a paragraph's four faces by their base font names", async () => {
    const { runs } = await readPdf(
      await markdownToPdf("Plain **heavy** *slanted* ***both*** `mono` end."),
    );
    const faceOf = (word: string) =>
      runs.find((run) => run.text.includes(word))?.face;
    expect(faceOf("Plain")).toBe("Helvetica");
    expect(faceOf("heavy")).toBe("Helvetica-Bold");
    expect(faceOf("slanted")).toBe("Helvetica-Oblique");
    expect(faceOf("both")).toBe("Helvetica-BoldOblique");
    expect(faceOf("mono")).toBe("Courier");
  });

  it("emphasis adds to the block's face: bold in an italic quote is bold oblique, italics upright", async () => {
    const { runs } = await readPdf(
      await markdownToPdf("> Quoted **heavy** and *upright* and `mono` end."),
    );
    const faceOf = (word: string) =>
      runs.find((run) => run.text.includes(word))?.face;
    expect(faceOf("Quoted")).toBe("Helvetica-Oblique");
    expect(faceOf("heavy")).toBe("Helvetica-BoldOblique");
    expect(faceOf("upright")).toBe("Helvetica");
    expect(faceOf("mono")).toBe("Courier");
  });

  it("finds the grid, and the cell predicate rejects a box across a rule", async () => {
    const { runs, rules } = await readPdf(await markdownToPdf(TABLE));
    const vertical = rules.filter((r) => r.x1 === r.x2);
    // 3 column edges per row slice, 7 rows: a reader that found no rules
    // would hold nothing and so pass every overflow check below.
    expect(vertical.length).toBe(3 * 7);
    expect(rules.length - vertical.length).toBeGreaterThanOrEqual(7);
    const run = tableRuns(runs).find((r) => r.text === "plain words")!;
    const held = cellHolding(rules, runBox(run), 1);
    expect(held).not.toBeNull();
    // Positive controls: the same run pushed across its right rule, and
    // one pushed left of the table, are both caught.
    const across = { ...run, x: held!.right - run.width / 2 };
    const outside = { ...run, x: held!.left - run.width - 2 };
    expect(overflowing(rules, [across, outside])).toHaveLength(2);
    expect(overflowing(rules, [run])).toEqual([]);
  });
});

describe("table cells draw inline bold, italic, code and links (backlog #24)", () => {
  it("each cell's run is in its own face, the header row bold", async () => {
    const { runs } = await readPdf(await markdownToPdf(TABLE));
    const cells = tableRuns(runs);
    const faceOf = (text: string) => {
      const found = cells.filter((run) => run.text === text);
      expect(found, `"${text}" is drawn once, as one run`).toHaveLength(1);
      return found[0]!.face;
    };
    expect(faceOf("Kind")).toBe("Helvetica-Bold");
    // Italics in the bold header row add to it.
    expect(faceOf("head")).toBe("Helvetica-BoldOblique");
    expect(faceOf("plain words")).toBe("Helvetica");
    expect(faceOf("b")).toBe("Helvetica-Bold");
    expect(faceOf("i")).toBe("Helvetica-Oblique");
    expect(faceOf("bi")).toBe("Helvetica-BoldOblique");
    expect(faceOf("bu")).toBe("Helvetica-BoldOblique");
    expect(faceOf("code")).toBe("Courier");
    expect(faceOf("link (https://example.com)")).toBe("Helvetica");
    // The markup itself is not drawn.
    expect(cells.map((run) => run.text).join("")).not.toMatch(/\*|`|\]\(/);
  });

  it("a cell's link opens: one /Link, the right address, inside its cell", async () => {
    const { runs, rules, links } = await readPdf(await markdownToPdf(TABLE));
    expect(links.map((l) => l.uri)).toEqual(["https://example.com"]);
    const [x1, y1, x2, y2] = links[0]!.rect;
    const box = { page: links[0]!.page, x1, y1, x2, y2 };
    const cell = cellHolding(rules, box, 0);
    expect(cell, "the link's box crosses a cell border").not.toBeNull();
    // ...and it is the cell the link's text is drawn in, over that text.
    const text = tableRuns(runs).find((r) => r.text.startsWith("link ("))!;
    expect(cellHolding(rules, runBox(text), 1)).toEqual(cell);
    expect(x1).toBeCloseTo(text.x, 1);
    expect(x2).toBeCloseTo(text.x + text.width, 1);
    expect(y1).toBeLessThan(text.y);
    expect(y2).toBeGreaterThan(text.y);
  });

  it("CONTROL: a table with no inline markup draws one face per row and no link", async () => {
    const { runs, links } = await readPdf(
      await markdownToPdf("| a | b |\n| - | - |\n| one | two |"),
    );
    expect(links).toEqual([]);
    const cells = tableRuns(runs);
    expect(cells.map((r) => `${r.text}:${r.face}`)).toEqual([
      "a:Helvetica-Bold",
      "b:Helvetica-Bold",
      "one:Helvetica",
      "two:Helvetica",
    ]);
  });

  it("a link in a table inside a quote opens too", async () => {
    const { links } = await readPdf(
      await markdownToPdf(
        "> | a | b |\n> | - | - |\n> | [q](https://quote.example/) | y |",
      ),
    );
    expect(links.map((l) => l.uri)).toEqual(["https://quote.example/"]);
  });
});

describe("styled cells wrap inside their column", () => {
  const LONG_CODE = `\`${"token_".repeat(14)}end\``;
  const NARROW = [
    "| One | Two | Three | Four | Five | Six |",
    "| --- | :-: | --: | --- | --- | --- |",
    `| **bold words that will need several lines here** | *italic words that wrap in a narrow column too* | ***both at once in a narrow right aligned column*** | ${LONG_CODE} | [a link label that wraps](https://wrap.example/) | plain words that wrap like the rest of them |`,
    "| x | y | z | w | v | u |",
  ].join("\n");

  it("no run crosses a cell border, and every row is tall enough for its lines", async () => {
    const { runs, rules, links } = await readPdf(await markdownToPdf(NARROW));
    const cells = tableRuns(runs);
    // Every cell's text is drawn, in order, each character once: a row
    // too short for its wrapped lines would slice some of them away.
    const [table] = parseMarkdownBlocks(NARROW) as (MarkdownBlock & {
      kind: "table";
    })[];
    const squash = (text: string) => text.replace(/\s+/g, "");
    expect(squash(cells.map((r) => r.text).join(""))).toBe(
      squash([table!.header, ...table!.rows].flat().join("")),
    );
    // Health: the styled cells really did wrap (more than one baseline in
    // the long row), in more than one face.
    const longRow = cells.filter((r) => r.y < cells[0]!.y && r.y > 0);
    expect(new Set(longRow.map((r) => r.y)).size).toBeGreaterThan(3);
    expect(new Set(cells.map((r) => r.face))).toEqual(
      new Set([
        "Helvetica",
        "Helvetica-Bold",
        "Helvetica-Oblique",
        "Helvetica-BoldOblique",
        "Courier",
      ]),
    );
    expect(overflowing(rules, cells)).toEqual([]);
    // Split, not dropped: the long code token is all on the page.
    expect(cells.map((r) => r.text).join("")).toContain(LONG_CODE.slice(1, -1));
    // The wrapped link opens on each of its lines, each box in the cell.
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link.uri).toBe("https://wrap.example/");
      const [x1, y1, x2, y2] = link.rect;
      expect(
        cellHolding(rules, { page: link.page, x1, y1, x2, y2 }, 0),
      ).not.toBeNull();
    }
  });
});

describe("the runs a table keeps say exactly what its cells say", () => {
  it("for every styled cell, the runs joined are the cell's text; plain cells keep none", () => {
    const [table] = parseMarkdownBlocks(TABLE) as (MarkdownBlock & {
      kind: "table";
    })[];
    expect(table?.kind).toBe("table");
    const rows = [table!.header, ...table!.rows];
    let styled = 0;
    rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        const runs = tableCellRuns(table!, r, c);
        if (!runs) return;
        styled++;
        expect(runs.map((run) => run.text).join(""), `${r}:${c}`).toBe(cell);
      }),
    );
    // Health: the header's *head* and the six styled body cells.
    expect(styled).toBe(7);
    expect(tableCellRuns(table!, 1, 0)).toBeUndefined();
  });
});

describe("one character outside Western European text keeps today's single face", () => {
  it("bold italic collapses into the one Noto face with the rest, and the cell's link still opens", async () => {
    const restore = useNodeFontSource();
    try {
      const z = String.fromCodePoint(0x017c);
      const source = `${TABLE}\n| polish | ${z} |`;
      const bytes = await markdownToPdf(source);
      const doc = await PDFDocument.load(bytes);
      const type1: string[] = [];
      const type0: string[] = [];
      for (const [, object] of doc.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFDict)) continue;
        if (object.lookup(PDFName.of("Type")) !== PDFName.of("Font")) continue;
        const subtype = String(object.lookup(PDFName.of("Subtype")));
        const base = String(object.lookup(PDFName.of("BaseFont")));
        if (subtype === "/Type1") type1.push(base);
        if (subtype === "/Type0") type0.push(base.replace(/^\/|-\d+$/g, ""));
      }
      expect(type1).toEqual([]);
      expect(type0.sort()).toEqual(["GeistMono-Regular", "NotoSans-Regular"]);
      const annots = doc.getPages()[0]!.node.lookup(PDFName.of("Annots"));
      expect(annots instanceof PDFArray && annots.size()).toBe(1);
      // Positive control: without the letter, the same table embeds the
      // standard faces, bold oblique among them.
      const western = await PDFDocument.load(await markdownToPdf(TABLE));
      const names = [...western.context.enumerateIndirectObjects()]
        .map(([, o]) =>
          o instanceof PDFDict ? String(o.lookup(PDFName.of("BaseFont"))) : "",
        )
        .filter(Boolean);
      expect(names).toContain("/Helvetica-BoldOblique");
    } finally {
      restore();
    }
  }, 30_000);
});
