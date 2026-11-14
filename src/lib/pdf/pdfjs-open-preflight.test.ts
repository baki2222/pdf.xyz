// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

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
 *
 * History: lane res1 shipped with one entry, the access probe
 * (`src/lib/pdf/encryption.ts`, "prescanXref + a deadline, not the stream
 * preflight"), while the opener's docblock said EVERY open was preflighted.
 * Review measured the probe opening and walking the object-stream bomb in
 * 11.3 s at 621 MB, on the paths where an upload arrives first. The guard
 * licensed the defect; the probe now preflights and the entry is gone.
 */
const EXEMPT: Record<string, string> = {
  // `withSharedWorker` binds `pdfjs.getDocument` and forwards each caller's
  // options with the shared worker added. It opens nothing of its own: the
  // callers it forwards for are the opens this guard judges, one by one.
  "src/lib/pdf/pdfjs-worker.ts":
    "withSharedWorker: a forwarder bound to getDocument, not an open",
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
  if (ts.isElementAccessExpression(e)) return memberName(e);
  return null;
};

/** `x.getDocument` or `x["getDocument"]`: the member a reference names. */
function memberName(e: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (
    ts.isElementAccessExpression(e) &&
    ts.isStringLiteralLike(e.argumentExpression)
  ) {
    return e.argumentExpression.text;
  }
  return null;
}

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
    // `const open = pdfjs.getDocument` (or `pdfjs["getDocument"]`) and a call
    // through `open` later: an open this walk cannot follow, so the reference
    // itself is reported, unguarded, for a person to look at.
    if (
      memberName(node) === "getDocument" &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      opens.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        guarded: false,
      });
    }
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

/**
 * A pdf.js PAGE render, or a call that may be one: `<x>.render(<one
 * argument>)`, the shape of pdf.js's `PDFPageProxy.render(params)`, where
 * the argument is an object literal naming `viewport`, or anything that is
 * not a literal at all (`page.render(renderContext)`, the form pdf.js's own
 * docs use: what it holds cannot be read here, so it is taken to be a
 * render). Discovered by shape, so a new renderer is a subject the moment
 * it is written. (`EditorPdf.render(index, scale, ...)` in the editor's
 * components is not this shape: it is the editor's wrapper, and its open is
 * judged where it is, in page-render.ts.)
 *
 * History (review, 2026-11-09): only the object-literal form was matched, so
 * a new file drawing with `const params = { canvas, viewport };
 * page.render(params)` after a bare open passed.
 */
function isPageRender(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || calleeName(node) !== "render") return false;
  if (node.arguments.length !== 1) return false;
  const arg = node.arguments[0]!;
  if (ts.isObjectLiteralExpression(arg)) {
    return arg.properties.some(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "viewport",
    );
  }
  return !(
    ts.isLiteralExpression(arg) ||
    ts.isJsxElement(arg) ||
    ts.isJsxSelfClosingElement(arg) ||
    ts.isJsxFragment(arg) ||
    isFunction(arg) ||
    arg.kind === ts.SyntaxKind.TrueKeyword ||
    arg.kind === ts.SyntaxKind.FalseKeyword ||
    arg.kind === ts.SyntaxKind.NullKeyword
  );
}

/** The `getDocument(` calls in `fn`'s own body, not in a function inside it. */
function ownOpens(fn: ts.FunctionLikeDeclaration): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const look = (n: ts.Node) => {
    if (n !== fn.body && isFunction(n)) return;
    if (ts.isCallExpression(n) && calleeName(n) === "getDocument") {
      found.push(n);
    }
    ts.forEachChild(n, look);
  };
  if (fn.body) look(fn.body);
  return found;
}

/** `...previewOptions` or `...x.previewOptions` among `call`'s options. */
function spreadsPreviewOptions(call: ts.CallExpression): boolean {
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some((p) => {
    if (!ts.isSpreadAssignment(p)) return false;
    const e = p.expression;
    return (
      (ts.isIdentifier(e) && e.text === "previewOptions") ||
      (ts.isPropertyAccessExpression(e) && e.name.text === "previewOptions")
    );
  });
}

