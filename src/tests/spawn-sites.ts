/**
 * Where the worker starts child processes — DISCOVERED, never listed.
 *
 * The set is derived through artifacts a deployment already depends on
 * (CLAUDE.md rule 4): the worker image's command → its package script → the
 * entry file (`Dockerfile CMD ["pnpm", "worker:daemon"]` → `package.json`
 * `"worker:daemon": "tsx scripts/worker-daemon.ts"`), then the VALUE import
 * graph from there. `import type` and all-`type` specifier lists are erased at
 * runtime and are not edges (that was a real false edge once); `export … from`,
 * side-effect imports and dynamic `import()` are. A module in that graph that
 * value-imports `node:child_process` is a spawning module, and every call it
 * makes to a child_process function — directly, through a namespace, or
 * through a `promisify(...)` alias of one — is a spawn site.
 *
 * Each site is then asked one question with the TYPE CHECKER, not a regex:
 * does the options argument's type carry `signal`? An options object built as
 * `{ ...options, encoding }` passes exactly when `options` is typed with a
 * signal, and fails when someone narrows it to `{ timeout, maxBuffer }`.
 * Synchronous variants (`execFileSync`, `spawnSync`, `execSync`) cannot be
 * aborted at all and are reported as violations whatever they are passed.
 *
 * Loading a module is not running a function (rule 4): this proves a spawn
 * site that a lost attempt could reach is WIRED for the signal. That the
 * signal actually ARRIVES — processor → engine → runner → child — is proven by
 * running each family against a real child in `engines-honour-abort.test.ts`.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Through `createRequire`: the bundler otherwise transforms TypeScript's own
 * multi-megabyte bundle (same reason as `spend-probe-reachability.test.ts`).
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

export const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CHILD_PROCESS = new Set(["node:child_process", "child_process"]);
/** The child_process functions that start a process. */
const ASYNC_SPAWNERS = new Set(["execFile", "spawn", "exec", "fork"]);
const SYNC_SPAWNERS = new Set(["execFileSync", "spawnSync", "execSync"]);

/** Repo-relative, forward slashes: stable across Windows and Linux. */
export const rel = (file: string, root = REPO_ROOT): string =>
  path.relative(root, file).split(path.sep).join("/");

/**
 * The worker container's entry files: `Dockerfile` `pnpm <script>` commands →
 * `package.json` scripts → the `scripts/*.ts` file each runs. FATAL on a
 * broken link: a corpus that silently drops one shrinks toward `[]`.
 */
export function workerEntryPoints(root = REPO_ROOT): string[] {
  const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const files = new Set<string>();
  for (const m of dockerfile.matchAll(/["']pnpm["']\s*,\s*["']([^"']+)["']/g)) {
    const name = m[1]!;
    const command = scripts[name];
    if (command === undefined)
      throw new Error(
        `the Dockerfile runs \`pnpm ${name}\` but package.json defines no such script`,
      );
    const file = /(?:^|\s)(scripts\/[\w.-]+\.ts)(?:\s|$)/.exec(command);
    if (file) files.add(path.join(root, file[1]!));
  }
  for (const file of files)
    if (!statSync(file, { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `a worker entry point does not exist: ${rel(file, root)}`,
      );
  return [...files];
}

/** Resolve an import specifier to a file of ours, or null for a package. */
function resolveImport(
  fromFile: string,
  spec: string,
  root: string,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith("."))
    base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  base = base.replace(/\.(m?js)$/, "");
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile())
      return candidate;
  }
  // Ours by its spelling, yet nothing on disk: a broken link, never skipped.
  throw new Error(`unresolvable import "${spec}" in ${rel(fromFile, root)}`);
}

function parse(file: string): TS.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Erased at runtime: `import type`, or every named binding `type`. */
function isErasedImport(node: TS.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false; // side-effect import: a real load
  if (clause.isTypeOnly) return true;
  return (
    clause.name === undefined &&
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((e) => e.isTypeOnly)
  );
}

function isErasedExport(node: TS.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((e) => e.isTypeOnly)
  );
}

/** Every runtime module specifier `source` loads. */
export function valueSpecifiers(source: TS.SourceFile): string[] {
  const specs: string[] = [];
  const visit = (node: TS.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !isErasedImport(node)
    )
      specs.push(node.moduleSpecifier.text);
    else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !isErasedExport(node)
    )
      specs.push(node.moduleSpecifier.text);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      specs.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

/** The value-import closure of `entries` (files of ours only). */
export function valueImportGraph(
  entries: readonly string[],
  root = REPO_ROOT,
): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueSpecifiers(parse(file))) {
      const target = resolveImport(file, spec, root);
      if (target && !seen.has(target) && /\.tsx?$/.test(target))
        queue.push(target);
    }
  }
  return [...seen].sort();
}

