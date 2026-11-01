// @vitest-environment node
/**
 * A tool whose engine works in the page AS A READER SEES IT may not tell the
 * reader it works on the page as stored.
 *
 * `@/lib/pdf/page-frame` is the one reader of the displayed frame: the visible
 * crop box, turned by the page's `/Rotate`. Engines that place or trim by a
 * person's numbers went onto it one by one (Crop in 4844aad3, Edit in
 * c25f9c80, Annotate the same week), each with a pdfjs proof of where its
 * output lands. Their PAGES did not follow. At 028d3a10 three still described
 * the engine that had been replaced:
 *
 *   crop-pdf      "Margins are applied to the page as it is stored in the
 *                 file … Top trims what you see as the right-hand edge …
 *                 move the slider for the matching stored edge" — advice
 *                 that, followed, now trims the WRONG edge; and a use case
 *                 sent readers to that answer.
 *   edit-pdf      "positions are measured on the unrotated page, so new
 *                 content turns with it".
 *   annotate-pdf  "The numbers describe the page's media box before any
 *                 /Rotate flag: on a turned page a note can read sideways".
 *
 * Every engine test was green, because each proved the ENGINE; nothing read
 * the page against it. This does, over what the page SERVES (`./page-copy`).
 *
 * ── THE SUBJECTS ARE DISCOVERED, NOT NAMED ─────────────────────────────────
 *
 * page → registry kind → the dispatcher arm in tool-runner.tsx → the runner
 * module → every `@/lib/pdf/*` module it imports a VALUE from → does that
 * module CALL a function `page-frame.ts` exports (imported from it or through
 * a sibling's re-export)? One hop, and a call: a transitive import walk
 * widened the set (see readsDisplayedFrame). `import type` edges are not
 * edges at all: they are erased at runtime (CLAUDE.md rule 4).
 *
 * WHAT THIS DOES NOT SEE: an engine that rotates by hand without
 * `page-frame`, and a stored-frame claim worded outside {@link STORED_FRAME}.
 * The corpus below is what shipped; a new spelling gets added to it with the
 * sentence that used it.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "./catalog";
import type { Tool } from "./types";
import { withoutComments } from "./copy-surface";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { getRunnerKind } from "@/lib/pdf/registry";
import { runnerModuleOf } from "@/tests/tool-panel-modules";

const ROOT = process.cwd();
const RUNNER_DIR = "src/components/tools/runner";
const PDF_DIR = "src/lib/pdf";
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** registry kind → dispatcher arm → runner module, as the page mounts it. */
function runnerFile(slug: string): string | null {
  const kind = getRunnerKind(slug);
  if (!kind) return null;
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const arm = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch);
  if (!arm) throw new Error(`no dispatcher arm renders kind "${kind}"`);
  // Through the dispatcher's own bindings — a static import, or the
  // `next/dynamic` loader every runner has been since 2026-10-09 — to the
  // module that defines it. Throws when it cannot.
  return runnerModuleOf(arm[1]!);
}

/**
 * The module specifiers `source` imports at least one VALUE from. A whole
 * `import type {…}` and a brace list of nothing but `type X` are skipped.
 */
function valueImports(source: string): string[] {
  const code = withoutComments(source);
  const out: string[] = [];
  for (const m of code.matchAll(
    /import\s+(type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{([^}]*)\})?)\s+from\s+"([^"]+)"/g,
  )) {
    if (m[1]) continue;
    const names = (m[2] ?? m[3] ?? "x")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (m[2] !== undefined && names.every((n) => /^type\s/.test(n))) continue;
    out.push(m[4]!);
  }
  return out;
}

/** An @/lib/pdf import, or a ./ sibling from inside src/lib/pdf, as its .ts file. */
function pdfModule(spec: string, fromPdfDir: boolean): string | null {
  const name = spec.startsWith("@/lib/pdf/")
    ? spec.slice("@/lib/pdf/".length)
    : fromPdfDir && spec.startsWith("./")
      ? spec.slice(2)
      : null;
  if (name === null || name.includes("/")) return null;
  const file = `${PDF_DIR}/${name}.ts`;
  if (!existsSync(path.join(ROOT, file)))
    throw new Error(`import "${spec}" resolves to no file (${file})`);
  return file;
}

const FRAME = `${PDF_DIR}/page-frame.ts`;

