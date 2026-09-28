// @vitest-environment node
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
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import {
  EMBEDDED_TEXT_ONLY,
  howToSteps,
  toolFacts,
  toolFaq,
} from "./tool-facts";
import { withoutComments } from "./copy-surface";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { GRAYSCALE_DPI_PRESETS } from "@/lib/pdf/grayscale";
import { extractedTextToMarkdown } from "@/lib/pdf/pdf-to-markdown";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  runPdfOfficeExport,
} from "@/lib/workers/pdf-office-export/engine";
import type { ExtractedPdfLines } from "@/lib/pdf/text";

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
  const from = new RegExp(
    `import\\s+\\{[^}]*\\b${component}\\b[^}]*\\}\\s+from\\s+"\\./([^"]+)"`,
  ).exec(dispatch)?.[1];
  return from ? `${RUNNER_DIR}/${from}.tsx` : undefined;
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
      const out = md([`Intro text\n${marker} item\nafter`]);
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
      expect(md(["Intro text\nitem\nafter"])).not.toMatch(
        /^(?:[-*+]|\d+[.)]) /m,
      );
    }
  });

  it("table rows arrive as plain text — no Markdown table is written", () => {
    expect(facts).toMatch(/table rows come through as plain text/i);
    const out = md(["Name    Qty\nPear    4"]);
    expect(out).toContain("Pear");
    expect(out).not.toMatch(/^\|/m);
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
  async function officeRefusesTextless(): Promise<boolean> {
    let asked = 0;
    for (const tool of PDF_OFFICE_EXPORT_TOOLS) {
      const run = await runPdfOfficeExport(tool, new Uint8Array([1]), {
        extract: async () => extracted([""], false),
        extractFlow: async () => ({
          pageCount: 1,
          pages: [{ pageNumber: 1, paragraphs: [] }],
        }),
      });
      if (run.ok || run.kind !== "no_text") return false;
      asked += 1;
    }
    return asked >= 3;
  }

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
  function readsEmbeddedText(source: string): boolean {
    const IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/pdf\/text["'];?/g;
    const locals = [...source.matchAll(IMPORT)].flatMap((m) =>
      m[1]!
        .split(",")
        .map((spec) => spec.trim().replace(/^type\s+/, ""))
        .filter(Boolean)
        .map((spec) => {
          const [imported, local] = spec.split(/\s+as\s+/);
          return { imported: imported!, local: (local ?? imported)! };
        })
        .filter(({ imported }) => TEXT_EXTRACTORS.includes(imported))
        .map(({ local }) => local),
    );
    const body = source.replace(IMPORT, "");
    return locals.some((local) => new RegExp(`\\b${local}\\b`).test(body));
  }

  function embeddedTextOnly(): string[] {
    const client = supportedToolSlugs.filter((slug) => {
      const file = runnerFileForSlug(slug);
      return file ? readsEmbeddedText(withoutComments(read(file))) : false;
    });
    return [...client, ...PDF_OFFICE_EXPORT_TOOLS];
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
  });

  it("reads the text module's extractors, both of them (health)", () => {
    expect(TEXT_EXTRACTORS).toEqual(
      expect.arrayContaining(["extractPdfText", "extractPdfLines"]),
    );
    expect(TEXT_EXTRACTORS.length).toBeLessThanOrEqual(6);
  });

  it("the set is discovered and plausibly sized", async () => {
    const set = embeddedTextOnly();
    // pdf-to-text, pdf-to-markdown, compare-pdf + the three office exports.
    expect(set.length).toBeGreaterThanOrEqual(5);
    expect(set.length).toBeLessThanOrEqual(10);
    // The office half is in the set because the engine REFUSES a text-less
    // PDF — shown by running it.
    expect(await officeRefusesTextless()).toBe(true);
  });

  it("the typed EMBEDDED_TEXT_ONLY set in tool-facts is exactly the discovered one", () => {
    // tool-facts types its set to stay light; this is the check that keeps
    // the typed list from drifting, in both directions.
    expect([...EMBEDDED_TEXT_ONLY].sort()).toEqual(
      [...new Set(embeddedTextOnly())].sort(),
    );
  });

  it("each one names OCR on its page, before a file is picked", () => {
    const silent = embeddedTextOnly().filter((slug) => {
      const tool = getToolBySlug(slug)!;
      const served = [
        tool.description,
        ...toolFacts(slug).map((f) => f.value),
        ...toolFaq(tool).map((f) => f.answer),
      ].join(" ");
      return !/\bOCR\b/.test(served);
    });
    expect(
      silent,
      `these read embedded text only and never say scans need OCR: ${silent.join(", ")}`,
    ).toEqual([]);
  });

  it("none promises text from any PDF", () => {
    const ANY_PDF = /\b(?:any|every|all)\s+PDFs?\b/i;
    const offenders = embeddedTextOnly().flatMap((slug) => {
      const tool = getToolBySlug(slug)!;
      return [tool.tagline, tool.description]
        .filter((t) => ANY_PDF.test(t))
        .map((t) => `${slug}: "${t}"`);
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
    // Positive control: the tagline pdf-to-text shipped.
    expect(ANY_PDF.test("Grab plain text from any PDF.")).toBe(true);
  });
});
