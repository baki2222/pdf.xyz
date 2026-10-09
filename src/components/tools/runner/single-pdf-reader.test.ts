import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

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

/** Every non-test source file in SEARCH_DIRS, read once per run. */
let sources: { file: string; text: string }[] | null = null;
const searchSources = (): { file: string; text: string }[] =>
  (sources ??= SEARCH_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => ({
        file: join(dir, file),
        text: readFileSync(join(dir, file), "utf8"),
      })),
  ));

interface Definition {
  file: string;
  body: string;
}

/**
 * Memoized per name (and calling file): the recursive walk asks for the same
 * callees many times, and re-reading and re-scanning two directories on every
 * lookup took ~8 s and timed out on a slower filesystem.
 */
const bodies = new Map<string, Definition | null>();

/** The body from `start` up to the next top-level declaration. */
function bodyFrom(text: string, start: number): string {
  const rest = text.slice(start + 1);
  const end = rest.search(
    /\n(export |function |async function |const |\/\*\*)/,
  );
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * The definition a call to `name` runs: a function of that name in the
 * CALLING file (`from`) when there is one — exported or not — and otherwise
 * `export (async) function name(` anywhere in src/lib/pdf or the runners.
 *
 * Module-private functions since the integration of wave1/l01-page-leak: the
 * text extractors open the document in ONE private helper both of them call
 * (`readPageTextItems`), and a search for exported definitions answered
 * "opens no document" for both — a blind classifier, not a clean one. A
 * private function is looked for only in the file that calls it, as the
 * language resolves it; searched everywhere, one module's private helper
 * answered for another module's call of the same name.
 */
function functionBody(name: string, from?: string): Definition | null {
  const key = `${from ?? ""}#${name}`;
  if (bodies.has(key)) return bodies.get(key)!;
  let found: Definition | null = null;
  const local = new RegExp(
    `\\n(?:export )?(?:async )?function ${name}\\s*[(<]`,
  );
  const exported = new RegExp(`export (?:async )?function ${name}\\s*[(<]`);
  const own = from
    ? searchSources().find((source) => source.file === from)
    : undefined;
  const at = own ? own.text.search(local) : -1;
  if (own && at >= 0) {
    found = { file: own.file, body: bodyFrom(own.text, at + 1) };
  } else {
    for (const source of searchSources()) {
      const start = source.text.search(exported);
      if (start < 0) continue;
      found = { file: source.file, body: bodyFrom(source.text, start) };
      break;
    }
  }
  bodies.set(key, found);
  return found;
}

type Opener = "pdfjs" | "pdf-lib";

/**
 * Functions that run ONLY once a load has already failed — every call to them
 * in the searched sources sits in a `catch` clause. DERIVED, never listed.
 *
 * Since the integration of wave1/l01-page-leak, pdf-lib's refusal of an
 * encrypted file is classified by asking pdf.js whether it opens without a
 * password (`pdfLoadError` → `classifyPdfAccess`, which now awaits through
 * `awaitPdfjsDocument`). That pdf.js open decides which refusal to SHOW; it
 * reads nothing for the tool, and a pdf-lib tool is not a pdfjs reader because
 * it can explain why pdf-lib refused. Without this, every pdf-lib engine
 * classified as `["pdf-lib", "pdfjs"]`.
 */
let refusalOnly: Set<string> | null = null;
function refusalOnlyFunctions(): Set<string> {
  if (refusalOnly) return refusalOnly;
  const inCatch = new Map<string, boolean>();
  for (const { file, text } of searchSources()) {
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: TS.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        let cur: TS.Node | undefined = node.parent;
        let caught = false;
        while (cur && !ts.isSourceFile(cur)) {
          if (ts.isCatchClause(cur)) {
            caught = true;
            break;
          }
          if (ts.isFunctionLike(cur)) break;
          cur = cur.parent;
        }
        const name = node.expression.text;
        inCatch.set(name, (inCatch.get(name) ?? true) && caught);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  refusalOnly = new Set(
    [...inCatch].filter(([, only]) => only).map(([name]) => name),
  );
  return refusalOnly;
}

/**
 * Which libraries `name` opens a document with — directly, or through the
 * functions it calls (a thumbnail hook reaches pdfjs via its renderer).
 */
function openersOf(
  name: string,
  seen = new Set<string>(),
  from?: string,
): Set<Opener> {
  const found = new Set<Opener>();
  const definition = functionBody(name, from);
  if (definition === null) return found;
  const key = `${definition.file}#${name}`;
  if (seen.has(key)) return found;
  seen.add(key);
  const { body } = definition;
  if (PDFJS_OPEN.test(body)) found.add("pdfjs");
  if (PDF_LIB_OPEN.test(body)) found.add("pdf-lib");
  for (const [, callee] of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    // A refusal's explanation is not a read (see refusalOnlyFunctions).
    if (callee === name || refusalOnlyFunctions().has(callee!)) continue;
    for (const o of openersOf(callee!, seen, definition.file)) found.add(o);
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
    // The refusal path is derived, in both directions: pdf-lib's refusal
    // classifier runs only in a catch; the loader it explains does not.
    expect(refusalOnlyFunctions().has("pdfLoadError")).toBe(true);
    expect(refusalOnlyFunctions().has("loadPdf")).toBe(false);
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
