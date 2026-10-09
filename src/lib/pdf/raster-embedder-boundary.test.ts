// @vitest-environment node
/**
 * pdf-lib's raster image embedders are called from exactly ONE module.
 *
 * `image-byte-offset.test.ts` proves that a valid JPEG at a non-zero
 * `byteOffset` embeds correctly through `embedRasterImage`. That proof covers
 * the code that goes through the helper and says nothing at all about a sixth
 * call site added next month — and one of the product sites we have
 * (`redactPdf`) cannot be unit-tested at all here, because its bytes come from
 * a canvas rasterizer that needs a browser. For that one, this guard is the
 * whole proof. (`grayscalePdf` was the second until it began encoding its own
 * one-component page JPEGs; its embed now runs in Node, through
 * `createGrayscaleBuilder` in grayscale-output.test.ts.)
 *
 * So the property is structural: **no module may reach `embedJpg`/`embedPng`
 * except the one that normalizes the offset first.** That is checkable without
 * running anything, it covers the untestable engines, and it covers the test
 * and tooling code too — which is where this defect was actually found, on a
 * fixture that failed for a ~1 KB JPEG and passed for a larger one.
 *
 * ── HOW THE CORPUS IS DERIVED ───────────────────────────────────────────────
 *
 * From `git ls-files --cached --others --exclude-standard`, not from a list of
 * directories and not from a list of files. A named list cannot see a file it
 * does not name, and a directory walk rooted at `src/` cannot see `e2e/` or
 * `scripts/` — both of which call these methods. `--others` is there so a file
 * written but not yet committed is still in the set: a guard that only sees
 * committed code is blind for exactly as long as it takes to add a violation.
 *
 * The corpus size is asserted, in both directions. `[] ⊆ X` is vacuously true,
 * so a corpus that silently collapsed would report the strongest possible pass;
 * and a corpus that ballooned would mean the filter stopped filtering.
 *
 * ── THE ONE ESCAPE HATCH, AND WHY IT CANNOT LICENSE A PRODUCT DEFECT ────────
 *
 * Something has to call the raw embedder: the test that PINS pdf-lib's broken
 * behaviour cannot go through the wrapper that hides it, or it would stop
 * testing anything. A file opts out by carrying {@link RAW_MARKER} in its text.
 *
 * The hatch is deliberately unavailable to product code — an opted-out file
 * must ALSO be a `.test.`/`.spec.` file — because a guard that can license the
 * defect it exists to prevent is worse than no guard: the defect then ships
 * with a written argument for why it was safe. The count of opted-out files is
 * bounded above (they cannot quietly proliferate) and below (if it reaches
 * zero, the hatch is decorative and this paragraph is a lie).
 *
 * ── WHAT IT CANNOT CATCH ────────────────────────────────────────────────────
 *
 * Stated because a guard that overclaims is worse than none.
 *
 *  - It is syntactic. `const m = "embedJpg"; doc[m](bytes)` is invisible to it,
 *    as is anything reaching `JpegEmbedder.for` through the core export.
 *    Both are caught instead by the *other* half — a wrong-offset embed still
 *    throws at runtime, loudly, on the first JPEG that is a view.
 *  - It over-approximates: any `x.embedJpg(...)` counts, whatever `x` is. A
 *    same-named method on an unrelated object would turn this red for the wrong
 *    reason. That is the safe direction, and the failure message says which
 *    file and line, so a real one is a one-line exemption discussion rather
 *    than a mystery.
 */
import { describe, expect, it } from "vitest";
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The compiler used as a library; see spend-probe-reachability.test.ts. */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = resolve(__dirname, "..", "..", "..");

/** The single module allowed to touch the raw embedders, as a repo path. */
const BOUNDARY = "src/lib/pdf/pdf-lib.ts";

/** The pdf-lib methods that take raw image bytes and read them by offset. */
const EMBEDDERS = new Set(["embedJpg", "embedPng"]);

/**
 * A test file carrying this token calls the raw embedders on purpose. Written
 * split so this guard's own source does not opt itself out.
 */
const RAW_MARKER = ["@pdf-lib", "raw-embedder"].join("-");

/** Only a test file may opt out; product code has no hatch at all. */
const isTestFile = (file: string): boolean =>
  /\.(test|spec)\.(ts|tsx)$/.test(file);

/**
 * Every file git would track — committed OR newly written and not ignored.
 * FATAL if git cannot answer: a silently empty corpus passes everything.
 */
function corpus(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\.(ts|tsx|mts|cts)$/.test(line));
}

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly name: string;
}

/** Every `<expr>.embedJpg(...)` / `<expr>["embedPng"](...)` call in a source. */
function scan(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name: string | undefined;
      if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
      else if (
        ts.isElementAccessExpression(callee) &&
        callee.argumentExpression !== undefined &&
        ts.isStringLiteralLike(callee.argumentExpression)
      )
        name = callee.argumentExpression.text;
      if (name !== undefined && EMBEDDERS.has(name)) {
        hits.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          name,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("the scanner itself", () => {
  it("finds every spelling it claims to, and nothing it does not", () => {
    const found = scan(
      "positive-control.ts",
      [
        "const a = await doc.embedJpg(bytes);",
        'const b = await doc["embedPng"](bytes);',
        "const c = await pdf.doc.embedJpg(bytes);",
        "// doc.embedJpg(bytes) in a comment",
        'const d = "doc.embedJpg(bytes)";',
        "declare function embedJpg(x: Uint8Array): void;",
        "const e = await doc.embedFont(font);",
      ].join("\n"),
    ).map((h) => `${h.line}:${h.name}`);
    // Lines 1-3 are calls; 4 is a comment, 5 a string, 6 a declaration (not a
    // call), 7 a different method. A scanner that returned [] here would report
    // a clean tree no matter what the tree contained.
    expect(found).toEqual(["1:embedJpg", "2:embedPng", "3:embedJpg"]);
  });
});

describe("pdf-lib raster embedder boundary", () => {
  const files = corpus();

  it("scans a plausible number of TypeScript files", () => {
    // Measured 957 on 2026-08-21. The bounds are wide because the number grows;
    // they exist to catch a corpus that collapsed or stopped filtering, both of
    // which are invisible to the assertion below.
    expect(files.length).toBeGreaterThan(500);
    expect(files.length).toBeLessThan(5000);
    expect(files).toContain(BOUNDARY);
  });

  it("is the only module that calls embedJpg/embedPng", () => {
    const sources = new Map(
      files.map((file) => [file, readFileSync(resolve(ROOT, file), "utf8")]),
    );
    const hits = [...sources].flatMap(([file, text]) => scan(file, text));

    // Health check: if the sweep found NOTHING anywhere, the boundary module's
    // own calls have moved or the reader is broken, and "no violations" would
    // be a false clean rather than a result.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.file === BOUNDARY)).toBe(true);

    const optedOut = [...sources]
      .filter(([, text]) => text.includes(RAW_MARKER))
      .map(([file]) => file);
    // The hatch is exercised (so this is not a decorative branch) and bounded
    // (so it cannot become the normal way to call an embedder).
    expect(optedOut.length).toBeGreaterThan(0);
    expect(optedOut.length).toBeLessThanOrEqual(2);
    // …and it is unavailable to anything that ships.
    expect(optedOut.filter((f) => !isTestFile(f))).toEqual([]);

    const outside = hits
      .filter((h) => h.file !== BOUNDARY && !optedOut.includes(h.file))
      .map((h) => `${h.file}:${h.line} calls ${h.name}`);
    expect(outside).toEqual([]);
  });
});
