// @vitest-environment node
// @native-canvas
/**
 * Review round 2 of #28 slice 2 (2026-11-15): pages that are NOT tables must
 * not come out as Word tables (exit property (d): a false table is a
 * defect). The review built five, each a bordered `w:tbl` on the branch at
 * 61184c12 and tabbed rows on main: a two-line running header, a
 * letterhead, Bengali prose beside a sidebar of names, two columns of
 * Chinese prose, and sentences set beside a table. flow.ts's rules 1-6 pass
 * every one of them (bands are page-wide, rule 3 needs ONE short aligned
 * column, rule 4 cannot see wrapping in a script without letter case), so
 * a Word table now also needs `wordTableDoubt` (`../pdf-text/table-grid`)
 * to find nothing doubtful; the rest stay the tabbed rows main wrote.
 *
 * Each case runs the COMPOSED chain — flowText, the layout, the writer, and
 * the independent reader (`./docx-structure`) — and then the whole engine on
 * a real PDF. Every case has a positive control through the same chain: a
 * real table built by the same helpers IS a Word table, so a reader that
 * found no tables anywhere could not pass.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { gappedTablePdf, sidebarPdf } from "@/tests/pdf-office-fixtures";
import { useNodeFontSource } from "@/tests/unicode-fonts";
import { flowPageText, flowText } from "../pdf-text/flow";
import { parseBboxFlow } from "../pdf-text/parse";
import { docxDocumentOf } from "./docx-layout";
import { docxPackage } from "./docx-package";
import {
  docxPageTexts,
  docxStructureProblems,
  readDocxStructure,
  type DocxBodyBlock,
} from "./docx-structure";
import { PDF_TO_WORD_TOOL, runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";

type Tbl = Extract<DocxBodyBlock, { kind: "tbl" }>;
const NO_PAGES = {
  pageCount: 0,
  pages: [],
  undecodedImages: 0,
  tooLargeImages: 0,
};

type W = [number, number, string];
/** Words from `x`, 6 points a character, 3 between words. */
function ws(x: number, text: string): W[] {
  const out: W[] = [];
  for (const t of text.split(" ")) {
    const w = [...t].length * 6;
    out.push([x, w, t]);
    x += w + 3;
  }
  return out;
}
const line = (y: number, words: W[]) =>
  `<line>${words
    .map(
      ([x, w, t]) =>
        `<word xMin="${x}" yMin="${y}" xMax="${x + w}" yMax="${y + 10}">${t}</word>`,
    )
    .join("")}</line>`;
const block = (lines: string[]) => `<block>${lines.join("")}</block>`;
const page = (blocks: string[]) =>
  `<doc><page width="612" height="792"><flow>${blocks.join("")}</flow></page></doc>`;

/** The composed chain on one page of bbox XHTML. */
async function chain(xhtml: string) {
  const flow = flowText(parseBboxFlow(xhtml));
  const { bytes } = await docxPackage(docxDocumentOf(flow, NO_PAGES));
  const structure = await readDocxStructure(bytes);
  return {
    flow,
    tables: structure.blocks.filter((b): b is Tbl => b.kind === "tbl"),
    problems: await docxStructureProblems(bytes),
    conserved:
      JSON.stringify(docxPageTexts(structure)) ===
      JSON.stringify(flow.pages.map(flowPageText)),
  };
}

const PROSE = [
  "The year closed with revenue ahead of plan and costs held flat",
  "across every region, which left the margin at its best level",
  "since the company was founded.",
];

const CASES: Record<string, string> = {
  "a two-line running header": page([
    block([line(30, ws(50, "Annual Report 2026"))]),
    block([line(30, ws(470, "Confidential"))]),
    block([line(44, ws(50, "Section 3 Results"))]),
    block([line(44, ws(500, "Page 4"))]),
    block(PROSE.map((t, k) => line(100 + 14 * k, ws(50, t)))),
  ]),
  "a letterhead": page([
    block([
      line(40, ws(50, "ACME Corporation")),
      line(54, ws(50, "12 Harbour Road")),
      line(68, ws(50, "Dhaka 1207")),
    ]),
    block([
      line(40, ws(430, "Invoice 1042")),
      line(54, ws(430, "Date 2026-11-15")),
      line(68, ws(430, "Due 2026-12-15")),
    ]),
    block([line(120, ws(50, "Thank you for your order, which we shipped."))]),
  ]),
  "Bengali prose beside a narrow sidebar of names": page([
    block(
      ["Rahim", "Karim", "Salma", "Nasrin"].map((t, k) =>
        line(100 + 14 * k, ws(50, t)),
      ),
    ),
    block(
      [
        "আমাদের প্রতিষ্ঠান গত বছর অনেক নতুন",
        "গ্রাহকের কাছে পৌঁছেছে এবং সেবার মান",
        "আরও উন্নত করেছে যা সবার কাছে",
        "প্রশংসিত হয়েছে এই বছরেও আমরা",
      ].map((t, k) => line(100 + 14 * k, ws(200, t))),
    ),
  ]),
  "two columns of Chinese prose": page([
    block(
      [
        "我们公司去年取得了很好的成绩",
        "收入增长了百分之二十左右",
        "成本也得到了有效的控制",
      ].map((t, k) => line(100 + 14 * k, [[50, t.length * 10, t]])),
    ),
    block(
      [
        "今年我们将继续扩大市场份额",
        "并在亚洲开设新的分公司",
        "同时加强研发投入和人才",
      ].map((t, k) => line(100 + 14 * k, [[320, t.length * 10, t]])),
    ),
  ]),
  "sentences set beside a table": page([
    block([
      line(100, [...ws(50, "Item"), ...ws(150, "Qty")]),
      line(114, [...ws(50, "Widget"), ...ws(150, "2")]),
      line(128, [...ws(50, "Gadget"), ...ws(150, "7")]),
    ]),
    block([
      line(100, ws(330, "Sales rose sharply.")),
      line(114, ws(330, "Margins held firm.")),
      line(128, ws(330, "Outlook remains good.")),
    ]),
  ]),
};

