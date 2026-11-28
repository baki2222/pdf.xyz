/**
 * axe-core reaches an e2e page through e2e/axe-inject.ts and nowhere else,
 * because that is where `axe.run` is made to wait until the page has
 * stopped scrolling (see its docblock: run mid-scroll, axe turned main red
 * on 8f379e1a with a target-size violation that a still page does not
 * have).
 *
 * THE SET IS PLAYWRIGHT'S REACH, not a folder: every spec Playwright itself
 * lists, its config files, and everything they import or name, followed
 * into src/ and scripts/ and in any script extension. This is the
 * derivation the wall-clock guard uses (wall-clock-corpus.ts). The first
 * version walked `e2e/*.ts`, and review planted four ways past it that
 * stayed green: an `.mjs` under e2e/, a fixture under src/tests a spec
 * imports, and two split names, `"axe-" + "core"` and a template.
 *
 * Two predicates, each over the whole set, the helper excepted:
 * - no string names axe-core (a path, a `require.resolve`, an import);
 * - no `addScriptTag` call at all: that is how a script reaches the page
 *   whatever its name is spelt as, so a split name is caught here. Only
 *   the helper calls it (`addInitScript`, which many specs use for
 *   storage keys, runs before the page and is not this).
 *
 * Bounded both ways, so a walk that goes blind cannot report "no
 * offender": a reach of plausible size that leaves e2e/, and enough
 * `axe.run` callers to be looking at the real suite.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { e2eCorpus } from "./wall-clock-corpus";

const ROOT = path.join(__dirname, "..", "..");
const HELPER = "e2e/axe-inject.ts";
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

/** A relative or `@/` specifier to a repo file, or undefined (a package). */
function resolve(spec: string, from: string): string | undefined {
  const base = spec.startsWith("@/")
    ? path.join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(path.join(ROOT, from)), spec)
      : undefined;
  if (!base) return undefined;
  const tries = [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => path.join(base, "index" + e)),
  ];
  const hit = tries.find((p) => existsSync(p) && statSync(p).isFile());
  return hit ? rel(hit) : undefined;
}

/**
 * Playwright's reach: what it lists, and everything those import, static
 * or dynamic, followed into src/ and scripts/. A page script can only
 * come from code the Playwright process runs, so imports are the whole
 * path. The wall-clock guard's `supportCorpus` also follows names in
 * strings (spawned children, child configs), which cannot add a script to
 * a page, and costs 168 s here; this walk costs about a second.
 */
function playwrightReach(entries: readonly string[]): {
  files: string[];
  unresolvedRelative: string[];
} {
  const seen = new Set<string>();
  const unresolvedRelative: string[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const { fileName } of ts.preProcessFile(text, true, true)
      .importedFiles) {
      const hit = resolve(fileName, file);
      if (hit) queue.push(hit);
      else if (fileName.startsWith(".") || fileName.startsWith("@/"))
        unresolvedRelative.push(`${file} -> ${fileName}`);
    }
  }
  return { files: [...seen].sort(), unresolvedRelative };
}

/** A string literal naming axe-core. Prose in a comment loads nothing. */
const namesAxeCore = (text: string) => /["'`][^"'`\n]*axe-core/.test(text);
/** A call that puts a script on the page. */
const addsScriptTag = (text: string) => /\baddScriptTag\s*\(/.test(text);

let files: { file: string; text: string }[] = [];
let listed = 0;
let unresolvedRelative: string[] = [];

beforeAll(() => {
  const e2e = e2eCorpus();
  listed = e2e.listed.length;
  const reach = playwrightReach([...e2e.listed, ...e2e.configFiles]);
  unresolvedRelative = reach.unresolvedRelative;
  files = reach.files
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !f.endsWith(".d.ts"))
    .map((file) => ({
      file,
      text: readFileSync(path.join(ROOT, file), "utf8"),
    }));
}, 60_000);

describe("axe-core reaches e2e pages only through the scroll-settling helper", () => {
  it("health: Playwright lists the suite, every repo import resolves, and the reach is plausible, leaves e2e/, holds the helper, and sees the axe.run callers", () => {
    expect(listed).toBeGreaterThanOrEqual(80);
    expect(listed).toBeLessThanOrEqual(200);
    // A broken link is fatal: a walk that silently stops is a smaller set.
    expect(unresolvedRelative).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(listed + 40);
    expect(files.length).toBeLessThanOrEqual(1500);
    expect(files.map((f) => f.file)).toContain(HELPER);
    // A fixture a spec imports from src/tests is in: one review evasion
    // was a raw-axe fixture there.
    expect(files.map((f) => f.file)).toContain(
      "src/tests/hostile/conversion-out.fixtures.ts",
    );
    const callers = files.filter((f) => /\baxe\.run\(/.test(f.text));
    expect(callers.length).toBeGreaterThanOrEqual(10);
    expect(callers.length).toBeLessThanOrEqual(60);
  });

  it("positive control: each predicate catches what it is for, prose and init scripts pass, and the helper is caught", () => {
    for (const planted of [
      `await page.addScriptTag({ path: fromRoot.resolve("axe-core/axe.min.js") });`,
      `await page.addScriptTag({ content: readFileSync(require.resolve("axe-core")) });`,
      `import AxeBuilder from "@axe-core/playwright";`,
    ])
      expect(namesAxeCore(planted), planted).toBe(true);
    for (const split of [
      `await page.addScriptTag({ path: require.resolve("axe-" + "core/axe.min.js") });`,
      "await page.addScriptTag({ path: require.resolve(`${p}-core/axe.min.js`) });",
    ]) {
      expect(namesAxeCore(split), split).toBe(false);
      expect(addsScriptTag(split), split).toBe(true);
    }
    for (const inert of [
      `await injectAxe(page);`,
      `/** axe-core's WCAG 2.x A/AA rules on the page as it stands. */`,
      `await page.addInitScript((key) => localStorage.setItem(key, "1"), KEY);`,
    ]) {
      expect(namesAxeCore(inert), inert).toBe(false);
      expect(addsScriptTag(inert), inert).toBe(false);
    }
    const helper = files.find((f) => f.file === HELPER)!;
    expect(namesAxeCore(helper.text)).toBe(true);
    expect(addsScriptTag(helper.text)).toBe(true);
  });

  it("no file in Playwright's reach but the helper names axe-core", () => {
    expect(
      files
        .filter((f) => f.file !== HELPER && namesAxeCore(f.text))
        .map((f) => f.file),
    ).toEqual([]);
  });

  it("no file in Playwright's reach but the helper calls addScriptTag", () => {
    expect(
      files
        .filter((f) => f.file !== HELPER && addsScriptTag(f.text))
        .map((f) => f.file),
    ).toEqual([]);
  });
});