interface RenderingOpen {
  line: number;
  /** "preview" spreads previewOptions, "refuse" refuses first, else null. */
  handled: "preview" | "refuse" | null;
}

/** A page render, and the line of the open that made its document. */
interface PageRenderSite {
  line: number;
  /**
   * The innermost function around the render asks for the page budget's
   * verdict before it: a call named `pageImageVerdict` (a preview: draw a
   * note instead) or `refuseOverBudgetPages` (an output: refuse by page)
   * earlier in that function's text.
   */
  verdict: boolean;
  /**
   * The innermost function around the render reads the drawn pixels back
   * (`getImageData` after the render): an ANALYSIS, whose answer is wrong if
   * a skipped image left white where it sits.
   */
  analysis: boolean;
  /** An analysis that asks `imagePlacements` before the render. */
  placements: boolean;
  /**
   * The lines of the `getDocument(` calls in the nearest function around the
   * render that opens one itself (the render may sit in a closure inside
   * it, as the editor's does); empty when no function around it opens a
   * document, so the document it draws came from somewhere else.
   */
  openedBy: number[];
}

/** `n` is (inside) the condition of an `if` or a `?:`. */
function inCondition(n: ts.Node): boolean {
  for (let at: ts.Node = n; at.parent; at = at.parent) {
    const p = at.parent;
    if (ts.isIfStatement(p) && p.expression === at) return true;
    if (ts.isConditionalExpression(p) && p.condition === at) return true;
    if (ts.isStatement(p) || isFunction(p)) return false;
  }
  return false;
}

/**
 * A `pageImageVerdict(...)` call whose answer DECIDES whether the page is
 * drawn: it sits in an `if`/`?:` condition itself, or it initialises a
 * variable (alone, or compared) that such a condition reads before the
 * render. A call whose result is thrown away (`void verdict(...)`) or kept
 * and never tested names the mechanism and certifies nothing.
 *
 * History (hostile review r2, 2026-11-14): the rule asked only that a call
 * with the name came earlier; a viewer that computed the verdict and
 * discarded it passed and drew the over-budget page.
 */
function verdictDecides(
  call: ts.CallExpression,
  fn: ts.Node | undefined,
  render: ts.Node,
  file: ts.SourceFile,
): boolean {
  if (inCondition(call)) return true;
  let at: ts.Node = call;
  while (
    at.parent &&
    (ts.isBinaryExpression(at.parent) ||
      ts.isParenthesizedExpression(at.parent) ||
      ts.isAwaitExpression(at.parent))
  ) {
    at = at.parent;
  }
  const decl = at.parent;
  if (
    !decl ||
    !ts.isVariableDeclaration(decl) ||
    decl.initializer !== at ||
    !ts.isIdentifier(decl.name) ||
    !fn
  ) {
    return false;
  }
  const name = decl.name.text;
  let read = false;
  const look = (n: ts.Node) => {
    if (read) return;
    if (
      ts.isIdentifier(n) &&
      n.text === name &&
      n !== decl.name &&
      n.getStart(file) > decl.end &&
      n.end <= render.getStart(file) &&
      inCondition(n)
    ) {
      read = true;
      return;
    }
    ts.forEachChild(n, look);
  };
  look(fn);
  return read;
}

/**
 * In a file that renders pdf.js pages, every `getDocument(` call, and how it
 * treats an image over its raster budget (CO-08): a PREVIEW spreads the
 * preflight's `previewOptions` (pdf.js skips the image before decoding it);
 * a path that WRITES pixels calls `refuseOverBudgetImages` first, on the
 * straight path of the same function. `renders` is false when the file draws
 * no page, and then nothing here applies to its opens.
 */
