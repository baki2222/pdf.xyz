// @vitest-environment node
/**
 * Every ending is a fork: each place a run's result is shown says what the
 * run PRODUCED (`output`, the file a receipt re-opens and "Continue with"
 * carries) and how to go BACK to the settings (`onAdjust`, or `NO_ADJUST`
 * with the reason there is nothing to adjust). And every run trigger sits in
 * the bar that docks it on a phone (`RunBar`).
 *
 * The props are REQUIRED in the type, so a call site that forgets one is a
 * compile error. This census is the second, independent bound the type
 * cannot give: it DISCOVERS the call sites, so it can say how many there are
 * and that none was written around the type (a spread, a cast), and it holds
 * the floor that keeps the walk honest.
 *
 * DISCOVERED, never listed — an AST walk of every non-test `.tsx` under
 * `src/components` and `src/app`, counting JSX ELEMENTS (comments and strings
 * that mention `<ResultPanel` are not call sites). The redesign spec counted
 * 27 with grep; 26 are elements, and the 27th was a comment in
 * `live-region.tsx` (addendum WP-08 #1). A grep census could never pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sources(rel);
      return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [rel]
        : [];
    },
  );
}

interface Element {
  file: string;
  line: number;
  attributes: string[];
  /** A `{...spread}` among the attributes: the census cannot read past it. */
  spread: boolean;
  /** Tag names of the JSX elements around it, innermost first. */
  ancestors: string[];
}

/** Every JSX element named `tag` in `source`, with its attributes and ancestors. */
function elementsIn(file: string, source: string, tag: string): Element[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: Element[] = [];
  const visit = (node: ts.Node, ancestors: string[]) => {
    let next = ancestors;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = opening.tagName.getText(sf);
      if (name === tag) {
        const props = opening.attributes.properties;
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1,
          attributes: props.flatMap((p) =>
            ts.isJsxAttribute(p) ? [p.name.getText(sf)] : [],
          ),
          spread: props.some((p) => ts.isJsxSpreadAttribute(p)),
          ancestors,
        });
      }
      next = [name, ...ancestors];
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(sf, []);
  return out;
}

const files = ["src/components", "src/app"].flatMap(sources);
const census = (tag: string) =>
  files.flatMap((file) =>
    elementsIn(file, readFileSync(path.join(ROOT, file), "utf8"), tag),
  );
const where = (e: Element) => `${e.file}:${e.line}`;

describe("the walk reads JSX, not text", () => {
  it("POSITIVE CONTROL: elements are found; comments and strings are not", () => {
    const fixture = `
      // <ResultPanel output={x}> in a comment
      const s = "<ResultPanel>";
      export const A = () => (
        <RunBar>
          <ResultPanel title="t" output={o} onAdjust={reset} onReset={r}>
            <b />
          </ResultPanel>
        </RunBar>
      );
      export const B = () => <ResultPanel title="t" onReset={r} {...rest} />;`;
    const found = elementsIn("fixture.tsx", fixture, "ResultPanel");
    expect(found.map((e) => e.attributes)).toEqual([
      ["title", "output", "onAdjust", "onReset"],
      ["title", "onReset"],
    ]);
    expect(found.map((e) => e.spread)).toEqual([false, true]);
    expect(found[0]!.ancestors).toEqual(["RunBar"]);
    expect(found[1]!.ancestors).toEqual([]);
  });
});

describe("every result says what it produced and how to go back", () => {
  const panels = census("ResultPanel");

  it("health check: the call sites are discovered, and they are the runners", () => {
    // 26 on 2026-10-10, one per in-browser runner file (addendum WP-08 #1).
    expect(panels.length).toBeGreaterThanOrEqual(26);
    expect(panels.length).toBeLessThanOrEqual(60);
    expect(new Set(panels.map((p) => p.file)).size).toBeGreaterThanOrEqual(26);
  });

  it("each passes `output` and `onAdjust`, written out — never through a spread", () => {
    const missing = panels
      .filter(
        (p) =>
          p.spread ||
          !p.attributes.includes("output") ||
          !p.attributes.includes("onAdjust"),
      )
      .map(where);
    expect(
      missing,
      "a result that does not say what it made cannot be re-opened, counted or carried on — pass `output` (the file) and `onAdjust` (`reset`, or NO_ADJUST(reason))",
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: a site without `output` fails the rule above", () => {
    const [bare] = elementsIn(
      "bare.tsx",
      `export const X = () => <ResultPanel title="t" onAdjust={reset} onReset={r}><b /></ResultPanel>;`,
      "ResultPanel",
    );
    expect(bare!.attributes.includes("output")).toBe(false);
  });
});

describe("every run trigger docks on a phone", () => {
  const buttons = census("RunButton");

  it("health check: the triggers are discovered", () => {
    // 26 on 2026-10-10, one per in-browser runner.
    expect(buttons.length).toBeGreaterThanOrEqual(26);
    expect(buttons.length).toBeLessThanOrEqual(60);
  });

  it("each RunButton is inside a RunBar", () => {
    const undocked = buttons
      .filter((b) => !b.ancestors.includes("RunBar"))
      .map(where);
    expect(
      undocked,
      "a run trigger outside RunBar scrolls away from a phone user configuring the run — wrap its action row in <RunBar>",
    ).toEqual([]);
  });
});