/** The functions `page-frame.ts` exports, read from it rather than typed. */
const FRAME_FUNCTIONS = new Set(
  [
    ...withoutComments(read(`${PDF_DIR}/page-frame.ts`)).matchAll(
      /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*:\s*\(/g,
    ),
  ]
    .map((m) => (m[1] ?? m[2])!)
    // An angle utility: it reads no page and no box, so calling it is not
    // working in the displayed frame.
    .filter((name) => name !== "normalizeRotation"),
);

/**
 * The frame functions `source` imports by value from a sibling module — from
 * `./page-frame` itself, or through a re-export such as `./stamp`'s
 * `visibleBox` (Page numbers reaches the frame that way).
 */
function frameNames(source: string): string[] {
  const code = withoutComments(source);
  return [...code.matchAll(/import\s+\{([^}]*)\}\s+from\s+"\.\/[^"]+"/g)]
    .flatMap((m) =>
      m[1]!
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n && !/^type\s/.test(n)),
    )
    .filter((n) => FRAME_FUNCTIONS.has(n.split(/\s+as\s+/)[0]!))
    .map((n) => n.split(/\s+as\s+/).pop()!);
}

/**
 * The runner's own files: its module, plus every module it imports a value
 * from in a SUBDIRECTORY of the runner directory (`./editor/…`) — a runner
 * split into components of its own — and, within that subdirectory, every
 * module those import in turn (relative `./x` there). Siblings in the runner
 * directory itself (`./runner-kit`, `./single-pdf-runner`) are shared by
 * every runner and are not followed, and the walk never leaves the
 * subdirectory. Static value imports and `import("./…")` both count: the
 * editor is a lazy chunk of its runner, fetched as the file opens.
 *
 * Added 2026-10-24 when Edit PDF's runner became `edit-runner.tsx` →
 * `./editor/wysiwyg-editor`, where its engine import
 * (`@/lib/pdf/editor-export`) lives: without it, edit-pdf dropped out of the
 * subjects below while its engine still reads the displayed frame. Made
 * transitive within the subdirectory the same day, when Edit, Annotate and
 * Sign PDF all became `<EditorRunner>` (`./editor/editor-session`), which
 * loads `./wysiwyg-editor` — two hops.
 */
function runnerSources(runner: string): string[] {
  const imports = (file: string) => {
    const source = read(file);
    const dynamic = [
      ...withoutComments(source).matchAll(/import\(\s*"(\.\.?\/[^"]+)"\s*\)/g),
    ].map((m) => m[1]!);
    return [...new Set([...valueImports(source), ...dynamic])];
  };
  const resolve = (from: string, spec: string) => {
    for (const ext of [".tsx", ".ts"]) {
      const file = path.posix.join(path.posix.dirname(from), `${spec}${ext}`);
      if (existsSync(path.join(ROOT, file))) return file;
    }
    throw new Error(`${from} imports "${spec}", which resolves to no file`);
  };
  const runnerDir = path.posix.dirname(runner);
  const own = imports(runner)
    .filter((s) => s.startsWith("./") && s.slice(2).includes("/"))
    .map((s) => resolve(runner, s));
  const seen = new Set(own);
  const queue = [...own];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const sub = path.posix.dirname(file);
    for (const spec of imports(file)) {
      if (!spec.startsWith("./")) continue;
      const next = resolve(file, spec);
      if (
        path.posix.dirname(next) !== sub ||
        next.startsWith(`${runnerDir}/`) === false
      )
        continue;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [runner, ...seen];
}

/**
 * Does a `@/lib/pdf` module the runner imports a value from CALL the frame?
 * One hop, and a call, not an import: the first version walked the module
 * graph to the end and found Flatten and Overlay, whose engines reach
 * `page-frame` only because they import `loadPdf` from `./stamp`, which
 * imports it for the stamps. Loading a module is not running a function
 * (CLAUDE.md rule 4) — the walk was answering "is page-frame reachable?".
 */
function readsDisplayedFrame(runner: string): boolean {
  return runnerSources(runner)
    .flatMap((file) => valueImports(read(file)))
    .map((s) => pdfModule(s, false))
    .filter((f): f is string => f !== null && f !== FRAME)
    .some((file) => {
      const source = read(file);
      const code = withoutComments(source).replace(
        /import\s+[^;]*?from\s+"[^"]+";?/g,
        "",
      );
      return frameNames(source).some((name) =>
        new RegExp(`\\b${name}\\s*\\(`).test(code),
      );
    });
}

/** Every string the page serves. */
function servedText(tool: Tool): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z"“])/);

/** A sentence that places the user's numbers on the page as STORED. */
const STORED_FRAME =
  /\bas (?:it is )?stored\b|\bstored edge\b|\bunrotated\b|\bunturned\b|\bbefore any (?:\/Rotate|rotation)\b|\bmedia box\b|\bturns with (?:it|the page|a rotated page)\b|\bread(?:s)? sideways\b/i;

