// @vitest-environment node
// @native-canvas
/**
 * The copy written to fill three thin tool pages, pinned to the behaviour it
 * describes.
 *
 * On 2026-09-27 grayscale-pdf, pdf-to-markdown and pdf-to-text each shipped a
 * placeholder HowTo ("Choose your options." for tools with none, or no options
 * at all worth the name), no facts, and three generic FAQ entries — and
 * pdf-to-text's tagline promised text from "any PDF", which a scanned PDF
 * disproves on the first try. The fix added facts, steps and answers. Each is a
 * new falsifiable claim ("surfacing a number is a new claim"), so each is tied
 * here to the thing that makes it true:
 *
 *   - grayscale's steps and facts name the SAME presets the runner renders,
 *     read from `GRAYSCALE_DPI_PRESETS`, never typed;
 *   - pdf-to-markdown's facts are checked against `extractedTextToMarkdown`,
 *     the function the runner calls — every list marker the fact names is fed
 *     through it and must stay a list item;
 *   - every tool that reads only embedded text says, before a file is picked,
 *     that scans need OCR — and may not promise "any PDF". That set is
 *     DISCOVERED: the runners that import one of the extractors
 *     `@/lib/pdf/text` exports (read off that module, not typed here) and use
 *     it, reached through the page's own dispatch, plus the worker engine that
 *     refuses a text-less PDF as `no_text` (proven by running it, not by
 *     reading it).
 *
 * CHANGED 2026-09-27 where this file met the pdf-to-markdown fix merged beside
 * it (history kept). That fix moved the runner from `extractPdfText` to
 * `extractPdfLines` — the same pdfjs text, plus each line's geometry, without
 * which every real page collapsed to one paragraph — and so:
 *
 *   - the discovery, which searched for the literal `extractPdfText(`, lost
 *     pdf-to-markdown from the set while the tool still reads embedded text
 *     only; the tool-facts list then disagreed with it, and nothing else would
 *     have noticed a tool leaving the OCR check. The same day compare-pdf's
 *     runner (the compare fix, merged next) began taking its extractor as a
 *     default parameter, `extract = extractPdfText`, and calling `extract(`,
 *     and the call-shaped search lost compare-pdf too — so the discovery now
 *     follows the IMPORT and requires a use, not a spelling of the call;
 *   - the facts were checked by feeding the converter text with NO geometry,
 *     the fallback that fix names as the defect, instead of what the runner
 *     hands it now; and a bullet was required to keep its own character,
 *     where the fact says it "stays a list item" and the converter writes every
 *     unordered marker as `- `.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { EMBEDDED_TEXT_ONLY, howToSteps, toolFacts } from "./tool-facts";
import { withoutComments } from "./copy-surface";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { GRAYSCALE_DPI_PRESETS } from "@/lib/pdf/grayscale";
import { extractedTextToMarkdown } from "@/lib/pdf/pdf-to-markdown";
import { tablesOfPage } from "@/lib/pdf/pdf-to-markdown-tables";

import {
  PDF_OFFICE_EXPORT_TOOLS,
  runPdfOfficeExport,
} from "@/lib/workers/pdf-office-export/engine";
import { scanPdfPages } from "@/lib/workers/pdf-office-export/page-scan";
import { scannedPdf } from "@/tests/pptx-fidelity-fixtures";
import type { ExtractedPdfLines } from "@/lib/pdf/text";
import { runnerModuleOf } from "@/tests/tool-panel-modules";

const RUNNER_DIR = "src/components/tools/runner";
const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

function runnerFileForSlug(slug: string): string | undefined {
  const kind = getRunnerKind(slug);
  if (!kind) return undefined;
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const component = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch)?.[1];
  if (!component) return undefined;
  // Through the dispatcher's own bindings — a static import, or the
  // `next/dynamic` loader every runner has been since 2026-10-09 — to the
  // module that defines it. (An import regex here went blind to the loaders.)
  return runnerModuleOf(component);
}

describe("grayscale-pdf: steps and facts carry the presets the runner renders", () => {
  const slugs = supportedToolSlugs.filter(
    (s) => getRunnerKind(s) === "grayscale",
  );

  it("discovers the grayscale tool, and its runner renders from the presets", () => {
    expect(slugs.length).toBe(1);
    const runner = withoutComments(read(runnerFileForSlug(slugs[0]!)!));
    expect(runner).toContain("GRAYSCALE_DPI_PRESETS.map(");
  });

  it("every preset — label and resolution — is named in the steps and the facts", () => {
    const tool = getToolBySlug(slugs[0]!)!;
    const steps = howToSteps(tool).join(" ");
    const facts = toolFacts(tool.slug)
      .map((f) => f.value)
      .join(" ");
    expect(GRAYSCALE_DPI_PRESETS.length).toBeGreaterThan(1);
    for (const preset of GRAYSCALE_DPI_PRESETS) {
      const named = `${preset.label} (${preset.dpi} DPI)`;
      expect(steps, `steps do not name ${named}`).toContain(named);
      expect(facts, `facts do not name ${named}`).toContain(named);
    }
  });
});

/* ------------------------------------------------------------------ */

