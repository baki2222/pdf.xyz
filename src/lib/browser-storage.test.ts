// @vitest-environment node
/**
 * Every place this site keeps something in a visitor's browser is in the
 * registry `/privacy` renders — and every registry entry is a place the code
 * really writes. DISCOVERED, both ways (addendum WP-04 #74):
 *
 *  - the WRITERS are every non-test source under `src` that touches
 *    `localStorage`, `sessionStorage` or `indexedDB` — found, not named;
 *  - the KEYS are the first argument of every `getItem`/`setItem`/
 *    `removeItem` (on any receiver: the workspace reads storage through an
 *    injected `store`) and every `indexedDB.open`, resolved through local
 *    constants, imports and re-exports, and `PREFIX + tool` concatenation;
 *  - a key this walker cannot resolve is FATAL, not skipped — a skipped call
 *    site is a hole of exactly that shape.
 *
 * The spec planned the check over `*_STORAGE_KEY` and `DB_NAME` constants by
 * name; that misses `pdfxyz.workerJob.<slug>` (a prefix, in sessionStorage,
 * which the spec believed unused) and the IndexedDB name (a private
 * constant). Discovering call sites finds both.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DEFAULT_HANDOFF_TTL_MS } from "@/lib/handoff/record";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { withoutComments } from "@/lib/tools/copy-surface";
import { FORBIDDEN as TRANSMISSION_FORBIDDEN } from "@/lib/tools/transmission-claims";
import {
  ACCOUNT_CLAIMS,
  PERSONAL_CONDUCT_CLAIMS,
} from "@/tests/identity-claims";
import { BROWSER_STORAGE, HANDOFF_LIFETIME } from "./browser-storage";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)
      ? [full]
      : [];
  });
}

const TOUCHES = /\b(?:localStorage|sessionStorage|indexedDB)\b/;
const parse = (file: string, text: string) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** `@/x` and `./x` to a file on disk, or null. */
function resolveModule(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ])
    if (existsSync(candidate)) return candidate;
  return null;
}

/** The string a name holds in `file`: a const, or an import, followed. */
function resolveName(name: string, file: string, depth = 0): string | null {
  if (depth > 4) return null;
  const sf = parse(file, readFileSync(file, "utf8"));
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
          if (ts.isStringLiteralLike(d.initializer)) return d.initializer.text;
          // `const A = B`: follow B.
          if (ts.isIdentifier(d.initializer))
            return resolveName(d.initializer.text, file, depth + 1);
        }
    let from: string | null = null;
    let elements:
      ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier> | undefined;
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      from = st.moduleSpecifier.text;
      const bindings = st.importClause?.namedBindings;
      elements =
        bindings && ts.isNamedImports(bindings) ? bindings.elements : undefined;
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      from = st.moduleSpecifier.text;
      elements =
        st.exportClause && ts.isNamedExports(st.exportClause)
          ? st.exportClause.elements
          : undefined;
    }
    if (!from) continue;
    for (const el of elements ?? []) {
      if (el.name.text !== name) continue;
      const target = resolveModule(file, from);
      const original = el.propertyName?.text ?? el.name.text;
      if (target) return resolveName(original, target, depth + 1);
    }
  }
  return null;
}

interface Found {
  file: string;
  key: string | null;
  perTool: boolean;
  line: number;
}