describe("pages that are not tables are not Word tables (review round 2)", () => {
  it("POSITIVE CONTROL: a real table through the same helpers and chain IS one Word table", async () => {
    const out = await chain(
      page([
        block([
          line(100, [
            ...ws(50, "Item"),
            ...ws(200, "Qty"),
            ...ws(300, "Price"),
          ]),
          line(114, [...ws(50, "Widget"), ...ws(200, "2"), ...ws(300, "9.50")]),
          line(128, [...ws(50, "Gadget"), ...ws(300, "12.00")]),
          line(142, [...ws(50, "Gizmo"), ...ws(200, "5"), ...ws(300, "3.25")]),
        ]),
      ]),
    );
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0]!.gridCols).toHaveLength(3);
    expect(out.problems).toEqual([]);
    expect(out.conserved).toBe(true);
  });

  it("health: the corpus is the five cases the review built", () => {
    expect(Object.keys(CASES)).toHaveLength(5);
  });

  for (const [name, xhtml] of Object.entries(CASES))
    it(`${name}: no Word table, text conserved, a file Word opens; counted as a table kept tabbed`, async () => {
      const out = await chain(xhtml);
      expect(out.tables).toEqual([]);
      expect(out.problems).toEqual([]);
      expect(out.conserved).toBe(true);
      // flow.ts still recognises the rows (main wrote them tabbed); the
      // Word table is what was refused, and that is counted.
      expect(out.flow.pages[0]!.tablesAsTabs).toBe(1);
    });
});

/** The whole engine on a real PDF: the stand-in extractor, the page reader. */
async function engineTables(pdf: Uint8Array): Promise<Tbl[]> {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
    extractFlow: flowStandIn,
    scanPages: scanPdfPages,
  });
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  return (await readDocxStructure(run.output)).blocks.filter(
    (b): b is Tbl => b.kind === "tbl",
  );
}

describe("the same false tables through the whole engine (review round 2)", () => {
  it("POSITIVE CONTROL: the probe's invoice table is one Word table", async () => {
    expect(await engineTables(await gappedTablePdf())).toHaveLength(1);
  });

  it("a two-line running header on each page of a three-page report: no Word table", async () => {
    const doc = await PDFDocument.create();
    const texts = [
      "Annual Report 2026",
      "Confidential",
      "Section 3 Results",
      "Page 1",
      "Page 2",
      "Page 3",
      ...PROSE,
    ];
    const font = await embedDrawingFont(doc, texts);
    for (let p = 1; p <= 3; p++) {
      const pg = doc.addPage([612, 792]);
      pg.drawText("Annual Report 2026", { x: 50, y: 750, size: 9, font });
      pg.drawText("Confidential", { x: 500, y: 750, size: 9, font });
      pg.drawText("Section 3 Results", { x: 50, y: 738, size: 9, font });
      pg.drawText(`Page ${p}`, { x: 520, y: 738, size: 9, font });
      PROSE.forEach((l, i) =>
        pg.drawText(l, { x: 50, y: 680 - i * 14, size: 11, font }),
      );
    }
    expect(await engineTables(await doc.save())).toEqual([]);
  });

  it("a letterhead above a sentence: no Word table", async () => {
    const doc = await PDFDocument.create();
    const left = ["ACME Corporation", "12 Harbour Road", "Dhaka 1207"];
    const right = ["Invoice 1042", "Date 2026-11-15", "Due 2026-12-15"];
    const font = await embedDrawingFont(doc, [...left, ...right, ...PROSE]);
    const pg = doc.addPage([612, 792]);
    left.forEach((l, i) =>
      pg.drawText(l, { x: 50, y: 740 - i * 14, size: 11, font }),
    );
    right.forEach((l, i) =>
      pg.drawText(l, { x: 430, y: 740 - i * 14, size: 11, font }),
    );
    PROSE.forEach((l, i) =>
      pg.drawText(l, { x: 50, y: 640 - i * 14, size: 11, font }),
    );
    expect(await engineTables(await doc.save())).toEqual([]);
  });

  it("Bengali prose beside a sidebar of names: no Word table", async () => {
    const restore = useNodeFontSource();
    try {
      const bn = [
        "আমাদের প্রতিষ্ঠান গত বছর অনেক নতুন",
        "গ্রাহকের কাছে পৌঁছেছে এবং সেবার মান",
        "আরও উন্নত করেছে যা সবার কাছে",
        "প্রশংসিত হয়েছে এই বছরেও আমরা",
      ];
      const side = ["Editor", "Jane Doe", "Design", "Sam Lee"];
      const doc = await PDFDocument.create();
      const font = await embedDrawingFont(doc, bn);
      const latin = await embedDrawingFont(doc, side);
      const pg = doc.addPage([612, 792]);
      bn.forEach((l, i) =>
        pg.drawText(l, { x: 50, y: 700 - i * 16, size: 11, font }),
      );
      side.forEach((l, i) =>
        pg.drawText(l, { x: 420, y: 700 - i * 16, size: 11, font: latin }),
      );
      expect(await engineTables(await doc.save())).toEqual([]);
    } finally {
      restore();
    }
  });

  it("the sidebar fixture (prose beside Editor / Jane Doe / ...): no Word table", async () => {
    expect(await engineTables(await sidebarPdf())).toEqual([]);
  });
});

