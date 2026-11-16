// @vitest-environment node
/**
 * GUARD: reading order is TRANSLATE'S, and the shared extractor is untouched.
 *
 * `resolveNativePdfTextExtractor` (`../pdf-text/native`) serves summarize,
 * ai-extract, chat-with-pdf (and its page-selection proof), OCR's read-back
 * and the four OCR proof scripts.
 * One more file calls it ON PURPOSE without consuming it: Translate's own
 * reading-order proof (`scripts/worker-translate-reading-order-proof.ts`)
 * wires the shared resolver into the probe as its CONTROL, which must come
 * out false FOR ORDER. That call is what makes the probe able to fail, so it
 * is listed here by name and reason — a control, not a consumer.
 * Translate's reading order adds a second `pdftotext` run (`-bbox-layout`);
 * that run must reach Translate and nobody else, so Translate builds its own
 * composite (`./native`, `nativeTranslateExtractor`) instead of changing the
 * shared one. Two halves, each able to fail on its own:
 *
 *  - STRUCTURAL: the call sites are DISCOVERED — `git ls-files src scripts`,
 *    non-test `.ts`/`.tsx`/`.mts`/`.cts`, each parsed with the TypeScript
 *    compiler, every call of `resolveNativePdfTextExtractor` collected however
 *    it is spelled (bare, through a local alias, or as a property/element
 *    call; a renamed re-export is reported separately) — and must be
 *    exactly the nine consumers plus the one control above (ten), NOT
 *    `translate/native.ts`. A broken walk is FATAL (at least 4 engine call
 *    sites under `src/lib/workers` and 10 in all), never a vacuous pass.
 *  - BEHAVIOURAL: the shared resolver, on a text PDF, issues exactly ONE
 *    `pdftotext` run, with `-layout`. A composite slipped inside it would add
 *    a `-bbox-layout` run for every AI engine and for OCR.
 *
 * MUTATIONS (2026-11-16, each on the file with a backup copy, grepped back,
 * restored and diffed empty): putting the composite inside the shared
 * resolver turned the behavioural half red; putting the shared call back in
 * `translate/native.ts` turned the structural half red.
 *
 * HISTORY (merge of origin/main, 2026-11-16): #337 added Chat with PDF's
 * page-selection proof (`chat-with-pdf/retrieval-capability.ts`), which
 * reads the shared resolver as a real consumer — the image's `-layout` text,
 * the same as chat's engine. The walk found it on the merge (red until
 * listed); eight consumers became nine, nine call sites ten.
 *
 * HISTORY (S3 review, 2026-11-16): the walk matched only a bare-identifier
 * call in a `.ts` file, so `import { … as r }`, `pt.resolveNative…(…)` and
 * any `.tsx`/`.mts` caller walked past it. Each form now has a positive
 * control below.
 *
 * HISTORY (review 2026-11-16): commit C added the control call to the proof
 * script and left this list at eight, so the guard went red on its own
 * branch — the discovery doing its job, the expected set never updated. The
 * list now names the control separately from the consumers.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  resolveNativePdfTextExtractor,
  type PdfTextExec,
} from "../pdf-text/native";
import { TWO_COLUMN_BBOX, TWO_COLUMN_LAYOUT } from "@/tests/poppler-samples";

const ROOT = process.cwd();
const NAME = "resolveNativePdfTextExtractor";

/** The script kinds the walk reads: `.ts`, `.tsx`, `.mts`, `.cts`. */
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;
/** Declarations and tests are not call sites. */
const NOT_A_CALL_SITE = /(?:\.d\.[cm]?ts|\.test\.[cm]?tsx?)$/;

/** Is `file` (a `git ls-files` path) one the walk must parse? */
function isScanned(file: string): boolean {
  return SOURCE_FILE.test(file) && !NOT_A_CALL_SITE.test(file);
}

/** The name a property-name node spells, when it spells one statically. */
function staticName(n: ts.Node | undefined): string | undefined {
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) return n.text;
  return undefined;
}

/**
 * Every call of `name` in `source`, by line — whatever the call is spelled
 * through (S3 review, 2026-11-16; the first walk matched only a bare
 * `name(...)` in `.ts` files):
 *
 *  - the bare identifier, and every LOCAL ALIAS of it: `import { name as r }`,
 *    `const { name: r } = await import(...)`, `const r = name` (chained);
 *  - a property or element call on anything: `ns.name(...)` (a namespace
 *    import, a dynamic import's module object) and `x["name"](...)`.
 *
 * Aliases are collected in passes over the whole file before any call is
 * matched, so a call that appears before its binding is still seen.
 */
