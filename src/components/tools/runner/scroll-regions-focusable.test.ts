// @vitest-environment node
/**
 * Every box that scrolls in a tool runner can be scrolled from a keyboard
 * (axe scrollable-region-focusable).
 *
 * PDF to Text's result box got `tabIndex={0}` and a name on 2026-11-17; PDF
 * to Markdown's identical box, one file over, did not, and the after-upload
 * sweep of 2026-11-18 found it on production (F2). A fix that names its file
 * cannot see the sibling. So the boxes are not named here: they are FOUND,
 * as every JSX element under src/components/tools/runner/** whose className
 * holds an `overflow-auto` / `overflow-scroll` / `overflow-x-auto` /
 * `overflow-y-auto` class (with or without a `sm:` style prefix), or whose
 * inline style sets `overflow`, `overflowX` or `overflowY` to "auto" or
 * "scroll". They are read through the TypeScript parser, so a mention in a
 * comment, or a string that is not a className, is not a box.
 *
 * Each box must either be reachable and named itself (`tabIndex={0}` plus
 * `aria-label` or `aria-labelledby`, or a `LongText` given a `label`, which
 * renders exactly that: checked below by rendering it), or be listed in
 * EXEMPT with the reason. An exemption of kind "children" names the tag
 * inside the box that a keyboard lands on, and that tag must really be
 * inside it: axe passes a scrolling box that holds something focusable,
 * because tabbing to that thing scrolls the box.
 *
 * Health checks: the found set is bounded both ways and printed by name,
 * the predicates are first run on planted snippets that must pass and fail,
 * and every exemption must still match exactly one found box that would
 * otherwise fail (a stale exemption is a hole waiting to be reused).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { LongText } from "@/components/tools/ai-result-views";

const RUNNER = __dirname;
const SRC = path.resolve(__dirname, "../../..");

type Exemption =
  | {
      /** Path from src/, e.g. components/tools/runner/split-runner.tsx. */
      file: string;
      /** A piece of the box's className (or style) text, unique in the file. */
      match: string;
      kind: "children";
      /** A tag rendered inside the box that takes keyboard focus. */
      via: string;
      reason: string;
    }
  | {
      file: string;
      match: string;
      kind: "other-lane";
      reason: string;
    };

const R = "components/tools/runner/";

const EXEMPT: Exemption[] = [
  {
    file: `${R}editor/wysiwyg-editor.tsx`,
    match: "[touch-action:pan-x_pan-y] overflow-auto",
    kind: "other-lane",
    reason:
      "the editor's page view ([data-editor-viewport], tabIndex={-1}): sweep finding F1, fixed in lane A (fix/editor-viewport-focusable), which owns this file. Delete this entry when that lands: the check below fails on a stale exemption.",
  },
  {
    file: `${R}editor/wysiwyg-editor.tsx`,
    match: "border-line bg-panel overflow-y-auto border p-3",
    kind: "children",
    via: "button",
    reason:
      "the phone Pages sheet: every page in it is a button, so tabbing through them scrolls the sheet",
  },
  {
    file: `${R}editor/wysiwyg-editor.tsx`,
    match: "max-h-[45dvh] overflow-y-auto border border-b-0 p-4",
    kind: "children",
    via: "button",
    reason:
      "the phone Properties sheet: it opens with a Done button and holds the selection's fields",
  },
  {
    file: `${R}editor/toolbar.tsx`,
    match: "overflow-x-auto px-1 py-1",
    kind: "children",
    via: "children",
    reason:
      "a role=toolbar row whose children are the editor's tool buttons (passed in as children)",
  },
  {
    file: `${R}editor/thumbnail-rail.tsx`,
    match: "h-full overflow-y-auto pr-1",
    kind: "children",
    via: "Thumb",
    reason: "the editor's page rail: each Thumb is a button",
  },
  {
    file: `${R}merge-page-grid.tsx`,
    match: "grid max-h-[58vh] list-none grid-cols-2 gap-3 overflow-auto",
    kind: "children",
    via: "MergeTile",
    reason:
      "the merge board: every tile has move buttons and a keyboard handle",
  },
  {
    file: `${R}organize-runner.tsx`,
    match: "grid max-h-[58vh] list-none grid-cols-2 gap-3 overflow-auto",
    kind: "children",
    via: "PageTile",
    reason: "the organize board: every tile has move buttons and a handle",
  },
  {
    file: `${R}page-picker.tsx`,
    match: "grid max-h-[50vh] grid-cols-2 gap-3 overflow-auto",
    kind: "children",
    via: "PageTile",
    reason: "the page picker: every page is a selectable tile",
  },
  {
    file: `${R}page-select-runner.tsx`,
    match: "grid max-h-[58vh] grid-cols-2 gap-3 overflow-auto",
    kind: "children",
    via: "PageTile",
    reason: "the Delete / Extract board: every page is a selectable tile",
  },
  {
    file: `${R}rotate-runner.tsx`,
    match: "grid max-h-[58vh] grid-cols-2 gap-3 overflow-auto",
    kind: "children",
    via: "PageTile",
    reason: "the Rotate board: every page is a selectable tile",
  },
  {
    file: `${R}redact-find-panel.tsx`,
    match: "flex max-h-72 flex-col gap-1.5 overflow-auto pr-1",
    kind: "children",
    via: "input",
    reason: "the found-text list: every entry has a checkbox",
  },
  {
    file: `${R}viewer/viewer-sidebar.tsx`,
    match: "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3",
    kind: "children",
    via: "button",
    reason: "the viewer's page rail: each thumbnail is a button",
  },
  {
    file: `${R}viewer/viewer-sidebar.tsx`,
    match: "flex min-h-0 flex-1 flex-col overflow-y-auto p-2",
    kind: "children",
    via: "button",
    reason:
      "the bookmark list: a bookmark with a page is a button, one with a web address a link",
  },
];

