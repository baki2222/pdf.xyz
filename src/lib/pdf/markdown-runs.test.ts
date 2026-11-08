// @native-canvas
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import {
  blockRuns,
  markdownToPdf,
  parseMarkdownBlocks,
} from "./markdown-to-pdf";
import { clickableHref, pdfSafeUri } from "./markdown-runs";
import { useNodeFontSource } from "@/tests/unicode-fonts";

/**
 * Markdown to PDF's inline styling and links, read back from the PDF it
 * writes: the /Link annotations (pdf-lib) and the faces each word is drawn in
 * (pdf.js's legacy build, the one Node runs).
 */

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

/** Every /Link /URI annotation on every page: its address and its box. */
async function links(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().flatMap((page) => {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) return [];
    return annots.asArray().flatMap((ref) => {
      const annot = doc.context.lookup(ref);
      if (!(annot instanceof PDFDict)) return [];
      if (annot.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) return [];
      const action = annot.lookup(PDFName.of("A"));
      const uri =
        action instanceof PDFDict ? action.lookup(PDFName.of("URI")) : null;
      const rect = annot.lookup(PDFName.of("Rect"));
      return [
        {
          uri: uri instanceof PDFString ? uri.decodeText() : null,
          rect:
            rect instanceof PDFArray
              ? rect.asArray().map((n) => Number(n.toString()))
              : [],
        },
      ];
    });
  });
}

/** Page 1's content stream operators, inflated when they are compressed. */
async function contentOps(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPages()[0]!.node.lookup(PDFName.of("Contents"));
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .map((stream) => {
      if (!(stream instanceof PDFRawStream)) return "";
      const raw = stream.getContents();
      const filter = stream.dict.lookup(PDFName.of("Filter"));
      return Buffer.from(
        filter === PDFName.of("FlateDecode") ? inflateSync(raw) : raw,
      ).toString("latin1");
    })
    .join("\n");
}

/** The fill operator markdown-runs.ts sets a link's colour with. */
const LINK_FILL = "0.1 0.32 0.78 rg";

/** Each text item of page 1, with the font family pdf.js reports for it. */
async function items(bytes: Uint8Array) {
  const pdfjs = await legacy();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    return content.items.flatMap((item) =>
      "str" in item && item.str.trim()
        ? [
            {
              str: item.str,
              font: item.fontName,
              family: content.styles[item.fontName]?.fontFamily ?? "",
              x: item.transform[4] as number,
              y: item.transform[5] as number,
            },
          ]
        : [],
    );
  } finally {
    await task.destroy();
  }
}

/**
 * The item `word` is drawn in. Read from ONE load's items: pdf.js names a
 * font after its document ("g_d0_f2", "g_d1_f2"), so names from two loads
 * always differ — a comparison across loads passed with every face the same,
 * until a mutation that dropped bold and italic showed it.
 */
const fontOf = (all: Awaited<ReturnType<typeof items>>, word: string) => {
  const found = all.find((i) => i.str.includes(word));
  expect(found, `"${word}" is drawn`).toBeDefined();
  return found!;
};

