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
    expect(docxPageTexts(body)).toEqual([
      "Before\nWide\t\nBig & red\tplain",
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
