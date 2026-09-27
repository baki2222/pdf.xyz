// @vitest-environment node
/**
 * docs/RATE_LIMITING.md's policy table is the runbook's statement of POLICY,
 * and until 2026-09-27 nothing read it.
 *
 * ── WHAT IT SAID, AND WHY NOTHING CAUGHT IT ─────────────────────────────────
 *
 * Under "## What is already enforced the moment it is on" the table listed
 * `ai.run | 3 | per day`, and the prose under it repeated "`ai.run` is 3 runs
 * per day for everyone combined". Nothing enforces `ai.run`: the allowance
 * moved to `ai.characters` (see `AI_ALLOWANCE_ACTION` in `jobs/ai-allowance.ts`,
 * whose docblock calls `ai.run` "a superseded policy, not a live one"). The
 * table also omitted `ai.characters` and `ai.spend` — the two AI policies that
 * DO run, one of which is the only cost control in the product. An operator
 * reading it believed AI was capped at three runs a day and did not know the
 * global token ceiling existed.
 *
 * The runbook already had a figures guard (`allowance-probe.test.ts`). It did
 * `doc.slice(doc.indexOf("## Step 5"))` — a correct check over the wrong set:
 * the table sits at the top of the file, above the slice. Rule 4.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *
 * The set of rows is DERIVED, never typed: every action in `RATE_LIMIT_ACTIONS`
 * minus `SUPERSEDED_RATE_LIMIT_ACTIONS` (exported beside the union, so this
 * guard and any future consumer read one definition). And the superseded set
 * is itself checked against the code: the actions some call site actually
 * enforces are discovered from a TypeScript AST of `src/` and `scripts/` —
 * CALLS to the limiter's enforcing functions from outside the limiter package,
 * never a `policyFor("…")` lookup (see "WHO ENFORCES WHAT" below for why that
 * distinction was paid for) — and "superseded" must be exactly the complement.
 * A superseded action that regains a caller, or a live action that loses its
 * last one, fails here rather than in a paragraph.
 *
 * Each row's Limit is `policy.limit` formatted the way the doc formats numbers,
 * and each Window is `policy.windowSeconds` in words.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { AI_ALLOWANCE_ACTION } from "@/lib/jobs/ai-allowance";
import { AI_SPEND_DAILY_TOKEN_CEILING } from "@/lib/jobs/ai-spend-ceiling";
import { RATE_LIMIT_POLICIES } from "./policy";
import {
  RATE_LIMIT_ACTIONS,
  SUPERSEDED_RATE_LIMIT_ACTIONS,
  type RateLimitAction,
} from "./types";

const DOC_PATH = "docs/RATE_LIMITING.md";
const HEADING = "## What is already enforced";

const WINDOW_WORDS: Record<number, string> = {
  60: "per minute",
  3600: "per hour",
  86_400: "per day",
};

interface Row {
  action: string;
  limit: string;
  window: string;
  line: string;
}

/** The section from the policy heading to the next `## `, or "" if absent. */
function policySection(doc: string): string {
  const start = doc.indexOf(HEADING);
  if (start < 0) return "";
  const next = doc.indexOf("\n## ", start + HEADING.length);
  return doc.slice(start, next < 0 ? undefined : next);
}

function tableRows(section: string): Row[] {
  const rows: Row[] = [];
  for (const line of section.split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (!m) continue;
    rows.push({
      action: m[1]!,
      limit: m[2]!.trim(),
      window: m[3]!.trim(),
      line,
    });
  }
  return rows;
}

const LIVE: readonly RateLimitAction[] = RATE_LIMIT_ACTIONS.filter(
  (a) => !(SUPERSEDED_RATE_LIMIT_ACTIONS as readonly string[]).includes(a),
);

/**
 * Every disagreement between the doc's table and the code, as sentences. The
 * predicate is a function so the positive controls below can run THROUGH it.
 */
