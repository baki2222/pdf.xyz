import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Which single-PDF runners may read their page board with pdfjs.
 *
 * `reader="pdfjs"` lets an owner-only ("permissions") encrypted file through
 * the upload gate — correct for a tool whose pipeline is pdfjs, and a trap for
 * one that then hands the bytes to pdf-lib: the user would configure a job
 * and be refused only at Run. So the rule is a RELATIONSHIP, derived from what
 * each runner does with the bytes, not a list of tool names:
 *
 *   a runner passes reader="pdfjs"  <=>  every function it hands `pdf.bytes`
 *   to opens the document with pdfjs and never with pdf-lib.
 *
 * Both directions matter. The right-to-left half is what found the three
 * tools that had been refusing restricted files for no reason.
 *
 * "Opens with" is read from each function's own body (the call that loads the
 * document), not from the module graph: `text.ts` imports `engine.ts` for an
 * error class, and loading a module is not running a function.
 */

const RUNNER_DIR = __dirname;
const PDF_DIR = join(__dirname, "..", "..", "..", "lib", "pdf");

const PDFJS_OPEN = /\b(loadPdfjs|awaitPdfjsDocument|readPagesWithPdfjs)\s*\(/;
const PDF_LIB_OPEN = /\b(loadPdf|loadPdfLib|load|PDFDocument\.load)\s*\(/;

const SEARCH_DIRS = [PDF_DIR, RUNNER_DIR];

/** Body of `export (async) function name(` in src/lib/pdf or the runners. */
function functionBody(name: string): string | null {
  for (const dir of SEARCH_DIRS) {
    for (const file of readdirSync(dir)) {
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      const source = readFileSync(join(dir, file), "utf8");
      const start = source.search(
        new RegExp(`export (async )?function ${name}\\s*[(<]`),
      );
      if (start < 0) continue;
      // Up to the next top-level declaration.
      const rest = source.slice(start + 1);
      const end = rest.search(
        /\n(export |function |async function |const |\/\*\*)/,
      );
      return end < 0 ? rest : rest.slice(0, end);
    }
  }
  return null;
}

type Opener = "pdfjs" | "pdf-lib";

/**
 * Which libraries `name` opens a document with — directly, or through the
 * functions it calls (a thumbnail hook reaches pdfjs via its renderer).
 */
function openersOf(name: string, seen = new Set<string>()): Set<Opener> {
  const found = new Set<Opener>();
  if (seen.has(name)) return found;
  seen.add(name);
  const body = functionBody(name);
  if (body === null) return found;
  if (PDFJS_OPEN.test(body)) found.add("pdfjs");
  if (PDF_LIB_OPEN.test(body)) found.add("pdf-lib");
  for (const [, callee] of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    if (callee === name) continue;
    for (const o of openersOf(callee!, seen)) found.add(o);
  }
  return found;
}

function openerOf(name: string): Opener[] {
  if (functionBody(name) === null) {
    throw new Error(`no definition found for ${name}()`);
  }
  const found = openersOf(name);
  // An unexplained answer is fatal, not a default.
  if (found.size === 0) throw new Error(`${name}() opens no document`);
  return [...found].sort();
}

interface Runner {
  file: string;
  reader: "pdfjs" | "pdf-lib";
  consumers: string[];
}

function singlePdfRunners(): Runner[] {
  return readdirSync(RUNNER_DIR)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((file) => ({
      file,
      source: readFileSync(join(RUNNER_DIR, file), "utf8"),
    }))
    .filter(({ source }) => /<SinglePdfRunner\b/.test(source))
    .map(({ file, source }) => ({
      file,
      reader: /<SinglePdfRunner\b[^>]*\breader="pdfjs"/.test(source)
        ? ("pdfjs" as const)
        : ("pdf-lib" as const),
      consumers: [
        ...new Set(
          [...source.matchAll(/\b(\w+)\(\s*pdf\.bytes\b/g)].map((m) => m[1]!),
        ),
      ],
    }));
}

describe("single-PDF runners read with the library they run on", () => {
  it("POSITIVE CONTROLS: the classifier tells the two libraries apart", () => {
    expect(openerOf("extractPages")).toEqual(["pdf-lib"]);
    expect(openerOf("rasterizePdf")).toEqual(["pdfjs"]);
    expect(openerOf("extractPdfText")).toEqual(["pdfjs"]);
    expect(openerOf("usePdfThumbnails")).toEqual(["pdfjs"]);
    expect(() => openerOf("noSuchFunction")).toThrow(/no definition/);
  });

  const runners = singlePdfRunners();

  it("health check: the walk found the runners, and the runners' byte consumers", () => {
    expect(runners.length).toBeGreaterThan(15);
    // Most runners hand the bytes to at least one engine function by name.
    expect(
      runners.filter((r) => r.consumers.length > 0).length,
    ).toBeGreaterThan(10);
  });

  for (const runner of runners) {
    it(`${runner.file}`, () => {
      const openers = runner.consumers.flatMap(openerOf);
      if (runner.reader === "pdfjs") {
        // Nothing downstream may reach pdf-lib, and there must BE a downstream.
        expect(runner.consumers.length).toBeGreaterThan(0);
        expect(openers).not.toContain("pdf-lib");
      } else if (openers.length > 0) {
        expect(
          openers,
          `${runner.file} only runs pdfjs — it should read with reader="pdfjs"`,
        ).toContain("pdf-lib");
      }
    });
  }

  it("the three pdfjs-only tools are the ones found (a count, so a new one is noticed)", () => {
    expect(
      runners
        .filter((r) => r.reader === "pdfjs")
        .map((r) => r.file)
        .sort(),
    ).toEqual([
      "pdf-to-image-runner.tsx",
      "pdf-to-markdown-runner.tsx",
      "pdf-to-text-runner.tsx",
    ]);
  });
});