/** Every storage key `text` uses, resolved — or null where it cannot be. */
function storageKeys(file: string, text: string): Found[] {
  const sf = parse(file, text);
  const out: Found[] = [];
  const resolve = (
    e: ts.Expression,
  ): { key: string | null; perTool: boolean } => {
    if (ts.isStringLiteralLike(e)) return { key: e.text, perTool: false };
    if (ts.isIdentifier(e))
      return { key: resolveName(e.text, file), perTool: false };
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken
    )
      return { key: resolve(e.left).key, perTool: true };
    return { key: null, perTool: false };
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const receiver = n.expression.expression;
      const isStorageCall = ["getItem", "setItem", "removeItem"].includes(
        method,
      );
      const isDbOpen =
        method === "open" &&
        ((ts.isIdentifier(receiver) &&
          /indexedDB|factory/i.test(receiver.text)) ||
          (ts.isPropertyAccessExpression(receiver) &&
            receiver.name.text === "indexedDB"));
      if ((isStorageCall || isDbOpen) && n.arguments[0]) {
        out.push({
          file: rel(file),
          ...resolve(n.arguments[0]),
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const WRITERS = sources().filter((f) =>
  TOUCHES.test(withoutComments(readFileSync(f, "utf8"))),
);
const FOUND = WRITERS.flatMap((f) => storageKeys(f, readFileSync(f, "utf8")));
const id = (k: { key: string | null; perTool: boolean }) =>
  `${k.key}${k.perTool ? "<tool>" : ""}`;

describe("the browser-storage registry is what the code writes", () => {
  it("health: the writers are found, and each yields a key", () => {
    const writers = WRITERS.map(rel);
    expect(writers.length, writers.join("\n")).toBeGreaterThanOrEqual(4);
    for (const expected of [
      "src/lib/analytics/consent.ts",
      "src/lib/workspace/storage.ts",
      "src/lib/handoff/idb.ts",
      "src/components/tools/worker-job.tsx",
    ])
      expect(writers).toContain(expected);
    expect(FOUND.length).toBeGreaterThanOrEqual(8);
  });

  it("positive controls: a prefix key in sessionStorage, and an injected store", () => {
    expect(FOUND).toContainEqual(
      expect.objectContaining({
        file: "src/components/tools/worker-job.tsx",
        key: "pdfxyz.workerJob.",
        perTool: true,
      }),
    );
    expect(FOUND).toContainEqual(
      expect.objectContaining({
        file: "src/lib/workspace/storage.ts",
        key: "pdfxyz.workspace.v1",
      }),
    );
    // And a fixture through the same reader: a new key is found.
    expect(
      storageKeys(
        path.join(SRC, "fixture.ts"),
        'export const f = () => window.localStorage.setItem("pdfxyz.secret", "x");',
      ).map(id),
    ).toEqual(["pdfxyz.secret"]);
  });

  it("every call site's key resolves — an unread key is a hole, so it is fatal", () => {
    expect(
      FOUND.filter((f) => f.key === null).map((f) => `${f.file}:${f.line}`),
    ).toEqual([]);
  });

  it("every key the code uses is registered, and every registered key is used", () => {
    const registered = new Set(BROWSER_STORAGE.map(id));
    const used = new Set(FOUND.map(id));
    expect(
      [...used].filter((k) => !registered.has(k)),
      "the code keeps these in the browser and /privacy does not say so",
    ).toEqual([]);
    expect(
      [...registered].filter((k) => !used.has(k)),
      "the registry names these and no code uses them",
    ).toEqual([]);
  });
});

describe("what /privacy says about each store", () => {
  const texts = BROWSER_STORAGE.flatMap((s) => [s.holds, s.lasts]);

  it("passes the copy predicates, and prints only figures the code owns", () => {
    const owned = new Set([
      String(DEFAULT_HANDOFF_TTL_MS / 60_000),
      String(DEFAULT_RETENTION.outputTtlMinutes),
    ]);
    const offences: string[] = [];
    for (const text of texts) {
      for (const p of TRANSMISSION_FORBIDDEN)
        if (p.test(text)) offences.push(`${text} — ${p}`);
      for (const { label, pattern } of ACCOUNT_CLAIMS)
        if (pattern.test(text)) offences.push(`${text} — ${label}`);
      for (const { name, pattern } of PERSONAL_CONDUCT_CLAIMS)
        if (pattern.test(text)) offences.push(`${text} — ${name}`);
      for (const n of text.match(/\d+/g) ?? [])
        if (!owned.has(n)) offences.push(`${text} — unowned ${n}`);
    }
    expect(texts.length).toBe(BROWSER_STORAGE.length * 2);
    expect(offences).toEqual([]);
  });

  it("the hand-off lifetime is the TTL the store enforces", () => {
    expect(HANDOFF_LIFETIME).toContain(
      `expires after ${DEFAULT_HANDOFF_TTL_MS / 60_000} minutes`,
    );
    expect(HANDOFF_LIFETIME).toContain("deleted when that tool opens them");
  });

  /**
   * "…deleted from this browser the next time a pdf.xyz page opens" is true
   * only while every page sweeps. The spec made it true with WP-07's drop
   * layer; this package ships the sentence, so it ships the sweep, and the
   * sentence is held to the layout mounting it. (`handoff-sweep.test.tsx`
   * proves what the sweep does once mounted.)
   */
  it("the 'next time a page opens' clause is backed: the root layout mounts the sweep", () => {
    expect(HANDOFF_LIFETIME).toMatch(/next time a pdf\.xyz page opens/);
    const layout = readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8");
    const sf = parse("layout.tsx", layout);
    const tags: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n))
        tags.push(n.tagName.getText(sf));
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // Health: the walk saw the layout's own chrome.
    expect(tags).toContain("SiteFooter");
    expect(tags).toContain("HandoffSweep");
  });
});