/** Verbatim from the pages at 028d3a10, one sentence each. */
const SHIPPED: readonly string[] = [
  "Margins are applied to the page as it is stored in the file, before any rotation setting a viewer applies.",
  "In Per side mode, move the slider for the matching stored edge.",
  "Crop preview draws page 1 unrotated, as stored, so on a rotated page 1 the outline looks turned compared with your viewer, but its dashed edges line up with the sliders that move them.",
  "On a page stored with a rotation setting, positions are measured on the unrotated page, so new content turns with it.",
  "The numbers describe the page's media box before any /Rotate flag: on a turned page a note can read sideways and the readout and preview show the page unturned, and where a smaller crop box trims the page, a mark placed in the trimmed margin will not show.",
];

/** Sentences that describe the displayed frame and must NOT be caught. */
const DISPLAYED: readonly string[] = [
  "Margins are measured on the page as your viewer shows it, after any rotation setting in the file, so Top always trims the edge you see at the top, whether a page is stored upright and turned for display or stored turned.",
  "On a rotated page, new text, boxes and pictures are turned so they read upright on screen.",
  "A rotated or cropped page is measured as displayed.",
  "Margins follow each page as your viewer displays it, so on a landscape insert Top trims the edge you see at the top, even when the insert is stored upright and only turned by a rotation setting.",
];

const subjects = tools
  .map((tool) => ({ tool, runner: runnerFile(tool.slug) }))
  .filter(
    (s): s is { tool: Tool; runner: string } =>
      s.runner !== null && readsDisplayedFrame(s.runner),
  );

describe("pages whose engine reads the displayed frame do not describe the stored one", () => {
  it("health check: the subjects are discovered, and the import reader skips type-only edges", () => {
    const slugs = subjects.map((s) => s.tool.slug).sort();
    // The set the discovery returned on 2026-10-07, pinned so that any change
    // to what this guard covers is read by someone: the three that shipped
    // the defect, and every placing tool page-frame.ts's docblock names
    // (Edit, Sign, Annotate, Create forms, the three stamps, Crop) plus
    // Redact. The first, transitive version also returned Flatten and
    // Overlay — see readsDisplayedFrame. Organize Pages joined 2026-10-24: it
    // sizes an inserted blank page from the neighbour's visible frame
    // (`getUprightPageSizes`), and its page says "as you see it".
    expect(slugs).toEqual([
      "annotate-pdf",
      "create-forms",
      "crop-pdf",
      "edit-pdf",
      "header-footer",
      // Joined 2026-10-30: both size and place each page by its visible
      // frame (CropBox, turned by /Rotate), and their pages say so.
      "n-up-pdf",
      "organize-pages",
      "page-numbers",
      "redact-pdf",
      "resize-pdf",
      "sign-pdf",
      // Joined 2026-11-01: each half is half of the visible frame (CropBox,
      // turned by /Rotate), and the page says halves are cut as displayed.
      "split-pdf-pages-in-half",
      "watermark-pdf",
    ]);
    expect(FRAME_FUNCTIONS.has("visiblePageFrame")).toBe(true);
    // Edit PDF reaches the frame through its lazily loaded editor (whose
    // engine is editor-export.ts), not only through the old edit.ts engine
    // it still imports a file-name helper from.
    expect(runnerSources(runnerFile("edit-pdf")!)).toContain(
      "src/components/tools/runner/editor/wysiwyg-editor.tsx",
    );
    expect(FRAME_FUNCTIONS.has("normalizeRotation")).toBe(false);
    const withRunner = tools.filter((t) => runnerFile(t.slug) !== null);
    expect(withRunner.length).toBeGreaterThan(20);
    // Type-only edges are not runtime edges.
    expect(valueImports('import type { A } from "./page-frame";')).toEqual([]);
    expect(
      valueImports('import { type A, type B } from "./page-frame";'),
    ).toEqual([]);
    expect(
      valueImports(
        'import {\n  viewToContent,\n  type B,\n} from "./page-frame";',
      ),
    ).toEqual(["./page-frame"]);
  });

  it("the pattern catches every sentence that shipped, and none that describe the displayed page", () => {
    for (const s of SHIPPED) expect(STORED_FRAME.test(s), s).toBe(true);
    for (const s of DISPLAYED) expect(STORED_FRAME.test(s), s).toBe(false);
  });

  it("no subject's page serves a stored-frame sentence", () => {
    const offenders = subjects.flatMap(({ tool }) =>
      servedText(tool)
        .flatMap(sentences)
        .filter((s) => STORED_FRAME.test(s))
        .map((s) => `${tool.slug}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});
