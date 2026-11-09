// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every pdf.js open in the browser code awaits `preflightPdfjsOpen` first
 * (`./pdfjs-guard`): the xref pre-scan and the stream preflight that refuse,
 * typed, a file pdf.js cannot open in bounded memory or time.
 *
 * History (lane res1, 2026-11-09): the text and raster readers ran the stream
 * preflight and the access probe ran the xref pre-scan, and nothing said the
 * other readers had to. The upload board of every pdf.js tool, Compare's
 * cards, Auto-crop, the editor canvas and the editor's text snap opened pdf.js
 * with neither, so a 20 x 100 MiB object-stream bomb opened in 11 s and a
 * zero-width xref ran the tab out of memory there, while the same file was
 * refused by name on the text path.
 *
 * The subjects are DISCOVERED: every `getDocument(` call in shipped files
 * under src/lib and src/components (src/lib/workers runs on the server and
 * has its own bounds). Each must sit in a function that, earlier and on its
 * straight-line path (not under an `if`, a loop, a callback or a `catch`),
 * awaits a call named `preflightPdfjsOpen`.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCOPES = ["src/lib", "src/components"].map((d) => join(ROOT, d));
const SERVER = join(ROOT, "src", "lib", "workers");

/**
 * Opens that are not the browser readers this guard is about, each with the
 * reason and the check it does run. A stale entry (its file no longer opens
 * pdf.js) fails the guard too.
 */
const EXEMPT: Record<string, string> = {
  // The access probe: it runs on file arrival for every tool, ahead of any
  // reader, and has its own checks in front of its open (`readAccessFacts`
  // runs `prescanXref`; `withDeadline` ends the open). Whether it should also
  // run the stream preflight is a separate decision (see lane res1's
  // follow-ups): it is the one open whose answer is a lock verdict, not a
  // reading.
  "src/lib/pdf/encryption.ts":
    "classifyPdfAccess: prescanXref + a deadline, not the stream preflight",
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (path === SERVER) return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });

interface Open {
  line: number;
  guarded: boolean;
}

const isFunction = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n);

const calleeName = (call: ts.CallExpression): string | null => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
};

/**
 * Is `node` reached every time its function body runs, up to a throw? Its
 * ancestors up to `body` may be blocks, statements that evaluate it as an
 * expression, a `try` block, and the expressions around a call; never a
 * branch, a loop, a callback, a `catch` or a `finally`.
 */
function onStraightPath(node: ts.Node, body: ts.Node): boolean {
  for (let n = node; n !== body; n = n.parent) {
    const p = n.parent;
    if (
      ts.isIfStatement(p) ||
      ts.isConditionalExpression(p) ||
      ts.isIterationStatement(p, false) ||
      ts.isSwitchStatement(p) ||
      ts.isCaseClause(p) ||
      ts.isCatchClause(p) ||
      isFunction(p) ||
      (ts.isBinaryExpression(p) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(p.operatorToken.kind) &&
        p.right === n) ||
      (ts.isTryStatement(p) && p.tryBlock !== n)
    ) {
      return false;
    }
  }
  return true;
}

