import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getToolContent } from "@/lib/tools/content";
import { guides } from "@/lib/guides/catalog";
import { modeFaq, toolFacts, toolFaq } from "@/lib/tools/tool-facts";
import { getToolBySlug, tools } from "@/lib/tools";

/**
 * TEST ONLY. Everything Create Fillable Forms says, split into sentences:
 * the subject set of create-forms-placement-copy.test.ts and
 * create-forms-detect-copy.test.ts, discovered rather than named.
 *
 *  - the tool's content, its catalogue row, its FAQ entries and facts;
 *  - every guide whose `tools` lists the slug;
 *  - the source text of every runner module the create-forms runner loads
 *    at run time (its static and `import()` edges, never `import type`)
 *    that no OTHER tool's runner loads: the shared kits are not this
 *    tool's words, a helper only this builder loads is (review round 7:
 *    the set was a filename pattern, so `find-fields-hint.tsx` was unseen);
 *  - every OTHER tool's content, FAQ or fact sentence that names Find
 *    fields (a cross-link, such as Fill Forms' "find no fields" answer);
 *  - every other source file under src/ that names Find fields, for the
 *    sentences that name it (a file nothing imports yet, a guide that does
 *    not list the slug).
 *
 * A guard can add what only it can render (the Find fields summary is built
 * at run time); the discovered part is shared so the two guards cannot drift
 * onto different sets.
 */
export const SLUG = "create-forms";

export interface Said {
  source: string;
  text: string;
}

export function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

export const sentences = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const RUNNER_DIR = path.join(
  process.cwd(),
  "src/components/tools/runner",
);

/** The runner's entry: the module that defines `CreateFormsRunner`. */
export const RUNNER_ENTRY = "create-forms-runner.tsx";

const SRC = path.join(process.cwd(), "src");

/**
 * The runner-directory modules `file` loads at RUN time: static imports
 * and re-exports that are not type-only, and `import("...")` calls. A type
 * import is erased, so it is not an edge (house rule 4).
 */
export function runtimeImports(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const specs: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly =
        c?.isTypeOnly ||
        (c &&
          !c.name &&
          c.namedBindings &&
          ts.isNamedImports(c.namedBindings) &&
          c.namedBindings.elements.length > 0 &&
          c.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) specs.push(n.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(n) &&
      !n.isTypeOnly &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      specs.push(n.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      specs.push(n.arguments[0].text);
    }
    n.forEachChild(visit);
  };
  visit(sf);
  const out: string[] = [];
  for (const s of specs) {
    const base = s.startsWith("./")
      ? s.slice(2)
      : s.startsWith("@/components/tools/runner/")
        ? s.slice("@/components/tools/runner/".length)
        : null;
    if (!base || base.includes("/")) continue;
    const hit = [`${base}.tsx`, `${base}.ts`].find((f) =>
      readdirSync(RUNNER_DIR).includes(f),
    );
    if (hit) out.push(hit);
  }
  return out;
}

const IMPORTS = new Map<string, string[]>();
const importsOf = (f: string): string[] => {
  let out = IMPORTS.get(f);
  if (!out) {
    out = runtimeImports(f, readFileSync(path.join(RUNNER_DIR, f), "utf8"));
    IMPORTS.set(f, out);
  }
  return out;
};

/** Every runner-directory module `entry` reaches at run time, itself included. */
export function reachable(entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const f = queue.shift()!;
    for (const g of importsOf(f))
      if (!seen.has(g)) {
        seen.add(g);
        queue.push(g);
      }
  }
  return seen;
}

/**
 * The runner modules the corpus reads: what the create-forms runner loads
 * at run time, less what any other runner entry (`*-runner.tsx`) also
 * reaches (the shared kits). An entry that reaches this runner itself (the
 * dispatcher, tool-runner.tsx) is not another tool's runner and is skipped.
 */
let RUNNER_FILES: string[] | null = null;
export const runnerFiles = (): string[] => (RUNNER_FILES ??= findRunnerFiles());
function findRunnerFiles(): string[] {
  const mine = reachable(RUNNER_ENTRY);
  const shared = new Set<string>();
  for (const other of readdirSync(RUNNER_DIR).filter(
    (f) => /-runner\.tsx$/.test(f) && f !== RUNNER_ENTRY,
  )) {
    const theirs = reachable(other);
    if (theirs.has(RUNNER_ENTRY)) continue;
    for (const f of theirs) shared.add(f);
  }
  return [...mine].filter((f) => !shared.has(f)).sort();
}