describe("Markdown to PDF draws inline bold, italic and code", () => {
  it("sets **bold**, *italic* and `code` in their own faces, the rest in the body face", async () => {
    const bytes = await markdownToPdf(
      "Plain words then **heavy** and *slanted* and `mono_code` end.",
    );
    const all = await items(bytes);
    const plain = fontOf(all, "Plain");
    const bold = fontOf(all, "heavy");
    const italic = fontOf(all, "slanted");
    const code = fontOf(all, "mono_code");
    expect(new Set([plain.font, bold.font, italic.font, code.font]).size).toBe(
      4,
    );
    expect(code.family).toMatch(/monospace/i);
    // The markup characters themselves are not drawn.
    const text = (await items(bytes)).map((i) => i.str).join("");
    expect(text).not.toMatch(/\*\*|`/);
  });

  it("CONTROL: a paragraph with no inline markup is one face", async () => {
    const bytes = await markdownToPdf("Plain words and nothing more here.");
    const fonts = new Set(
      (await items(bytes))
        .filter((i) => /Plain|nothing/.test(i.str))
        .map((i) => i.font),
    );
    expect(fonts.size).toBe(1);
    expect(await links(bytes)).toEqual([]);
  });
});

describe("Markdown to PDF makes web links clickable", () => {
  it("writes a /Link with a /URI action over a [label](url), and still prints the address", async () => {
    const bytes = await markdownToPdf(
      "Read the [setup guide](https://example.com/guide?a=1) first.",
    );
    const found = await links(bytes);
    expect(found.map((l) => l.uri)).toEqual(["https://example.com/guide?a=1"]);
    // The box starts where "setup" is drawn: after "Read the " in the body
    // face (Helvetica 11pt for ASCII text), from the paragraph's left edge.
    const line = fontOf(await items(bytes), "Read");
    const helvetica = await (
      await PDFDocument.create()
    ).embedFont(StandardFonts.Helvetica);
    const [x1, y1, x2, y2] = found[0]!.rect;
    expect(x1).toBeCloseTo(
      line.x + helvetica.widthOfTextAtSize("Read the ", 11),
      0,
    );
    const label = line;
    expect(x2).toBeGreaterThan(x1! + 40);
    expect(y1).toBeLessThan(label.y);
    expect(y2).toBeGreaterThan(label.y);
    const text = (await items(bytes)).map((i) => i.str).join("");
    expect(text).toContain("setup guide (https://example.com/guide?a=1)");
  });

  it("links bare addresses, <autolinks>, www. addresses, emails and <a href>", async () => {
    const bytes = await markdownToPdf(
      [
        "One https://a.example/x two <https://b.example/> three",
        "www.c.example four <d@example.com> five",
        '<a href="https://e.example/">six</a>',
      ].join("\n\n"),
    );
    expect((await links(bytes)).map((l) => l.uri).sort()).toEqual([
      "http://www.c.example",
      "https://a.example/x",
      "https://b.example/",
      "https://e.example/",
      "mailto:d@example.com",
    ]);
  });

  it("never makes a javascript:, relative or image address clickable", async () => {
    const bytes = await markdownToPdf(
      "[run](javascript:alert(1)) and [notes](docs/notes.md) and ![logo](https://img.example/l.png)",
    );
    expect(await links(bytes)).toEqual([]);
  });

  it("a link that wraps is clickable on both of its lines", async () => {
    const long = "word ".repeat(17);
    const bytes = await markdownToPdf(
      `${long}[a long label that will wrap onto the next line](https://wrap.example/)`,
    );
    const found = await links(bytes);
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(new Set(found.map((l) => l.uri))).toEqual(
      new Set(["https://wrap.example/"]),
    );
  });

  it("keeps hiding HTML comments, and links in a non-Latin document too", async () => {
    const restore = useNodeFontSource();
    try {
      const bytes = await markdownToPdf(
        "<!-- private note --> **বাংলা** লেখা [link](https://bn.example/)",
      );
      const text = (await items(bytes)).map((i) => i.str).join("");
      expect(text).not.toContain("private note");
      expect((await links(bytes)).map((l) => l.uri)).toEqual([
        "https://bn.example/",
      ]);
    } finally {
      restore();
    }
  });
});

describe("the link helpers", () => {
  it("clickableHref takes web and mail addresses only", () => {
    expect(clickableHref("https://x.example/a")).toBe("https://x.example/a");
    expect(clickableHref("www.x.example")).toBe("http://www.x.example");
    expect(clickableHref("me@x.example")).toBe("mailto:me@x.example");
    for (const no of ["javascript:alert(1)", "docs/a.md", "file:///etc", "x"]) {
      expect(clickableHref(no), no).toBeUndefined();
    }
  });

  it("pdfSafeUri leaves no bracket, backslash or non-ASCII in the string", () => {
    expect(pdfSafeUri("https://x.example/a(b)\\c/é")).toBe(
      "https://x.example/a%28b%29%5Cc/%C3%A9",
    );
  });
});

describe("styled runs say exactly what the block text says", () => {
  it("a list item and a quote carry their links too", async () => {
    const bytes = await markdownToPdf(
      "- an item with **bold** and [a link](https://item.example/)\n\n> a quote with [a link](https://quote.example/)",
    );
    expect((await links(bytes)).map((l) => l.uri).sort()).toEqual([
      "https://item.example/",
      "https://quote.example/",
    ]);
  });

  it("for every block that has runs, the runs joined are its text", () => {
    const blocks = parseMarkdownBlocks(
      [
        "Plain **bold *both* bold** _it_ `co  de` ~~gone~~ snake_case_name",
        "line one  ",
        "line two <br> after &amp; [l](https://x.example) www.y.example",
        "",
        "- item **b** [r][ref]",
        "  - nested `c`",
        "",
        "> quoted *i* [l](https://q.example)",
        "> - quoted item **b**",
        "",
        "# head **b** [l](https://h.example)",
        "",
        "Setext *i* [l](https://s.example)",
        "---",
        "",
        "> [!NOTE]",
        "> alert **b** [l](https://n.example)",
        "",
        "[ref]: https://ref.example",
      ].join("\n"),
    );
    const checked = blocks.filter((block) => blockRuns(block) !== undefined);
    // Health: the paragraph, both items, both quote lines, both headings and
    // the callout's text have runs.
    expect(checked.length).toBeGreaterThanOrEqual(8);
    expect(checked.map((block) => block.kind)).toContain("heading");
    for (const block of checked) {
      expect(
        blockRuns(block)!
          .map((run) => run.text)
          .join(""),
        block.kind,
      ).toBe("text" in block ? block.text : "");
    }
  });
});

describe("links outside paragraphs: where they open, and where they only print", () => {
  it("a link in a heading opens, and the heading keeps its one bold face", async () => {
    const bytes = await markdownToPdf(
      "# See the [docs](https://example.com/h) now\n\nBody text here.",
    );
    expect((await links(bytes)).map((l) => l.uri)).toEqual([
      "https://example.com/h",
    ]);
    const all = await items(bytes);
    // One face across the heading: "See the", the link and its address.
    const heading = all.filter((i) => i.y === fontOf(all, "See").y);
    expect(heading.map((i) => i.str).join("")).toContain(
      "docs (https://example.com/h)",
    );
    expect(new Set(heading.map((i) => i.font)).size).toBe(1);
    expect(fontOf(all, "See").font).not.toBe(fontOf(all, "Body").font);
  });

  it("a link in a setext heading opens too", async () => {
    const bytes = await markdownToPdf(
      "Read [this](https://example.com/s)\n===\n",
    );
    expect((await links(bytes)).map((l) => l.uri)).toEqual([
      "https://example.com/s",
    ]);
  });

  it("CONTROL: a heading with no link is drawn as before, with no annotation", async () => {
    const bytes = await markdownToPdf("# Plain heading\n\nBody.");
    expect(await links(bytes)).toEqual([]);
  });

  it("a [!NOTE] callout keeps its links and its bold", async () => {
    const bytes = await markdownToPdf(
      "> [!NOTE]\n> Read **heavy** and [the note](https://example.com/n).",
    );
    expect((await links(bytes)).map((l) => l.uri)).toEqual([
      "https://example.com/n",
    ]);
    const all = await items(bytes);
    expect(fontOf(all, "heavy").font).not.toBe(fontOf(all, "Read").font);
    expect(all.map((i) => i.str).join("")).toContain("Note");
  });

  it("a link in a table cell prints its label and address but does not open (the page says so)", async () => {
    const bytes = await markdownToPdf(
      "| a | b |\n| - | - |\n| [x](https://example.com/t) | y |",
    );
    expect(await links(bytes)).toEqual([]);
    const text = (await items(bytes)).map((i) => i.str).join("");
    expect(text).toContain("x (https://example.com/t)");
  });

  it("a relative link prints in the text colour; a web link in the link colour (control)", async () => {
    const relative = await contentOps(
      await markdownToPdf("See [notes](docs/setup.md) here."),
    );
    const web = await contentOps(
      await markdownToPdf("See [web](https://example.com/w) here."),
    );
    // Health: the page was read, and the body text colour is in it.
    expect(relative).toContain("0.1 0.12 0.18 rg");
    expect(relative).not.toContain(LINK_FILL);
    expect(web).toContain(LINK_FILL);
    // On one line with a web link (the styled path), only the web link's
    // segment takes the link colour; the relative link's words do not.
    const mixed = await contentOps(
      await markdownToPdf(
        "[notes](docs/setup.md) then [web](https://example.com/w)",
      ),
    );
    expect(mixed.split(LINK_FILL)).toHaveLength(2);
  });
});

describe("bold italic", () => {
  it("text that is both bold and italic is set in the bold face", async () => {
    const bytes = await markdownToPdf(
      "Plain **heavy** then ***both*** and *slanted* end.",
    );
    const all = await items(bytes);
    expect(fontOf(all, "both").font).toBe(fontOf(all, "heavy").font);
    expect(fontOf(all, "both").font).not.toBe(fontOf(all, "slanted").font);
  });
});
