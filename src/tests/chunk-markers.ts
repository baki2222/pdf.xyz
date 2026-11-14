/**
 * Which source module's code a shipped chunk carries — decided by
 * distinctive strings read off the module's own source and searched for in
 * the chunk's bytes. Shared by the build guards that ask "whose code is in
 * this page's first load" (`src/deploy/own-panel-first-load.test.ts`,
 * `src/deploy/variant-panels.test.ts`); the reasoning for markers over
 * module ids or Next's manifests is in the first of those.
 *
 * A marker is: in the module's own code (not a type, an import specifier, a
 * directive or a property name), at least `MARKER_MIN` characters with no
 * quote, backtick, backslash or control character, in NO other non-test
 * source file under src/ (compared whitespace-collapsed, the form JSX text
 * compiles to), and present in the built client chunks.
 */
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SRC } from "./tool-panel-modules";

const textCache = new Map<string, string>();
/** `file` as UTF-8, read once per run. */
export function readCached(file: string): string {
  let text = textCache.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    textCache.set(file, text);
  }
  return text;
}

/** Every file under `dir` whose base name `keep` accepts. */
export function walkFiles(
  dir: string,
  keep: (name: string) => boolean,
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(full, keep);
    return keep(entry.name) ? [full] : [];
  });
}

export const isTestFile = (name: string): boolean =>
  /\.(test|spec)\.tsx?$/.test(name);

/** Every non-test source file under src/ — the uniqueness corpus for markers. */
export const sourceFiles = (): string[] =>
  walkFiles(SRC, (n) => /\.tsx?$/.test(n) && !isTestFile(n));

/**
 * A source file with every whitespace run collapsed to one space — the form
 * its JSX text compiles to. Uniqueness is checked against THIS, not the raw
 * file: on the first split build a marker from the Office panel ("isolated
 * worker. It produces a PDF artifact or fails honestly — no") turned up in
 * the HTML-render panel's chunk, because that panel breaks the same sentence
 * at a different word and a raw substring search cannot see across a line
 * wrap.
 */
const flatCache = new Map<string, string>();
export function flatSource(file: string): string {
  let text = flatCache.get(file);
  if (text === undefined) {
    text = readCached(file).replace(/\s+/g, " ");
    flatCache.set(file, text);
  }
  return text;
}

/**
 * A built chunk's text with the minifier's `\xNN` and `\uNNNN` escapes
 * decoded. A string literal does NOT always survive verbatim: on 2026-11-10
 * every runner hint ("One PDF · pages laid out on sheets …") shipped with its
 * middle dot as `\xb7`, so a hint was never a marker and a runner with one
 * other string had ONE (n-up-runner.tsx, once its editor moved out). Read
 * chunks through this, never raw.
 */
const chunkCache = new Map<string, string>();
export function chunkText(file: string): string {
  let text = chunkCache.get(file);
  if (text === undefined) {
    text = readCached(file).replace(
      /\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})/g,
      (_, x?: string, u?: string) =>
        String.fromCharCode(parseInt((x ?? u)!, 16)),
    );
    chunkCache.set(file, text);
  }
  return text;
}

export const MARKER_MIN = 9;

/**
 * No quote, backtick or backslash (a minifier may re-escape or re-quote them)
 * and no control character. Written as char codes, not a regex class.
 */
export const plainText = (text: string): boolean =>
  [...text].every((ch) => {
    const code = ch.codePointAt(0)!;
    return (
      code >= 0x20 && code !== 0x7f && !"\"'`".includes(ch) && code !== 0x5c
    );
  });

/**
 * Strings in `file`'s own code that reach the compiled output: string
 * literals that are not types, specifiers, directives or property names, and
 * each trimmed line of JSX text (React joins the lines with one space, so a
 * single line is a substring of the compiled literal).
 */
export function ownStrings(file: string): string[] {
  const sf = ts.createSourceFile(
    file,
    readCached(file),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const erased =
        ts.isLiteralTypeNode(p) ||
        ts.isImportDeclaration(p) ||
        ts.isExportDeclaration(p) ||
        ts.isExternalModuleReference(p) ||
        (ts.isCallExpression(p) &&
          p.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        ts.isExpressionStatement(p) || // a directive: "use client"
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isPropertySignature(p) && p.name === n);
      if (!erased) out.push(n.text);
    } else if (ts.isJsxText(n)) {
      for (const line of n.text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) out.push(trimmed);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Up to `max` markers of `file`, longest first: its own strings that no
 * other source file has and some built chunk carries.
 */
export function markersOf(
  file: string,
  allSources: readonly string[],
  allChunks: readonly string[],
  max: number,
): string[] {
  const others = allSources.filter((f) => f !== file);
  return [...new Set(ownStrings(file))]
    .filter((t) => t.length >= MARKER_MIN && plainText(t))
    .filter((t) => others.every((f) => !flatSource(f).includes(t)))
    .filter((t) => allChunks.some((c) => chunkText(c).includes(t)))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, max);
}