function tableProblems(doc: string): string[] {
  const section = policySection(doc);
  const rows = tableRows(section);
  const problems: string[] = [];
  if (rows.length < 10)
    problems.push(
      `the policy table has ${rows.length} rows; a vanished table must not pass vacuously`,
    );

  const documented = rows.map((r) => r.action).sort();
  const expected = [...LIVE].sort();
  if (JSON.stringify(documented) !== JSON.stringify(expected))
    problems.push(
      `table lists [${documented.join(", ")}], the code enforces [${expected.join(", ")}]`,
    );

  for (const row of rows) {
    const policy = RATE_LIMIT_POLICIES[row.action as RateLimitAction];
    if (!policy) {
      problems.push(`\`${row.action}\` is not a rate-limit action`);
      continue;
    }
    const limit = policy.limit.toLocaleString("en-US");
    if (row.limit !== limit)
      problems.push(
        `\`${row.action}\` says ${row.limit}, the policy is ${limit}`,
      );
    const window = WINDOW_WORDS[policy.windowSeconds];
    if (!window)
      problems.push(`no words for a ${policy.windowSeconds}s window`);
    else if (row.window !== window)
      problems.push(
        `\`${row.action}\` says "${row.window}", the policy is "${window}"`,
      );
  }

  // Not in a row, and not in a sentence either: the prose under the old table
  // restated the ai.run figure, and a table-only fix would have left it.
  for (const gone of SUPERSEDED_RATE_LIMIT_ACTIONS)
    if (section.includes(`\`${gone}\``))
      problems.push(`the section still names superseded \`${gone}\``);

  // The one COST control is global whatever the identity setting; the section
  // must say so rather than let "per client" be inferred from the table.
  const spendParagraphs = section
    .split(/\n\s*\n/)
    .filter((p) => !p.trimStart().startsWith("|") && p.includes("`ai.spend`"));
  if (!spendParagraphs.some((p) => /\bglobal\b/i.test(p)))
    problems.push("no paragraph says `ai.spend` is a GLOBAL bucket");

  return problems;
}

// ── WHO ENFORCES WHAT: a CALL graph, not a module graph ──────────────────────
//
// History (2026-09-27, review of 508f5dc). The first discovery counted every
// `policyFor("…")` literal in `src/`. For `ai.spend` the only such literals are
// INSIDE the definitions of `peekAiSpendCeiling` and `recordAiSpend` (and the
// probe's `spendProbePolicy`) — so a reviewer neutered every real caller of the
// spend gate (the jobs route's peek, the executor's record, the status read)
// and this file stayed 5/5 green. Looking a policy up enforces nothing; the
// runbook could have kept calling `ai.spend` the only cost control after its
// last caller was gone. Rule 4: a module graph read as a call graph.
//
// What it does now:
//  1. The LIMITER PACKAGE is discovered as the directory that defines
//     `policyFor`. Nothing inside it is a call site — its own functions reading
//     policies, and its status reads, are the mechanism, not a consumer.
//  2. The POLICY READERS are discovered: every exported function in that
//     package whose body calls `policyFor`. Each must be classified below as
//     enforcement or not, in both directions — a new reader fails until someone
//     says which it is, and a classification naming no reader fails too.
//  3. Each enforcer's action is resolved from its OWN definition (a literal, a
//     const bound to an exported constant, or "the caller's Nth argument").
//  4. An action is enforced when a call site OUTSIDE the package reaches it:
//     for a parameterised enforcer, by passing the literal; for fixed-action
//     enforcers, by EVERY one of them having a caller. `ai.spend` is two-phase —
//     a peek that refuses and a record that counts — and either alone bounds
//     nothing: with no record the counter never rises, with no peek nothing is
//     refused.
//  Calls are CallExpressions in a TypeScript AST, so a comment that mentions
//  `recordAiSpend(tokens)` and a `function recordAiSpend(` declaration are not
//  callers.

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

/** Readers of `policyFor` that decide whether a request or a job proceeds. */
const ENFORCEMENT = [
  "enforceRateLimit",
  "enforceAiCharacterAllowance",
  "peekAiSpendCeiling",
  "recordAiSpend",
] as const;

/** Readers of `policyFor` that decide nothing, and why. */
const NOT_ENFORCEMENT: Record<string, string> = {
  rateLimitHeaders: "formats headers for a decision already made",
  spendProbePolicy:
    "the probe's own bucket; it moves nothing the ceiling reads",
};

interface Source {
  path: string;
  text: string;
}

type ActionOf =
  | { kind: "fixed"; action: string }
  | { kind: "argument"; index: number }
  | { kind: "unresolved"; why: string };

interface PolicyReader {
  name: string;
  file: string;
  actionOf: ActionOf;
}

const SOURCE_ROOTS = ["src", "scripts"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (
      /\.(m?[jt]sx?)$/.test(name) &&
      !/\.(test|spec)\.(m?[jt]sx?)$/.test(name)
    )
      out.push(path.replace(/\\/g, "/"));
  }
  return out;
}

function sourceCorpus(): Source[] {
  return SOURCE_ROOTS.flatMap(walk).map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));
}

function parse(src: Source): TS.SourceFile {
  return ts.createSourceFile(src.path, src.text, ts.ScriptTarget.Latest, true);
}

function each(node: TS.Node, visit: (n: TS.Node) => void): void {
  visit(node);
  node.forEachChild((child) => each(child, visit));
}

