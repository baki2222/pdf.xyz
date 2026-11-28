/**
 * axe-core reaches an e2e page through e2e/axe-inject.ts and nowhere else,
 * because that is where `axe.run` is made to wait until the page has
 * stopped scrolling (see its docblock: run mid-scroll, axe turned main red
 * on 8f379e1a with a target-size violation that a still page does not
 * have).
 *
 * The property: no e2e file other than the helper NAMES axe-core. Every
 * way to put axe on a page names it: the path of `axe.min.js`, its source
 * read from node_modules, or `@axe-core/playwright`. So a file that calls
 * `axe.run` without the helper must name it, and is caught here.
 *
 * The set is discovered (every .ts file under e2e/, walked), and bounded
 * both ways. A walk that goes blind reports no offender, so it must also
 * see enough `axe.run` callers to be looking at the real suite.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const E2E = join(ROOT, "e2e");
const HELPER = "e2e/axe-inject.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.ts$/.test(name) ? [p] : [];
  });
}

const files = walk(E2E).map((p) => ({
  file: relative(ROOT, p).replace(/\\/g, "/"),
  text: readFileSync(p, "utf8"),
}));

/**
 * A text that puts axe on a page: a string literal naming axe-core (a path,
 * a `require.resolve`, an import). Not prose: "axe-core's WCAG rules" in a
 * comment loads nothing, and three such comments were the first offenders
 * of a predicate that matched the bare word.
 */
const namesAxeCore = (text: string) => /["'`][^"'`\n]*axe-core/.test(text);

describe("axe-core reaches e2e pages only through the scroll-settling helper", () => {
  it("health: the walk sees the suite (80-400 files) and 10-60 files that call axe.run", () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
    expect(files.length).toBeLessThanOrEqual(400);
    const callers = files.filter((f) => /\baxe\.run\(/.test(f.text));
    expect(callers.length).toBeGreaterThanOrEqual(10);
    expect(callers.length).toBeLessThanOrEqual(60);
  });

  it("positive control: the predicate catches each way of naming axe-core, and the helper itself", () => {
    for (const planted of [
      `await page.addScriptTag({ path: fromRoot.resolve("axe-core/axe.min.js") });`,
      `await page.addScriptTag({ content: readFileSync(require.resolve("axe-core")) });`,
      `import AxeBuilder from "@axe-core/playwright";`,
    ])
      expect(namesAxeCore(planted), planted).toBe(true);
    for (const inert of [
      `await injectAxe(page);`,
      `/** axe-core's WCAG 2.x A/AA rules on the page as it stands. */`,
    ])
      expect(namesAxeCore(inert), inert).toBe(false);
    const helper = files.find((f) => f.file === HELPER);
    expect(helper, HELPER).toBeDefined();
    expect(namesAxeCore(helper!.text)).toBe(true);
  });

  it("no e2e file but the helper names axe-core", () => {
    expect(
      files
        .filter((f) => f.file !== HELPER && namesAxeCore(f.text))
        .map((f) => f.file),
    ).toEqual([]);
  });
});
