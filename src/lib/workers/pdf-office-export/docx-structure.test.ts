// @vitest-environment node
// @native-canvas
/**
 * `./docx-structure`: the structural reader the engine's check before
 * delivery stands on. Every check has a negative control here, and the
 * reader is held to the whole corpus the engine writes (which must be clean)
 * and to jsdom's XML parser (which must agree on every part).
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { wordCorpus, wordCorpusGenerators } from "@/tests/docx-word-corpus";
import {
  docxPageTexts,
  docxStructureProblems,
  parseXml,
  readDocxStructure,
} from "./docx-structure";
import { xmlProblems } from "./validate-ooxml";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A minimal package around `body`, with optional extra relationships. */
async function docx(
  body: string,
  opts: { rels?: string; parts?: Record<string, string> } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${opts.rels ?? ""}</Relationships>`,
  );
  for (const [name, content] of Object.entries(opts.parts ?? {}))
    zip.file(name, content);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

const TABLE = (cells: string, grid = 3) =>
  `<w:tbl><w:tblGrid>${'<w:gridCol w:w="1000"/>'.repeat(grid)}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;
const P = (text: string, rPr = "") =>
  `<w:p><w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** The body every check passes: a table with a span, an empty cell and a styled cell paragraph. */
const GOOD_BODY =
  P("Before") +
  TABLE(
    `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${P("Wide")}</w:tc>` +
      `<w:tc><w:p/></w:tc>`,
  ) +
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:bCs/><w:i/><w:iCs/><w:color w:val="FF0000"/><w:sz w:val="36"/><w:szCs w:val="36"/><w:rtl/></w:rPr><w:t xml:space="preserve">Big &amp; red</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>plain</w:t></w:r></w:p>` +
  `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
  P("Second page");

describe("readDocxStructure", () => {
  it("POSITIVE: reads a hand-written body — paragraphs, a table with a span and an empty cell, every run property — exactly", async () => {
    const bytes = await docx(GOOD_BODY);
    expect(await docxStructureProblems(bytes)).toEqual([]);
    const body = await readDocxStructure(bytes);
    expect(body.blocks).toEqual([
      {
        kind: "p",
        runs: [{ text: "Before" }],
        drawing: false,
        pageBreak: false,
      },
      {
        kind: "tbl",
        gridCols: [1000, 1000, 1000],
        rows: [
          {
            cells: [
              {
                span: 2,
                blocks: [
                  {
                    kind: "p",
                    runs: [{ text: "Wide" }],
                    drawing: false,
                    pageBreak: false,
                  },
                ],
              },
              {
                span: 1,
                blocks: [
                  { kind: "p", runs: [], drawing: false, pageBreak: false },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: "p",
        runs: [
          {
            text: "Big & red",
            fonts: "Arial",
            b: true,
            bCs: true,
            i: true,
            iCs: true,
            color: "FF0000",
            sz: 36,
            szCs: 36,
            rtl: true,
          },
          { text: "\t" },
          { text: "plain" },
        ],
        drawing: false,
        pageBreak: false,
      },
      { kind: "p", runs: [{ text: "" }], drawing: false, pageBreak: true },
      {
        kind: "p",
        runs: [{ text: "Second page" }],
        drawing: false,
        pageBreak: false,
      },
    ]);
    // INVERTED 2026-11-15 (#28 slice 2). HISTORY: until then this read
    // "Before\nWide\t\nBig & red\tplain" — the empty cell `<w:p/>` (no run)
    // added an empty cell and its tab. An empty SLOT now adds nothing: PDF
    // to Word writes one where poppler's row has no value, and poppler's
    // line has no tab for it. A cell with an empty-text RUN still keeps its
    // tab (the "an EMPTY SLOT (no run) skipped" test below).
    expect(docxPageTexts(body)).toEqual([
      "Before\nWide\nBig & red\tplain",
      "Second page",
    ]);
    expect(body.contentTypes.overrides["word/document.xml"]).toMatch(
      /document\.main\+xml$/,
    );
    expect(body.parts).toContain("word/document.xml");
  });

  it.each([
    [
      "a table cell with no paragraph",
      P("x") + TABLE(`<w:tc></w:tc>`, 1) + P("y"),
      /a table cell with no paragraph/,
    ],
    [
      "a row that does not span the grid",
      TABLE(`<w:tc>${P("a")}</w:tc><w:tc>${P("b")}</w:tc>`, 3) + P("y"),
      /spans 2 of 3 grid columns/,
    ],
    [
      "a grid wider than Word allows",
      TABLE(
        `<w:tc><w:tcPr><w:gridSpan w:val="64"/></w:tcPr>${P("a")}</w:tc>`,
        64,
      ) + P("y"),
      /64 grid columns/,
    ],
    [
      "a table directly before the section",
      P("x") + TABLE(`<w:tc>${P("a")}</w:tc>`, 1),
      /a table with no paragraph after it/,
    ],
    [
      "two tables side by side",
      TABLE(`<w:tc>${P("a")}</w:tc>`, 1) +
        TABLE(`<w:tc>${P("b")}</w:tc>`, 1) +
        P("y"),
      /two tables side by side/,
    ],
    ["a size of 0", P("x", '<w:sz w:val="0"/>'), /w:sz "0"/],
    ["a size past Word's", P("x", '<w:szCs w:val="3277"/>'), /w:szCs "3277"/],
    ["a fractional size", P("x", '<w:sz w:val="23.5"/>'), /w:sz "23.5"/],
    ["a colour by name", P("x", '<w:color w:val="red"/>'), /w:color "red"/],
    [
      "a colour in lower case",
      P("x", '<w:color w:val="ff0000"/>'),
      /w:color "ff0000"/,
    ],
    [
      "bold after size",
      P("x", '<w:sz w:val="24"/><w:b/>'),
      /out of schema order at <w:b>/,
    ],
    [
      "italic before bold",
      P("x", "<w:i/><w:b/>"),
      /out of schema order at <w:b>/,
    ],
    ["an element rPr cannot hold", P("x", "<w:jc/>"), /<w:jc> inside <w:rPr>/],
    ["mismatched tags", "<w:p><w:r></w:p></w:r>", /closes/],
    ["a bare ampersand", P("Tom & Jerry"), /bare "&"/],
    ["an unknown entity", P("&nbsp;"), /unknown entity/],
    ["an unbound prefix", "<v:shape/>" + P("x"), /unbound prefix/],
    [
      "a character XML cannot carry",
      P(`a${String.fromCharCode(1)}b`),
      /a character XML cannot carry/,
    ],
    ["a repeated attribute", '<w:p w:a="1" w:a="2"/>', /repeated attribute/],
  ] as const)("NEGATIVE: %s is a problem", async (_, body, why) => {
    const problems = await docxStructureProblems(await docx(body));
    expect(problems.join("\n")).toMatch(why);
  });

  it("NEGATIVE: a related part without a content type, or missing from the package, is a problem", async () => {
    const unregistered = await docx(P("x"), {
      rels: `<Relationship Id="rId9" Type="${R}/image" Target="media/image1.gif"/>`,
      parts: { "word/media/image1.gif": "GIF89a" },
    });
    expect((await docxStructureProblems(unregistered)).join("\n")).toMatch(
      /word\/media\/image1\.gif has no content type/,
    );
    const missing = await docx(P("x"), {
      rels: `<Relationship Id="rId9" Type="${R}/styles" Target="styles.xml"/>`,
    });
    expect((await docxStructureProblems(missing)).join("\n")).toMatch(
      /names word\/styles\.xml, which is not in the package/,
    );
    // An external target is not a part.
    const external = await docx(P("x"), {
      rels: `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com/a.gif" TargetMode="External"/>`,
    });
    expect(await docxStructureProblems(external)).toEqual([]);
  });

  it("a file that is not a package is one problem, not a throw", async () => {
    expect(
      await docxStructureProblems(new TextEncoder().encode("not a zip")),
    ).toHaveLength(1);
  });
});

