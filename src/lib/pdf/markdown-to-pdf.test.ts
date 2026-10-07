// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  type PDFFont,
} from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MARGIN,
  PAGE_WIDTH,
  markdownPdfOutputName,
  markdownToPdf,
  parseMarkdownBlocks,
  validateMarkdownInput,
  type MarkdownBlock,
} from "./markdown-to-pdf";
import { embedDrawingFont } from "./unicode-font";
import { PdfEngineError } from "./engine";
import { proveGlyphs, useNodeFontSource } from "@/tests/unicode-fonts";
import { MAX_SOURCE_BYTES } from "@/lib/tools/limits";

const ROOT = path.resolve(__dirname, "../../..");

describe("markdown-to-pdf", () => {
  it("rejects empty markdown", () => {
    expect(() => validateMarkdownInput("  \n\t  ")).toThrow(
      /Add some Markdown/,
    );
  });

  it("parses headings, bullets, ordered items, blockquotes, code fences, and paragraphs", () => {
    const blocks = parseMarkdownBlocks(
      `# Title\n\nIntro **bold** text.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n\`\`\`ts\nconst x = 1;\n\`\`\``,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list-item",
      "list-item",
      "list-item",
      "list-item",
      "quote",
      "code",
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "heading",
      depth: 1,
      text: "Title",
    });
    expect(blocks[2]).toMatchObject({
      kind: "list-item",
      ordered: false,
      text: "one",
    });
    expect(blocks[4]).toMatchObject({
      kind: "list-item",
      ordered: true,
      index: 1,
      text: "first",
    });
    expect(blocks[7]).toMatchObject({ kind: "code", language: "ts" });
  });

  it("strips common inline markdown marks to readable PDF text", () => {
    const blocks = parseMarkdownBlocks(
      "**Bold** and _em_ with [link](https://example.com) and `code`",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "paragraph",
      text: "Bold and em with link (https://example.com) and code",
    });
  });

  it("creates a valid PDF with document metadata", async () => {
    const bytes = await markdownToPdf(
      "# Release notes\n\n- Repair PDF\n- Optimize for Web",
      { title: "notes.md" },
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("notes.md");
    expect(doc.getCreator()).toBe("pdf.xyz");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("names PDF downloads from source Markdown files", () => {
    expect(markdownPdfOutputName("README.md")).toBe("README-pdf.pdf");
    expect(markdownPdfOutputName("notes.markdown")).toBe("notes-pdf.pdf");
  });
});

/* ------------------------------------------------------------------ *
 *  The corpus: every Markdown file this repository ships.
 *
 *  Derived from git's index rather than typed, so a new README joins the
 *  corpus by existing. They are exactly the documents the tool's keyword
 *  ("readme to pdf") is about: snake_case env vars, dunder files, tables,
 *  nested bullets, fenced shell with long tokens.
 * ------------------------------------------------------------------ */

const MARKDOWN_FILES = execFileSync("git", ["ls-files", "-z", "*.md"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

function readRepoMarkdown(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8");
}

/** Lines outside fenced code, found WITHOUT the parser under test. */
function proseLines(markdown: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      continue;
    }
    if (!fence) out.push(line);
  }
  return out;
}

function paragraphText(markdown: string): string {
  const blocks = parseMarkdownBlocks(markdown);
  expect(blocks, JSON.stringify(blocks)).toHaveLength(1);
  const block = blocks[0]!;
  expect(block.kind).not.toBe("rule");
  expect(block.kind).not.toBe("table");
  return (block as { text: string }).text;
}

describe("the markdown corpus (health check)", () => {
  it("is the repository's Markdown, and plausibly all of it", () => {
    // Bounded both ways: an empty list passes every assertion below, and a
    // list that swallowed node_modules would be asking a different question.
    expect(MARKDOWN_FILES.length).toBeGreaterThanOrEqual(15);
    expect(MARKDOWN_FILES.length).toBeLessThan(200);
    expect(MARKDOWN_FILES).toContain("README.md");
  });
});

/* ------------------------------------------------------------------ *
 *  Finding: inline markup stripping deleted the user's own characters.
 *
 *  Before: "Set `MAX_UPLOAD_SIZE` and edit `__init__.py` in my_module_name."
 *  printed as "Set MAXUPLOADSIZE and edit init.py in mymodulename.", and the
 *  tool said "PDF created". The strip test above only fed it well-formed
 *  `_em_`, so it was green over this; it pins correct behaviour and stays.
 * ------------------------------------------------------------------ */

/** Every snake_case token in the repository's Markdown, bounded below. */
function repoSnakeTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const file of MARKDOWN_FILES) {
    const text = readRepoMarkdown(file);
    for (const match of text.matchAll(
      // Intraword underscores only. A prose `__init__` IS strong emphasis by
      // CommonMark (GitHub shows a bold "init"); the dunder case this tool
      // broke was inside a code span, and the span corpus covers it.
      /(?<![\w*~])[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+(?![\w*~])/g,
    )) {
      tokens.add(match[0]);
    }
  }
  expect(tokens.size, "the token corpus is implausibly small").toBeGreaterThan(
    50,
  );
  return tokens;
}