const OVERFLOW_CLASS = /^(?:[\w-]+:)*overflow-(?:x-|y-)?(?:auto|scroll)$/;
const OVERFLOW_STYLE_KEYS = new Set(["overflow", "overflowX", "overflowY"]);

interface Box {
  /** Path from src/. */
  file: string;
  line: number;
  tag: string;
  /** The className's string pieces joined, or the style's text. */
  text: string;
  attrs: Map<string, ts.JsxAttribute>;
  /** Tag names rendered inside the element, and `children` if it renders them. */
  inner: Set<string>;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Every string piece written inside an expression (cn() args, ternaries). */
function strings(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node.text);
  } else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text, ...node.templateSpans.map((s) => s.literal.text));
  }
  node.forEachChild((child) => {
    strings(child, out);
  });
  return out;
}

function attrValue(attr: ts.JsxAttribute): ts.Node | undefined {
  const init = attr.initializer;
  if (!init) return undefined;
  if (ts.isJsxExpression(init)) return init.expression;
  return init;
}

function overflowStyle(attr: ts.JsxAttribute | undefined): boolean {
  const value = attr && attrValue(attr);
  if (!value || !ts.isObjectLiteralExpression(value)) return false;
  return value.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      OVERFLOW_STYLE_KEYS.has(p.name.getText()) &&
      strings(p.initializer).some((s) => s === "auto" || s === "scroll"),
  );
}