function renderingOpens(
  source: string,
  fileName = "x.ts",
): { renders: boolean; opens: RenderingOpen[]; sites: PageRenderSite[] } {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let renders = false;
  const calls: ts.CallExpression[] = [];
  const sites: PageRenderSite[] = [];
  const lineOf = (n: ts.Node) =>
    file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1;
  const visit = (node: ts.Node) => {
    if (isPageRender(node)) {
      renders = true;
      let openedBy: number[] = [];
      for (let fn = node.parent; fn && openedBy.length === 0; fn = fn.parent) {
        if (isFunction(fn)) openedBy = ownOpens(fn).map(lineOf);
      }
      let inner: ts.Node | undefined = node.parent;
      while (inner && !isFunction(inner)) inner = inner.parent;
      const calls = (
        name: string,
        before: boolean,
        used: (call: ts.CallExpression) => boolean = () => true,
      ) => {
        let found = false;
        const look = (n: ts.Node) => {
          if (found || (n !== inner && isFunction(n))) return;
          if (
            ts.isCallExpression(n) &&
            calleeName(n) === name &&
            (before
              ? n.end <= node.getStart(file)
              : n.getStart(file) >= node.end) &&
            used(n)
          ) {
            found = true;
            return;
          }
          ts.forEachChild(n, look);
        };
        if (inner && isFunction(inner) && inner.body) look(inner.body);
        return found;
      };
      sites.push({
        line: lineOf(node),
        openedBy,
        verdict:
          calls("pageImageVerdict", true, (c) =>
            verdictDecides(c, inner, node, file),
          ) ||
          calls(
            "refuseOverBudgetPages",
            true,
            (c) => !!c.parent && ts.isAwaitExpression(c.parent),
          ),
        analysis: calls("getImageData", false),
        placements: calls("imagePlacements", true),
      });
    }
    if (ts.isCallExpression(node) && calleeName(node) === "getDocument") {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const opens = calls.map((node): RenderingOpen => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
    if (spreadsPreviewOptions(node))
      return { line: line + 1, handled: "preview" };
    let fn: ts.Node | undefined = node.parent;
    while (fn && !isFunction(fn)) fn = fn.parent;
    const body = fn && isFunction(fn) ? fn.body : undefined;
    let refused = false;
    const look = (n: ts.Node) => {
      if (refused || (n !== body && isFunction(n))) return;
      if (
        ts.isCallExpression(n) &&
        calleeName(n) === "refuseOverBudgetImages" &&
        n.end <= node.getStart(file) &&
        onStraightPath(n, body!) &&
        onStraightPath(node, body!)
      ) {
        refused = true;
        return;
      }
      ts.forEachChild(n, look);
    };
    if (body) look(body);
    return { line: line + 1, handled: refused ? "refuse" : null };
  });
  return { renders, opens, sites };
}

/**
 * Rendering opens that neither preview nor refuse, each with why. A stale
 * entry (the file no longer renders, or its opens are now handled) fails.
 */
const RENDER_EXEMPT: Record<string, string> = {
  // History: from 2026-11-09 (lane editor-opener-budget) to 2026-11-14 this
  // held "src/lib/pdf/auto-crop-render.ts": Auto-crop drew each page with
  // neither option, so a CO-08 image was decoded in full, because skipping
  // it would crop the page to the rest of its ink, said nowhere. It now
  // previews, and counts each skipped image's PLACEMENT as ink (an ANALYSIS
  // that must ask `imagePlacements`, the third rule below), keeping a page
  // whole where the placement cannot be worked out. Empty: no exemption.
};

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

  it("a failure of the scan itself is not kept: the next open scans again", async () => {
    const { preflightPdfjsOpen } = await import("./pdfjs-guard");
    const { oneContentPdf } =
      await import("@/tests/hostile/pdfjs-open.fixtures");
    const { deflateSync } = await import("node:zlib");
    const bytes = oneContentPdf(
      "/Filter /FlateDecode",
      new Uint8Array(deflateSync(Buffer.from("0 0 m q Q\n"))),
    );
    // Not a fact about the file: the environment could not inflate.
    vi.stubGlobal(
      "DecompressionStream",
      class {
        constructor() {
          throw new TypeError("no DecompressionStream here");
        }
      },
    );
    let first: Promise<unknown>;
    try {
      first = preflightPdfjsOpen(bytes);
      await expect(first).rejects.toBeInstanceOf(TypeError);
    } finally {
      vi.unstubAllGlobals();
    }
    const second = preflightPdfjsOpen(bytes);
    expect(second).not.toBe(first);
    await expect(second).resolves.toMatchObject({ overBudgetImage: false });
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
    // An element access is the same open; an alias is one the walk cannot
    // follow, so it is reported whatever precedes it.
    expect(
      guarded(
        `async function a(bytes) {
  pdfjs["getDocument"]({ data: bytes });
}`,
      ),
    ).toEqual([false]);
    expect(
      guarded(
        `async function a(bytes) {
  await guard.preflightPdfjsOpen(bytes);
  pdfjs["getDocument"]({ data: bytes });
}`,
      ),
    ).toEqual([true]);
    expect(
      guarded(
        `async function a(bytes) {
  await guard.preflightPdfjsOpen(bytes);
  const open = pdfjs.getDocument;
  open({ data: bytes });
}`,
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
      "src/lib/pdf/encryption.ts",
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

describe("every pdf.js open that renders pages previews or refuses an over-budget image", () => {
  const handled = (src: string) =>
    renderingOpens(src).opens.map((o) => o.handled);
  const RENDER = "  await page.render({ canvas, viewport });\n";

  it("the predicates tell a preview, a refusal and a bare rendering open apart (positive and negative controls)", () => {
    // Positive: a preview, by name and through the preflight's object.
    expect(
      handled(
        `async function a(bytes) {\n  const { previewOptions } = await guard.preflightPdfjsOpen(bytes);\n  const t = pdfjs.getDocument({ data, ...DEFAULTS, ...previewOptions });\n${RENDER}}`,
      ),
    ).toEqual(["preview"]);
    expect(
      handled(
        `async function a(bytes) {\n  const pre = await guard.preflightPdfjsOpen(bytes);\n  const t = pdfjs.getDocument({ data, ...pre.previewOptions });\n${RENDER}}`,
      ),
    ).toEqual(["preview"]);
    // Positive: an output path that refuses first.
    expect(
      handled(
        `async function a(bytes) {\n  guard.refuseOverBudgetImages(await guard.preflightPdfjsOpen(bytes));\n  const t = pdfjs.getDocument({ data });\n${RENDER}}`,
      ),
    ).toEqual(["refuse"]);
    // Negative: the editor's open as it shipped, the preflight awaited and
    // its options dropped.
    expect(
      handled(
        `async function a(bytes) {\n  await guard.preflightPdfjsOpen(bytes);\n  const t = pdfjs.getDocument({ data, ...DEFAULTS });\n  const r = async () => { ${RENDER} };\n}`,
      ),
    ).toEqual([null]);
    // Negative: some other spread, a refusal after the open, under a branch,
    // or in another function.
    expect(
      handled(
        `async function a() {\n  const t = pdfjs.getDocument({ data, ...options });\n${RENDER}}`,
      ),
    ).toEqual([null]);
    expect(
      handled(
        `async function a(p) {\n  const t = pdfjs.getDocument({ data });\n  guard.refuseOverBudgetImages(p);\n${RENDER}}`,
      ),
    ).toEqual([null]);
    expect(
      handled(
        `async function a(p, x) {\n  if (x) guard.refuseOverBudgetImages(p);\n  const t = pdfjs.getDocument({ data });\n${RENDER}}`,
      ),
    ).toEqual([null]);
    expect(
      handled(
        `function pre(p) { guard.refuseOverBudgetImages(p); }\nasync function a() {\n  const t = pdfjs.getDocument({ data });\n${RENDER}}`,
      ),
    ).toEqual([null]);
    // What counts as rendering: pdf.js's page.render({ viewport }), not the
    // editor's wrapper `doc.render(index, scale, ratio)`, and not a comment.
    expect(renderingOpens(`async function a() {\n${RENDER}}`).renders).toBe(
      true,
    );
    expect(
      renderingOpens(
        "async function a() {\n  await page.render({ canvasContext: ctx, viewport: vp });\n}",
      ).renders,
    ).toBe(true);
    expect(
      renderingOpens("async function a() {\n  await doc.render(0, 1, 2);\n}")
        .renders,
    ).toBe(false);
    expect(
      renderingOpens(
        "async function a() {\n  // page.render({ canvas, viewport });\n}",
      ).renders,
    ).toBe(false);
    // History (review, 2026-11-09): a render through a variable, pdf.js's
    // own documented form, was not seen as one, so a bare open beside it
    // passed. Positive: it is a render, and the bare open is judged.
    const viaVariable = `async function a(bytes) {\n  await guard.preflightPdfjsOpen(bytes);\n  const doc = await pdfjs.getDocument({ data: bytes }).promise;\n  const page = await doc.getPage(1);\n  const params = { canvas, viewport };\n  await page.render(params).promise;\n}`;
    expect(renderingOpens(viaVariable).renders).toBe(true);
    expect(handled(viaVariable)).toEqual([null]);
    // Negative: a literal, JSX, or a callback is no page render.
    for (const call of [
      'x.render("a")',
      "x.render(1)",
      "root.render(<App />)",
      "x.render(() => 1)",
      "x.render(null)",
    ]) {
      expect(
        renderingOpens(`function a() {\n  ${call};\n}`, "x.tsx").renders,
        call,
      ).toBe(false);
    }
  });

  it("the predicate finds the open behind each render, in the function around it, and none for a document from elsewhere (positive and negative controls)", () => {
    const sites = (src: string) =>
      renderingOpens(src).sites.map((s) => s.openedBy);
    // Positive: the open in the same function, and in the function around
    // the closure that renders (the editor's shape).
    expect(
      sites(
        `async function a(bytes) {\n  const t = pdfjs.getDocument({ data, ...previewOptions });\n${RENDER}}`,
      ),
    ).toEqual([[2]]);
    expect(
      sites(
        `async function a(bytes) {\n  const t = pdfjs.getDocument({ data, ...previewOptions });\n  const r = async () => {\n${RENDER}  };\n}`,
      ),
    ).toEqual([[2]]);
    // Negative (review, 2026-11-09): a file whose one open is a preview also
    // drew a document passed in from another file, and passed, because the
    // guard judged the file's opens, never what each render draws.
    expect(
      sites(
        `async function count(bytes) {\n  const t = pdfjs.getDocument({ data, ...previewOptions });\n}\nasync function draw(page) {\n${RENDER}}`,
      ),
    ).toEqual([[]]);
    expect(sites(`async function draw(page) {\n${RENDER}}`)).toEqual([[]]);
  });

  it("the page-budget verdict and the analysis rule tell a handled render from a bare one (positive and negative controls)", () => {
    const site = (src: string) => renderingOpens(src).sites[0]!;
    const OPENED =
      "  const t = pdfjs.getDocument({ data, ...previewOptions });\n";
    // Positive: a preview asks for the page verdict before drawing, in the
    // closure that draws (the editor's and the thumbnails' shape)...
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  const r = async (page) => {\n    const note = guard.pageImageVerdict(pre, page.ref);\n    if (note) return draw(note);\n${RENDER}  };\n}`,
      ).verdict,
    ).toBe(true);
    // ...and an output refuses by page before its loop.
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  await guard.refuseOverBudgetPages(pre, order, get);\n  for (const i of order) {\n${RENDER}  }\n}`,
      ).verdict,
    ).toBe(true);
    // ...and an analysis picks the document to draw by it (Auto-crop's shape).
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  const over = guard.pageImageVerdict(pre, page.ref) !== null;\n  const page = over ? bare : shown;\n${RENDER}}`,
      ).verdict,
    ).toBe(true);
    // Negative (hostile review r2): the verdict computed and thrown away,
    // kept and never tested, tested only after the render, and a refusal
    // not awaited (a promise nobody waits for refuses nothing).
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  void guard.pageImageVerdict(pre, page.ref);\n  const note = null;\n  if (note) return draw(note);\n${RENDER}}`,
      ).verdict,
    ).toBe(false);
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  const note = guard.pageImageVerdict(pre, page.ref);\n  log(note);\n${RENDER}}`,
      ).verdict,
    ).toBe(false);
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  const note = guard.pageImageVerdict(pre, page.ref);\n${RENDER}  if (note) draw(note);\n}`,
      ).verdict,
    ).toBe(false);
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  guard.refuseOverBudgetPages(pre, order, get);\n${RENDER}}`,
      ).verdict,
    ).toBe(false);
    // Negative: no verdict; a verdict AFTER the render; a verdict in another
    // function than the one that draws.
    expect(site(`async function a(bytes) {\n${OPENED}${RENDER}}`).verdict).toBe(
      false,
    );
    expect(
      site(
        `async function a(bytes) {\n${OPENED}${RENDER}  guard.pageImageVerdict(pre, page.ref);\n}`,
      ).verdict,
    ).toBe(false);
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  guard.pageImageVerdict(pre, page.ref);\n  const r = async () => {\n${RENDER}  };\n}`,
      ).verdict,
    ).toBe(false);
    // An analysis reads the pixels back after drawing; it must place the
    // images the preview skipped, before drawing.
    const analysed = site(
      `async function a(bytes) {\n${OPENED}  guard.pageImageVerdict(pre, page.ref);\n${RENDER}  const px = ctx.getImageData(0, 0, w, h);\n}`,
    );
    expect(analysed).toMatchObject({ analysis: true, placements: false });
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  guard.pageImageVerdict(pre, page.ref);\n  const boxes = await guard.imagePlacements(bytes, page.ref, bound);\n${RENDER}  const px = ctx.getImageData(0, 0, w, h);\n}`,
      ),
    ).toMatchObject({ analysis: true, placements: true });
    // Negative: pixels read BEFORE the draw are no analysis of it; a preview
    // that never reads its pixels is none either.
    expect(
      site(
        `async function a(bytes) {\n${OPENED}  const px = ctx.getImageData(0, 0, w, h);\n${RENDER}}`,
      ).analysis,
    ).toBe(false);
    expect(
      site(`async function a(bytes) {\n${OPENED}${RENDER}}`).analysis,
    ).toBe(false);
  });

  it("finds every page render in src/lib and src/components asking the page budget's verdict, and every analysis placing what it skips", () => {
    const files = SCOPES.flatMap(walk);
    expect(files.length).toBeGreaterThan(300);
    const sites = files.flatMap((path) => {
      const file = relative(ROOT, path).replace(/\\/g, "/");
      return renderingOpens(readFileSync(path, "utf8"), path).sites.map(
        (s) => ({ ...s, at: `${file}:${s.line}`, file }),
      );
    });
    // Health: the thumbnails, the raster output, the editor, the viewer
    // and Auto-crop each draw at least once.
    expect(new Set(sites.map((s) => s.file))).toEqual(
      new Set([
        "src/lib/pdf/render.ts",
        "src/lib/pdf/editor/page-render.ts",
        "src/lib/pdf/viewer.ts",
        "src/lib/pdf/auto-crop-render.ts",
      ]),
    );
    expect(sites.filter((s) => !s.verdict).map((s) => s.at)).toEqual([]);
    const analyses = sites.filter((s) => s.analysis);
    // Health: Auto-crop is an analysis; nothing else reads its own render.
    expect(analyses.map((s) => s.file)).toEqual([
      "src/lib/pdf/auto-crop-render.ts",
    ]);
    expect(analyses.filter((s) => !s.placements).map((s) => s.at)).toEqual([]);
  });

  it("finds every rendering open in src/lib and src/components previewing or refusing", () => {
    const files = SCOPES.flatMap(walk);
    // Health: the walk read the codebase.
    expect(files.length).toBeGreaterThan(300);
    const read = files.map((path) => ({
      file: relative(ROOT, path).replace(/\\/g, "/"),
      ...renderingOpens(readFileSync(path, "utf8"), path),
    }));
    const rendering = read.filter((f) => f.renders);
    // Every pdf.js page render sits in (or in a closure inside) a function
    // that opens the document itself, so the rule below sees the open behind
    // each draw. A render of a document opened anywhere else, even in a file
    // whose own opens are all handled, is a path this guard cannot follow:
    // it fails here, for a person to extend the guard, never passes by
    // omission.
    //
    // History (review, 2026-11-09): this asked only that a rendering file
    // have SOME open, so `draw(doc)` beside a handled page count passed.
    expect(
      rendering.flatMap((f) =>
        f.sites
          .filter((s) => s.openedBy.length === 0)
          .map((s) => `${f.file}:${s.line}`),
      ),
    ).toEqual([]);
    // Every open behind a render is one the rule below judges as handled.
    const judgedAt = new Map<string, RenderingOpen["handled"]>(
      rendering.flatMap((f) =>
        f.opens.map((o) => [`${f.file}:${o.line}`, o.handled] as const),
      ),
    );
    const behind = rendering.flatMap((f) =>
      f.sites.flatMap((s) => s.openedBy.map((line) => `${f.file}:${line}`)),
    );
    // Health: the thumbnails, the raster output, the editor and Auto-crop.
    expect(new Set(behind).size).toBeGreaterThanOrEqual(4);
    expect(
      behind.filter(
        (at) =>
          judgedAt.get(at) === null &&
          !(at.slice(0, at.lastIndexOf(":")) in RENDER_EXEMPT),
      ),
    ).toEqual([]);
    // Health: the thumbnails and the raster output (render.ts), the editor
    // canvas and Auto-crop. A collapse would mean the shape match broke.
    expect(rendering.map((f) => f.file)).toEqual(
      expect.arrayContaining([
        "src/lib/pdf/render.ts",
        "src/lib/pdf/editor/page-render.ts",
        "src/lib/pdf/auto-crop-render.ts",
      ]),
    );
    const bare = rendering.flatMap((f) =>
      f.opens
        .filter((o) => o.handled === null)
        .map((o) => ({ at: `${f.file}:${o.line}`, file: f.file })),
    );
    // Every exemption is still a rendering file with a bare open.
    for (const file of Object.keys(RENDER_EXEMPT)) {
      expect(
        bare.some((o) => o.file === file),
        `${file} is exempt but no longer renders with a bare open`,
      ).toBe(true);
    }
    expect(
      bare.filter((o) => !(o.file in RENDER_EXEMPT)).map((o) => o.at),
    ).toEqual([]);
    // Both kinds are present, so neither predicate is blind in the real tree:
    // the thumbnails and the editor preview, the raster output refuses.
    const kinds = new Map(
      rendering.flatMap((f) =>
        f.opens.map((o) => [`${f.file}:${o.handled}`, o]),
      ),
    );
    for (const want of [
      "src/lib/pdf/render.ts:preview",
      "src/lib/pdf/render.ts:refuse",
      "src/lib/pdf/editor/page-render.ts:preview",
    ]) {
      expect(kinds.has(want), want).toBe(true);
    }
  });
});