function calleeName(call: TS.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

function isExported(node: TS.FunctionDeclaration): boolean {
  return (
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

/** The directory that defines `policyFor`, with a trailing slash. */
function limiterPackage(corpus: readonly Source[]): string {
  const definers = corpus.filter((src) => {
    let found = false;
    each(parse(src), (n) => {
      if (
        ts.isFunctionDeclaration(n) &&
        n.name?.text === "policyFor" &&
        isExported(n)
      )
        found = true;
    });
    return found;
  });
  if (definers.length !== 1)
    throw new Error(
      `expected ONE definition of policyFor, found [${definers.map((d) => d.path).join(", ")}]`,
    );
  const path = definers[0]!.path;
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** `export const NAME = "literal"` anywhere in the corpus. */
function exportedStringConst(
  corpus: readonly Source[],
  name: string,
): string | undefined {
  for (const src of corpus) {
    if (!src.text.includes(name)) continue;
    let value: string | undefined;
    each(parse(src), (n) => {
      if (
        ts.isVariableStatement(n) &&
        n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      )
        for (const d of n.declarationList.declarations)
          if (
            ts.isIdentifier(d.name) &&
            d.name.text === name &&
            d.initializer &&
            ts.isStringLiteral(d.initializer)
          )
            value = d.initializer.text;
    });
    if (value !== undefined) return value;
  }
  return undefined;
}

function resolveAction(
  fn: TS.FunctionDeclaration,
  arg: TS.Expression | undefined,
  corpus: readonly Source[],
): ActionOf {
  if (!arg) return { kind: "unresolved", why: "policyFor() with no argument" };
  if (ts.isStringLiteral(arg)) return { kind: "fixed", action: arg.text };
  if (!ts.isIdentifier(arg))
    return { kind: "unresolved", why: `policyFor(${arg.getText()})` };
  const index = fn.parameters.findIndex(
    (p) => ts.isIdentifier(p.name) && p.name.text === arg.text,
  );
  if (index >= 0) return { kind: "argument", index };
  let init: TS.Expression | undefined;
  each(fn, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === arg.text
    )
      init = n.initializer;
  });
  if (init && ts.isStringLiteral(init))
    return { kind: "fixed", action: init.text };
  if (init && ts.isIdentifier(init)) {
    const value = exportedStringConst(corpus, init.text);
    if (value !== undefined) return { kind: "fixed", action: value };
  }
  return { kind: "unresolved", why: `policyFor(${arg.text})` };
}

/** Every exported function in the limiter package that calls `policyFor`. */
function policyReaders(corpus: readonly Source[]): PolicyReader[] {
  const pkg = limiterPackage(corpus);
  const readers: PolicyReader[] = [];
  for (const src of corpus) {
    if (!src.path.startsWith(pkg)) continue;
    each(parse(src), (n) => {
      if (!ts.isFunctionDeclaration(n) || !isExported(n) || !n.name || !n.body)
        return;
      let first: TS.CallExpression | undefined;
      each(n.body, (m) => {
        if (!first && ts.isCallExpression(m) && calleeName(m) === "policyFor")
          first = m;
      });
      if (first)
        readers.push({
          name: n.name.text,
          file: src.path,
          actionOf: resolveAction(n, first.arguments[0], corpus),
        });
    });
  }
  return readers;
}

/**
 * action → the call sites (outside the limiter package) that enforce it.
 * Only actions that are ACTUALLY enforced appear; see the header for the rule.
 */
function enforcedActions(corpus: readonly Source[]): Map<string, string[]> {
  const pkg = limiterPackage(corpus);
  const enforcers = policyReaders(corpus).filter((r) =>
    (ENFORCEMENT as readonly string[]).includes(r.name),
  );
  const byName = new Map(enforcers.map((e) => [e.name, e]));
  const sitesOf = new Map<string, string[]>(enforcers.map((e) => [e.name, []]));
  const enforced = new Map<string, string[]>();
  const add = (action: string, site: string) =>
    enforced.set(action, [...(enforced.get(action) ?? []), site]);

  for (const src of corpus) {
    if (src.path.startsWith(pkg)) continue;
    if (!enforcers.some((e) => src.text.includes(e.name))) continue;
    const sf = parse(src);
    each(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const enforcer = byName.get(calleeName(n) ?? "");
      if (!enforcer) return;
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const site = `${src.path}:${line} ${enforcer.name}`;
      if (enforcer.actionOf.kind === "argument") {
        const arg = n.arguments[enforcer.actionOf.index];
        if (arg && ts.isStringLiteral(arg)) add(arg.text, site);
      } else sitesOf.get(enforcer.name)!.push(site);
    });
  }

  const fixed = new Map<string, PolicyReader[]>();
  for (const e of enforcers)
    if (e.actionOf.kind === "fixed")
      fixed.set(e.actionOf.action, [
        ...(fixed.get(e.actionOf.action) ?? []),
        e,
      ]);
  for (const [action, group] of fixed)
    if (group.every((e) => sitesOf.get(e.name)!.length > 0))
      for (const e of group)
        for (const site of sitesOf.get(e.name)!) add(action, site);
  return enforced;
}

/** Rename every call of `names` outside the limiter package; counts landings. */
function neuter(
  corpus: readonly Source[],
  names: readonly string[],
): { corpus: Source[]; landed: number } {
  const pkg = limiterPackage(corpus);
  let landed = 0;
  const pattern = new RegExp(`\\b(${names.join("|")})\\(`, "g");
  const mutated = corpus.map((src) =>
    src.path.startsWith(pkg)
      ? src
      : {
          ...src,
          text: src.text.replace(pattern, (_m, name: string) => {
            landed++;
            return `neutered_${name}(`;
          }),
        },
  );
  return { corpus: mutated, landed };
}

describe("docs/RATE_LIMITING.md — the policy table is the policy", () => {
  const doc = readFileSync(DOC_PATH, "utf8");

  it("lists every live action, and only those, at the limit and window the code enforces", () => {
    expect(tableProblems(doc)).toEqual([]);
  });

  it("the doc's rows, printed — a count alone is a claim nobody can read", () => {
    const rows = tableRows(policySection(doc));
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["ai.characters", "ai.spend"]),
    );
    // The one row whose limit is tokens, not requests.
    const spend = rows.find(
      (r) => r.limit === AI_SPEND_DAILY_TOKEN_CEILING.toLocaleString("en-US"),
    );
    expect(spend?.action).toBe("ai.spend");
  });

  // Each check here re-walks every source file with the TypeScript parser
  // (~0.3-2 s alone). Under a full parallel run on the integrated tree they
  // passed 5 s — vitest's default — intermittently, and a red that is really
  // a clock is the kind that gets a guard deleted. Measured 2026-09-27.
  describe("SUPERSEDED is exactly the actions no call site enforces", () => {
    const corpus = sourceCorpus();

    it("health: the corpus spans both source roots and is plausibly sized", () => {
      expect(
        corpus.length,
        "the source walk found implausibly few files",
      ).toBeGreaterThan(200);
      for (const root of SOURCE_ROOTS)
        expect(
          corpus.some((s) => s.path.startsWith(`${root}/`)),
          `nothing walked under ${root}/`,
        ).toBe(true);
      expect(limiterPackage(corpus)).toBe("src/lib/ratelimit/");
    });

    it("every policyFor reader in the limiter package is classified, and every classification names one", () => {
      const readers = policyReaders(corpus);
      const classified = [...ENFORCEMENT, ...Object.keys(NOT_ENFORCEMENT)];
      expect(readers.map((r) => r.name).sort()).toEqual(classified.sort());
      for (const r of readers.filter((r) =>
        (ENFORCEMENT as readonly string[]).includes(r.name),
      ))
        expect(
          r.actionOf.kind,
          `${r.name}: ${JSON.stringify(r.actionOf)}`,
        ).not.toBe("unresolved");
      // The resolved actions, printed. The allowance's comes from the shared
      // constant's DEFINITION, read independently of the import below.
      const actionOf = Object.fromEntries(
        readers.map((r) => [r.name, r.actionOf]),
      );
      expect(actionOf).toMatchObject({
        enforceRateLimit: { kind: "argument", index: 0 },
        enforceAiCharacterAllowance: {
          kind: "fixed",
          action: AI_ALLOWANCE_ACTION,
        },
        peekAiSpendCeiling: { kind: "fixed", action: "ai.spend" },
        recordAiSpend: { kind: "fixed", action: "ai.spend" },
      });
    });

    it("the enforced set equals the live set, with its call sites printed", () => {
      const enforced = enforcedActions(corpus);
      // Health: the discovery must see most of the policy table, or every
      // assertion below answers a question about a shrunken world.
      expect(enforced.get("uploads.create")?.length ?? 0).toBeGreaterThan(0);
      expect(enforced.size).toBeGreaterThanOrEqual(LIVE.length);

      expect([...enforced.keys()].sort()).toEqual([...LIVE].sort());
      for (const gone of SUPERSEDED_RATE_LIMIT_ACTIONS)
        expect(
          enforced.get(gone),
          `${gone} has a call site again`,
        ).toBeUndefined();
      // Both phases of the spend gate, by file — not a count.
      const spend = (enforced.get("ai.spend") ?? []).join("\n");
      expect(spend).toMatch(
        /src\/app\/api\/jobs\/route\.ts:\d+ peekAiSpendCeiling/,
      );
      expect(spend).toMatch(/executor\.ts:\d+ recordAiSpend/);
      expect(spend, "a status read is not enforcement").not.toMatch(
        /spend-status/,
      );
    });

    it("CONTROL: no caller of either spend phase drops ai.spend", () => {
      const both = neuter(corpus, ["peekAiSpendCeiling", "recordAiSpend"]);
      expect(both.landed, "the neutering never landed").toBeGreaterThanOrEqual(
        2,
      );
      expect(enforcedActions(both.corpus).has("ai.spend")).toBe(false);

      // Two-phase: either half alone bounds nothing. The status module's peek
      // is inside the limiter package and must not keep the gate "enforced".
      for (const phase of ["peekAiSpendCeiling", "recordAiSpend"]) {
        const one = neuter(corpus, [phase]);
        expect(one.landed, `${phase}: never landed`).toBeGreaterThan(0);
        expect(
          enforcedActions(one.corpus).has("ai.spend"),
          `ai.spend still enforced with no ${phase} caller`,
        ).toBe(false);
      }
    });

    it("CONTROL: a comment, a declaration and a policy lookup are not callers", () => {
      const { corpus: bare } = neuter(corpus, [
        "peekAiSpendCeiling",
        "recordAiSpend",
      ]);
      const decoy: Source = {
        path: "src/app/api/decoy/route.ts",
        text: [
          "// the executor calls recordAiSpend(tokens) on every terminal outcome",
          "/* peekAiSpendCeiling() refuses before the job is queued */",
          'import { policyFor } from "@/lib/ratelimit/policy";',
          'export const p = policyFor("ai.spend");',
          "export function recordAiSpend(tokens: number) { return tokens; }",
          "export function peekAiSpendCeiling() { return 0; }",
        ].join("\n"),
      };
      expect(enforcedActions([...bare, decoy]).has("ai.spend")).toBe(false);
    });

    it("CONTROL: the other enforcers drop their action when their callers go, and a superseded action that regains one is seen", () => {
      const allowance = neuter(corpus, ["enforceAiCharacterAllowance"]);
      expect(allowance.landed).toBeGreaterThan(0);
      expect(enforcedActions(allowance.corpus).has(AI_ALLOWANCE_ACTION)).toBe(
        false,
      );

      const routes = neuter(corpus, ["enforceRateLimit"]);
      expect(routes.landed).toBeGreaterThan(0);
      expect(enforcedActions(routes.corpus).has("uploads.create")).toBe(false);

      const [gone] = SUPERSEDED_RATE_LIMIT_ACTIONS;
      const revived: Source = {
        path: "scripts/revived.ts",
        text: `import { enforceRateLimit } from "@/lib/ratelimit/guard";\nexport const r = (q: Request) => enforceRateLimit("${gone}", q);\n`,
      };
      expect(enforcedActions([...corpus, revived]).get(gone)).toEqual([
        "scripts/revived.ts:2 enforceRateLimit",
      ]);
    });
  }, 30_000);

  it("CONTROL: re-inserting the superseded ai.run row fails the predicate", () => {
    const withRow = doc.replace(
      /(\| `ai\.spend`[^\n]*\n)/,
      "$1| `ai.run`            | 3         | per day    |\n",
    );
    expect(withRow, "the control never landed").not.toBe(doc);
    expect(tableProblems(withRow).join("\n")).toMatch(/ai\.run/);
  });

  it("CONTROL: a wrong limit, a wrong window and a missing table each fail", () => {
    const [first] = tableRows(policySection(doc));
    expect(first, "no row to mutate").toBeDefined();
    const wrongLimit = doc.replace(
      first!.line,
      first!.line.replace(`| ${first!.limit}`, `| 9${first!.limit}`),
    );
    expect(wrongLimit).not.toBe(doc);
    expect(tableProblems(wrongLimit).length).toBeGreaterThan(0);

    const wrongWindow = doc.replace(
      first!.line,
      first!.line.replace(first!.window, "per week"),
    );
    expect(wrongWindow).not.toBe(doc);
    expect(tableProblems(wrongWindow).length).toBeGreaterThan(0);

    expect(tableProblems(doc.replace(HEADING, "## Renamed"))).toContainEqual(
      expect.stringMatching(/0 rows/),
    );
  });
});