/** One call to a child_process function. */
export interface SpawnSite {
  file: string;
  line: number;
  /** The child_process function: `execFile`, `spawn`, ... */
  fn: string;
  /** The call's own text, one line, for the report. */
  text: string;
}

/** Does `source` value-import child_process? */
function importsChildProcess(source: TS.SourceFile): boolean {
  return valueSpecifiers(source).some((s) => CHILD_PROCESS.has(s));
}

/**
 * The spawn calls in one module. Names are bound from its child_process
 * imports (named, renamed, namespace, default) and from `promisify(<bound>)`
 * aliases; a call through any of them is a site.
 */
export function spawnSitesIn(source: TS.SourceFile): SpawnSite[] {
  const direct = new Map<string, string>(); // local name → child_process fn
  const namespaces = new Set<string>();
  for (const stmt of source.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier) ||
      !CHILD_PROCESS.has(stmt.moduleSpecifier.text) ||
      isErasedImport(stmt)
    )
      continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) namespaces.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      for (const el of bindings.elements) {
        if (el.isTypeOnly) continue;
        const imported = (el.propertyName ?? el.name).text;
        direct.set(el.name.text, imported);
      }
  }
  const spawnerOf = (expr: TS.Expression): string | null => {
    if (ts.isIdentifier(expr)) return direct.get(expr.text) ?? null;
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      namespaces.has(expr.expression.text)
    )
      return expr.name.text;
    return null;
  };
  // `const run = promisify(execFile)` makes `run` a spawner too.
  const visitAliases = (node: TS.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "promisify" &&
      node.initializer.arguments[0]
    ) {
      const fn = spawnerOf(node.initializer.arguments[0]);
      if (fn) direct.set(node.name.text, fn);
    }
    ts.forEachChild(node, visitAliases);
  };
  visitAliases(source);

  const sites: SpawnSite[] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const fn = spawnerOf(node.expression);
      if (fn && (ASYNC_SPAWNERS.has(fn) || SYNC_SPAWNERS.has(fn))) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        sites.push({
          file: source.fileName,
          line: line + 1,
          fn,
          text: node.getText().split("\n")[0]!.trim(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** A spawn site that a lost attempt could not stop. */
export interface UnsignalledSite extends SpawnSite {
  why: string;
}

/**
 * Ask the type checker, for each site, whether its options argument carries
 * `signal`. `files` are the modules to check; a program is built over them
 * (their imports are followed for types).
 */
export function unsignalledSites(
  files: readonly string[],
  root = REPO_ROOT,
): { sites: SpawnSite[]; unsignalled: UnsignalledSite[] } {
  const program = ts.createProgram([...files], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    allowJs: false,
    baseUrl: root,
    paths: { "@/*": ["./src/*"] },
    typeRoots: [path.join(REPO_ROOT, "node_modules", "@types")],
    types: ["node"],
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  });
  const checker = program.getTypeChecker();
  const sites: SpawnSite[] = [];
  const unsignalled: UnsignalledSite[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`not in the program: ${file}`);
    // The caller's spelling of the path (the program normalises separators).
    const found = spawnSitesIn(source).map((site) => ({ ...site, file }));
    sites.push(...found);
    // Re-find each call node to type its arguments.
    const calls: TS.CallExpression[] = [];
    const collect = (node: TS.Node): void => {
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, collect);
    };
    collect(source);
    for (const site of found) {
      const call = calls.find(
        (c) =>
          source.getLineAndCharacterOfPosition(c.getStart()).line + 1 ===
            site.line && c.getText().split("\n")[0]!.trim() === site.text,
      )!;
      if (SYNC_SPAWNERS.has(site.fn)) {
        unsignalled.push({
          ...site,
          why: "a synchronous spawn blocks the event loop and cannot be aborted",
        });
        continue;
      }
      // The options object: the first argument after the command that is
      // neither an argv array nor a callback.
      const options = call.arguments.slice(1).find((arg) => {
        const type = checker.getTypeAtLocation(arg);
        if (checker.isArrayType(type) || checker.isTupleType(type))
          return false;
        return type.getCallSignatures().length === 0;
      });
      if (!options) {
        unsignalled.push({ ...site, why: "no options argument at all" });
        continue;
      }
      const type = checker.getTypeAtLocation(options);
      if (!type.getProperty("signal")) {
        unsignalled.push({
          ...site,
          why: `its options (${checker.typeToString(type)}) carry no \`signal\``,
        });
      }
    }
  }
  return { sites, unsignalled };
}

/** Everything the guard and the family test need, discovered from the entry. */
export function discoverWorkerSpawnSites(root = REPO_ROOT) {
  const entries = workerEntryPoints(root);
  const graph = valueImportGraph(entries, root);
  const modules = graph.filter((file) => importsChildProcess(parse(file)));
  return { entries, graph, modules };
}