function findBoxes(fileName: string, text: string, file: string): Box[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const boxes: Box[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = new Map<string, ts.JsxAttribute>();
      for (const a of node.attributes.properties) {
        if (ts.isJsxAttribute(a)) attrs.set(a.name.getText(source), a);
      }
      const className = attrs.get("className");
      const classValue = className && attrValue(className);
      const classes = classValue ? strings(classValue).join(" ") : "";
      const byClass = classes.split(/\s+/).some((c) => OVERFLOW_CLASS.test(c));
      const byStyle = overflowStyle(attrs.get("style"));
      if (byClass || byStyle) {
        const inner = new Set<string>();
        const element = ts.isJsxOpeningElement(node) ? node.parent : undefined;
        const walk = (n: ts.Node) => {
          if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
            inner.add(n.tagName.getText(source));
          } else if (ts.isIdentifier(n) && n.text === "children") {
            inner.add("children");
          }
          n.forEachChild(walk);
        };
        if (element && ts.isJsxElement(element)) {
          element.children.forEach(walk);
        }
        boxes.push({
          file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          tag: node.tagName.getText(source),
          text: byClass ? classes : attrs.get("style")!.getText(source),
          attrs,
          inner,
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return boxes;
}

/** `tabIndex={0}` or `tabIndex="0"`. */
function reachable(box: Box): boolean {
  const attr = box.attrs.get("tabIndex");
  const value = attr && attrValue(attr);
  if (!value) return false;
  if (ts.isNumericLiteral(value)) return value.text === "0";
  if (ts.isStringLiteral(value)) return value.text === "0";
  return false;
}

/** The box itself is a named stop in the tab order. */
function focusableAndNamed(box: Box): boolean {
  if (/(?:^|\.)LongText$/.test(box.tag)) return box.attrs.has("label");
  return (
    reachable(box) &&
    (box.attrs.has("aria-label") || box.attrs.has("aria-labelledby"))
  );
}

const where = (box: Box) => `${box.file}:${box.line}`;

function discover(): Box[] {
  return sourceFiles(RUNNER).flatMap((full) =>
    findBoxes(
      full,
      readFileSync(full, "utf8"),
      path.relative(SRC, full).split(path.sep).join("/"),
    ),
  );
}

describe("predicates, on planted snippets first", () => {
  const plant = (jsx: string) =>
    findBoxes("planted.tsx", `const x = (${jsx});`, "planted.tsx");

  it("finds a scrolling box by class, prefixed class, cn() piece and style", () => {
    expect(
      plant(`<div className="max-h-72 overflow-auto">a</div>`),
    ).toHaveLength(1);
    expect(plant(`<div className="sm:overflow-y-auto">a</div>`)).toHaveLength(
      1,
    );
    expect(
      plant(`<div className={cn(open && "h-full overflow-x-auto")}>a</div>`),
    ).toHaveLength(1);
    expect(
      plant(`<div style={{ maxHeight: "70vh", overflowY: "scroll" }}>a</div>`),
    ).toHaveLength(1);
  });

  it("does not widen: clipped or hidden overflow, comments and other strings are not boxes", () => {
    expect(
      plant(
        `<div className="overflow-hidden overflow-x-clip sm:overflow-visible" title="overflow-auto">{/* overflow-auto */}</div>`,
      ),
    ).toHaveLength(0);
    expect(plant(`<div style={{ overflow: "hidden" }}>a</div>`)).toHaveLength(
      0,
    );
  });

  it("flags a box without tabIndex 0 or without a name, and passes one with both", () => {
    const [bare] = plant(`<div className="overflow-auto">a</div>`);
    const [minus] = plant(
      `<div aria-label="x" tabIndex={-1} className="overflow-auto">a</div>`,
    );
    const [unnamed] = plant(
      `<div tabIndex={0} className="overflow-auto">a</div>`,
    );
    const [good] = plant(
      `<section aria-label="x" tabIndex={0} className="overflow-auto">a</section>`,
    );
    const [byId] = plant(
      `<section aria-labelledby="h" tabIndex="0" className="overflow-auto">a</section>`,
    );
    expect([bare, minus, unnamed].map((b) => focusableAndNamed(b!))).toEqual([
      false,
      false,
      false,
    ]);
    expect(focusableAndNamed(good!)).toBe(true);
    expect(focusableAndNamed(byId!)).toBe(true);
  });

  it("a LongText passes only with a label, and with one really renders a named focusable region", () => {
    const [withLabel] = plant(
      `<views.LongText label="Text" text={t} className="overflow-auto" />`,
    );
    const [without] = plant(`<LongText text={t} className="overflow-auto" />`);
    expect(focusableAndNamed(withLabel!)).toBe(true);
    expect(focusableAndNamed(without!)).toBe(false);
    // The composed chain: what the predicate assumes LongText does.
    const named = renderToStaticMarkup(
      createElement(LongText, { label: "Text", text: "a", className: "x" }),
    );
    expect(named).toMatch(/^<section aria-label="Text" tabindex="0"/);
    const plain = renderToStaticMarkup(
      createElement(LongText, { text: "a", className: "x" }),
    );
    expect(plain).not.toMatch(/tabindex/);
  });

  it("records the tags inside a box, so an exemption's `via` can be checked", () => {
    const [box] = plant(
      `<ul className="overflow-auto">{xs.map((x) => <li key={x}><button>{x}</button></li>)}</ul>`,
    );
    expect([...box!.inner].sort()).toEqual(["button", "li"]);
  });
});

describe("every scrolling box in a tool runner can be scrolled from a keyboard", () => {
  const boxes = discover();

  it("finds a plausible set, printed by name", () => {
    console.log(
      `scrolling boxes found (${boxes.length}):\n` +
        boxes
          .map(
            (b) =>
              `  ${where(b)} <${b.tag}> ${focusableAndNamed(b) ? "named+focusable" : "exempt?"}`,
          )
          .join("\n"),
    );
    // Too few means the walk went blind; too many means it matched
    // something that is not a box.
    expect(boxes.length).toBeGreaterThanOrEqual(15);
    expect(boxes.length).toBeLessThanOrEqual(60);
    // Both kinds are in the set: the predicate is not answering one way.
    expect(boxes.some(focusableAndNamed)).toBe(true);
    expect(boxes.some((b) => !focusableAndNamed(b))).toBe(true);
  });

  it("each box is named and focusable, or exempt with a reason", () => {
    const failing = boxes
      .filter((b) => !focusableAndNamed(b))
      .filter(
        (b) =>
          !EXEMPT.some((e) => e.file === b.file && b.text.includes(e.match)),
      )
      .map(
        (b) =>
          `${where(b)} <${b.tag} className="${b.text}">: give it tabIndex={0} and an aria-label (see pdf-to-text-runner.tsx), or exempt it with a reason`,
      );
    expect(failing).toEqual([]);
  });

  it("every exemption matches exactly one box, that box still needs it, and its `via` is inside", () => {
    const problems: string[] = [];
    for (const e of EXEMPT) {
      const hits = boxes.filter(
        (b) => b.file === e.file && b.text.includes(e.match),
      );
      if (hits.length !== 1) {
        problems.push(`${e.file} "${e.match}" matches ${hits.length} boxes`);
        continue;
      }
      const box = hits[0]!;
      if (focusableAndNamed(box)) {
        problems.push(
          `${where(box)} is now named and focusable: delete its exemption`,
        );
      }
      if (e.kind === "children" && !box.inner.has(e.via)) {
        problems.push(
          `${where(box)} renders no <${e.via}> inside (it renders ${[...box.inner].join(", ") || "nothing"})`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
