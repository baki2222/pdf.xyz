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
 * enforces are discovered by walking `src/`, and "superseded" must be exactly
 * the complement. A superseded action that regains a caller, or a live action
 * that loses its last one, fails here rather than in a paragraph.
 *
 * Each row's Limit is `policy.limit` formatted the way the doc formats numbers,
 * and each Window is `policy.windowSeconds` in words.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name))
      out.push(path);
  }
  return out;
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

  it("SUPERSEDED is exactly the actions no call site enforces (discovered by walking src/)", () => {
    const files = sourceFiles("src");
    expect(
      files.length,
      "the source walk found implausibly few files",
    ).toBeGreaterThan(200);

    const enforced = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/enforceRateLimit\(\s*"([^"]+)"/g))
        enforced.add(m[1]!);
      for (const m of text.matchAll(/policyFor\(\s*"([^"]+)"\s*\)/g))
        enforced.add(m[1]!);
      // The character allowance selects its policy through the shared
      // constant, so its call site names a function, not a literal.
      if (
        !file.replace(/\\/g, "/").endsWith("ratelimit/guard.ts") &&
        /\benforceAiCharacterAllowance\(/.test(text)
      )
        enforced.add(AI_ALLOWANCE_ACTION);
    }
    // Health check: the discovery must see most of the policy table, or every
    // assertion below would be answering a question about a shrunken world.
    expect([...enforced].sort().join(", ")).toMatch(/uploads\.create/);
    expect(enforced.size).toBeGreaterThanOrEqual(LIVE.length);

    expect([...enforced].sort()).toEqual([...LIVE].sort());
    for (const gone of SUPERSEDED_RATE_LIMIT_ACTIONS)
      expect(enforced.has(gone), `${gone} has a call site again`).toBe(false);
  });

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
