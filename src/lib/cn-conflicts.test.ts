// @vitest-environment node
/**
 * No `cn()` call can produce two classes from one Tailwind family — written
 * at the call, or arriving through a component's `className`.
 *
 * `cn()` is `clsx`: it joins, it does not merge (src/tests/class-conflicts.ts
 * says why, and what that cost). So `cn("px-2", wide && "px-4")` ships BOTH,
 * and which one applies is decided by the order Tailwind emits them, not by
 * the order they were written. This reads every `cn()` call in src from the
 * AST and checks every combination of classes its branches can produce: a
 * literal always applies, `x && "a"` may or may not, `x ? "a" : "b"` is one
 * or the other, `{ a: x }` may or may not, and a same-file `const` (a string,
 * or a map of strings indexed by a variant) is read through.
 *
 * FORWARDED CLASSES. A component that ends its `cn()` with its `className`
 * prop (`Spinner`, `ModeShape`, `buttonVariants` and `Button` over it) takes
 * its callers' classes on top of its own defaults — the idiom the old runtime
 * merge existed for. Each such component is found from its definition, and
 * every `<Component className=…>` / `component({ className: … })` in src,
 * resolved through the caller's import, is checked against its defaults.
 *
 * An argument the AST cannot read (a variable, a prop passed further on)
 * contributes nothing here; the prerendered pages (ssr-content.test.ts) and
 * the component suite (src/tests/setup.ts) see those as rendered.
 *
 * THE SET IS DERIVED — every .ts/.tsx file under src — and bounded both ways,
 * so a walker that went blind (or found a second tree) fails as implausible
 * rather than passing over nothing.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { droppedClasses } from "@/tests/class-conflicts";
import { cn } from "./utils";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
/** Above this many combinations a call is checked on its first ones only. */
const MAX_COMBOS = 512;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

function product(lists: string[][]): string[] {
  let acc = [""];
  for (const list of lists) {
    const next: string[] = [];
    for (const a of acc)
      for (const b of new Set(list)) {
        next.push(`${a} ${b}`);
        if (next.length >= MAX_COMBOS) break;
      }
    acc = next;
  }
  return acc;
}

const isCn = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === "cn";

/** One parsed file: its consts, its forwarders, its imports. */
class SourceFile {
  readonly sf: ts.SourceFile;
  /** `const X = "…"` → its value; `const X = { k: "…" }` → its values. */
  private readonly consts = new Map<string, string[]>();
  /** Local name → the module file it is imported from. */
  readonly imports = new Map<string, string>();

  constructor(
    readonly file: string,
    text: string,
  ) {
    this.sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isVariableDeclarationList(node.parent) &&
        node.parent.flags & ts.NodeFlags.Const
      ) {
        const init = node.initializer;
        if (
          ts.isStringLiteral(init) ||
          ts.isNoSubstitutionTemplateLiteral(init)
        )
          this.consts.set(node.name.text, [init.text]);
        else if (ts.isObjectLiteralExpression(init)) {
          const values = init.properties.flatMap((p) =>
            ts.isPropertyAssignment(p) &&
            (ts.isStringLiteral(p.initializer) ||
              ts.isNoSubstitutionTemplateLiteral(p.initializer))
              ? [p.initializer.text]
              : [],
          );
          if (values.length > 0 && values.length === init.properties.length)
            this.consts.set(node.name.text, values);
        }
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        const target = resolveModule(file, node.moduleSpecifier.text);
        if (target)
          for (const el of node.importClause.namedBindings.elements)
            this.imports.set(el.name.text, target);
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  line(node: ts.Node): string {
    const { line } = this.sf.getLineAndCharacterOfPosition(node.getStart());
    return `${path.relative(ROOT, this.file).replace(/\\/g, "/")}:${line + 1}`;
  }

  /** Every class string an expression can evaluate to ("" = nothing known). */
  options(node: ts.Expression): string[] {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
      return this.options(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return [node.text];
    if (ts.isTemplateExpression(node))
      // A substitution is unknown; the literal parts always apply.
      return [
        [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(
          " ",
        ),
      ];
    if (ts.isIdentifier(node)) return this.consts.get(node.text) ?? [""];
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression))
      return this.consts.get(node.expression.text) ?? [""];
    if (ts.isConditionalExpression(node))
      return [...this.options(node.whenTrue), ...this.options(node.whenFalse)];
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken)
        return ["", ...this.options(node.right)];
      if (
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      )
        return [...this.options(node.left), ...this.options(node.right)];
    }
    if (ts.isArrayLiteralExpression(node))
      return product(
        node.elements.filter(ts.isExpression).map((e) => this.options(e)),
      );
    if (ts.isObjectLiteralExpression(node))
      return product(
        node.properties.map((p) => {
          const name =
            p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))
              ? p.name.text
              : "";
          return ["", name];
        }),
      );
    return [""];
  }
}