function callsOf(source: string, file: string, name: string): number[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const local = new Set<string>([name]);
  const bind = (n: ts.Node): void => {
    // import { name as r } from "..."
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === name)
      local.add(n.name.text);
    // const { name: r } = ...
    if (
      ts.isBindingElement(n) &&
      ts.isIdentifier(n.name) &&
      staticName(n.propertyName ?? n.name) === name
    )
      local.add(n.name.text);
    ts.forEachChild(n, bind);
  };
  // `const r = name` may chain (`const s = r`): bind to a fixpoint.
  const alias = (n: ts.Node): boolean => {
    let grew = false;
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isIdentifier(n.initializer) &&
      local.has(n.initializer.text) &&
      !local.has(n.name.text)
    ) {
      local.add(n.name.text);
      grew = true;
    }
    ts.forEachChild(n, (c) => {
      if (alias(c)) grew = true;
    });
    return grew;
  };
  bind(sf);
  while (alias(sf));

  const lines: number[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const hit =
        (ts.isIdentifier(callee) && local.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === name) ||
        (ts.isElementAccessExpression(callee) &&
          staticName(callee.argumentExpression) === name);
      if (hit)
        lines.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return lines;
}

/**
 * Re-exports of `name` under ANOTHER name (`export { name as other }`): a
 * file importing `other` never spells `name`, so the per-file pre-filter and
 * the alias pass above cannot see its calls. None may exist; the guard
 * asserts so at the re-exporting file, which does spell the name.
 */
