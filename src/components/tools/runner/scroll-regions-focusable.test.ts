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
 * inside the box that a keyboard lands on (axe passes a scrolling box that
 * holds something focusable, because tabbing to that thing scrolls the box).
 * Two things are checked about that tag, not one:
 *
 *  - it TAKES FOCUS: it is one of FOCUSABLE_TAGS, or a component defined
 *    under the runner tree whose own JSX renders one (followed through
 *    components, so MergeTile counts because it renders PageTile, which
 *    renders a button). A tag that only happens to be inside the box (li,
 *    span, div) licenses nothing. Until 2026-11-18 only the second check
 *    existed, and an exemption reading `via: "li"` stayed green.
 *  - it is INSIDE the box: written in the box's JSX, or, when the box
 *    renders `{children}`, written inside every call site of the component
 *    that owns the box. (The toolbar's Strip once passed with `via:
 *    "children"`, which verified nothing.)
 *
 * An exemption of kind "while-it-scrolls" is a box that is a tab stop only
 * while its content overflows (`tabIndex={scrolls ? 0 : undefined}`): the
 * page zoom dialog's page area, which overflows only on a phone about 480px
 * tall, and was an empty tab stop at every other size while it was always
 * one (review finding, 2026-11-18). No parser can tell that `scrolls`
 * tracks the overflow, so the exemption names the e2e test that measures it
 * in a browser, and the guard checks that test exists, beside the
 * structural checks (a conditional with a 0 branch, and a name).
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
      /**
       * A tag rendered inside the box that takes keyboard focus: a
       * FOCUSABLE_TAGS member or a runner component that renders one.
       */
      via: string;
      reason: string;
    }
  | {
      file: string;
      match: string;
      kind: "other-lane";
      reason: string;
    }
  | {
      file: string;
      match: string;
      kind: "while-it-scrolls";
      /** The title of the e2e test that measures it, as written in e2e/. */
      proof: string;
      reason: string;
    };

const R = "components/tools/runner/";

const EXEMPT: Exemption[] = [
  // (2026-11-18) The editor's page view ([data-editor-viewport]) was exempt
  // here as "other-lane" while PR #374 fixed it; #374 merged first, the
  // stale-exemption check below then failed on this merged head as designed,
  // and the entry was deleted.
  {
    file: `${R}page-zoom-dialog.tsx`,
    match: "bg-wash rounded-panel",
    kind: "while-it-scrolls",
    proof: "the page area is a tab stop only while it scrolls",
    reason:
      "the zoom dialog's page area: the page is capped to fit, so it scrolls only on a very short phone, and is a tab stop exactly then",
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
    via: "ToolButton",
    reason:
      "the Strip, a role=toolbar row: it renders {children}, and its call site passes the editor's ToolButtons, each a button",
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

/**
 * Native tags that take keyboard focus by themselves. (An `a` needs an href
 * and an input must not be hidden; every exemption below that leans on one
 * was read for that.) Components are not listed: they are FOLLOWED, see
 * takesFocus.
 */
const FOCUSABLE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);

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
  /** The nearest enclosing capitalised function or const: the component. */
  owner: string | undefined;
}

/** Every component definition and call site under the scanned sources. */
interface SourceIndex {
  /** Component name to the tags its definition renders (one set per definition). */
  defs: Map<string, Set<string>[]>;
  /** Component name to the tags written inside each of its call sites. */
  uses: Map<string, Set<string>[]>;
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

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** JSX tag names written anywhere under `node`, and `children` if read. */
function tagsIn(
  node: ts.Node,
  source: ts.SourceFile,
  out = new Set<string>(),
): Set<string> {
  const walk = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      out.add(n.tagName.getText(source));
    } else if (ts.isIdentifier(n) && n.text === "children") {
      out.add("children");
    }
    n.forEachChild(walk);
  };
  walk(node);
  return out;
}

const COMPONENT = /^[A-Z]/;

/** The capitalised name a function or const declaration gives, if any. */
function componentName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return COMPONENT.test(node.name.text) ? node.name.text : undefined;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return COMPONENT.test(node.name.text) ? node.name.text : undefined;
  }
  return undefined;
}

function indexSources(
  files: { fileName: string; text: string }[],
): SourceIndex {
  const index: SourceIndex = { defs: new Map(), uses: new Map() };
  const push = (map: Map<string, Set<string>[]>, k: string, v: Set<string>) =>
    map.set(k, [...(map.get(k) ?? []), v]);
  for (const { fileName, text } of files) {
    const source = parse(fileName, text);
    const visit = (node: ts.Node) => {
      const name = componentName(node);
      const body = ts.isFunctionDeclaration(node)
        ? node.body
        : ts.isVariableDeclaration(node)
          ? node.initializer
          : undefined;
      if (name && body) push(index.defs, name, tagsIn(body, source));
      if (ts.isJsxElement(node)) {
        const inside = new Set<string>();
        node.children.forEach((c) => tagsIn(c, source, inside));
        push(index.uses, node.openingElement.tagName.getText(source), inside);
      }
      node.forEachChild(visit);
    };
    visit(source);
  }
  return index;
}

/**
 * The tag takes keyboard focus: a native FOCUSABLE_TAGS member, or a
 * component every definition of which renders one (followed through
 * components, cycle-safe). A component defined nowhere in the index is not
 * known to take focus, so it does not.
 */
function takesFocus(
  tag: string,
  index: SourceIndex,
  seen = new Set<string>(),
): boolean {
  if (FOCUSABLE_TAGS.has(tag)) return true;
  if (seen.has(tag)) return false;
  const defs = index.defs.get(tag);
  if (!defs?.length) return false;
  const next = new Set(seen).add(tag);
  return defs.every((tags) =>
    [...tags].some((t) => t !== "children" && takesFocus(t, index, next)),
  );
}

/** What is wrong with a "children" exemption's `via`, or nothing. */
function viaProblems(e: Exemption, box: Box, index: SourceIndex): string[] {
  if (e.kind !== "children") return [];
  const problems: string[] = [];
  if (!takesFocus(e.via, index)) {
    problems.push(
      `${where(box)}: <${e.via}> does not take keyboard focus (not one of ${[...FOCUSABLE_TAGS].join(", ")}, nor a runner component that renders one)`,
    );
  }
  if (box.inner.has(e.via)) return problems;
  const calls = box.owner ? (index.uses.get(box.owner) ?? []) : [];
  if (box.inner.has("children") && calls.length > 0) {
    if (!calls.every((c) => c.has(e.via))) {
      problems.push(
        `${where(box)} renders {children}, and not every <${box.owner}> call site passes a <${e.via}>`,
      );
    }
    return problems;
  }
  problems.push(
    `${where(box)} renders no <${e.via}> inside (it renders ${[...box.inner].join(", ") || "nothing"}${box.inner.has("children") ? `, and <${box.owner ?? "?"}> has no call site` : ""})`,
  );
  return problems;
}

function findBoxes(fileName: string, text: string, file: string): Box[] {
  const source = parse(fileName, text);
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
        if (element && ts.isJsxElement(element)) {
          element.children.forEach((c) => tagsIn(c, source, inner));
        }
        let owner: string | undefined;
        for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
          owner = componentName(p);
          if (owner) break;
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
          owner,
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

/** `tabIndex={cond ? 0 : undefined}`: a tab stop on a condition. */
function reachableWhen(box: Box): boolean {
  const attr = box.attrs.get("tabIndex");
  const value = attr && attrValue(attr);
  return (
    !!value &&
    ts.isConditionalExpression(value) &&
    ts.isNumericLiteral(value.whenTrue) &&
    value.whenTrue.text === "0" &&
    ts.isIdentifier(value.whenFalse) &&
    value.whenFalse.text === "undefined"
  );
}

const named = (box: Box) =>
  box.attrs.has("aria-label") || box.attrs.has("aria-labelledby");

/** What is wrong with a "while-it-scrolls" exemption, or nothing. */
function whileScrollsProblems(
  e: Exemption,
  box: Box,
  specs: readonly string[],
): string[] {
  if (e.kind !== "while-it-scrolls") return [];
  const problems: string[] = [];
  if (!reachableWhen(box) || !named(box)) {
    problems.push(
      `${where(box)}: a "while-it-scrolls" box needs tabIndex={scrolls ? 0 : undefined} and a name`,
    );
  }
  const title = e.proof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const test = new RegExp(`\\btest\\(\\s*["'\`]${title}["'\`]`);
  if (!specs.some((text) => test.test(text))) {
    problems.push(
      `${where(box)}: no e2e spec has a test titled "${e.proof}" to measure it`,
    );
  }
  return problems;
}

/** The text of every e2e spec. */
function e2eSpecs(): string[] {
  const dir = path.resolve(SRC, "../e2e");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.spec\.ts$/.test(f))
    .map((f) => readFileSync(path.join(dir, f), "utf8"));
}

/** The box itself is a named stop in the tab order. */
function focusableAndNamed(box: Box): boolean {
  if (/(?:^|\.)LongText$/.test(box.tag)) return box.attrs.has("label");
  return reachable(box) && named(box);
}

const where = (box: Box) => `${box.file}:${box.line}`;

function discover(): { boxes: Box[]; index: SourceIndex } {
  const files = sourceFiles(RUNNER).map((full) => ({
    fileName: full,
    text: readFileSync(full, "utf8"),
    file: path.relative(SRC, full).split(path.sep).join("/"),
  }));
  return {
    boxes: files.flatMap((f) => findBoxes(f.fileName, f.text, f.file)),
    index: indexSources(files),
  };
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

  it("a while-it-scrolls box needs a conditional 0, a name, and a real e2e test", () => {
    const [good, never, minus, unnamed] = plant(
      `<>
        <section aria-labelledby="h" tabIndex={s ? 0 : undefined} className="overflow-auto">a</section>
        <section aria-labelledby="h" tabIndex={-1} className="overflow-auto">a</section>
        <section aria-labelledby="h" tabIndex={s ? -1 : undefined} className="overflow-auto">a</section>
        <section tabIndex={s ? 0 : undefined} className="overflow-auto">a</section>
      </>`,
    );
    const ex: Exemption = {
      file: "planted.tsx",
      match: "overflow",
      kind: "while-it-scrolls",
      proof: "the box is a tab stop only while it scrolls",
      reason: "planted",
    };
    const specs = [
      `test("the box is a tab stop only while it scrolls", async () => {});`,
    ];
    expect(focusableAndNamed(good!)).toBe(false);
    expect(whileScrollsProblems(ex, good!, specs)).toEqual([]);
    for (const box of [never, minus, unnamed]) {
      expect(whileScrollsProblems(ex, box!, specs)).toEqual([
        expect.stringContaining("needs tabIndex={scrolls ? 0 : undefined}"),
      ]);
    }
    // The title only in a comment, or a different title, is no test.
    for (const text of [
      `// "the box is a tab stop only while it scrolls"`,
      `test("the box is a tab stop", async () => {});`,
    ]) {
      expect(whileScrollsProblems(ex, good!, [text])).toEqual([
        expect.stringContaining("no e2e spec has a test titled"),
      ]);
    }
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

  describe("an exemption's `via` must take focus, not merely be inside", () => {
    const planted = `
      function Tile() { return <div><button>x</button></div>; }
      const Wrapped = memo(function Wrapped() { return <Tile />; });
      function Label() { return <span>x</span>; }
      function List({ xs }) {
        return (
          <ul className="overflow-auto">
            {xs.map((x) => <li key={x}><span>{x}</span><button>{x}</button><Tile /><Wrapped /><Label /></li>)}
          </ul>
        );
      }
      function Row({ children }) {
        return <div className="overflow-x-auto">{children}</div>;
      }
      const a = <Row><Tile /></Row>;
      function Lonely({ children }) {
        return <div className="overflow-y-auto">{children}</div>;
      }`;
    const index = indexSources([{ fileName: "planted.tsx", text: planted }]);
    const boxes = findBoxes("planted.tsx", planted, "planted.tsx");
    const box = (owner: string) => boxes.find((b) => b.owner === owner)!;
    const ex = (via: string): Exemption => ({
      file: "planted.tsx",
      match: "overflow",
      kind: "children",
      via,
      reason: "planted",
    });

    it("finds the three planted boxes and their owners", () => {
      expect(boxes.map((b) => b.owner)).toEqual(["List", "Row", "Lonely"]);
    });

    it("accepts a native focusable tag and components that render one, followed through a memo", () => {
      expect(viaProblems(ex("button"), box("List"), index)).toEqual([]);
      expect(viaProblems(ex("Tile"), box("List"), index)).toEqual([]);
      expect(viaProblems(ex("Wrapped"), box("List"), index)).toEqual([]);
    });

    it("rejects a tag that is inside but takes no focus: li, span, a component of spans", () => {
      for (const via of ["li", "span", "Label"]) {
        expect(viaProblems(ex(via), box("List"), index)).toEqual([
          expect.stringContaining(`<${via}> does not take keyboard focus`),
        ]);
      }
    });

    it("rejects a focusable tag that is not inside", () => {
      expect(viaProblems(ex("textarea"), box("List"), index)).toEqual([
        expect.stringContaining("renders no <textarea> inside"),
      ]);
    });

    it("a box rendering {children} is checked at its component's call sites", () => {
      expect(viaProblems(ex("Tile"), box("Row"), index)).toEqual([]);
      expect(viaProblems(ex("select"), box("Row"), index)).toEqual([
        expect.stringContaining("not every <Row> call site passes a <select>"),
      ]);
      // "children" is not a tag and takes no focus: the old form is refused.
      expect(viaProblems(ex("children"), box("Row"), index)).toEqual([
        expect.stringContaining("<children> does not take keyboard focus"),
      ]);
      // No call site at all: nothing is verified, so it fails.
      expect(viaProblems(ex("button"), box("Lonely"), index)).toEqual([
        expect.stringContaining("<Lonely> has no call site"),
      ]);
    });
  });
});

describe("every scrolling box in a tool runner can be scrolled from a keyboard", () => {
  const { boxes, index } = discover();
  const specs = e2eSpecs();

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

  it("the component index is plausible: the via components resolve to definitions", () => {
    // A blind index makes every component "not focusable" (a red for the
    // wrong reason); a missing name here says which.
    expect(index.defs.size).toBeGreaterThanOrEqual(50);
    // The e2e specs were read: a blind read fails every proof the same way.
    expect(specs.length).toBeGreaterThanOrEqual(100);
    for (const name of ["PageTile", "MergeTile", "Thumb", "ToolButton"]) {
      expect(index.defs.get(name)?.length, name).toBeGreaterThan(0);
      expect(takesFocus(name, index), name).toBe(true);
    }
  });

  it("every exemption matches exactly one box, that box still needs it, and its `via` takes focus and is inside", () => {
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
      problems.push(...viaProblems(e, box, index));
      problems.push(...whileScrollsProblems(e, box, specs));
    }
    expect(problems).toEqual([]);
  });
});