function resolveModule(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ])
    if (existsSync(candidate)) return candidate;
  return null;
}

const mentionsClassName = (node: ts.Node): boolean => {
  let found = false;
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === "className") found = true;
    else if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

/** The name a function-like node is known by, if it has one. */
function functionName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  )
    return node.parent.name.text;
  return null;
}

interface Finding {
  at: string;
  dropped: string[];
  classes: string;
}

function firstConflict(
  combos: string[],
): { dropped: string[]; classes: string } | null {
  for (const classes of combos) {
    const dropped = droppedClasses(classes);
    if (dropped.length > 0)
      return { dropped, classes: classes.trim().replace(/\s+/g, " ") };
  }
  return null;
}

/** Scan a set of files; `texts` maps file → source. */
function scan(texts: Map<string, string>): {
  calls: number;
  forwarders: string[];
  forwardedSites: number;
  found: Finding[];
} {
  const files = [...texts].map(([file, text]) => new SourceFile(file, text));
  let calls = 0;
  const found: Finding[] = [];
  // file + name → the default class combinations a forwarder adds.
  const defaults = new Map<string, string[]>();
  const key = (file: string, name: string) => `${file}\0${name}`;

  // Pass 1: every cn() call, and every component that forwards `className`.
  for (const f of files) {
    const visit = (node: ts.Node, owner: string | null) => {
      const name = functionName(node) ?? owner;
      if (isCn(node)) {
        calls += 1;
        const conflict = firstConflict(
          product(node.arguments.map((a) => f.options(a))),
        );
        if (conflict) found.push({ at: f.line(node), ...conflict });
        if (name && node.arguments.some(mentionsClassName)) {
          const own = product(
            node.arguments
              .filter((a) => !mentionsClassName(a))
              .map((a) => f.options(a)),
          );
          defaults.set(key(f.file, name), own);
        }
      }
      ts.forEachChild(node, (child) => visit(child, name));
    };
    visit(f.sf, null);
  }

  // The forwarder a name refers to in a file: its own, or the one imported.
  const resolve = (f: SourceFile, name: string): string[] | undefined =>
    defaults.get(key(f.file, name)) ??
    (f.imports.has(name)
      ? defaults.get(key(f.imports.get(name)!, name))
      : undefined);

  // Pass 2, to a fixpoint: a component that hands its `className` to a
  // forwarder (`Button` → `buttonVariants`) forwards too, with its defaults.
  for (let round = 0; round < 3; round += 1)
    for (const f of files) {
      const visit = (node: ts.Node, owner: string | null) => {
        const name = functionName(node) ?? owner;
        if (
          name &&
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.arguments.some(mentionsClassName)
        ) {
          const inner = resolve(f, node.expression.text);
          if (inner && !defaults.has(key(f.file, name)))
            defaults.set(key(f.file, name), inner);
        }
        ts.forEachChild(node, (child) => visit(child, name));
      };
      visit(f.sf, null);
    }

  // Pass 3: every caller that hands classes to a forwarder.
  let forwardedSites = 0;
  for (const f of files) {
    const check = (node: ts.Node, name: string, cls: ts.Expression) => {
      const own = resolve(f, name);
      if (!own) return;
      forwardedSites += 1;
      const combos: string[] = [];
      for (const extra of f.options(cls))
        for (const d of own) combos.push(`${d} ${extra}`);
      const conflict = firstConflict(combos.slice(0, MAX_COMBOS * 4));
      if (conflict)
        found.push({ at: `${f.line(node)} (into ${name})`, ...conflict });
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(f.sf);
        for (const attr of node.attributes.properties)
          if (
            ts.isJsxAttribute(attr) &&
            attr.name.getText(f.sf) === "className" &&
            attr.initializer
          ) {
            const value = ts.isJsxExpression(attr.initializer)
              ? attr.initializer.expression
              : attr.initializer;
            if (value && ts.isExpression(value)) check(node, name, value);
          }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      )
        for (const p of node.arguments[0].properties)
          if (
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === "className" &&
            !mentionsClassName(p.initializer)
          )
            check(node, node.expression.text, p.initializer);
      ts.forEachChild(node, visit);
    };
    visit(f.sf);
  }

  return {
    calls,
    forwarders: [...defaults.keys()].map((k) => k.split("\0")[1]!),
    forwardedSites,
    found: found.filter((a, i) => found.findIndex((b) => b.at === a.at) === i),
  };
}