function renamedReExports(source: string, file: string, name: string): number {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found = 0;
  const visit = (n: ts.Node): void => {
    if (
      ts.isExportSpecifier(n) &&
      (n.propertyName ?? n.name).text === name &&
      n.name.text !== name
    )
      found += 1;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function discoverCallSites(): {
  files: string[];
  scanned: string[];
  laundered: string[];
} {
  const scanned = execFileSync("git", ["ls-files", "src", "scripts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(isScanned);
  const files: string[] = [];
  const laundered: string[] = [];
  for (const file of scanned) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    // Cheap pre-filter; the AST decides. Every form above spells the name in
    // the calling file; the one that does not (importing a renamed
    // re-export) is caught at the re-exporting file, which does.
    if (!source.includes(NAME)) continue;
    if (callsOf(source, file, NAME).length > 0) files.push(file);
    if (renamedReExports(source, file, NAME) > 0) laundered.push(file);
  }
  return { files: files.sort(), scanned, laundered };
}

describe("the shared pdftotext extractor stays shared, and Translate is not on it", () => {
  const { files, scanned, laundered } = discoverCallSites();

  it("health: the walk saw the tree and found the engine call sites", () => {
    expect(
      scanned.length,
      "git ls-files returned implausibly few files",
    ).toBeGreaterThan(500);
    // The widened set is really read: `.tsx` files are in it (the app's
    // components), so a filter that silently dropped them shows here.
    expect(
      scanned.filter((f) => f.endsWith(".tsx")).length,
      "no .tsx file was scanned",
    ).toBeGreaterThan(50);
    const engines = files.filter((f) => f.startsWith("src/lib/workers/"));
    expect(engines.length, JSON.stringify(files)).toBeGreaterThanOrEqual(4);
    expect(files.length, JSON.stringify(files)).toBeGreaterThanOrEqual(11);
  });

  it("the call sites are exactly eleven: the ten consumers and Translate's proof control, and not translate/native.ts", () => {
    expect(files).not.toContain("src/lib/workers/translate/native.ts");
    expect(files).toEqual(
      [
        // CONTROL, not a consumer: the reading-order proof wires the shared
        // resolver into the probe on purpose, so the probe must fail on order.
        "scripts/worker-translate-reading-order-proof.ts",
        // Consumers.
        "scripts/worker-ocr-deskew-proof.ts",
        "scripts/worker-ocr-languages-proof.ts",
        "scripts/worker-ocr-redo-proof.ts",
        "scripts/worker-ocr-rotate-proof.ts",
        "src/lib/workers/ai-extract/native.ts",
        "src/lib/workers/chat-with-pdf/native.ts",
        // Chat's page-selection proof (#337): reads -layout like chat does.
        "src/lib/workers/chat-with-pdf/retrieval-capability.ts",
        "src/lib/workers/ocr-native.ts",
        "src/lib/workers/summarize/native.ts",
        // Summarize's chosen-pages proof (slice 5, merged beside #340): reads
        // -layout like summarize does, so poppler's own blank-page numbering
        // is what gets proved.
        "src/lib/workers/summarize/pages-capability.ts",
      ].sort(),
    );
  });

  it("no file re-exports the resolver under another name", () => {
    expect(laundered).toEqual([]);
  });

  it("positive control: the AST predicate sees a call, and ignores a mention", () => {
    expect(callsOf(`const x = ${NAME}(env);`, "a.ts", NAME)).toEqual([1]);
    expect(
      callsOf(`// ${NAME}(env)\nconst s = "${NAME}(env)";`, "b.ts", NAME),
    ).toEqual([]);
  });

  // Each form the S3 review named — the first walk was blind to every one of
  // them — plus near-misses that must stay quiet.
  it.each([
    [
      "an aliased import",
      `import { ${NAME} as r } from "../pdf-text/native";\nconst x = r(env);`,
      "a.ts",
      [2],
    ],
    [
      "a namespace import's property call",
      `import * as pt from "../pdf-text/native";\nconst x = pt.${NAME}(env);`,
      "a.ts",
      [2],
    ],
    [
      "a property call on any object",
      `const x = deps.native.${NAME}(env);`,
      "a.ts",
      [1],
    ],
    ["an element-access call", `const x = mod["${NAME}"](env);`, "a.ts", [1]],
    [
      "a destructured dynamic import, renamed",
      `const { ${NAME}: r } = await import("../pdf-text/native");\nr(env);`,
      "a.ts",
      [2],
    ],
    [
      "a chained variable alias, called before it is bound",
      `function f() { return s(env); }\nconst r = ${NAME};\nconst s = r;`,
      "a.ts",
      [1],
    ],
    [
      "a call in a .tsx file, inside JSX",
      `export const C = () => <div>{String(${NAME}(env))}</div>;`,
      "c.tsx",
      [1],
    ],
    ["a call in a .mts file", `export const x = ${NAME}(env);`, "m.mts", [1]],
    [
      "near-miss: a different property",
      `const x = pt.${NAME}Config(env);`,
      "a.ts",
      [],
    ],
    [
      "near-miss: an alias imported but never called",
      `import { ${NAME} as r } from "../pdf-text/native";\nexport const k = r;`,
      "a.ts",
      [],
    ],
  ] as const)("positive control: %s", (_label, source, file, lines) => {
    expect(callsOf(source, file, NAME)).toEqual(lines);
  });

  it("positive control: a renamed re-export is reported, a plain one is not", () => {
    expect(
      renamedReExports(
        `export { ${NAME} as other } from "../pdf-text/native";`,
        "a.ts",
        NAME,
      ),
    ).toBe(1);
    expect(
      renamedReExports(
        `export { ${NAME} } from "../pdf-text/native";`,
        "a.ts",
        NAME,
      ),
    ).toBe(0);
  });

  it("positive control: the file filter reads .ts, .tsx, .mts and .cts, and skips tests and declarations", () => {
    expect(
      [
        "a.ts",
        "b.tsx",
        "c.mts",
        "d.cts",
        "e.d.ts",
        "f.d.mts",
        // Built, not spelled: test-references.test.ts reads a spelled
        // `*.test.ts` name as a reference to a test that must exist.
        ["g", "test", "ts"].join("."),
        ["h", "test", "tsx"].join("."),
        "i.js",
      ].filter(isScanned),
    ).toEqual(["a.ts", "b.tsx", "c.mts", "d.cts"]);
  });

  it("behavioural: the shared resolver issues exactly one pdftotext run, with -layout, on a text PDF", async () => {
    const argv: string[][] = [];
    const exec: PdfTextExec = async (_command, args) => {
      argv.push([...args]);
      return args.includes("-bbox-layout")
        ? TWO_COLUMN_BBOX
        : TWO_COLUMN_LAYOUT;
    };
    const extract = resolveNativePdfTextExtractor(
      {},
      { resolveOnPath: () => true, exec },
    );
    expect(extract, "health: the resolver wired an extractor").toBeDefined();
    const extracted = await extract!(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(extracted.hasText).toBe(true);
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain("-layout");
    expect(argv[0]).not.toContain("-bbox-layout");
    expect("readingOrder" in extracted).toBe(false);
  });
});
