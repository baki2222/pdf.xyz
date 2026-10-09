// @vitest-environment node
/**
 * A figure labelled "provisional" must say since WHEN, and must not stay
 * provisional forever without someone deciding it should.
 *
 * THE DEFECT. `AI_CHARACTER_ALLOWANCE_BASIS` carried the docblock "Where the
 * figure came from, so its age is visible rather than implicit" over
 * `measuredOn: "provisional"`, which has no age at all. Nothing read the
 * record. `AI_SPEND_CEILING.measuredOn` was the same. The published daily AI
 * allowance and the spend ceiling had no recorded date, so nobody could see
 * how long they had gone un-measured. The docblock asserted the opposite. A
 * comment is not a guard.
 *
 * THE RULE. Every record in src/lib whose `measuredOn` is "provisional" also
 * carries `provisionalSince` (an ISO date), and that date is at most
 * MAX_PROVISIONAL_DAYS old. When it expires, the figure is re-measured (and
 * `measuredOn` becomes a date) or the date is renewed on purpose, in a commit
 * that says why. Either is a decision. Silence is not.
 *
 * The records are DISCOVERED by parsing every src/lib source file for an
 * object literal with `measuredOn: "provisional"`, not named here.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AI_CHARACTER_ALLOWANCE_BASIS } from "./ai-allowance";
import { AI_SPEND_CEILING } from "./ai-spend-ceiling";

/**
 * A quarter. The spend ceiling's own ruling is to revise it "from real
 * `results.ai.usage` rows once there are some", and traffic, not effort, is
 * what supplies those rows.
 */
const MAX_PROVISIONAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Found {
  at: string;
  provisionalSince: string | null;
}

/** Why a provisional record fails the rule on `today`, or null when it passes. */
export function provisionalProblem(
  record: Found,
  today: Date,
  maxDays = MAX_PROVISIONAL_DAYS,
): string | null {
  const since = record.provisionalSince;
  if (since === null)
    return `${record.at}: provisional with no provisionalSince`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since)))
    return `${record.at}: provisionalSince "${since}" is not an ISO date`;
  const days = Math.floor((today.getTime() - Date.parse(since)) / DAY_MS);
  if (days < 0)
    return `${record.at}: provisionalSince ${since} is in the future`;
  if (days > maxDays)
    return (
      `${record.at}: provisional since ${since} (${days} days, limit ${maxDays}). ` +
      "Re-measure it and set measuredOn to the date, or renew provisionalSince in a commit that says why."
    );
  return null;
}

function libFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\./.test(entry.name)
      )
        out.push(full);
    }
  };
  walk(path.join(process.cwd(), "src", "lib"));
  return out;
}

/** Every object literal with `measuredOn: "provisional"`, and its provisionalSince. */
function provisionalRecords(file: string, source: string): Found[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: Found[] = [];
  const valueOf = (obj: ts.ObjectLiteralExpression, key: string) => {
    const prop = obj.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(sf) === key,
    );
    return prop && ts.isStringLiteral(prop.initializer)
      ? prop.initializer.text
      : null;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isObjectLiteralExpression(node) &&
      valueOf(node, "measuredOn") === "provisional"
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      out.push({
        at: `${path.relative(process.cwd(), file).split(path.sep).join("/")}:${line}`,
        provisionalSince: valueOf(node, "provisionalSince"),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("every provisional figure carries its age, and the age is bounded", () => {
  const records = libFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes('"provisional"')
      ? provisionalRecords(file, source)
      : [];
  });

  it("health: the scan finds the two records that exist today", () => {
    console.info(`provisional records: ${records.map((r) => r.at).join(", ")}`);
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(records.some((r) => r.at.includes("ai-spend-ceiling.ts"))).toBe(
      true,
    );
    expect(records.some((r) => r.at.includes("ai-allowance.ts"))).toBe(true);
  });

  it("each one has an ISO provisionalSince no older than the limit", () => {
    const today = new Date();
    expect(
      records.map((r) => provisionalProblem(r, today)).filter(Boolean),
    ).toEqual([]);
  });

  it("the imported records agree with what the scan read", () => {
    // The scan reads source; this reads the values the product imports.
    expect(AI_SPEND_CEILING.measuredOn).toBe("provisional");
    expect(AI_CHARACTER_ALLOWANCE_BASIS.measuredOn).toBe("provisional");
    const byFile = (name: string) =>
      records.find((r) => r.at.includes(name))?.provisionalSince;
    expect(AI_SPEND_CEILING.provisionalSince).toBe(
      byFile("ai-spend-ceiling.ts"),
    );
    expect(AI_CHARACTER_ALLOWANCE_BASIS.provisionalSince).toBe(
      byFile("ai-allowance.ts"),
    );
  });

  it("positive controls: a stale, a missing and a malformed date each fail", () => {
    const today = new Date("2026-09-27T00:00:00Z");
    expect(
      provisionalProblem({ at: "x", provisionalSince: "2026-05-01" }, today),
    ).toMatch(/days, limit/);
    expect(
      provisionalProblem({ at: "x", provisionalSince: null }, today),
    ).toMatch(/no provisionalSince/);
    expect(
      provisionalProblem({ at: "x", provisionalSince: "last August" }, today),
    ).toMatch(/not an ISO date/);
    expect(
      provisionalProblem({ at: "x", provisionalSince: "2026-09-01" }, today),
    ).toBeNull();
  });
});