const one = (source: string) =>
  scan(new Map([[path.join(SRC, "control.tsx"), source]]));

describe("cn() in the suite", () => {
  it("joins without merging, and the suite's observer refuses a conflict", () => {
    expect(cn("size-2", false && "x", "text-fg")).toBe("size-2 text-fg");
    // src/tests/setup.ts: every component test runs under this.
    expect(() => cn("size-4 animate-spin", "size-3")).toThrow(
      /conflicting classes — \[size-4\]/,
    );
  });
});

describe("cn() call sites", () => {
  it("positive control: the scan sees a base class and its override", () => {
    const hit = one('const a = cn("size-4 animate-spin", big && "size-6");');
    expect(hit.calls).toBe(1);
    expect(hit.found.map((f) => f.dropped)).toEqual([["size-4"]]);
    // ...and does NOT flag the fix: one class per family, per branch.
    expect(
      one('const a = cn("animate-spin", big ? "size-6" : "size-4");').found,
    ).toEqual([]);
    // Through a const map indexed by a variant.
    expect(
      one(
        'const v = { a: "px-2", b: "px-4" };\nconst x = cn("px-3", v[k]);',
      ).found.map((f) => f.dropped),
    ).toEqual([["px-3"]]);
    // Through a forwarded className, and through a component built on one.
    const forwarded = one(
      [
        'function Spin({ className }) { return <i className={cn("size-4", className)} />; }',
        "function Wrap({ className }) { return <b className={spinClass({ className })} />; }",
        'function spinClass({ className }) { return cn("p-2", className); }',
        'const a = <Spin className="size-3" />;',
        'const b = <Wrap className="p-4" />;',
        'const c = <Spin className="text-ok" />;',
      ].join("\n"),
    );
    expect(forwarded.found.map((f) => f.dropped)).toEqual([
      ["size-4"],
      ["p-2"],
    ]);
    // The oracle knows this theme: a display size is not a colour.
    expect(droppedClasses("text-fg text-display-1")).toEqual([]);
  });

  it("no call can produce two classes from one family", () => {
    const files = sourceFiles(SRC);
    const texts = new Map(
      files.map((file) => [file, readFileSync(file, "utf8")] as const),
    );
    const { calls, forwarders, forwardedSites, found } = scan(texts);
    // Health check, both ways (2026-10-29: 175 calls, 40 forwarders, 44
    // forwarded sites). A blind walker reports a clean tree.
    expect(files.length).toBeGreaterThan(300);
    expect(calls).toBeGreaterThanOrEqual(120);
    expect(calls).toBeLessThanOrEqual(1000);
    expect(forwarders).toEqual(
      expect.arrayContaining([
        "ModeShape",
        "Container",
        "buttonVariants",
        "Button",
      ]),
    );
    expect(forwardedSites).toBeGreaterThanOrEqual(30);
    expect(
      found,
      'a cn() call can produce two classes from one family — write one class per family per branch (`x ? "a" : "b"`), since cn() does not merge',
    ).toEqual([]);
    // Budget, not assertion (2026-10-30): up to 4.8 s on CI's slower 4-vCPU
    // runners in the full unit run (26 logs, 10-24..10-30), against vitest's
    // 5-second default. The work is the same; the runner is not.
    // `src/tests/timeout-headroom.ts` names the next test past half its budget
    // on every CI run.
  }, 30_000);
});