/**
 * The tokenizer replaces jsdom at runtime (jsdom is a dev dependency, not in
 * the worker image), so it is held to jsdom here: on each malformed control
 * BOTH refuse, and on well-formed XML both accept.
 */
describe("parseXml agrees with jsdom's XML parser", () => {
  const malformed = [
    "<a><b></a>",
    "<a>&nbsp;</a>",
    "<a>Tom & Jerry</a>",
    `<a>${String.fromCharCode(1)}</a>`,
    "<a b=1/>",
    '<a b="1" b="2"/>',
    "<p:a/>",
    "<a/><b/>",
    "<a>",
    "</a>",
    "text<a/>",
    '<a b="<"/>',
    "<a>&#0;</a>",
    "<1a/>",
  ];
  it.each(malformed)("both refuse %j", (xml) => {
    expect(xmlProblems(xml).length, "jsdom").toBeGreaterThan(0);
    expect(parseXml(xml).problems.length, "parseXml").toBeGreaterThan(0);
  });
  it.each([
    '<?xml version="1.0"?><a xmlns:p="urn:x"><p:b c="&amp;&#65;&#x42;"/>&lt;<!-- c --><![CDATA[<x>]]></a>',
    "<a>\n  <b/>\n</a>\n",
    '<a xml:space="preserve"> t </a>',
  ])("both accept %j", (xml) => {
    expect(xmlProblems(xml)).toEqual([]);
    expect(parseXml(xml).problems).toEqual([]);
  });
});

