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
 * A pdf.js PAGE render: `<page>.render({ ..., viewport, ... })`, the shape of
 * pdf.js's `PDFPageProxy.render`. Discovered by shape, so a new renderer is
 * a subject the moment it is written. (`EditorPdf.render(index, scale, ...)`
 * in the editor's components is not this shape: it is the editor's wrapper,
 * and its open is judged where it is, in page-render.ts.)
 */
function isPageRender(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || calleeName(node) !== "render") return false;
  const arg = node.arguments[0];
  return (
    !!arg &&
    ts.isObjectLiteralExpression(arg) &&
    arg.properties.some(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "viewport",
    )
  );
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
): { renders: boolean; opens: RenderingOpen[] } {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let renders = false;
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (isPageRender(node)) renders = true;
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
  return { renders, opens };
}

/**
 * Rendering opens that neither preview nor refuse, each with why. A stale
 * entry (the file no longer renders, or its opens are now handled) fails.
 */
const RENDER_EXEMPT: Record<string, string> = {
  // OPEN (found 2026-11-09, lane editor-opener-budget): Auto-crop draws each
  // page to find its content box, with neither option, so a CO-08 image is
  // decoded in full. Neither fix is free: skipping the image would crop a
  // page to the rest of its content (a wrong crop, said nowhere), and
  // refusing changes what Crop PDF accepts. Listed so the guard can land
  // without deciding Crop PDF's behaviour; it is a defect, not a licence.
  "src/lib/pdf/auto-crop-render.ts":
    "OPEN: decodes an over-budget image; preview-or-refuse is undecided",
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
    // Every file that draws pdf.js pages opens its own document, so the rule
    // above sees the open beside the draw. A file that draws a document
    // opened elsewhere is a path this guard cannot follow: it fails here,
    // for a person to extend the guard, never passes by omission.
    expect(
      rendering.filter((f) => f.opens.length === 0).map((f) => f.file),
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
