import { readFileSync, readdirSync } from "node:fs";
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
 *  - the source text of every `create-forms*` runner module (the runner's
 *    help is JSX), the Find fields chunk included;
 *  - every OTHER tool's FAQ or fact sentence that names Find fields (a
 *    cross-link, such as Fill Forms' "find no fields" answer).
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

/** The runner modules the corpus reads: every create-forms*.ts(x) but tests. */
export const runnerFiles = () =>
  readdirSync(RUNNER_DIR).filter(
    (f) => /^create-forms.*\.tsx?$/.test(f) && !/\.test\./.test(f),
  );

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
      toolFaq(other),
      modeFaq(other),
      toolFacts(other.slug),
    ])
      .flatMap(sentences)
      .filter((s) => /\bFind fields\b/.test(s));
    add(`faq ${other.slug}`, said);
  }
  for (const guide of guides.filter((g) => g.tools.includes(SLUG)))
    add(`guide ${guide.slug}`, strings(guide));
  for (const file of runnerFiles()) {
    const text = readFileSync(path.join(RUNNER_DIR, file), "utf8");
    add(file, o.source === "shown" ? shownText(file, text) : [text]);
  }
  return out;
}
