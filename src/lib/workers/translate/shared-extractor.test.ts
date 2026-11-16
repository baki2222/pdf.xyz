// @vitest-environment node
/**
 * GUARD: reading order is TRANSLATE'S, and the shared extractor is untouched.
 *
 * `resolveNativePdfTextExtractor` (`../pdf-text/native`) serves summarize,
 * ai-extract, chat-with-pdf, OCR's read-back and the four OCR proof scripts.
 * Translate's reading order adds a second `pdftotext` run (`-bbox-layout`);
 * that run must reach Translate and nobody else, so Translate builds its own
 * composite (`./native`, `nativeTranslateExtractor`) instead of changing the
 * shared one. Two halves, each able to fail on its own:
 *
 *  - STRUCTURAL: the call sites are DISCOVERED — `git ls-files src scripts`,
 *    non-test `.ts`, each parsed with the TypeScript compiler, every
 *    CallExpression of `resolveNativePdfTextExtractor` collected — and must be
 *    exactly the eight consumers above, NOT `translate/native.ts`. A broken
 *    walk is FATAL (at least 4 engine call sites under `src/lib/workers` and
 *    8 in all), never a vacuous pass.
 *  - BEHAVIOURAL: the shared resolver, on a text PDF, issues exactly ONE
 *    `pdftotext` run, with `-layout`. A composite slipped inside it would add
 *    a `-bbox-layout` run for every AI engine and for OCR.
 *
 * MUTATIONS (2026-11-16, each on the file with a backup copy, grepped back,
 * restored and diffed empty): putting the composite inside the shared
 * resolver turned the behavioural half red; putting the shared call back in
 * `translate/native.ts` turned the structural half red.
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

/** Every CallExpression of `name` in `source`, by line. */
function callsOf(source: string, file: string, name: string): number[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === name
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return lines;
}

function discoverCallSites(): { files: string[]; scanned: number } {
  const listed = execFileSync("git", ["ls-files", "src", "scripts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(
      (f) =>
        f.endsWith(".ts") && !f.endsWith(".d.ts") && !/\.test\.ts$/.test(f),
    );
  const files: string[] = [];
  for (const file of listed) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    // Cheap pre-filter; the AST decides.
    if (!source.includes(NAME)) continue;
    if (callsOf(source, file, NAME).length > 0) files.push(file);
  }
  return { files: files.sort(), scanned: listed.length };
}

describe("the shared pdftotext extractor stays shared, and Translate is not on it", () => {
  const { files, scanned } = discoverCallSites();

  it("health: the walk saw the tree and found the engine call sites", () => {
    expect(
      scanned,
      "git ls-files returned implausibly few files",
    ).toBeGreaterThan(500);
    const engines = files.filter((f) => f.startsWith("src/lib/workers/"));
    expect(engines.length, JSON.stringify(files)).toBeGreaterThanOrEqual(4);
    expect(files.length, JSON.stringify(files)).toBeGreaterThanOrEqual(8);
  });

  it("the call sites are exactly the eight consumers, and not translate/native.ts", () => {
    expect(files).not.toContain("src/lib/workers/translate/native.ts");
    expect(files).toEqual(
      [
        "scripts/worker-ocr-deskew-proof.ts",
        "scripts/worker-ocr-languages-proof.ts",
        "scripts/worker-ocr-redo-proof.ts",
        "scripts/worker-ocr-rotate-proof.ts",
        "src/lib/workers/ai-extract/native.ts",
        "src/lib/workers/chat-with-pdf/native.ts",
        "src/lib/workers/ocr-native.ts",
        "src/lib/workers/summarize/native.ts",
      ].sort(),
    );
  });

  it("positive control: the AST predicate sees a call, and ignores a mention", () => {
    expect(callsOf(`const x = ${NAME}(env);`, "a.ts", NAME)).toEqual([1]);
    expect(
      callsOf(`// ${NAME}(env)\nconst s = "${NAME}(env)";`, "b.ts", NAME),
    ).toEqual([]);
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