/** Every non-test .ts/.tsx under src/, as paths relative to src/. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\./.test(name))
      out.push(path.relative(SRC, full).split(path.sep).join("/"));
  }
  return out;
}

/** The product's name for the feature: what a cross-mention must name. */
export const NAMES_IT = /\bFind fields\b/;

/**
 * Every source file outside the runner set that names Find fields, with
 * the sentences in it that do (as written, or as shown).
 */
let NAMING_FILES: string[] | null = null;
export const namingFiles = (): string[] => (NAMING_FILES ??= findNamingFiles());
function findNamingFiles(): string[] {
  const runner = new Set(
    runnerFiles().map((f) => `components/tools/runner/${f}`),
  );
  return sourceFiles().filter(
    (f) =>
      !runner.has(f) &&
      f !== "tests/create-forms-copy-corpus.ts" &&
      // Every tool's content is read as SERVED, above.
      !f.startsWith("lib/tools/content/") &&
      NAMES_IT.test(readFileSync(path.join(SRC, f), "utf8")),
  );
}

/**
 * The text a runner module can SHOW: its string literals, template literals
 * (each substitution read as "N") and JSX text, each its own text; never a
 * comment or code. JSX text runs that a `{" "}` or an expression splits are
 * joined within one element, so a sentence the page shows whole is judged
 * whole.
 */
export function shownText(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: string[] = [];
  const template = (n: ts.TemplateExpression) =>
    n.head.text + n.templateSpans.map((s) => `N${s.literal.text}`).join("");
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      // The element's own text, its children's expressions read as text
      // when they are literals, as "N" otherwise; child elements apart.
      let run = "";
      for (const c of n.children) {
        if (ts.isJsxText(c)) run += c.text;
        else if (ts.isJsxExpression(c) && c.expression) {
          const e = c.expression;
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))
            run += e.text;
          else run += "N";
        } else {
          if (run.trim()) out.push(run);
          run = "";
        }
      }
      if (run.trim()) out.push(run);
      n.forEachChild((c) => {
        if (!ts.isJsxText(c)) visit(c);
      });
      return;
    }
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(template(n));
    n.forEachChild(visit);
  };
  visit(sf);
  return out.filter((t) => /[a-z]{2,} [a-z]{2,}/i.test(t));
}

/**
 * `source: "text"` reads each runner module as its whole source text (a
 * shape matched in a comment counts too); `"shown"` reads only what it can
 * show ({@link shownText}).
 */
export function createFormsCorpus(
  o: { source?: "text" | "shown" } = {},
): Said[] {
  const tool = getToolBySlug(SLUG)!;
  const out: Said[] = [];
  const add = (source: string, texts: string[]) => {
    for (const text of texts)
      for (const s of sentences(text)) out.push({ source, text: s });
  };
  add("content", strings(getToolContent(SLUG)));
  add("catalog", [tool.tagline, tool.description]);
  add("faq", strings([toolFaq(tool), modeFaq(tool), toolFacts(SLUG)]));
  for (const other of tools.filter((t) => t.slug !== SLUG)) {
    const said = strings([
      getToolContent(other.slug),
      toolFaq(other),
      modeFaq(other),
      toolFacts(other.slug),
    ])
      .flatMap(sentences)
      .filter((s) => NAMES_IT.test(s));
    add(`faq ${other.slug}`, said);
  }
  for (const guide of guides.filter((g) => g.tools.includes(SLUG)))
    add(`guide ${guide.slug}`, strings(guide));
  for (const file of runnerFiles()) {
    const text = readFileSync(path.join(RUNNER_DIR, file), "utf8");
    add(file, o.source === "shown" ? shownText(file, text) : [text]);
  }
  for (const file of namingFiles()) {
    const text = readFileSync(path.join(SRC, file), "utf8");
    // What it can SHOW, whatever the mode: a docblock elsewhere that
    // explains what may not be claimed is not a claim.
    const said = shownText(file, text)
      .flatMap(sentences)
      .filter((s) => NAMES_IT.test(s));
    add(`names ${file}`, said);
  }
  return out;
}