describe("inline markup never deletes the user's characters", () => {
  it.each([
    [
      "Set `MAX_UPLOAD_SIZE` and edit `__init__.py` in my_module_name.",
      "Set MAX_UPLOAD_SIZE and edit __init__.py in my_module_name.",
    ],
    ["Compute 2 * 3 * 4 now.", "Compute 2 * 3 * 4 now."],
    ["- use `a*b*c`", "use a*b*c"],
    ["`\\*`", "\\*"],
    [
      "Keep ~/code and ABC~1\\x~2 as typed.",
      "Keep ~/code and ABC~1\\x~2 as typed.",
    ],
    ["``a ` b``", "a ` b"],
    ["` `` `", "``"],
    ["An unclosed `tick stays", "An unclosed `tick stays"],
    [
      "See [the docs](https://x.dev/my_page_name_here).",
      "See the docs (https://x.dev/my_page_name_here).",
    ],
    ["<https://x.dev/a_b_c>", "https://x.dev/a_b_c"],
    ["A \\_literal\\_ underscore", "A _literal_ underscore"],
    ["snake_case_word and a_b stay", "snake_case_word and a_b stay"],
  ])("%j prints as %j", (source, expected) => {
    expect(paragraphText(source)).toBe(expected);
  });

  it.each([
    // Positive controls: the tokenizer is not a no-op. Each of these IS markup.
    ["a *b* c", "a b c"],
    ["__bold__ text", "bold text"],
    ["**Important:** read this.", "Important: read this."],
    ["_em_ and *em*", "em and em"],
    ["~~gone~~ struck", "gone struck"],
    ["***both***", "both"],
    ["foo*bar*baz", "foobarbaz"],
    ["`code` span", "code span"],
    ['[label](https://e.com "title")', "label (https://e.com)"],
    ["![alt text](img.png)", "alt text (img.png)"],
    // A badge: an image inside a link. The label-depth bound must not stop it.
    ["[![CI](badge.svg)](actions)", "CI (badge.svg) (actions)"],
  ])("control: %j is markup and prints as %j", (source, expected) => {
    expect(paragraphText(source)).toBe(expected);
  });

  it("keeps every inline code span in the repository's Markdown verbatim", () => {
    // Spans found by an independent pattern, not by the tokenizer under test.
    const spans = new Set<string>();
    for (const file of MARKDOWN_FILES) {
      for (const line of proseLines(readRepoMarkdown(file))) {
        for (const match of line.matchAll(/(?<!`)`([^`]+)`(?!`)/g)) {
          spans.add(match[1]!);
        }
      }
    }
    expect(spans.size, "the span corpus is implausibly small").toBeGreaterThan(
      200,
    );
    const wrong: string[] = [];
    for (const span of spans) {
      const expected =
        span.length >= 2 &&
        span.startsWith(" ") &&
        span.endsWith(" ") &&
        span.trim()
          ? span.slice(1, -1)
          : span;
      const got = paragraphText(`Before \`${span}\` after`);
      if (got !== `Before ${expected} after`) wrong.push(`${span} -> ${got}`);
    }
    expect(wrong).toEqual([]);
  });

  it("keeps every snake_case token in the repository's Markdown", () => {
    const tokens = repoSnakeTokens();
    const lost = [...tokens].filter(
      (token) => paragraphText(`Use ${token} here.`) !== `Use ${token} here.`,
    );
    expect(lost).toEqual([]);
  });

  it("reads ~~~ fences, and a ``` line inside one is content", () => {
    expect(parseMarkdownBlocks("~~~\ntilde code\n~~~")).toEqual([
      { kind: "code", text: "tilde code" },
    ]);
    expect(
      parseMarkdownBlocks("~~~md\n```js\nx_y = 1\n```\n~~~\n\nafter"),
    ).toEqual([
      { kind: "code", language: "md", text: "```js\nx_y = 1\n```" },
      { kind: "paragraph", text: "after" },
    ]);
    // A shorter closer does not close a longer fence.
    expect(parseMarkdownBlocks("````\n```\nstill code\n````")).toEqual([
      { kind: "code", text: "```\nstill code" },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  Finding (review note): a bare URL lost its characters to emphasis.
 *
 *  "See https://x.com/_private_ now" printed "https://x.com/private", and a
 *  bare ".../main/__init__.py" printed ".../main/init.py". CommonMark's
 *  flanking rules allow it, but GFM's autolink extension — what GitHub shows
 *  a README reader — takes the URL before emphasis is looked for, so the
 *  address a reader copies out of the PDF was a broken one. The corpus above
 *  puts its tokens in prose and code spans, never in a bare address.
 * ------------------------------------------------------------------ */

/** Bare URLs in the repository's prose, found without the tokenizer. */
function repoBareUrls(): Set<string> {
  const urls = new Set<string>();
  for (const file of MARKDOWN_FILES) {
    for (const line of proseLines(readRepoMarkdown(file))) {
      for (const match of line.matchAll(
        /(?<=^|[\s(*_~])(?:https?:\/\/|www\.)[^\s<`]+/g,
      )) {
        // GFM leaves trailing punctuation to the sentence; drop it, and any
        // closing paren, so the sample is an address on its own.
        const url = match[0].replace(/[?!.,:*_~)]+$/, "");
        if (!/^(?:https?:\/\/|www\.)$/.test(url)) urls.add(url);
      }
    }
  }
  expect(urls.size, "the URL corpus is implausibly small").toBeGreaterThan(2);
  return urls;
}

describe("a bare URL keeps its characters", () => {
  it.each([
    "See https://x.com/_private_ now",
    "Get https://github.com/a/b/blob/main/__init__.py here.",
    "a https://x.com/*star*/p, then.",
    "Visit www.x.com/a_b_/c today",
    "Read (https://x.com/wiki/Foo_(bar)) first",
  ])("%j prints as typed", (source) => {
    expect(paragraphText(source)).toBe(source);
  });

  it.each([
    // Positive controls: the address is literal, the markup around it is not.
    ["**https://x.com/a_b**", "https://x.com/a_b"],
    ["_https://x.com/a_", "https://x.com/a"],
    ["*see www.x.com/p*.", "see www.x.com/p."],
    // Not an address: a scheme with nothing after it, or no word boundary.
    ["_http://_ is a scheme", "http:// is a scheme"],
    ["x/https://y.com/_a_", "x/https://y.com/a"],
  ])("control: %j prints as %j", (source, expected) => {
    expect(paragraphText(source)).toBe(expected);
  });

  it("keeps every bare URL in the repository's Markdown, and every snake_case token as a path", () => {
    const urls = [...repoBareUrls()];
    for (const token of repoSnakeTokens()) {
      urls.push(
        `https://x.dev/${token}`,
        `https://x.dev/_${token}_/`,
        `https://x.dev/__${token}__.py`,
        `www.x.dev/*${token}*/p`,
      );
    }
    const lost = urls.filter(
      (url) => paragraphText(`See ${url} now.`) !== `See ${url} now.`,
    );
    expect(lost).toEqual([]);
  });
});

/** Every construct whose label the tokenizer reads as inline Markdown. */
const NESTED_OPENERS = [
  ["links", "["],
  ["images", "!["],
] as const;

/** `open` nested as deep as the source cap allows, around one `label`. */
function nestedAtCap(open: string, label: string, url: string) {
  const closer = `](${url})`;
  const k = Math.floor(
    (MAX_SOURCE_BYTES - label.length) / (open.length + closer.length),
  );
  return { k, source: open.repeat(k) + label + closer.repeat(k) };
}

const occurrences = (text: string, ch: string) => text.split(ch).length - 1;

/**
 * No character of a nested label is lost, whichever levels are read as links:
 * each destination survives, once, and each level is either consumed whole
 * (its brackets, and for an image its `!`) or printed whole.
 */
function expectEveryNestedLevelKept(
  text: string,
  open: string,
  k: number,
  label: string,
  url: string,
) {
  expect(occurrences(text, label)).toBe(1);
  expect(occurrences(text, url)).toBe(k);
  expect(occurrences(text, "(")).toBe(k);
  expect(occurrences(text, ")")).toBe(k);
  expect(occurrences(text, "]")).toBe(occurrences(text, "["));
  expect(occurrences(text, "!")).toBe(
    open.startsWith("!") ? occurrences(text, "[") : 0,
  );
}

describe("the inline tokenizer stays linear up to the source cap", () => {
  // One paragraph, as large as the tool accepts. A scan that restarts per
  // candidate is quadratic here: `[a](b` repeated took 19.5 s before the
  // link-scan budget existed. Nothing in these inputs is markup, so each must
  // also come back character for character.
  const repeat = (unit: string) =>
    unit.repeat(Math.floor(MAX_SOURCE_BYTES / unit.length));
  it.each([
    ["unmatched brackets", "["],
    ["unmatched closers", "]"],
    ["link candidates", "[a](b"],
    ["angle destinations", "[a](<b"],
    ["unterminated titles", '[a](b "t'],
    ["openers only", "*a "],
    ["closers only", "a* "],
    ["underscores", "_a _b "],
    ["bare URLs", "(https://x/_a_) "],
    ["scheme candidates", "abcdefghijklmnopqrstuvwxyz012345:/ "],
    ["unbalanced parens", "https://x" + ")".repeat(64) + " "],
  ])("%s", (_label, unit) => {
    const source = repeat(unit);
    const started = performance.now();
    const text = paragraphText(source);
    const elapsed = performance.now() - started;
    expect(text).toBe(source.trim());
    expect(elapsed).toBeLessThan(5_000);
  });

  // Nesting. Every label used to be read by a fresh recursive call, one stack
  // frame and one O(n) bracket pass per level: at 5 KB this took 396 ms, and
  // at 20 KB it threw "Maximum call stack size exceeded" - an input the
  // renderer before links drew in 23 ms. The flat shapes above never nest, so
  // the suite's title held for them and not for this. The stack half of the
  // property is proved in a child process below; this is the time half.
  it.each(NESTED_OPENERS)("nested %s", (_label, open) => {
    const { k, source } = nestedAtCap(open, "a", "b");
    const started = performance.now();
    const text = paragraphText(source);
    const elapsed = performance.now() - started;
    expectEveryNestedLevelKept(text, open, k, "a", "b");
    expect(elapsed).toBeLessThan(5_000);
  });
});

/* ------------------------------------------------------------------ *
 *  Finding: a table under the source cap crashed the tool.
 *
 *  Table support spread one argument per cell (`out.push(...cells)`) and
 *  one per row (`Math.max(...rows.map(...))`). A 40,000-row, 4-column table
 *  (1.3 MB) threw "Maximum call stack size exceeded"; the renderer before
 *  tables drew the same file. Nothing reached it: the linearity suite above
 *  feeds single paragraphs, and vitest's worker threads have a 4 MB stack,
 *  four times a browser main thread's — a 380,000-cell table passed HERE on
 *  the broken code.
 *
 *  So the render runs where the stack is the consumer's shape: a child
 *  `node`, main thread, the tool's real module through tsx. The child
 *  MEASURES how many arguments its stack can spread, and every table is
 *  built just past that, so the size follows the stack instead of a number
 *  typed here. It runs with a fifth of node's default stack: the limit
 *  scales with the stack and the property does not, and at the default
 *  (984 KB, ~125,000 arguments — about what Chrome's main thread allows)
 *  the same proof costs 8 s and 1.4 GB. The positive control is in the
 *  child too: spreading as many arguments as the table has rows MUST throw
 *  there, or the table proves nothing.
 * ------------------------------------------------------------------ */

const TABLE_CHILD = String.raw`
const md = await import(process.env.MD_MODULE);
// Node 22 (CI) loads the .ts through tsx as CommonJS and leaves its named
// exports only on default; Node 24 detects them. Found 2026-10-08: every
// local run was Node 24, so "parseMarkdownBlocks is not a function" was
// CI-only. Either shape is accepted; neither is a loud failure.
const { markdownToPdf, parseMarkdownBlocks } =
  typeof md.parseMarkdownBlocks === "function" ? md : md.default;
if (typeof markdownToPdf !== "function" || typeof parseMarkdownBlocks !== "function")
  throw new Error("MD_MODULE exports neither named nor default: " + Object.keys(md).join(","));
let lo = 1, hi = 1 << 24;
while (lo < hi) {
  const mid = (lo + hi + 1) >> 1;
  try { Math.max(...new Array(mid).fill(0)); lo = mid; } catch { hi = mid - 1; }
}
const n = Math.ceil(lo * 1.1);
let spreadThrows = false;
try { Math.max(...new Array(n).fill(0)); } catch (e) { spreadThrows = e instanceof RangeError; }
const shapes = {
  // n rows: every row-wise spread passes n arguments.
  tall: "| h0 |\n| --- |\n" + "x\n".repeat(n),
  // n columns: every cell-wise and column-wise spread passes n arguments.
  wide: "|a|" + "c|".repeat(n - 2) + "z|\n|" + "-|".repeat(n) + "\n",
};
const out = { limit: lo, n, spreadThrows, cases: {} };
for (const [name, source] of Object.entries(shapes)) {
  const blocks = parseMarkdownBlocks(source);
  const table = blocks[0];
  const result = {
    bytes: Buffer.byteLength(source),
    blocks: blocks.length,
    kind: table.kind,
    columns: table.header?.length,
    rows: table.rows?.length,
  };
  const started = performance.now();
  try {
    const pdf = await markdownToPdf(source, { title: name + ".md" });
    result.pdf = Buffer.from(pdf).toString("base64");
  } catch (error) {
    result.error = String(error);
  }
  result.ms = performance.now() - started;
  out.cases[name] = result;
}
process.stdout.write(JSON.stringify(out));
`;

interface TableCase {
  bytes: number;
  blocks: number;
  kind: string;
  columns: number;
  rows: number;
  pdf?: string;
  error?: string;
  ms: number;
}

let tableRun: {
  limit: number;
  n: number;
  spreadThrows: boolean;
  cases: Record<"tall" | "wide", TableCase>;
} | null = null;

/**
 * Runs `script` in a child `node`, on its main thread, with a fifth of node's
 * default stack; the tool's real module is at `MD_MODULE`, the source cap at
 * `MD_CAP`, and anything in `env` is passed too. Returns what it printed.
 */
function runInConsumerStack<T>(script: string, env: Record<string, string>) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--stack-size=200",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        env: {
          ...process.env,
          MD_MODULE: pathToFileURL(path.join(__dirname, "markdown-to-pdf.ts"))
            .href,
          MD_CAP: String(MAX_SOURCE_BYTES),
          ...env,
        },
      },
    ),
  ) as T;
}

function renderTablesInChild() {
  tableRun ??= runInConsumerStack<NonNullable<typeof tableRun>>(
    TABLE_CHILD,
    {},
  );
  return tableRun;
}

describe("a table stays renderable up to the source cap", () => {
  it("the child's stack cannot spread one argument per row (health check)", () => {
    const run = renderTablesInChild();
    // Plausible: a stack that allowed millions would make every table below
    // pass whatever the renderer spreads; one that allowed a handful would
    // mean the child is not the shape of a browser's main thread at all.
    expect(run.limit).toBeGreaterThan(5_000);
    expect(run.limit).toBeLessThan(200_000);
    expect(run.n).toBeGreaterThan(run.limit);
    expect(run.spreadThrows).toBe(true);
  }, 120_000);

  it.each(["tall", "wide"] as const)(
    "a %s table past that limit, under the cap, reaches the page cell for cell",
    async (name) => {
      const { n, cases } = renderTablesInChild();
      const result = cases[name];
      // Under the cap, so the tool accepts it; ONE table of the built shape,
      // so a table that fell through to a paragraph cannot pass.
      expect(result.bytes).toBeLessThanOrEqual(MAX_SOURCE_BYTES);
      expect(result.blocks).toBe(1);
      expect(result.kind).toBe("table");
      expect(name === "tall" ? result.rows : result.columns).toBe(n);
      expect(result.error).toBeUndefined();
      expect(result.ms).toBeLessThan(30_000);

      // What the reader receives: every cell typed is drawn, once.
      const texts = (
        await drawnRuns(new Uint8Array(Buffer.from(result.pdf!, "base64")))
      ).map((run) => run.text);
      const count = (cell: string) => texts.filter((t) => t === cell).length;
      if (name === "tall") {
        expect(count("h0")).toBe(1);
        expect(count("x")).toBe(n);
      } else {
        expect(count("a")).toBe(1);
        expect(count("c")).toBe(n - 2);
        expect(count("z")).toBe(1);
      }
    },
    120_000,
  );
});

/* ------------------------------------------------------------------ *
 *  Finding: nested link labels overflowed the stack far below the cap.
 *
 *  Each link or image label was tokenized by a recursive call, so the stack
 *  depth was the nesting depth: `"[".repeat(k) + "a" + "](b)".repeat(k)`
 *  threw "Maximum call stack size exceeded" at 20 KB. A stack-depth property
 *  is not provable in vitest's 4 MB worker stack, so, as for tables, the
 *  render runs in the child. The shape is built at the cap, and the positive
 *  control is a walk that spends one frame per nesting level: it MUST throw
 *  there, or the shape is too shallow to tell a bounded tokenizer from the
 *  recursive one.
 * ------------------------------------------------------------------ */

const NESTED_CHILD = String.raw`
const md = await import(process.env.MD_MODULE);
// Node 22 (CI) loads the .ts through tsx as CommonJS and leaves its named
// exports only on default; Node 24 detects them. Found 2026-10-08: every
// local run was Node 24, so "parseMarkdownBlocks is not a function" was
// CI-only. Either shape is accepted; neither is a loud failure.
const { markdownToPdf, parseMarkdownBlocks } =
  typeof md.parseMarkdownBlocks === "function" ? md : md.default;
if (typeof markdownToPdf !== "function" || typeof parseMarkdownBlocks !== "function")
  throw new Error("MD_MODULE exports neither named nor default: " + Object.keys(md).join(","));
const cap = Number(process.env.MD_CAP);
const openers = JSON.parse(process.env.MD_OPENERS);
const down = (n) => (n === 0 ? 0 : 1 + down(n - 1));
let lo = 1, hi = 1 << 24;
while (lo < hi) {
  const mid = (lo + hi + 1) >> 1;
  try { down(mid); lo = mid; } catch { hi = mid - 1; }
}
const out = { depthLimit: lo, cases: {} };
for (const [name, open] of openers) {
  const closer = "](y)";
  const k = Math.floor((cap - 1) / (open.length + closer.length));
  const source = open.repeat(k) + "x" + closer.repeat(k);
  let walkThrows = false;
  try { down(k); } catch (e) { walkThrows = e instanceof RangeError; }
  const result = { k, bytes: Buffer.byteLength(source), walkThrows };
  const started = performance.now();
  try {
    result.blocks = parseMarkdownBlocks(source).length;
    const pdf = await markdownToPdf(source, { title: name + ".md" });
    result.pdf = Buffer.from(pdf).toString("base64");
  } catch (error) {
    result.error = String(error);
  }
  result.ms = performance.now() - started;
  out.cases[name] = result;
}
process.stdout.write(JSON.stringify(out));
`;

interface NestedCase {
  k: number;
  bytes: number;
  walkThrows: boolean;
  blocks?: number;
  pdf?: string;
  error?: string;
  ms: number;
}

let nestedRun: {
  depthLimit: number;
  cases: Record<string, NestedCase>;
} | null = null;

function renderNestedInChild() {
  nestedRun ??= runInConsumerStack<NonNullable<typeof nestedRun>>(
    NESTED_CHILD,
    { MD_OPENERS: JSON.stringify(NESTED_OPENERS) },
  );
  return nestedRun;
}

describe("nested link labels stay renderable up to the source cap", () => {
  it("the child's stack cannot recurse once per level of the shape (health check)", () => {
    const run = renderNestedInChild();
    // Plausible: a stack deep enough for the whole shape would let the
    // recursive tokenizer pass; one a few frames deep is not a main thread.
    expect(run.depthLimit).toBeGreaterThan(500);
    expect(Object.keys(run.cases)).toEqual(NESTED_OPENERS.map(([n]) => n));
    for (const result of Object.values(run.cases)) {
      expect(result.k).toBeGreaterThan(run.depthLimit);
      expect(result.walkThrows).toBe(true);
    }
  }, 120_000);

  it.each(NESTED_OPENERS)(
    "%s nested to the cap reach the page, every character kept",
    async (name, open) => {
      const result = renderNestedInChild().cases[name]!;
      expect(result.bytes).toBeLessThanOrEqual(MAX_SOURCE_BYTES);
      expect(result.error).toBeUndefined();
      expect(result.blocks).toBe(1);
      expect(result.ms).toBeLessThan(30_000);

      // What the reader receives: every drawn run. The title ("links.md")
      // holds none of the characters counted, so it needs no filtering.
      const runs = await drawnRuns(
        new Uint8Array(Buffer.from(result.pdf!, "base64")),
      );
      const drawn = runs.map((run) => run.text).join("");
      expect(drawn).toContain(`${name}.md`);
      expectEveryNestedLevelKept(drawn, open, result.k, "x", "y");
    },
    120_000,
  );
});

/* ------------------------------------------------------------------ *
 *  Reading what the reader receives: the text runs in the saved PDF.
 *
 *  Parsed out of the page content streams — font, size, position, and the
 *  string each `Tj` shows — and measured with the metrics the FILE carries:
 *  `/W` for an embedded face, the standard-14 AFM widths for a built-in one.
 *  Nothing here asks the renderer what it meant to draw.
 * ------------------------------------------------------------------ */

interface DrawnRun {
  page: number;
  /** The paper's width, from the page's own MediaBox. */
  pageWidth: number;
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

const winAnsi = new TextDecoder("windows-1252");

function inflateMaybe(raw: Uint8Array): string {
  try {
    return inflateSync(Buffer.from(raw)).toString("latin1");
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}

function contentOf(doc: PDFDocument, pageIndex: number): string {
  const page = doc.getPages()[pageIndex]!;
  const contents = doc.context.lookup(page.node.get(PDFName.of("Contents")));
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) =>
      inflateMaybe((s as unknown as { contents: Uint8Array }).contents),
    )
    .join("\n");
}

interface FontMeasure {
  decode(hex: string): string;
  width(hex: string, size: number): number;
}

async function fontMeasure(
  doc: PDFDocument,
  dict: PDFDict,
  scratch: PDFDocument,
): Promise<FontMeasure> {
  const subtype = dict.lookup(PDFName.of("Subtype"), PDFName).asString();
  if (subtype === "/Type1") {
    const base = dict.lookup(PDFName.of("BaseFont"), PDFName).decodeText();
    const known = Object.values(StandardFonts) as string[];
    if (!known.includes(base)) throw new Error(`not a standard face: ${base}`);
    const font: PDFFont = await scratch.embedFont(base as StandardFonts);
    const decode = (hex: string) => winAnsi.decode(Buffer.from(hex, "hex"));
    return {
      decode,
      width: (hex, size) => font.widthOfTextAtSize(decode(hex), size),
    };
  }
  if (subtype === "/Type0") {
    const cid = dict
      .lookup(PDFName.of("DescendantFonts"), PDFArray)
      .lookup(0, PDFDict);
    const widths = new Map<number, number>();
    const w = cid.lookup(PDFName.of("W"), PDFArray);
    const items = w.asArray().map((item) => doc.context.lookup(item) ?? item);
    for (let i = 0; i < items.length;) {
      const first = (items[i] as PDFNumber).asNumber();
      const next = items[i + 1];
      if (next instanceof PDFArray) {
        next.asArray().forEach((n, k) => {
          widths.set(first + k, (n as PDFNumber).asNumber());
        });
        i += 2;
      } else {
        const last = (next as PDFNumber).asNumber();
        const value = (items[i + 2] as PDFNumber).asNumber();
        for (let g = first; g <= last; g++) widths.set(g, value);
        i += 3;
      }
    }
    const dw = cid.lookup(PDFName.of("DW"));
    const fallback = dw instanceof PDFNumber ? dw.asNumber() : 1000;
    const unicode = new Map<number, string>();
    const toUnicode = dict.lookup(PDFName.of("ToUnicode"));
    if (toUnicode instanceof PDFRawStream) {
      const text = inflateMaybe(
        (toUnicode as unknown as { contents: Uint8Array }).contents,
      );
      const utf16 = (hex: string) =>
        Buffer.from(hex, "hex").swap16().toString("utf16le");
      for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of block[1]!.matchAll(
          /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
        )) {
          unicode.set(parseInt(pair[1]!, 16), utf16(pair[2]!));
        }
      }
    }
    const ids = (hex: string) =>
      Array.from({ length: hex.length / 4 }, (_, i) =>
        parseInt(hex.slice(i * 4, i * 4 + 4), 16),
      );
    return {
      decode: (hex) =>
        ids(hex)
          .map((id) => unicode.get(id) ?? "�")
          .join(""),
      width: (hex, size) =>
        (ids(hex).reduce((sum, id) => sum + (widths.get(id) ?? fallback), 0) /
          1000) *
        size,
    };
  }
  throw new Error(`unexpected font subtype ${subtype}`);
}

async function drawnRuns(bytes: Uint8Array): Promise<DrawnRun[]> {
  const doc = await PDFDocument.load(bytes);
  const scratch = await PDFDocument.create();
  const runs: DrawnRun[] = [];
  for (const [index, page] of doc.getPages().entries()) {
    const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const measures = new Map<string, FontMeasure>();
    for (const [name, ref] of fonts.entries()) {
      const dict = doc.context.lookup(ref as PDFRef, PDFDict);
      measures.set(name.asString(), await fontMeasure(doc, dict, scratch));
    }
    let font: FontMeasure | undefined;
    let size = 0;
    let x = NaN;
    let y = NaN;
    if (process.env.DEBUG_RUNS)
      console.log(JSON.stringify(contentOf(doc, index).slice(0, 400)));
    const ops = contentOf(doc, index).matchAll(
      /(\/[^\s/]+)\s+([\d.]+)\s+Tf|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9A-Fa-f]*)>\s*Tj|\[[^\]]*\]\s*TJ|\([^)]*\)\s*Tj/g,
    );
    for (const op of ops) {
      if (op[1]) {
        font = measures.get(op[1]);
        size = Number(op[2]);
        if (!font) throw new Error(`no resource for ${op[1]}`);
      } else if (op[3] !== undefined) {
        x = Number(op[3]);
        y = Number(op[4]);
      } else if (op[5] !== undefined) {
        runs.push({
          page: index,
          pageWidth: page.getMediaBox().width,
          text: font!.decode(op[5]),
          x,
          y,
          size,
          width: font!.width(op[5], size),
        });
      } else {
        // A shape this reader does not measure would be a run it silently
        // skipped — the one outcome a bounds check cannot afford.
        throw new Error(`unmeasured text operator: ${op[0].slice(0, 40)}`);
      }
    }
  }
  return runs;
}

let corpusRender: Promise<{ file: string; runs: DrawnRun[] }[]> | null = null;

/**
 * Every repository Markdown file through the real converter, read back as
 * drawn runs. Rendered once and shared: two guards read it.
 */
function renderedCorpus(): Promise<{ file: string; runs: DrawnRun[] }[]> {
  corpusRender ??= (async () => {
    const restore = useNodeFontSource();
    try {
      const out: { file: string; runs: DrawnRun[] }[] = [];
      for (const file of MARKDOWN_FILES) {
        let bytes: Uint8Array;
        try {
          bytes = await markdownToPdf(readRepoMarkdown(file), { title: file });
        } catch (error) {
          // An honest refusal (emoji, a script no shipped face can draw) is
          // not a layout defect; anything else is.
          if (error instanceof PdfEngineError) continue;
          throw error;
        }
        out.push({ file, runs: await drawnRuns(bytes) });
      }
      // Bounded: if most files are refused, the guards below check nothing.
      expect(
        out.length,
        "too few repository files rendered to mean anything",
      ).toBeGreaterThanOrEqual(Math.ceil(MARKDOWN_FILES.length * 0.75));
      for (const { file, runs } of out) {
        expect(runs.length, `${file} drew nothing`).toBeGreaterThan(3);
      }
      return out;
    } finally {
      restore();
    }
  })();
  return corpusRender;
}

/** Table delimiter rows, setext underlines and `---` rules, as printed text. */
function leaksSyntax(text: string): boolean {
  return /\|\s*:?-{3,}|={3,}|(?:^|\s)-{3,}(?:\s|$)/.test(text);
}

const EPSILON = 0.01;

/**
 * Runs outside the text column. The column is the PAPER (each page's
 * MediaBox) less the margin, so the check is about what gets clipped, not
 * about a constant the module under test hands us.
 */
function outOfBounds(runs: DrawnRun[]): string[] {
  expect(
    Number.isFinite(MARGIN) && MARGIN > 0,
    "MARGIN is not a number; every bound below would be NaN and pass",
  ).toBe(true);
  return runs
    .filter(
      (run) =>
        run.x < MARGIN - EPSILON ||
        run.x + run.width > run.pageWidth - MARGIN + EPSILON,
    )
    .map(
      (run) =>
        `p${run.page + 1} x=${run.x.toFixed(1)} right=${(run.x + run.width).toFixed(1)} "${run.text.slice(0, 50)}"`,
    );
}

describe("the run reader (controls)", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = useNodeFontSource();
  });
  afterEach(() => restore());

  it.each([
    [
      "a built-in face",
      "A standard-font line that is wider than nothing at all",
    ],
    // Chinese rather than Bengali: its ToUnicode maps glyphs one to one, so
    // the decoded text can be compared exactly (Bengali reads back in visual
    // order, with pre-base vowel signs first).
    ["an embedded face", "机密文件 测试文档 页面"],
  ])("measures %s exactly as the font that drew it", async (_label, text) => {
    const doc = await PDFDocument.create();
    const font = await embedDrawingFont(doc, [text], "sans");
    doc.addPage([PAGE_WIDTH, 792]).drawText(text, {
      x: 450,
      y: 400,
      size: 13,
      font,
    });
    const runs = await drawnRuns(await doc.save());
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe(text);
    expect(runs[0]!.x).toBe(450);
    expect(runs[0]!.width).toBeCloseTo(font.widthOfTextAtSize(text, 13), 2);
    // And the predicate sees it: 450 + that width runs past the margin.
    expect(outOfBounds(runs)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 *  Finding: long words were drawn past the right edge of the paper.
 *
 *  The renderer's own wrapText only broke at whitespace, so a 112-char URL
 *  at 11pt ended at x=639.9 on a 612pt page and a JWT in a code block at
 *  780.2. Now every block wraps with text-to-pdf's wrapTextLine, which
 *  splits a word wider than the column.
 * ------------------------------------------------------------------ */

const LONG_URL = `https://github.com/pdf-xyz/pdf.xyz/blob/main/src/lib/pdf/${"segment-".repeat(8)}markdown-to-pdf.ts`;
const LONG_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo".repeat(4)}.sig`;

const EDGE_DOCUMENT = [
  `# ${LONG_TOKEN.slice(0, 90)}`,
  "",
  `See [the source](${LONG_URL}) for details.`,
  "",
  "```sh",
  `curl -H "Authorization: Bearer ${LONG_TOKEN}" ${LONG_URL}`,
  "```",
  "",
  `- ${LONG_URL}`,
  "  - nested child",
  "    - deeper still",
  `      - ${LONG_TOKEN}`,
  "",
  `> ${LONG_URL}`,
  "",
  "| Key | Value | Notes |",
  "| --- | ---: | :---: |",
  `| token | ${LONG_TOKEN} | ${LONG_URL} |`,
  "",
  `###### ${LONG_URL}`,
].join("\n");

describe("every drawn line stays inside the text column", () => {
  it("the edge document really does contain words wider than the column", async () => {
    // Without this, a document of short words would pass the bounds check
    // with any wrapper at all — including the one that caused the defect.
    const doc = await PDFDocument.create();
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const courier = await doc.embedFont(StandardFonts.Courier);
    const column = PAGE_WIDTH - MARGIN * 2;
    expect(column).toBeGreaterThan(400);
    expect(helvetica.widthOfTextAtSize(LONG_URL, 11)).toBeGreaterThan(column);
    expect(courier.widthOfTextAtSize(LONG_TOKEN, 9)).toBeGreaterThan(column);
  });

  it("holds for long URLs, tokens, headings, nested lists, quotes and tables", async () => {
    const title = `a-very-long-exported-file-name-${"x".repeat(160)}`;
    const runs = await drawnRuns(await markdownToPdf(EDGE_DOCUMENT, { title }));
    expect(runs.length).toBeGreaterThan(30);
    // The margin the check uses is the one the page actually has.
    expect(Math.min(...runs.map((run) => run.x))).toBeCloseTo(MARGIN, 2);
    expect(outOfBounds(runs)).toEqual([]);
    // Split, not dropped: every character of the long words is on the page.
    const onPage = runs
      .map((run) => run.text)
      .join("")
      .replace(/\s+/g, "");
    expect(onPage).toContain(LONG_URL);
    expect(onPage).toContain(LONG_TOKEN);
  });

  it("holds for every Markdown file in the repository", async () => {
    const corpus = await renderedCorpus();
    const problems = corpus.flatMap(({ file, runs }) =>
      outOfBounds(runs).map((problem) => `${file}: ${problem}`),
    );
    expect(problems).toEqual([]);
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 *  Finding: common Markdown structures printed as raw syntax.
 *
 *  Before: a GFM table became the paragraph "| Col A | Col B | |-------|...",
 *  nested bullets lost their nesting, "Title\n=====" printed its underline,
 *  "---" printed as "---", and indented code reflowed as prose.
 * ------------------------------------------------------------------ */

describe("block structure", () => {
  it("setext headings take their underline", () => {
    expect(
      parseMarkdownBlocks("Setext Title\n============\n\nSub\n---"),
    ).toEqual([
      { kind: "heading", depth: 1, text: "Setext Title" },
      { kind: "heading", depth: 2, text: "Sub" },
    ]);
  });

  it.each(["---", "***", "* * *", "___", " - - -"])(
    "%j is a thematic break, not text or an empty bullet",
    (line) => {
      expect(parseMarkdownBlocks(`above\n\n${line}\n\nbelow`)).toEqual([
        { kind: "paragraph", text: "above" },
        { kind: "rule" },
        { kind: "paragraph", text: "below" },
      ]);
    },
  );

  it("indented code keeps its lines and its underscores", () => {
    expect(
      parseMarkdownBlocks(
        "Intro:\n\n    my_var = 1\n      nested_call()\n\nafter",
      ),
    ).toEqual([
      { kind: "paragraph", text: "Intro:" },
      { kind: "code", text: "my_var = 1\n  nested_call()" },
      { kind: "paragraph", text: "after" },
    ]);
  });

  it("nested lists keep their depth", () => {
    const items = parseMarkdownBlocks(
      "- parent\n  - nested child\n    1. deep ordered\n- sibling\n continued lazily",
    );
    expect(items).toEqual([
      { kind: "list-item", ordered: false, depth: 0, text: "parent" },
      { kind: "list-item", ordered: false, depth: 1, text: "nested child" },
      {
        kind: "list-item",
        ordered: true,
        index: 1,
        depth: 2,
        text: "deep ordered",
      },
      {
        kind: "list-item",
        ordered: false,
        depth: 0,
        text: "sibling continued lazily",
      },
    ]);
  });

  it.each([
    "- item after table",
    "* starred item",
    "+ plus item",
    "1. ordered item",
    "2) ordered item",
    "---",
    "***",
    "> quoted",
    "## heading",
  ])("a table ends where %j starts a block (GFM 4.10)", (line) => {
    // Before: the row loop stopped only at a blank line, a quote, a heading or
    // a fence, so a list or a rule straight after a table became a row —
    // ["- item after table", ""] — and printed its own syntax in a cell.
    const alone = parseMarkdownBlocks(line);
    // Health check: the line really is a block of its own, not prose.
    expect(alone).toHaveLength(1);
    expect(alone[0]!.kind).not.toBe("paragraph");
    const blocks = parseMarkdownBlocks(
      `| a | b |\n|---|---|\n| 1 | 2 |\n${line}`,
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        align: ["left", "left"],
        header: ["a", "b"],
        rows: [["1", "2"]],
      },
      ...alone,
    ]);
  });

  it("a table still takes a plain line with no pipe as a row (GFM example 202)", () => {
    // The control for the break above: ending the table at ANY line would
    // pass it too.
    expect(parseMarkdownBlocks("| a | b |\n|---|---|\n| 1 | 2 |\nbar")).toEqual(
      [
        {
          kind: "table",
          align: ["left", "left"],
          header: ["a", "b"],
          rows: [
            ["1", "2"],
            ["bar", ""],
          ],
        },
      ],
    );
  });

  it("GFM tables become rows and cells, with escaped pipes kept", () => {
    expect(
      parseMarkdownBlocks(
        "| Col A | Col B |\n|:------|------:|\n| `a\\|b` | **2** |\n| short |",
      ),
    ).toEqual([
      {
        kind: "table",
        align: ["left", "right"],
        header: ["Col A", "Col B"],
        rows: [
          ["a|b", "2"],
          ["short", ""],
        ],
      },
    ]);
  });

  it("YAML front matter prints verbatim as code", () => {
    expect(parseMarkdownBlocks("---\ntitle: My_Doc\n---\n\n# Body")).toEqual([
      { kind: "code", text: "title: My_Doc" },
      { kind: "heading", depth: 1, text: "Body" },
    ]);
  });

  it("the drawn table is a grid: cells on one baseline, left to right, no delimiter row", async () => {
    const runs = await drawnRuns(
      await markdownToPdf(
        "| Name | Size | Owner |\n|---|:-:|--:|\n| alpha | 12 | ops_team |",
      ),
    );
    const texts = runs.map((run) => run.text);
    for (const cell of ["Name", "Size", "Owner", "alpha", "12", "ops_team"]) {
      expect(texts).toContain(cell);
    }
    const at = (text: string) => runs.find((run) => run.text === text)!;
    expect(at("Size").y).toBe(at("Name").y);
    expect(at("alpha").y).toBe(at("12").y);
    expect(at("alpha").y).toBeLessThan(at("Name").y);
    expect(at("Name").x).toBeLessThan(at("Size").x);
    expect(at("Size").x).toBeLessThan(at("Owner").x);
    expect(texts.join(" ")).not.toMatch(/\||---/);
  });

  it("nested items are drawn further right than their parents", async () => {
    const runs = await drawnRuns(
      await markdownToPdf("- parent\n  - child\n    - grandchild"),
    );
    const x = (text: string) => runs.find((run) => run.text === text)!.x;
    expect(x("child")).toBeGreaterThan(x("parent"));
    expect(x("grandchild")).toBeGreaterThan(x("child"));
  });

  it.each([
    ["| Col A | Col B | |-------|-------| | 1 | 2 |", true],
    ["Setext Title ============", true],
    ["---", true],
    ["above --- below", true],
    ["Name", false],
    ["a — b -- c", false],
    ["x = y", false],
  ])("the syntax-leak predicate reads %j as %s", (text, leaks) => {
    // Its positive controls are the exact strings the old parser printed.
    expect(leaksSyntax(text)).toBe(leaks);
  });

  it("no repository Markdown file leaves table or setext syntax on the page", async () => {
    const tables = MARKDOWN_FILES.flatMap((file) =>
      parseMarkdownBlocks(readRepoMarkdown(file)).filter(
        (block: MarkdownBlock) => block.kind === "table",
      ),
    ).length;
    expect(tables, "the corpus has no tables left to check").toBeGreaterThan(3);
    const leaks: string[] = [];
    for (const { file, runs } of await renderedCorpus()) {
      // Code blocks (9pt mono) are verbatim by design; this reads the rest.
      for (const run of runs.filter((r) => r.size !== 9)) {
        if (leaksSyntax(run.text)) {
          leaks.push(`${file}: "${run.text.slice(0, 60)}"`);
        }
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it("a table in a script only its cells use still gets a face that can draw it", async () => {
    // Table cells are part of the font corpus. Leave them out and the chooser
    // sees an all-ASCII document, picks Helvetica, and the Bengali cell
    // cannot be encoded at all.
    const restore = useNodeFontSource();
    try {
      const out = await markdownToPdf(
        "# Report\n\n| Name | Value |\n|---|---|\n| গোপনীয় | নথি |",
      );
      const proof = await proveGlyphs(out);
      expect(proof.embeddedFonts).toBe(1);
      expect(proof.notdefIds).toEqual([]);
      expect(proof.emptyOutlineIds).toEqual([]);
    } finally {
      restore();
    }
  }, 30_000);
});