/**
 * What `extractPdfLines` hands the runner: each page's text AND its visual
 * lines with their geometry — one column of body text at a steady leading, so
 * the layout is the plain case and the markers are what is under test.
 */
function extracted(pages: string[], hasText = true): ExtractedPdfLines {
  const text = pages.join("\n\n");
  return {
    pageCount: pages.length,
    pages: pages.map((t, i) => ({
      pageNumber: i + 1,
      text: t,
      characterCount: t.length,
      lines: t
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line, n) => ({
          text: line,
          x: 72,
          y: 720 - n * 14,
          size: 11,
          fontName: null,
        })),
    })),
    text,
    characterCount: hasText ? text.length : 0,
    hasText,
  };
}

describe("pdf-to-markdown: the facts describe what the converter emits", () => {
  const tool = getToolBySlug(
    supportedToolSlugs.find((s) => getRunnerKind(s) === "pdf-to-markdown")!,
  )!;
  const facts = toolFacts(tool.slug)
    .map((f) => f.value)
    .join(" ");
  const md = (pages: string[]) =>
    extractedTextToMarkdown(extracted(pages), { sourceName: "report.pdf" })
      .markdown;

  it("has facts to check (health)", () => {
    expect(facts.length).toBeGreaterThan(40);
  });

  it("the file name becomes the # title", () => {
    expect(facts).toMatch(/file name[^.]*# title/i);
    expect(md(["Hello"]).split("\n")[0]).toBe("# report");
  });

  it("## Page N headings appear exactly when the PDF has more than one page", () => {
    expect(facts).toMatch(/more than one page[^.]*## Page N/i);
    expect(md(["One", "Two"])).toContain("## Page 2");
    expect(md(["Only"])).not.toContain("## Page");
  });

  it("wrapped lines are joined into paragraphs", () => {
    expect(facts).toMatch(/joined into paragraphs/i);
    expect(md(["line one\nline two"])).toContain("line one line two");
  });

  it("every list marker the fact names stays a list item", () => {
    const named = /list marker \(([^)]+)\)/i.exec(facts)?.[1];
    expect(named, "the fact no longer names its list markers").toBeDefined();
    const markers = named!
      .split(/,|\bor\b/)
      .map((m) => m.trim())
      .filter(Boolean)
      .map((m) => (/number/i.test(m) ? "1." : m));
    // Health: the parse found the markers, not one blob.
    expect(markers.length).toBeGreaterThanOrEqual(4);
    for (const marker of markers) {
      // The intro is a finished sentence. Until audit #8 (2026-11-06) it was
      // "Intro text" with no stop, and any marker after it opened an item;
      // now a line that wraps a running sentence stays in its paragraph, and
      // the fact names that exception (checked below).
      const out = md([`Intro text.\n${marker} item\nafter`]);
      // A Markdown list item: a number keeps its number, and an unordered
      // marker may come out as any unordered marker (the converter writes
      // `- `). Until 2026-09-27 this demanded the marker's own character.
      const item = /^\d/.test(marker)
        ? new RegExp(`^${marker.replace(/[.)]/g, "\\$&")} item$`, "m")
        : /^[-*+] item$/m;
      expect(out, `"${marker}" is named but does not stay a list item`).toMatch(
        item,
      );
      // CONTROL: the same line without its marker is not a list item, so the
      // match above is the marker's doing.
      expect(md(["Intro text.\nitem\nafter"])).not.toMatch(
        /^(?:[-*+]|\d+[.)]) /m,
      );
    }
  });

  it("a line that only wraps a running sentence stays in its paragraph, as the fact says", () => {
    expect(facts).toMatch(
      /unless it only wraps a sentence that is still running/i,
    );
    const wrapped = md([
      "Sales were flat for the whole decade until\n2023. Revenue grew after that",
    ]);
    expect(wrapped).toContain("until 2023. Revenue grew after that");
    // CONTROL: after a finished sentence the same line is a list item.
    expect(
      md(["Sales were flat for the whole decade then.\n2023. Revenue grew"]),
    ).toMatch(/^2023\. Revenue grew$/m);
  });

  // INVERTED 2026-11-08 (audit pdf-to-markdown#4). This was "table rows
  // arrive as plain text — no Markdown table is written", pinned to the fact
  // "table rows come through as plain text". The reader now runs Extract
  // Tables' detector over each page, so the fact and this test say the
  // opposite; the detector runs here on items laid out as pdf.js reports them.
  it("a table whose cells line up becomes a Markdown table, as the fact says", () => {
    expect(facts).toMatch(
      /table whose cells line up in columns becomes a Markdown table/i,
    );
    const rows = [
      ["Name", "Qty"],
      ["Pear", "4"],
      ["Plum", "12"],
    ];
    const items = rows.flatMap(([name, qty], r) => [
      {
        str: name!,
        transform: [11, 0, 0, 11, 72, 720 - r * 14],
        width: name!.length * 6,
        height: 11,
      },
      {
        str: qty!,
        transform: [11, 0, 0, 11, 250, 720 - r * 14],
        width: qty!.length * 6,
        height: 11,
      },
    ]);
    const page = extracted([rows.map((r) => r.join(" ")).join("\n")]);
    const out = extractedTextToMarkdown(
      {
        ...page,
        pages: page.pages.map((p) => ({
          ...p,
          tables: tablesOfPage(items, 1),
        })),
      },
      { sourceName: "report.pdf" },
    ).markdown;
    expect(out).toContain(
      "| Name | Qty |\n| --- | --- |\n| Pear | 4 |\n| Plum | 12 |",
    );
    // CONTROL: the same lines with no table detected stay plain text.
    expect(md([rows.map((r) => r.join(" ")).join("\n")])).not.toMatch(/^\|/m);
  });

  it("a PDF with no selectable text produces nothing", () => {
    const result = extractedTextToMarkdown(extracted([""], false));
    expect(result.hasMarkdown).toBe(false);
    expect(result.markdown).toBe("");
  });
});

