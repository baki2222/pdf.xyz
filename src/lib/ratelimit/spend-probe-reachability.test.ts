// @vitest-environment node
/**
 * The two-tier probe must be REACHED FROM AN ENTRY POINT, not merely defined.
 *
 * On 2026-08-12 the spend probe was built, reviewed, merged and deployed — and
 * production reported `probe: 0 keys` after a real job, because
 * `writeSpendProbe`/`readSpendProbe` were invoked by nothing except their own
 * unit tests. Every unit test was green. The module was correct. It was also
 * inert, and no test in the repo could tell the difference, because **every test
 * imported the function directly** and so supplied by hand the one thing
 * production was missing: a caller.
 *
 * That is this codebase's most expensive recurring shape, in its purest form:
 *
 *   - `peek` that accumulated nothing, because the worker had no limiter.
 *   - `usageFrom(body)`, correct and tested, sitting below the branch that
 *     needed it.
 *   - a probe deployed with no call site.
 *
 * "The probe is ready" and "the probe answers" differ by a call site, and a diff
 * shows neither. So this guard does not check that the functions exist, and does
 * not check that some file mentions them. It walks the import graph **from the
 * process entry points a deployment actually runs** — HTTP route handlers and
 * the worker scripts — and asserts the probe is reachable from both tiers.
 *
 * WHY REACHABILITY AND NOT A GREP. A grep is satisfied by one library module
 * importing another; that is exactly the state this guard exists to reject,
 * since a lib-to-lib reference proves nothing about whether a running process
 * ever calls it. Two boundaries can each pass their own tests while the path
 * through them drops everything — so the assertion is about the PATH.
 *
 * WHAT IT CANNOT CATCH, stated because a guard that overclaims is worse than
 * none: reachability is not execution. A call site sitting behind a condition
 * that is never true would satisfy this and still write nothing. That gap is
 * closed on the other side — by reading the probe key off the deployed store —
 * and this guard's job is only to make the ABSENCE of a call site impossible to
 * ship again.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
const SCRIPTS = join(ROOT, "scripts");

const isSource = (f: string): boolean =>
  /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f);

/** Every non-test source file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (isSource(entry)) out.push(full);
  }
  return out;
}

/**
 * The processes a deployment actually starts.
 *
 * DISCOVERED, never listed. A named list cannot see a file it does not name, so
 * a new route that needed the posture — or a second worker entry point — would
 * be invisible to a hand-written array. The web tier's entry points are Next's
 * route handlers; the worker tier's are the daemon scripts.
 */
function entryPoints(): { web: string[]; worker: string[] } {
  const web = walk(join(SRC, "app")).filter((f) => /[\\/]route\.ts$/.test(f));
  const worker = walk(SCRIPTS).filter((f) =>
    /worker-daemon|worker-ops-check/.test(f),
  );
  return { web, worker };
}

/** Resolve one import specifier to a file on disk, or null if it is external. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // a package, not our tree
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this shape; try the next
    }
  }
  return null;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Erase TYPE-ONLY imports before the graph is walked.
 *
 * A type import does not exist at runtime — TypeScript strips it — so a module
 * reached only that way is never loaded and its code never runs. Counting one as
 * reachability is not a rounding error; it is the difference between "a process
 * calls this" and "a process mentions this type", which is the whole distinction
 * this guard sells.
 *
 * IT WAS A LIVE FALSE PASS, not a hypothetical. `snapshot.ts` imports
 * `AiSpendStatusCode` and `AiSpendProbeState` from `spend-status.ts` with
 * `import type`, purely to feed its compile-time subset assertion. That dragged
 * `spend-status.ts` — and therefore its `readSpendProbe(...)` call — into the web
 * graph, and the "WEB tier reaches readSpendProbe" arm below passed with the
 * route's real import deleted. The guard that exists to prove a call site was
 * itself satisfied by a type annotation.
 *
 * Caught by removing the route's import and re-running, which is the only check
 * that can tell a guard from a decoration: make the thing it watches for true
 * and confirm it goes red. Pinned as a case below so the arm cannot regress.
 */
function withoutTypeOnlyImports(source: string): string {
  return (
    source
      // `import type { A } from "x"` / `export type { A } from "x"`
      .replace(/^\s*(?:import|export)\s+type\s[^;]*?;/gm, " ")
      // `import { type A, type B } from "x"` — every specifier erased, so the
      // whole statement is. One non-type specifier and it stays a real import.
      .replace(
        /^\s*import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']\s*;?/gm,
        (whole, specifiers: string) => {
          const parts = specifiers
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          const allTypes =
            parts.length > 0 && parts.every((p) => /^type\s/.test(p));
          return allTypes ? " " : whole;
        },
      )
  );
}

/**
 * Every module reachable from `roots` by following our own imports, plus the
 * concatenated source of all of them.
 *
 * `import()` is followed as well as `import` — the operations route reaches its
 * native probe through a dynamic import, and a walker that only understood
 * static imports would silently under-report reachability, which for a guard
 * that asserts REACHED is the direction that produces a false failure and, for
 * the arms asserting NOT reached, a false pass.
 */
function reachableFrom(roots: string[]): {
  files: Set<string>;
  source: string;
} {
  const seen = new Set<string>();
  const queue = [...roots];
  let source = "";
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      // A root that cannot be read must never silently shrink the graph.
      throw new Error(`unreadable module in the import graph: ${file}`);
    }
    source += `\n/* ${relative(ROOT, file)} */\n${text}`;
    for (const m of withoutTypeOnlyImports(text).matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1]!);
      if (target !== null) queue.push(target);
    }
  }
  return { files: seen, source };
}