/**
 * HEALTH CHECK over every .docx the engine writes from the generated
 * fixtures (discovered, `@/tests/docx-word-corpus`): no structure problem,
 * and jsdom agrees every XML part is well-formed. The floors are the counts
 * on 2026-11-15; a corpus that shrinks fails here rather than passing
 * emptier.
 */
describe("the corpus the engine writes is clean", () => {
  it("every delivered .docx has no structure problem, and jsdom agrees on every part", async () => {
    expect(wordCorpusGenerators().length).toBeGreaterThanOrEqual(GENERATORS);
    const corpus = await wordCorpus();
    const delivered = corpus.filter((c) => c.docx);
    expect(delivered.length).toBeGreaterThanOrEqual(DELIVERED);
    for (const entry of delivered) {
      expect(await docxStructureProblems(entry.docx!), entry.name).toEqual([]);
      const zip = await JSZip.loadAsync(entry.docx!);
      for (const name of Object.keys(zip.files).filter((n) =>
        /\.(xml|rels)$/.test(n),
      )) {
        const xml = await zip.file(name)!.async("string");
        expect(xmlProblems(xml), `${entry.name}: ${name}`).toEqual([]);
        expect(parseXml(xml).problems, `${entry.name}: ${name}`).toEqual([]);
      }
      // And it reads: at least one page, at least one character.
      const pages = docxPageTexts(await readDocxStructure(entry.docx!));
      expect(pages.join("").trim().length, entry.name).toBeGreaterThan(0);
    }
  }, 300_000);
});

/** Counted 2026-11-15 on this tree (`wordCorpus`). */
const GENERATORS = 26;
const DELIVERED = 26;

/**
 * #28 slice 2 (tables), added 2026-11-15: PDF to Word now writes real Word
 * tables, so the table properties it writes — `w:tblPr` (width, borders,
 * fixed layout), each cell's `w:tcW` — are checked as Word reads them, each
 * with a negative control; and the read-back rule the engine's conservation
 * check stands on learns two things: an EMPTY SLOT (a cell whose paragraphs
 * have no run at all) adds no cell to its row's line, and a body paragraph
 * with no run at all (the separator after a table) adds no line.
 */
