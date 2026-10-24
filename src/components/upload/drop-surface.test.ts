// @vitest-environment node
/**
 * One drop primitive: every file input the site renders is the drop sheet's.
 *
 * WHY. A file reaches a page three ways — picked, dropped, pasted — and each
 * zone that grew its own `<input type="file">` grew its own answers to the
 * questions that come with one: does a drag over its text flicker (the old
 * zones cleared their state on every `dragleave`), does a drop it misses
 * open the file in the tab, does a refused file still reach `onFiles`, does
 * a paste land anywhere. The runner kit's `Dropzone` and the workspace's
 * label each answered differently from the home desk's sheet (redesign
 * WP-07). So the input lives in ONE primitive, and every surface that takes
 * files is built on it: `drop-sheet.tsx`, the sheet as a whole-surface
 * label (every tool's zone, a guide's desk), and `drop-desk.tsx`, the same
 * sheet whose body is its owner's (the home desk, the workspace, the ticket
 * dialog) — one box (`drop-sheet-face.tsx`), one path in and one engine
 * (`use-drop-box.ts`), in two modules only so a tool page does not carry a
 * desk in its first load (WP-07 re-review). And in the sheet's SHELL,
 * `drop-sheet-shell.tsx`: the same sheet as the server draws it for a page
 * whose sheet's code arrives after the page (a guide's desk), drawn from
 * the same face and held to the sheet's markup by
 * `drop-sheet-shell.test.tsx`. It only ever holds a pick until the live
 * sheet takes it over.
 *
 * THE SET IS DISCOVERED, never typed: every non-test `.ts`/`.tsx` under
 * `src/components` and `src/app`, read for every spelling of a file input a
 * source can carry — the JSX attribute (`type="file"`, `type={"file"}`), a
 * props object (`type: "file"`), a DOM property (`input.type = "file"`) and
 * `setAttribute("type", "file")`. An attribute SELECTOR
 * (`input[type="file"]`) is a query, not an input, and is not counted.
 *
 * EXEMPTIONS, each with its reason, and an exemption whose file no longer
 * renders an input fails as stale:
 *  - `editor/wysiwyg-editor.tsx` (in `edit-runner.tsx` until 2026-10-24):
 *    the editor's "insert an image" picker chooses a picture to PLACE on a
 *    page already open — not a document arriving, so not a drop target, and
 *    a page drop must never land in it;
 *  - `editor/signature-panel.tsx`: the same, for a picture of a signature;
 *  - `drop-layer-view.tsx`: the picker behind the header's "Open files"
 *    when the page has no target of its own — made when it is asked for and
 *    appended to the end of `<body>`, never rendered with the page, so
 *    `e2e/helpers.ts`'s `fileInput()` (the first input on the page) always
 *    finds the page's own sheet. (In `drop-layer.tsx` until 2026-10-10: it
 *    left every page's first load for the layer's lazily loaded view.)
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";

const ROOT = process.cwd();
const ROOTS = ["src/components", "src/app"];
const HOME = "src/components/upload/drop-sheet.tsx";
/** The same primitive, as a desk whose body is its owner's (see above). */
const DESK = "src/components/upload/drop-desk.tsx";
/** The primitive's server-drawn shell (see above). */
const SHELL = "src/components/upload/drop-sheet-shell.tsx";
const EXEMPT: Record<string, string> = {
  "src/components/tools/runner/editor/wysiwyg-editor.tsx":
    "the editor's image-insert picker places a picture on an open page; it is not a document arriving",
  "src/components/tools/runner/editor/signature-panel.tsx":
    "the editor's signature picker reads a picture of a signature to place on an open page; it is not a document arriving",
  "src/components/intent/drop-layer-view.tsx":
    "the header's Open files picker when a page has no target: made when asked for, at the end of <body>",
};

/** Every way a source can make a file input. Selectors (`[type="file"]`) excluded. */
const FILE_INPUT: readonly RegExp[] = [
  // JSX or HTML attribute: type="file", type='file', type={"file"}, type={`file`}
  /(?<![[\w.-])type\s*=\s*\{?\s*["'`]file["'`]/g,
  // a props object: { type: "file" }
  /\btype\s*:\s*["'`]file["'`]/g,
  // a DOM property: input.type = "file"
  /\.type\s*=\s*["'`]file["'`]/g,
  // setAttribute("type", "file")
  /setAttribute\(\s*["'`]type["'`]\s*,\s*["'`]file["'`]/g,
];

/** How many file inputs this source makes. */
function fileInputsIn(source: string): number {
  const code = withoutComments(source);
  return FILE_INPUT.reduce(
    (sum, pattern) => sum + (code.match(pattern)?.length ?? 0),
    0,
  );
}

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sources(rel);
      return /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name)
        ? [rel]
        : [];
    },
  );
}

const walked = ROOTS.flatMap(sources);
const found = new Map(
  walked
    .map(
      (file) =>
        [
          file,
          fileInputsIn(readFileSync(path.join(ROOT, file), "utf8")),
        ] as const,
    )
    .filter(([, n]) => n > 0),
);

describe("every file input is the drop primitive's", () => {
  it("health check: the walk sees the site, and finds inputs in it", () => {
    // Both roots, whole: a walk that lost a directory would pass vacuously.
    expect(walked.length).toBeGreaterThanOrEqual(150);
    expect(walked.some((f) => f.startsWith("src/app/"))).toBe(true);
    // The primitive itself is found: the sheet's label input, and the
    // desk's two — its picker's and the hidden one behind `pick()`.
    expect(found.get(HOME)).toBe(1);
    expect(found.get(DESK)).toBe(2);
    // …and its shell, one: the native picker it draws.
    expect(found.get(SHELL)).toBe(1);
  });

  it("positive control: the detector sees every spelling, and not a selector", () => {
    expect(fileInputsIn(`<input type="file" />`)).toBe(1);
    expect(fileInputsIn(`<input type={"file"} hidden />`)).toBe(1);
    expect(fileInputsIn(`createElement("input", { type: "file" })`)).toBe(1);
    expect(
      fileInputsIn(
        `const el = document.createElement("input");\nel.type = "file";`,
      ),
    ).toBe(1);
    expect(fileInputsIn(`el.setAttribute("type", "file")`)).toBe(1);
    // A query for one is not one.
    expect(fileInputsIn(`root.querySelector('input[type="file"]')`)).toBe(0);
    expect(fileInputsIn(`<input type="filename" data-type="file" />`)).toBe(0);
    // A comment is not an input either (whole-line comments are stripped).
    expect(fileInputsIn(`// <input type="file" />`)).toBe(0);
  });

  it("no surface outside the primitive renders a file input of its own", () => {
    const offenders = [...found.keys()].filter(
      (file) =>
        file !== HOME && file !== DESK && file !== SHELL && !(file in EXEMPT),
    );
    expect(
      offenders,
      "these render a file input of their own — build them on DropSheet or DropDesk (src/components/upload/drop-sheet.tsx, drop-desk.tsx), or exempt them here with a reason",
    ).toEqual([]);
  });

  it("every exemption is still in use", () => {
    const stale = Object.keys(EXEMPT).filter((file) => !found.has(file));
    expect(
      stale,
      "an exempt file no longer renders an input — delete its entry",
    ).toEqual([]);
  });
});
