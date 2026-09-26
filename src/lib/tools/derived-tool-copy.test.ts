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
 *     through it and must survive;
 *   - every tool that reads only embedded text says, before a file is picked,
 *     that scans need OCR — and may not promise "any PDF". That set is
 *     DISCOVERED: the runners that call `extractPdfText(`, reached through the
 *     page's own dispatch, plus the worker engine that refuses a text-less PDF
 *     as `no_text` (proven by running it, not by reading it).
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
import type { ExtractedPdfText } from "@/lib/pdf/text";

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

function extracted(pages: string[], hasText = true) {
  const text = pages.join("\n\f");
  return {
    pageCount: pages.length,
    pages: pages.map((t, i) => ({ pageNumber: i + 1, text: t })),
    text,
    characterCount: hasText ? text.length : 0,
    hasText,
  } as unknown as ExtractedPdfText;
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

  it("every list marker the fact names survives as a list item", () => {
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
      expect(out, `"${marker}" is named but not kept`).toMatch(
        new RegExp(`^${marker.replace(/[.*+]/g, "\\$&")} item$`, "m"),
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
  async function officeRefusesTextless(): Promise<boolean> {
    const run = await runPdfOfficeExport(
      PDF_OFFICE_EXPORT_TOOLS[0],
      new Uint8Array([1]),
      { extract: async () => extracted([""], false) },
    );
    return !run.ok && run.kind === "no_text";
  }

  function embeddedTextOnly(): string[] {
    const client = supportedToolSlugs.filter((slug) => {
      const file = runnerFileForSlug(slug);
      return file
        ? withoutComments(read(file)).includes("extractPdfText(")
        : false;
    });
    return [...client, ...PDF_OFFICE_EXPORT_TOOLS];
  }

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
