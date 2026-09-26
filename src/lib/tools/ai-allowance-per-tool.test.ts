// @vitest-environment node
/**
 * Each AI tool's page publishes the allowance in the unit the route charges IT.
 *
 * Audited at 67e8d0f: Summarize PDF, Chat with PDF and AI Extract all published
 * "30,774 free characters of AI text a day for your connection" — as a fact line
 * and as the FAQPage answer to "Is X free?". That figure is TRANSLATE's: it is
 * `TRANSLATE_MAX_INPUT_CHARS × runs`, and it is true only for a client that
 * declares how many characters a job holds. Only the translate panel does. Every
 * other AI job arrives undeclared, and `POST /api/jobs` reserves a whole call's
 * worth for it (`deliveryCapFor({}, …)`), so each summary, question or extraction
 * costs a fixed third of the bucket whatever its length. A 2,000-character memo
 * bought 3 summaries, not ~15; a 300-page report read "30,774 characters a day"
 * beside "reads up to 500,000 characters" and looked impossible, yet ran — and
 * was charged exactly what the memo was. The refusal then told a user who had
 * summarised three short memos that their "30,774 free characters" were gone.
 *
 * Nothing caught it because every allowance guard checked the ONE sentence
 * against the ONE tool it was derived from (translate), and the other three
 * pages imported the same constant — "one copy" was true, and was the defect.
 *
 * So this file does not trust a list of which tools declare. It DISCOVERS it
 * from the browser clients (every `runSecurityJob` call, read with the
 * TypeScript parser), spends the real bucket through the real route for every
 * AI tool, and compares the count to the number each RENDERED page publishes.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import {
  AI_ALLOWANCE_USED_MESSAGE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  AI_TOOLS_DECLARING_CHARACTERS,
  AI_UNDECLARED_RUNS_PER_DAY,
  aiAllowanceFactFor,
} from "@/lib/jobs/ai-allowance";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { POST } from "@/app/api/jobs/route";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

const ROOT = process.cwd();

/**
 * The compiler through `createRequire`, never a static import — the bundler
 * would otherwise transform TypeScript's own bundle and hunt for its absent
 * sourcemap (the idiom of `client-bundle-node-free.test.ts`).
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const aiTools = () =>
  tools.filter((t) => capabilityForMode(t.processing) === "ai");

/* ------------------------------------------------------------------ *
 *  Which clients declare — read from the call sites, not from a list
 * ------------------------------------------------------------------ */

/**
 * slug → whether the browser client passes `declaredCharacters` (the sixth
 * positional argument of `runSecurityJob`). Every non-test module under
 * `src/lib/workers` is parsed; a call whose tool argument is not a string
 * literal is skipped (office/structure clients pass a variable, and none of
 * them is an AI tool — the coverage assertion below would say so if one were).
 */
function discoverDeclaringClients(): Map<string, boolean> {
  const found = new Map<string, boolean>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        visitFile(full);
    }
  };
  const visitFile = (file: string) => {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: TS.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "runSecurityJob"
      ) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) {
          found.set(
            first.text,
            (found.get(first.text) ?? false) || node.arguments.length >= 6,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  };
  walk(path.join(ROOT, "src", "lib", "workers"));
  return found;
}

/* ------------------------------------------------------------------ *
 *  What the page publishes, read the way a reader reads it
 * ------------------------------------------------------------------ */

const DELIVERED = AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US");

/**
 * Problems with an allowance sentence published for a tool whose jobs are
 * charged per run. Empty means it states a per-day count of runs, says the
 * allowance is shared, and does not quote the translate figure as its own.
 */
function perRunProblems(text: string, runs: number): string[] {
  const problems: string[] = [];
  if (text.includes(DELIVERED))
    problems.push(`quotes the character figure ${DELIVERED} as this tool's`);
  const count = /\b(\d[\d,]*) [a-z]+ a day\b/.exec(text);
  if (!count) problems.push("states no per-day count of runs");
  else if (Number(count[1]!.replace(/,/g, "")) !== runs)
    problems.push(`publishes ${count[1]} a day; the route allows ${runs}`);
  if (!/\bshared\b/i.test(text))
    problems.push(
      "does not say the allowance is shared with the other AI tools",
    );
  return problems;
}

/** Verbatim from production /tools/summarize-pdf at 67e8d0f. */
const SHIPPED_SUMMARIZE_FACT =
  "30,774 free characters of AI text a day for your connection — the allowance resets daily.";

/* ------------------------------------------------------------------ *
 *  The route, spent for real
 * ------------------------------------------------------------------ */

/**
 * A valid options body per AI tool, so the request reaches the allowance. A
 * newly discovered AI tool with no entry here is a FATAL gap, not a skip.
 */
const VALID_OPTIONS: Record<string, Record<string, unknown>> = {
  "summarize-pdf": { length: "brief", format: "bullets" },
  "chat-with-pdf": { question: "What is this document about?" },
  "ai-extract": { mode: "prompt", prompt: "List every date." },
  "translate-pdf": { targetLanguage: "fr", sourceLanguage: "auto" },
};

