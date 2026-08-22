// @vitest-environment node
/**
 * Drift guard between what a tool page PROMISES a user will get and what the engine
 * actually writes.
 *
 * `Tool.outputs` is user-facing: the tool page renders it as "Out: PDF" and it is
 * baked into the OpenGraph card. It was written by hand, next to the marketing copy,
 * and never checked against the code that produces the bytes — so it drifted:
 *
 *   - `request-signatures` promised `["PDF"]` and delivered a ZIP.
 *   - `ai-extract` promised `["JSON", "CSV"]` and has never written a single CSV.
 *   - `summarize`, `translate` and `chat-with-pdf` named their contents but not the
 *     ZIP they arrive in, so a user expecting a .txt got an archive.
 *
 * This reads the engine sources as text, the same technique
 * `src/deploy/ocr-languages.test.ts` uses against the Dockerfile: the check has to
 * fail in CI, before a page that misstates the deliverable ships.
 *
 * The map below is explicit rather than discovered, and that is deliberate. Several
 * engines call `zip.file(...)` without producing a ZIP *deliverable* — `docx`, `xlsx`
 * and `pptx` are themselves ZIP containers, so `pdf-office-export` builds one to emit
 * a Word document. Scanning for `zip.file` alone would demand those tools advertise
 * "ZIP", which would be exactly the kind of confident, wrong claim this file exists to
 * prevent. Only tools whose artifact really is a multi-file bundle belong here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolBySlug, tools } from "./index";
import { modeUploadsFiles } from "./processing-split";

/** Tools whose downloadable artifact is a ZIP bundle, and the engine that writes it. */
const BUNDLE_TOOLS: readonly { slug: string; engine: string }[] = [
  { slug: "summarize-pdf", engine: "src/lib/workers/summarize/engine.ts" },
  { slug: "translate-pdf", engine: "src/lib/workers/translate/engine.ts" },
  { slug: "chat-with-pdf", engine: "src/lib/workers/chat-with-pdf/engine.ts" },
  { slug: "ai-extract", engine: "src/lib/workers/ai-extract/engine.ts" },
  {
    slug: "request-signatures",
    engine: "src/lib/workers/request-signatures/engine.ts",
  },
  { slug: "extract-tables", engine: "src/lib/workers/table-extract/engine.ts" },
];

/**
 * The file extensions an engine writes into its bundle, upper-cased to match the
 * catalogue's format tokens. Only top-level entries count: `xl/worksheets/sheet1.xml`
 * is OOXML plumbing inside a nested workbook, not something a user receives as XML.
 */
function bundledFormats(engineFile: string): Set<string> {
  const source = readFileSync(path.join(process.cwd(), engineFile), "utf8");
  const formats = new Set<string>();
  for (const match of source.matchAll(/zip\.file\(\s*[`"']([^`"']+)[`"']/g)) {
    const name = match[1]!;
    if (name.includes("/")) continue;
    const ext = name.split(".").pop();
    if (ext && ext !== name) formats.add(ext.toUpperCase());
  }
  return formats;
}

describe("a tool's advertised outputs match what its engine writes", () => {
  it.each(BUNDLE_TOOLS)(
    "$slug advertises the ZIP it actually delivers",
    ({ slug }) => {
      const tool = getToolBySlug(slug);
      expect(tool, `${slug} is missing from the catalogue`).toBeDefined();
      // The artifact a user downloads is an archive. Naming only its contents reads as
      // a promise of a bare .txt or .pdf, which is what request-signatures did.
      expect(tool!.outputs).toContain("ZIP");
    },
  );

  it.each(BUNDLE_TOOLS)(
    "$slug promises no format it never writes",
    ({ slug, engine }) => {
      const tool = getToolBySlug(slug)!;
      const written = bundledFormats(engine);
      const phantom = tool.outputs.filter(
        (format) => format !== "ZIP" && !written.has(format),
      );
      // `ai-extract` sat here for the life of the product advertising CSV export while
      // its engine wrote extraction.json and extraction.md and nothing else.
      expect(
        phantom,
        `${slug} advertises ${phantom.join(", ")}, but ${engine} writes only ${[...written].join(", ")}`,
      ).toEqual([]);
    },
  );

  it("covers every WORKER-backed catalogue tool that claims to deliver a ZIP", () => {
    // Keeps BUNDLE_TOOLS from going stale in the other direction: a new worker bundle
    // tool added to the catalogue must be listed here, or it gets neither check.
    //
    // In-browser tools are excluded, not overlooked. split-pdf, extract-images,
    // pdf-to-jpg and pdf-to-png all deliver a ZIP too, but they assemble it in the
    // page — there is no engine file to read, so both checks above would be vacuous
    // for them. (All four already declare ZIP correctly; the drift was only ever in
    // the worker tools, whose output lived a repo away from its description.)
    const claimed = tools
      .filter(
        (t) => modeUploadsFiles(t.processing) && t.outputs.includes("ZIP"),
      )
      .map((t) => t.slug);
    const covered = new Set(BUNDLE_TOOLS.map((t) => t.slug));
    expect(claimed.filter((slug) => !covered.has(slug))).toEqual([]);
  });
});