/** Strip comments, so a symbol NAMED in a docblock never counts as a call. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Does the source CALL `symbol`, as opposed to DECLARING it?
 *
 * The first version of this predicate was `\bsymbol\s*\(`, and it reported this
 * whole guard as passing against a tree with zero call sites — because
 * `export async function writeSpendProbe(` matches that pattern exactly. A
 * definition is not a call, and the one instrument built to tell them apart
 * could not.
 *
 * It was caught only because a number disagreed with one somebody had a reason
 * to expect: this guard was supposed to FAIL on unmodified main, and passed. So
 * the declaring keyword is excluded, and the exclusion gets its own control
 * below — a predicate that cannot distinguish its two cases reports the
 * strongest possible pass, which is the worst direction for a guard to fail in.
 */
function calls(source: string, symbol: string): boolean {
  const re = new RegExp(`(\\w+)?\\s*\\b${symbol}\\s*\\(`, "g");
  for (const m of source.matchAll(re)) {
    if (m[1] === "function") continue;
    return true;
  }
  return false;
}

describe("the spend probe is reachable from the processes that run", () => {
  const { web, worker } = entryPoints();

  it("CONTROL: the predicate tells a declaration apart from a call", () => {
    // The control that would have caught this guard's own first version, which
    // read a tree with zero call sites as fully wired. Pinned as a unit here
    // because the failure was invisible at the level the guard reports at: it
    // said "reachable", and "reachable" was the answer everyone wanted.
    expect(calls("export async function fooBar(env) {}", "fooBar")).toBe(false);
    expect(calls("function fooBar() {}", "fooBar")).toBe(false);
    expect(calls("await fooBar(process.env);", "fooBar")).toBe(true);
    expect(calls("const r = fooBar();", "fooBar")).toBe(true);
    // An import binding is not a call either — naming a symbol is not using it.
    expect(calls("import { fooBar } from './x';", "fooBar")).toBe(false);
  });

  it("CONTROL: a type-only import is not reachability", () => {
    // The second false pass this guard produced, pinned. `snapshot.ts` pulls two
    // TYPES from `spend-status.ts` for a compile-time assertion; that import is
    // erased at runtime, and following it made the web tier look like it reached
    // `readSpendProbe` even with the route's real import deleted.
    const typeOnly = `import type { A } from "./x";\nexport type { B } from "./y";`;
    expect(withoutTypeOnlyImports(typeOnly).match(IMPORT_RE)).toBeNull();
    // Inline type specifiers, all of them ⇒ the whole statement is erased.
    expect(
      withoutTypeOnlyImports(`import { type A, type B } from "./x";`).match(
        IMPORT_RE,
      ),
    ).toBeNull();
    // One real binding and the statement survives — under-reporting reachability
    // would turn the arms below into false FAILURES, which is its own defect.
    const mixed = `import { type A, realThing } from "./x";`;
    expect(withoutTypeOnlyImports(mixed)).toContain("./x");
    expect(withoutTypeOnlyImports(`import { a } from "./keep";`)).toContain(
      "./keep",
    );
  });

  it("HEALTH CHECK: the walk actually found both tiers' entry points", () => {
    // `[] ⊆ X` is vacuously true, so a blind walk would report the strongest
    // possible pass. Every assertion below is worthless without this one.
    expect(
      web.length,
      "no Next route handlers were discovered",
    ).toBeGreaterThan(10);
    expect(
      worker.length,
      "no worker entry-point script was discovered",
    ).toBeGreaterThan(0);
  });

  it("POSITIVE CONTROL: the graph walk reaches a symbol known to be wired", () => {
    // If the walker were broken — a bad alias, an unfollowed import — every
    // "not reachable" assertion below would pass for the wrong reason. This
    // pins a call the web tier demonstrably makes today.
    const { files, source } = reachableFrom(web);
    expect(files.size, "the import graph is implausibly small").toBeGreaterThan(
      100,
    );
    expect(calls(withoutComments(source), "enforceRateLimit")).toBe(true);
  });

  it("NEGATIVE CONTROL: it does not report a symbol nobody calls", () => {
    const { source } = reachableFrom(web);
    expect(
      calls(withoutComments(source), "definitelyNotARealFunctionName"),
    ).toBe(false);
  });

  it("the WORKER tier reaches writeSpendProbe", () => {
    // The write half. Without it `no-probe-visible` is permanent and means
    // nothing — a posture that can only ever report one thing is not an
    // instrument.
    const { source } = reachableFrom(worker);
    expect(
      calls(withoutComments(source), "writeSpendProbe"),
      "no worker entry point reaches writeSpendProbe, so the probe key is " +
        "never written and the web tier can never prove the two tiers share " +
        "one bucket — the module is deployed and inert",
    ).toBe(true);
  });

  it("the WEB tier reaches readSpendProbe", () => {
    // The read half — blocker 2's remaining question, "is the counter I read
    // the counter they write?". Reached transitively via the posture resolver
    // is fine; reached by nothing is not.
    const { source } = reachableFrom(web);
    expect(
      calls(withoutComments(source), "readSpendProbe"),
      "no web entry point reaches readSpendProbe, so nothing on the tier that " +
        "must refuse jobs can say whether it reads the counter the worker writes",
    ).toBe(true);
  });

  it("the WEB tier reaches the ceiling peek, so the posture is observed not assumed", () => {
    const { source } = reachableFrom(web);
    expect(calls(withoutComments(source), "peekAiSpendCeiling")).toBe(true);
  });
});