/** How many jobs of `slug`, submitted the way its browser client submits them, the day allows. */
async function jobsTheRouteAllows(slug: string): Promise<number> {
  const options = VALID_OPTIONS[slug];
  if (!options) throw new Error(`no valid options fixture for AI tool ${slug}`);
  let allowed = 0;
  for (let i = 0; i < 50; i += 1) {
    const response = await POST(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tool: slug,
          inputs: ["f_probe0000000000"],
          options,
        }),
      }),
    );
    if (response.status === 429) return allowed;
    if (response.status === 400)
      throw new Error(
        `${slug}: the probe was rejected as malformed (${await response.text()}) — fix the fixture`,
      );
    allowed += 1;
  }
  throw new Error(`${slug}: 50 undeclared jobs were never refused`);
}

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

beforeEach(() => {
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
});
afterEach(() => {
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
});

describe("which AI clients declare their characters", () => {
  it("is read from every runSecurityJob call, and covers every AI tool", () => {
    const discovered = discoverDeclaringClients();
    expect(
      discovered.size,
      "implausibly few runSecurityJob callers — the parse has gone blind",
    ).toBeGreaterThanOrEqual(5);
    const missing = aiTools()
      .map((t) => t.slug)
      .filter((slug) => !discovered.has(slug));
    expect(
      missing,
      "these AI tools have no browser client call site this walk can see",
    ).toEqual([]);
  });

  it("matches the set the copy is keyed on, in both directions", () => {
    const discovered = discoverDeclaringClients();
    const declaring = aiTools()
      .map((t) => t.slug)
      .filter((slug) => discovered.get(slug) === true)
      .sort();
    // Health, both ways: at least one tool of each kind, or the comparison
    // below is between two empty (or two full) sets.
    expect(declaring.length).toBeGreaterThan(0);
    expect(declaring.length).toBeLessThan(aiTools().length);
    expect([...AI_TOOLS_DECLARING_CHARACTERS].sort()).toEqual(declaring);
  });
});

describe("each AI page publishes what the route lets that tool do", () => {
  it("the detector flags the sentence that shipped on Summarize (positive control)", () => {
    expect(
      perRunProblems(
        `Yes — ${SHIPPED_SUMMARIZE_FACT}`,
        AI_UNDECLARED_RUNS_PER_DAY,
      ),
    ).toEqual(
      expect.arrayContaining([
        `quotes the character figure ${DELIVERED} as this tool's`,
      ]),
    );
  });

  it("a per-run page's count equals the jobs the real route allows", async () => {
    const undeclared = aiTools().filter(
      (t) => !AI_TOOLS_DECLARING_CHARACTERS.has(t.slug),
    );
    expect(undeclared.length, "no per-run AI tool — blind").toBeGreaterThan(0);
    for (const tool of undeclared) {
      resetRateLimitGuardForTests();
      const allowed = await jobsTheRouteAllows(tool.slug);
      expect(
        allowed,
        `${tool.slug}: the route allows no job at all`,
      ).toBeGreaterThan(0);
      expect(
        allowed,
        "the published run count is not what the route actually allows",
      ).toBe(AI_UNDECLARED_RUNS_PER_DAY);

      const page = pages.get(tool.slug)!;
      const free = page.faq.find((e) => /\bfree\?$/.test(e.question));
      expect(
        free,
        `${tool.slug}: no "Is it free?" answer is served`,
      ).toBeDefined();
      expect(
        perRunProblems(free!.answer, allowed),
        `${tool.slug} FAQPage`,
      ).toEqual([]);
      const fact = aiAllowanceFactFor(tool.slug);
      expect(perRunProblems(fact, allowed), `${tool.slug} fact`).toEqual([]);
      expect(
        page.text,
        `${tool.slug}: the fact line is not what the page renders`,
      ).toContain(fact);
    }
  });

  it("a declaring page keeps the character figure, and says it is shared", () => {
    for (const slug of AI_TOOLS_DECLARING_CHARACTERS) {
      const page = pages.get(slug)!;
      const free = page.faq.find((e) => /\bfree\?$/.test(e.question))!;
      expect(free.answer).toContain(DELIVERED);
      expect(free.answer).toMatch(/\bsame allowance\b/);
    }
  });

  it("the refusal claims no character count was spent by a per-run user", () => {
    // It said "The 30,774 free characters of AI text for this connection are
    // used up" — false after three one-page summaries. It now names the
    // allowance, and states both units side by side.
    expect(AI_ALLOWANCE_USED_MESSAGE).not.toMatch(
      /\bThe [\d,]+ free characters\b[^.]*\bare used up\b/,
    );
    expect(
      AI_ALLOWANCE_USED_MESSAGE,
      "the refusal names no per-run count for the tools that are charged per run",
    ).toContain(`${AI_UNDECLARED_RUNS_PER_DAY} `);
  });
});