/* ------------------------------------------------------------------ */

describe("tools that read only embedded text say scans need OCR, and never promise any PDF", () => {
  /**
   * EVERY office export, each wired with both extractors as production wires
   * them. This asked only the first tool with `extract` alone until the wave-1
   * L03 merge (2026-09-28): PDF to Word now reads `extractFlow`, and with only
   * `extract` it answers `unsupported` before reading anything — so the one
   * tool asked stopped proving the property for all three.
   */
  /**
   * The office exports that REFUSE a text-less PDF, measured by running each
   * on one. INVERTED 2026-10-10: this was `officeRefusesTextless`, which
   * required all three to refuse, and the set took all three on that proof.
   * PDF to PowerPoint now keeps a scan's pages as pictures, so a scan does
   * NOT give it nothing: it leaves the set by the same measurement that put
   * it there, and the set's scanned-PDF answer (`scannedFallbackEntry`,
   * "Only once the scan has a text layer") would now be false on its page.
   * Each tool gets the input that asks it the question: Word and Excel their
   * stand-in extraction of nothing, PowerPoint a real scanned page through
   * its real page reader.
   */
  let officeRefusers: string[] = [];
  let officeAsked = 0;
  beforeAll(async () => {
    const scan = await scannedPdf();
    officeRefusers = [];
    officeAsked = 0;
    for (const tool of PDF_OFFICE_EXPORT_TOOLS) {
      const run = await runPdfOfficeExport(
        tool,
        tool === "pdf-to-powerpoint" ? scan.pdf : new Uint8Array([1]),
        {
          extract: async () => extracted([""], false),
          extractFlow: async () => ({
            pageCount: 1,
            pages: [{ pageNumber: 1, paragraphs: [] }],
          }),
          scanPages: scanPdfPages,
        },
      );
      officeAsked += 1;
      if (!run.ok && run.kind === "no_text") officeRefusers.push(tool);
    }
  });

  /**
   * The extractors `@/lib/pdf/text` exports, read off the module — every one
   * reads pdfjs's text layer and none performs OCR (the module says so, and
   * both share one page reader). Discovered rather than typed: this used to be
   * the literal `extractPdfText(`, and a runner that moved to a sibling
   * extractor silently left the set.
   */
  const TEXT_EXTRACTORS = [
    ...withoutComments(read("src/lib/pdf/text.ts")).matchAll(
      /export\s+async\s+function\s+(extract\w+)\s*\(/g,
    ),
  ].map((m) => m[1]!);

  /**
   * Does `source` import one of {@link TEXT_EXTRACTORS} from `@/lib/pdf/text`
   * and USE it — called, passed, or bound as a default? An import alone is
   * not a use (loading is not running), so the local name has to appear
   * again outside the import statement.
   */
  /** The names `source` imports from `from` and uses outside the import. */
  function usedImports(source: string, from: string): string[] {
    const quoted = from.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const IMPORT = new RegExp(
      `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${quoted}["'];?`,
      "g",
    );
    const specs = [...source.matchAll(IMPORT)].flatMap((m) =>
      m[1]!
        .split(",")
        .map((spec) => spec.trim())
        .filter((spec) => spec && !spec.startsWith("type "))
        .map((spec) => {
          const [imported, local] = spec.split(/\s+as\s+/);
          return { imported: imported!, local: (local ?? imported)! };
        }),
    );
    const body = source.replace(IMPORT, "");
    return specs
      .filter(({ local }) => new RegExp(`\\b${local}\\b`).test(body))
      .map(({ imported }) => imported);
  }

  /**
   * Does `source` USE one of {@link TEXT_EXTRACTORS} from `@/lib/pdf/text`,
   * directly or through one `@/lib/pdf/*` module that uses one from `./text`?
   * The hop is followed because PDF to Markdown's runner reads through its
   * own reader (`pdf-to-markdown-read`, 2026-11-08, for links): a detector
   * that read the runner's imports alone lost the tool from the set.
   */
  function readsEmbeddedText(source: string, hops = 1): boolean {
    if (
      usedImports(source, "@/lib/pdf/text").some((name) =>
        TEXT_EXTRACTORS.includes(name),
      )
    ) {
      return true;
    }
    if (hops === 0) return false;
    return [...source.matchAll(/from\s*["']@\/lib\/pdf\/([\w-]+)["']/g)]
      .map((m) => m[1]!)
      .filter((name) => name !== "text")
      .filter((name) => usedImports(source, `@/lib/pdf/${name}`).length > 0)
      .some((name) => {
        const file = `src/lib/pdf/${name}.ts`;
        let hopSource: string;
        try {
          hopSource = withoutComments(read(file));
        } catch {
          return false;
        }
        return readsEmbeddedText(
          hopSource.replace(
            /from\s*["']\.\/text["']/g,
            'from "@/lib/pdf/text"',
          ),
          hops - 1,
        );
      });
  }

  function embeddedTextOnly(): string[] {
    const client = supportedToolSlugs.filter((slug) => {
      const file = runnerFileForSlug(slug);
      return file ? readsEmbeddedText(withoutComments(read(file))) : false;
    });
    return [...client, ...officeRefusers];
  }

  it("the use detector follows the import, not the spelling of a call", () => {
    const from = 'from "@/lib/pdf/text";';
    // Positive: a call, a default parameter, a renamed import.
    expect(
      readsEmbeddedText(
        `import { extractPdfText } ${from} f(extractPdfText(b));`,
      ),
    ).toBe(true);
    expect(
      readsEmbeddedText(
        `import { extractPdfText } ${from} function g(extract = extractPdfText) { return extract(b); }`,
      ),
    ).toBe(true);
    expect(
      readsEmbeddedText(
        `import { extractPdfLines as lines } ${from} lines(b);`,
      ),
    ).toBe(true);
    // Negative: imported and never used; a type only; another module's name.
    expect(readsEmbeddedText(`import { extractPdfText } ${from}`)).toBe(false);
    expect(
      readsEmbeddedText(
        `import { type ExtractedPdfText } ${from} let x: ExtractedPdfText;`,
      ),
    ).toBe(false);
    expect(
      readsEmbeddedText(
        'import { extractPdfText } from "./elsewhere"; extractPdfText(b);',
      ),
    ).toBe(false);
    // One hop through a pdf module that reads `./text` — and only when the
    // hop is used: PDF to Markdown's reader, imported and called, or not.
    const reader = 'from "@/lib/pdf/pdf-to-markdown-read";';
    expect(
      readsEmbeddedText(`import { pdfToMarkdown } ${reader} pdfToMarkdown(b);`),
    ).toBe(true);
    expect(readsEmbeddedText(`import { pdfToMarkdown } ${reader}`)).toBe(false);
    // A pdf module that does not read text is not a hop.
    expect(
      readsEmbeddedText(
        'import { markdownOutputName } from "@/lib/pdf/pdf-to-markdown"; markdownOutputName(n);',
      ),
    ).toBe(false);
  });

  it("reads the text module's extractors, both of them (health)", () => {
    expect(TEXT_EXTRACTORS).toEqual(
      expect.arrayContaining(["extractPdfText", "extractPdfLines"]),
    );
    expect(TEXT_EXTRACTORS.length).toBeLessThanOrEqual(6);
  });

  it("the set is discovered and plausibly sized", async () => {
    const set = embeddedTextOnly();
    // pdf-to-text, pdf-to-markdown, compare-pdf + the two office exports
    // that refuse a scan (three until 2026-10-10).
    expect(set.length).toBeGreaterThanOrEqual(5);
    expect(set.length).toBeLessThanOrEqual(10);
    // The office half is in the set because the engine REFUSES a text-less
    // PDF — shown by running it. Health: every office export was asked.
    expect(officeAsked).toBe(PDF_OFFICE_EXPORT_TOOLS.length);
    expect(officeRefusers).toEqual(["pdf-to-word", "pdf-to-excel"]);
  });

  it("the typed EMBEDDED_TEXT_ONLY set in tool-facts is exactly the discovered one", () => {
    // tool-facts types its set to stay light; this is the check that keeps
    // the typed list from drifting, in both directions.
    expect([...EMBEDDED_TEXT_ONLY].sort()).toEqual(
      [...new Set(embeddedTextOnly())].sort(),
    );
  });

  /**
   * What the tool page renders before a file is picked: the strings the page
   * component reads (`src/app/tools/[slug]/page.tsx` — tagline, the page-copy
   * accessors and the facts), not the catalogue's.
   *
   * CHANGED 2026-10-06 (history kept). The OCR check read `tool.description`,
   * `toolFacts` and `toolFaq`; since the authored content arrived the page
   * renders `pageIntro` in place of the description and `pageFaq` in place of
   * the derived FAQ, so the check could pass on a sentence no reader of the
   * page receives (house rule 5). A probe at the change found no tool that
   * was silent on its page, so this certifies the same set, through the copy
   * the page serves.
   */
  const servedBeforePick = (slug: string): string[] => {
    const tool = getToolBySlug(slug)!;
    return [
      tool.tagline,
      pageDescription(tool),
      ...pageIntro(tool),
      ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
      ...pageSteps(tool).map(stepText),
      ...toolFacts(slug).map((f) => f.value),
      ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
    ];
  };

  it("each one names OCR on its page, before a file is picked", () => {
    // Health: the served corpus is the page's, not an empty list.
    for (const slug of embeddedTextOnly())
      expect(servedBeforePick(slug).length, slug).toBeGreaterThan(8);
    const silent = embeddedTextOnly().filter((slug) => {
      const served = servedBeforePick(slug).join(" ");
      return !/\bOCR\b/.test(served);
    });
    expect(
      silent,
      `these read embedded text only and never say scans need OCR: ${silent.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The browser extractor puts a page's text in READING order: a title drawn
   * after its body, a header drawn last and a footer drawn first are moved
   * to where they read, and `text-reading-order.test.ts` runs every route a
   * consumer reads through — PDF to Text's text, PDF to Markdown's lines and
   * Markdown — over those pages. So a page of a tool that reads through it
   * may not say the text comes out in the order the file stores it.
   *
   * Three served sentences said so after it stopped being true (L01 made it
   * false for PDF to Text; the lines fix of 2026-10-06 for PDF to Markdown),
   * and nothing went red. They are the corpus: every one must be caught by a
   * pattern, and every pattern must catch one of them.
   */
  const STORED_ORDER = [
    /\border\b[^.]*\b(?:program|application|software)\b[^.]*\b(?:wrote|writes|made|stored)\b/i,
    /\b(?:follows?|in)\s+the\s+order\s+(?:stored|saved|written|kept)\s+in\s+the\s+(?:PDF|file)\b/i,
    /\bin\s+the\s+order\s+the\s+(?:PDF|file)\s+(?:stores|stored|keeps|writes|wrote)\b/i,
    /\bnot\s+(?:always\s+)?(?:be\s+)?(?:in\s+)?reading\s+order\b/i,
  ];
  const SHIPPED_STORED_ORDER = [
    "Text comes out in the order the program that made the PDF wrote it, which on multi-column pages and tables may not be reading order.",
    "Words are not rewritten; they follow the order stored in the PDF, which on two-column pages is not always reading order.",
    "Columns and table cells come out as plain text, split by spaces and line breaks, in the order the PDF stores them.",
  ];

  it("the stored-order patterns and the sentences that shipped catch each other (both directions)", () => {
    const uncaught = SHIPPED_STORED_ORDER.filter(
      (sentence) => !STORED_ORDER.some((pattern) => pattern.test(sentence)),
    );
    expect(uncaught).toEqual([]);
    const idle = STORED_ORDER.filter(
      (pattern) => !SHIPPED_STORED_ORDER.some((s) => pattern.test(s)),
    ).map(String);
    expect(idle).toEqual([]);
  });

  it("no page of a tool that reads through the browser extractor says the text comes out in stored order", () => {
    const browserReaders = supportedToolSlugs.filter((slug) => {
      const file = runnerFileForSlug(slug);
      return file ? readsEmbeddedText(withoutComments(read(file))) : false;
    });
    // Health: the discovery found the runners, and the two pages whose copy
    // this was written for are among them.
    expect(browserReaders).toEqual(
      expect.arrayContaining(["pdf-to-text", "pdf-to-markdown", "compare-pdf"]),
    );
    const offenders = browserReaders.flatMap((slug) => {
      const tool = getToolBySlug(slug)!;
      // What the page SERVES, through the accessors the page renders.
      const served = [
        pageDescription(tool),
        ...pageIntro(tool),
        ...pageSteps(tool).map(stepText),
        ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
      ];
      return served
        .flatMap((text) => text.split(/(?<=[.!?])\s+/))
        .filter((sentence) => STORED_ORDER.some((p) => p.test(sentence)))
        .map((sentence) => `${slug}: "${sentence}"`);
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("none promises text from any PDF", () => {
    // "PDF" as the OBJECT ("any PDF"), not as an adjective of the noun after
    // it: the served corpus (2026-10-06) says "highlighting a sentence in any
    // PDF viewer" and "Every PDF line becomes its own paragraph", neither of
    // which promises text from a document. The controls below hold both
    // directions.
    const ANY_PDF =
      /\b(?:any|every|all)\s+PDFs?\b(?!\s+(?:viewers?|readers?|apps?|editors?|software|lines?)\b)/i;
    // The catalogue's tagline and description (served on cards and in the
    // catalogue), and, since 2026-10-06, everything the tool page renders.
    const offenders = embeddedTextOnly().flatMap((slug) => {
      const tool = getToolBySlug(slug)!;
      return [tool.tagline, tool.description, ...servedBeforePick(slug)]
        .flatMap((t) => t.split(/(?<=[.!?])\s+/))
        .filter((t) => ANY_PDF.test(t))
        .map((t) => `${slug}: "${t}"`);
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
    // Positive control: the tagline pdf-to-text shipped.
    expect(ANY_PDF.test("Grab plain text from any PDF.")).toBe(true);
    // ...and the promise in other shapes stays caught, while the adjective
    // uses the served page carries pass.
    for (const promise of [
      "Works on all PDFs.",
      "Reads every PDF page.",
      "Any PDF file converts.",
    ])
      expect(ANY_PDF.test(promise), promise).toBe(true);
    for (const adjective of [
      "Try highlighting a sentence in any PDF viewer.",
      "Every PDF line becomes its own paragraph, so a wrapped sentence splits where the page wrapped it.",
    ])
      expect(ANY_PDF.test(adjective), adjective).toBe(false);
  });
});