describe("tables as PDF to Word writes them (#28 slice 2)", () => {
  const BORDER = (
    side: string,
    attrs = 'w:val="single" w:sz="4" w:color="BFBFBF"',
  ) => `<w:${side} ${attrs}/>`;
  const BORDERS = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => BORDER(s))
    .join("");
  const TC = (w: number, inner: string, extra = "") =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${extra}</w:tcPr>${inner}</w:tc>`;
  const WRITTEN = (
    opts: {
      tblPr?: string;
      grid?: string;
      cells?: string;
    } = {},
  ) =>
    `<w:tbl><w:tblPr>${
      opts.tblPr ??
      `<w:tblW w:w="3000" w:type="dxa"/><w:tblBorders>${BORDERS}</w:tblBorders><w:tblLayout w:type="fixed"/>`
    }</w:tblPr><w:tblGrid>${
      opts.grid ?? '<w:gridCol w:w="1000"/><w:gridCol w:w="2000"/>'
    }</w:tblGrid><w:tr>${
      opts.cells ?? TC(1000, P("a")) + TC(2000, "<w:p></w:p>")
    }</w:tr></w:tbl><w:p></w:p>`;

  it("POSITIVE: the shape the writer emits has no problem, and its widths and borders are read", async () => {
    const bytes = await docx(WRITTEN());
    expect(await docxStructureProblems(bytes)).toEqual([]);
    const [tbl] = (await readDocxStructure(bytes)).blocks;
    expect(tbl).toMatchObject({
      kind: "tbl",
      gridCols: [1000, 2000],
      width: 3000,
      borders: {
        top: { val: "single", sz: 4, color: "BFBFBF" },
        insideV: { val: "single", sz: 4, color: "BFBFBF" },
      },
    });
    expect(
      tbl!.kind === "tbl" && tbl!.rows[0]!.cells.map((c) => c.width),
    ).toEqual([1000, 2000]);
  });

  it.each([
    [
      "a grid column of no width",
      WRITTEN({
        grid: '<w:gridCol w:w="0"/><w:gridCol w:w="3000"/>',
        tblPr: "",
      }),
      /w:gridCol w:w "0"/,
    ],
    [
      "a fractional grid column",
      WRITTEN({
        grid: '<w:gridCol w:w="1.5"/><w:gridCol w:w="3000"/>',
        tblPr: "",
      }),
      /w:gridCol w:w "1.5"/,
    ],
    [
      "a gridSpan that is not a number",
      TABLE(
        `<w:tc><w:tcPr><w:gridSpan w:val="x"/></w:tcPr>${P("a")}</w:tc>`,
        1,
      ) + P("y"),
      /w:gridSpan "x"/,
    ],
    [
      "a gridSpan of 0",
      TABLE(
        `<w:tc><w:tcPr><w:gridSpan w:val="0"/></w:tcPr>${P("a")}</w:tc>`,
        1,
      ) + P("y"),
      /w:gridSpan "0"/,
    ],
    [
      "tblPr children out of order",
      WRITTEN({
        tblPr: '<w:tblLayout w:type="fixed"/><w:tblW w:w="3000" w:type="dxa"/>',
      }),
      /<w:tblPr> children out of schema order at <w:tblW>/,
    ],
    [
      "an element tblPr cannot hold",
      WRITTEN({ tblPr: "<w:b/>" }),
      /<w:b> inside <w:tblPr>/,
    ],
    [
      "tcPr children out of order",
      WRITTEN({
        cells:
          TC(1000, P("a"), '<w:gridSpan w:val="1"/>').replace(
            '<w:tcPr><w:tcW w:w="1000" w:type="dxa"/><w:gridSpan w:val="1"/>',
            '<w:tcPr><w:gridSpan w:val="1"/><w:tcW w:w="1000" w:type="dxa"/>',
          ) + TC(2000, P("b")),
      }),
      /<w:tcPr> children out of schema order at <w:tcW>/,
    ],
    [
      "an element tcPr cannot hold",
      WRITTEN({ cells: TC(1000, P("a"), "<w:jc/>") + TC(2000, P("b")) }),
      /<w:jc> inside <w:tcPr>/,
    ],
    [
      "a cell width of an unknown type",
      WRITTEN({
        cells:
          TC(1000, P("a")).replace('w:type="dxa"', 'w:type="cm"') +
          TC(2000, P("b")),
      }),
      /w:tcW type "cm"/,
    ],
    [
      "a fractional cell width",
      WRITTEN({
        cells:
          TC(1000, P("a")).replace('w:w="1000"', 'w:w="999.5"') +
          TC(2000, P("b")),
      }),
      /w:tcW w "999.5"/,
    ],
    [
      "a dxa cell width that is not its columns'",
      WRITTEN({ cells: TC(1500, P("a")) + TC(2000, P("b")) }),
      /w:tcW 1500 is not its grid columns' 1000/,
    ],
    [
      "a table width that is not its grid's",
      WRITTEN({ tblPr: '<w:tblW w:w="2999" w:type="dxa"/>' }),
      /w:tblW 2999 is not its grid's 3000/,
    ],
    [
      "borders out of order",
      WRITTEN({
        tblPr: `<w:tblBorders>${BORDER("left")}${BORDER("top")}</w:tblBorders>`,
      }),
      /<w:tblBorders> children out of schema order at <w:top>/,
    ],
    [
      "a border style Word may not draw as written",
      WRITTEN({
        tblPr: `<w:tblBorders>${BORDER("top", 'w:val="wave" w:sz="4" w:color="BFBFBF"')}</w:tblBorders>`,
      }),
      /border top val "wave"/,
    ],
    [
      "a border too thick",
      WRITTEN({
        tblPr: `<w:tblBorders>${BORDER("top", 'w:val="single" w:sz="97" w:color="BFBFBF"')}</w:tblBorders>`,
      }),
      /border top sz "97"/,
    ],
    [
      "a border colour by name",
      WRITTEN({
        tblPr: `<w:tblBorders>${BORDER("top", 'w:val="single" w:sz="4" w:color="grey"')}</w:tblBorders>`,
      }),
      /border top color "grey"/,
    ],
  ] as const)("NEGATIVE: %s is a problem", async (_, body, why) => {
    const problems = await docxStructureProblems(await docx(body));
    expect(problems.join("\n")).toMatch(why);
  });

  it("a row reads as its cells in column order, an EMPTY SLOT (no run) skipped, a cell with an empty-text run kept", async () => {
    const body = await readDocxStructure(
      await docx(
        WRITTEN({
          grid: '<w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/>',
          tblPr: "",
          cells:
            TC(1000, P("a")) +
            TC(1000, "<w:p></w:p>") +
            // A cell made only of characters XML cannot carry: its run is
            // written, with no text. It keeps its tab.
            TC(1000, '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>') +
            TC(1000, P("b")),
        }),
      ),
    );
    expect(docxPageTexts(body)).toEqual(["a\t\tb"]);
  });

  it("a body paragraph with no run adds no line; one emptied of its runs' text still adds one", async () => {
    const zeroRuns = await readDocxStructure(
      await docx(P("x") + "<w:p></w:p>" + P("y")),
    );
    expect(docxPageTexts(zeroRuns)).toEqual(["x\ny"]);
    // The control: a REAL paragraph whose run lost its text is a line, so
    // the comparison against poppler's text still fails on it.
    const emptied = await readDocxStructure(
      await docx(
        P("x") +
          '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>' +
          P("y"),
      ),
    );
    expect(docxPageTexts(emptied)).toEqual(["x\n\ny"]);
  });
});

describe("w:rFonts as the reader reads it (#28 slice 4, 2026-11-15)", () => {
  it("reads ascii, hAnsi, cs and eastAsia each as written, and names every other attribute", async () => {
    const body = await readDocxStructure(
      await docx(
        P(
          "x",
          '<w:rFonts w:hint="eastAsia" w:ascii="Arial" w:hAnsi="Georgia" w:eastAsia="SimSun" w:cs="Mangal" w:asciiTheme="minorHAnsi"/>',
        ) + P("y", '<w:rFonts w:ascii="Arial"/>'),
      ),
    );
    const runs = body.blocks.flatMap((b) => (b.kind === "p" ? b.runs : []));
    expect(runs[0]).toEqual({
      text: "x",
      fonts: "Arial",
      fontsHAnsi: "Georgia",
      fontsCs: "Mangal",
      fontsEastAsia: "SimSun",
      fontsOther: ["w:hint", "w:asciiTheme"],
    });
    expect(runs[1]).toEqual({ text: "y", fonts: "Arial" });
  });

  it("w:rFonts after w:b is a problem (CT_RPr order); first is not", async () => {
    await expect(
      docxStructureProblems(
        await docx(P("x", '<w:b/><w:rFonts w:ascii="Arial"/>')),
      ),
    ).resolves.toEqual([
      expect.stringMatching(/out of schema order at <w:rFonts>/),
    ]);
    await expect(
      docxStructureProblems(
        await docx(P("x", '<w:rFonts w:ascii="Arial"/><w:b/>')),
      ),
    ).resolves.toEqual([]);
  });
});
