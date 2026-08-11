// @vitest-environment node
/**
 * The allowance sentence says what the limiter does — and says it once.
 *
 * It read *"3 free AI runs a day, shared across everyone using pdf.xyz right
 * now"*, which was TRUE when written: `identity.ts` handed every caller
 * `SHARED_BUCKET_TOKEN`, so there was one bucket for the whole product. Then the
 * limiter was fixed and the copy was not. Production reports
 * `remote-configured`, not `remote-configured-shared`; each visitor has their own
 * three runs; and the product went on telling them a stranger might have spent
 * them. The refusal even said *"it may not reflect your own usage"*, sending
 * someone who had spent nothing looking for somebody to blame.
 *
 * TWO PROPERTIES, and the second is the durable one:
 *  1. the words match the enforced policy;
 *  2. **there is one copy of them.** The sentence existed in six places — four
 *     literal duplicates, the constant those four ignored, and a third
 *     independent copy in a different module. A constant used by one of its six
 *     call sites is not a source of truth; it is a seventh copy.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_ALLOWANCE_CLAUSE,
  AI_ALLOWANCE_FACT,
  AI_ALLOWANCE_USED_MESSAGE,
} from "@/lib/jobs/ai-allowance";
import { RATE_LIMITS } from "@/lib/jobs/types";
import { withoutComments } from "./copy-surface";

const ROOT = process.cwd();

/** Every non-test source file, walked. A list is the thing that drifts. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  return out.filter((f) => statSync(f).isFile());
}

describe("the words match the enforced policy", () => {
  it("does not claim the allowance is shared", () => {
    // The exact claim that went stale. `policy.ts` has said `per client per day`
    // in a comment the whole time; nothing made the copy read it.
    for (const text of [
      AI_ALLOWANCE_FACT,
      AI_ALLOWANCE_USED_MESSAGE,
      AI_ALLOWANCE_CLAUSE,
    ]) {
      expect(text.toLowerCase()).not.toContain("shared across everyone");
      expect(text.toLowerCase()).not.toContain("may not reflect your own");
    }
  });

  it("the stale claim appears nowhere in the source tree", () => {
    // The one assertion here that can fail against the shipped code: the exact
    // words were in six files. Asserted over the WALKED tree rather than the
    // constants, because the constants are new and a test that can only pass is
    // not evidence of anything.
    // Comments stripped first: the docblock explaining this defect quotes the
    // very sentence it forbids, and a guard that cries wolf is a guard the
    // next person weakens. Only what a user can read counts.
    const offenders = sourceFiles().filter((file) =>
      /shared across everyone using pdf\.xyz/.test(
        withoutComments(readFileSync(file, "utf8")),
      ),
    );
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "These still say the AI allowance is shared across all visitors. It is " +
        "per client — `policy.ts` says `per client per day`, production reports " +
        "`remote-configured` rather than `remote-configured-shared`, and every " +
        "action derives its bucket from the same `deriveClientToken`.",
    ).toEqual([]);
  });

  it("says the allowance is the visitor's own, and derives the number", () => {
    expect(AI_ALLOWANCE_FACT).toContain("Your own");
    expect(AI_ALLOWANCE_FACT).toContain(
      String(RATE_LIMITS.aiRunsPerDayPerClient),
    );
    expect(AI_ALLOWANCE_USED_MESSAGE).toContain("your");
  });

  it("promises no isolation and no availability", () => {
    // A separate internal spend ceiling exists as a circuit breaker, is never
    // published, and can stop AI for everyone. These sentences say what the
    // allowance IS; claiming it is guaranteed or private would be a promise the
    // product cannot keep, and the opposite failure to the one just fixed.
    const both =
      `${AI_ALLOWANCE_FACT} ${AI_ALLOWANCE_USED_MESSAGE}`.toLowerCase();
    for (const overclaim of [
      "guarantee",
      "guaranteed",
      "always available",
      "private to you",
      "only you",
      "nobody else",
    ]) {
      expect(
        both,
        `the allowance copy must not promise "${overclaim}"`,
      ).not.toContain(overclaim);
    }
  });

  it("keeps the offer and the refusal distinct, sharing a clause", () => {
    // One string serving both surfaces is how the refusal came to carry a hedge
    // that only made sense while the bucket was shared.
    expect(AI_ALLOWANCE_FACT).not.toBe(AI_ALLOWANCE_USED_MESSAGE);
    expect(AI_ALLOWANCE_FACT).toContain(AI_ALLOWANCE_CLAUSE);
    expect(AI_ALLOWANCE_USED_MESSAGE).toContain(AI_ALLOWANCE_CLAUSE);
  });
});

describe("there is exactly one copy of the sentence", () => {
  it("no source file writes the allowance sentence out by hand", () => {
    // Walked, not listed. The duplicates were in three different modules and a
    // list of the ones we knew about is what let the fourth through.
    const offenders = sourceFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      const isTheSource = file
        .replace(/\\/g, "/")
        .endsWith("jobs/ai-allowance.ts");
      if (isTheSource) return false;
      return /free AI runs a day/.test(source);
    });

    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "These write the allowance sentence out instead of importing it from " +
        "@/lib/jobs/ai-allowance. It lived in six places once, and five of them " +
        "went stale together when the limiter changed underneath.",
    ).toEqual([]);
  });

  it("the panels reach the sentence through the shared source", async () => {
    // Reach, not membership: the re-exports must actually resolve to the same
    // string, or "one copy" is true of the source and false of what renders.
    const { AI_DAILY_ALLOWANCE_NOTE } =
      await import("@/lib/workers/ai-tool-availability");
    const { AI_ALLOWANCE_FACT: fromTools } = await import("./tool-facts");
    const { AI_ALLOWANCE_USED_MESSAGE: fromRateLimit } =
      await import("@/lib/ratelimit/response");

    expect(AI_DAILY_ALLOWANCE_NOTE).toBe(AI_ALLOWANCE_FACT);
    expect(fromTools).toBe(AI_ALLOWANCE_FACT);
    expect(fromRateLimit).toBe(AI_ALLOWANCE_USED_MESSAGE);
  });
});