/** Every `getDocument(` call in `source`, and whether it is preflighted. */
function pdfjsOpens(source: string, fileName = "x.ts"): Open[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const opens: Open[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && calleeName(node) === "getDocument") {
      let fn: ts.Node | undefined = node.parent;
      while (fn && !isFunction(fn)) fn = fn.parent;
      const body = fn && isFunction(fn) ? fn.body : undefined;
      let guarded = false;
      const look = (n: ts.Node) => {
        if (guarded || (n !== body && isFunction(n))) return;
        if (
          ts.isCallExpression(n) &&
          calleeName(n) === "preflightPdfjsOpen" &&
          ts.isAwaitExpression(n.parent) &&
          n.end <= node.getStart(file) &&
          onStraightPath(n, body!) &&
          onStraightPath(node, body!)
        ) {
          guarded = true;
          return;
        }
        ts.forEachChild(n, look);
      };
      if (body) look(body);
      opens.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        guarded,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return opens;
}

describe("preflightPdfjsOpen runs once per file", () => {
  it("the same bytes get the same answer without a second scan; other bytes get their own", async () => {
    const { preflightPdfjsOpen } = await import("./pdfjs-guard");
    const { CONTROL } = await import("@/tests/hostile/conversion-out.fixtures");
    const bytes = CONTROL();
    const first = preflightPdfjsOpen(bytes);
    expect(preflightPdfjsOpen(bytes)).toBe(first);
    await expect(first).resolves.toMatchObject({ overBudgetImage: false });
    // Positive control: a copy is other bytes, and is scanned for itself.
    expect(preflightPdfjsOpen(bytes.slice())).not.toBe(first);
  });

  it("a refusal is kept too, and is the same typed refusal", async () => {
    const { preflightPdfjsOpen } = await import("./pdfjs-guard");
    const { zeroWidthXrefPdf } =
      await import("@/tests/hostile/pdfjs-open.fixtures");
    const bytes = zeroWidthXrefPdf();
    const first = preflightPdfjsOpen(bytes);
    await expect(first).rejects.toMatchObject({ kind: "unreadable" });
    expect(preflightPdfjsOpen(bytes)).toBe(first);
  });
});

describe("every pdf.js open in the browser awaits preflightPdfjsOpen first", () => {
  const OPEN = "  const task = pdfjs.getDocument({ data: bytes.slice() });\n";
  const guarded = (src: string) => pdfjsOpens(src).map((o) => o.guarded);

  it("the predicate tells a preflighted open from a bare one (positive and negative controls)", () => {
    // Preflighted, through a module object and through a bare name.
    expect(
      guarded(
        `async function a(bytes) {\n  await guard.preflightPdfjsOpen(bytes);\n${OPEN}}`,
      ),
    ).toEqual([true]);
    expect(
      guarded(
        `const a = async (bytes) => {\n  const { previewOptions } = await preflightPdfjsOpen(bytes);\n${OPEN}};`,
      ),
    ).toEqual([true]);
    expect(
      guarded(
        `async function a(bytes) {\n  try {\n    await (await g).preflightPdfjsOpen(bytes);\n${OPEN}  } catch {}\n}`,
      ),
    ).toEqual([true]);
    // A planted bare open.
    expect(guarded(`async function a(bytes) {\n${OPEN}}`)).toEqual([false]);
    // After the open, not before it.
    expect(
      guarded(
        `async function a(bytes) {\n${OPEN}  await guard.preflightPdfjsOpen(bytes);\n}`,
      ),
    ).toEqual([false]);
    // Not awaited: the open does not wait for the refusal.
    expect(
      guarded(
        `async function a(bytes) {\n  guard.preflightPdfjsOpen(bytes);\n${OPEN}}`,
      ),
    ).toEqual([false]);
    // Under a branch, in a callback, in a catch: not on every path.
    expect(
      guarded(
        `async function a(bytes, x) {\n  if (x) await guard.preflightPdfjsOpen(bytes);\n${OPEN}}`,
      ),
    ).toEqual([false]);
    expect(
      guarded(
        `async function a(bytes) {\n  later(async () => { await guard.preflightPdfjsOpen(bytes); });\n${OPEN}}`,
      ),
    ).toEqual([false]);
    expect(
      guarded(
        `async function a(bytes) {\n  try { x(); } catch { await guard.preflightPdfjsOpen(bytes); }\n${OPEN}}`,
      ),
    ).toEqual([false]);
    // In another function: the guard does not travel.
    expect(
      guarded(
        `async function pre(bytes) { await guard.preflightPdfjsOpen(bytes); }\nasync function a(bytes) {\n${OPEN}}`,
      ),
    ).toEqual([false]);
    // A comment is not a call.
    expect(
      guarded(
        `async function a(bytes) {\n  // await guard.preflightPdfjsOpen(bytes);\n${OPEN}}`,
      ),
    ).toEqual([false]);
  });

  it("finds every getDocument( in src/lib and src/components preflighted", () => {
    const files = SCOPES.flatMap(walk);
    // Health: the walk read the codebase.
    expect(files.length).toBeGreaterThan(300);
    const found = files.flatMap((path) => {
      const rel = relative(ROOT, path).replace(/\\/g, "/");
      return pdfjsOpens(readFileSync(path, "utf8"), path).map((o) => ({
        at: `${rel}:${o.line}`,
        file: rel,
        guarded: o.guarded,
      }));
    });
    // Health: render x2, text x2, the page board, Compare's cards, Auto-crop,
    // the editor canvas and its text snap, and the access probe. A collapse
    // would mean the walk or the match stopped seeing them.
    expect(found.length).toBeGreaterThanOrEqual(7);
    // Every exemption still names a file that opens pdf.js.
    for (const file of Object.keys(EXEMPT)) {
      expect(
        found.some((o) => o.file === file),
        `${file} is exempt but no longer opens pdf.js`,
      ).toBe(true);
    }
    expect(
      found.filter((o) => !o.guarded && !(o.file in EXEMPT)).map((o) => o.at),
    ).toEqual([]);
    // And the readers this lane wired in are among the preflighted ones.
    const guardedFiles = new Set(
      found.filter((o) => o.guarded).map((o) => o.file),
    );
    for (const file of [
      "src/lib/pdf/pdfjs.ts",
      "src/lib/pdf/pdfjs-page-count.ts",
      "src/lib/pdf/auto-crop-render.ts",
      "src/lib/pdf/editor/page-render.ts",
      "src/lib/pdf/editor-export.ts",
      "src/lib/pdf/render.ts",
      "src/lib/pdf/text.ts",
    ]) {
      expect(guardedFiles, file).toContain(file);
    }
  });
});