/**
 * Audit wave 2 pdf-to-word#2 (2026-11-28): a table with no column of figures
 * is a Word table when it is clearly a table of short entries
 * (`isTextTable`). The five false tables above stay refused; these are the
 * pages nearest to the new rule, through the same composed chain.
 */
const TEXT_CASES: Record<string, string> = {
  "two columns of Chinese prose, four lines each": page([
    block(
      [
        "我们公司去年取得了很好的成绩",
        "收入增长了百分之二十左右",
        "成本也得到了有效的控制",
        "员工人数也有所增加",
      ].map((t, k) => line(100 + 14 * k, [[50, t.length * 10, t]])),
    ),
    block(
      [
        "今年我们将继续扩大市场份额",
        "并在亚洲开设新的分公司",
        "同时加强研发投入和人才",
        "培养计划以支持长期发展",
      ].map((t, k) => line(100 + 14 * k, [[320, t.length * 10, t]])),
    ),
  ]),
  "a numbered list of four short steps": page([
    block(
      ["Open the file", "Choose a page", "Press Save", "Close it"].map((t, k) =>
        line(100 + 14 * k, [...ws(50, `${k + 1}.`), ...ws(120, t)]),
      ),
    ),
  ]),
  "a staff list of three rows": page([
    block(
      [
        ["Name", "City", "Role"],
        ["Ada", "London", "Engineer"],
        ["Grace", "Arlington", "Admiral"],
      ].map(([a, b, c], k) =>
        line(100 + 14 * k, [...ws(50, a!), ...ws(200, b!), ...ws(350, c!)]),
      ),
    ),
  ]),
};

describe("tables without figures (pdf-to-word#2)", () => {
  it("POSITIVE: a staff list of four rows, no figures, IS one Word table with its cells", async () => {
    const rows = [
      ["Name", "City", "Role"],
      ["Ada", "London", "Engineer"],
      ["Grace", "Arlington", "Admiral"],
      ["Jamal", "Dhaka", "Physicist"],
    ];
    const out = await chain(
      page([
        block(
          rows.map(([a, b, c], k) =>
            line(100 + 14 * k, [...ws(50, a!), ...ws(200, b!), ...ws(350, c!)]),
          ),
        ),
      ]),
    );
    expect(out.tables).toHaveLength(1);
    const t = out.tables[0]!;
    expect(t.gridCols).toHaveLength(3);
    expect(
      t.rows.map((r) =>
        r.cells.map((c) =>
          c.blocks
            .flatMap((b) => (b.kind === "p" ? b.runs : []))
            .map((x) => x.text)
            .join(""),
        ),
      ),
    ).toEqual(rows);
    expect(out.problems).toEqual([]);
    expect(out.conserved).toBe(true);
  });

  it("health: three nearest non-tables", () => {
    expect(Object.keys(TEXT_CASES)).toHaveLength(3);
  });

  for (const [name, xhtml] of Object.entries(TEXT_CASES))
    it(`${name}: no Word table, text conserved, a file Word opens`, async () => {
      const out = await chain(xhtml);
      expect(out.tables).toEqual([]);
      expect(out.problems).toEqual([]);
      expect(out.conserved).toBe(true);
      expect(out.flow.pages[0]!.tablesAsTabs).toBe(1);
    });
});
