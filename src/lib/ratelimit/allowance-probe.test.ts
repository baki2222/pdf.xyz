// @vitest-environment node
/**
 * The documented way to ask "is my AI allowance gone?" without spending it.
 *
 * `docs/RATE_LIMITING.md` tells an operator to run this probe and read the
 * answer. **A documented procedure is a claim**, and the two numbers in it —
 * what the probe reveals, and what it costs — are exactly the kind that stay
 * written down long after the code moves underneath them. So the probe is
 * pinned here rather than only described there.
 *
 * ── THE OBVIOUS PROBE DOES NOT WORK, AND THAT IS WHY THIS EXISTS ────────────
 *
 * "Send a job with an invalid file id — the guard refuses before validation" is
 * the natural description and it is wrong about WHICH guard. Tracing
 * `POST /api/jobs`: the abuse guard runs first, then the body is read, then
 * `parseCreateJobRequest` — and a malformed file id fails THERE, with a 400,
 * **before the AI allowance is ever consulted**. It costs nothing and reveals
 * nothing about the allowance. It is a correct sentence about a different
 * guard.
 *
 * The probe that reaches the allowance needs a WELL-FORMED id (the contract
 * checks shape, not existence) and a `declaredCharacters` of 1, which reserves
 * `1 × headroom` — four characters out of 123,096.
 *
 * ── AND A 429 IS NOT A 429 ──────────────────────────────────────────────────
 *
 * `POST /api/jobs` can refuse with 429 for two unrelated reasons: the
 * `jobs.create` abuse limit (60/hour) and the `ai.characters` allowance
 * (per day). They are told apart by the MESSAGE, never by the status — and an
 * operator who reads the status alone will conclude the allowance is gone when
 * they have merely been throttled.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidFileId } from "@/lib/jobs";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import {
  AI_CHARACTER_ALLOWANCE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  AI_ALLOWANCE_USED_MESSAGE,
} from "@/lib/jobs/ai-allowance";
import { TRANSLATE_EXTRACTOR_HEADROOM } from "@/lib/jobs/translate-limits";
import { POST } from "@/app/api/jobs/route";

/** A file id in the shape the contract requires. It does not have to exist. */
const WELL_FORMED = "f_probe0000000000";
/** …and one that does not parse, for the variant that reveals nothing. */
const MALFORMED = "file_probe";

/** What the probe costs when it is allowed through. */
const PROBE_COST = 1 * TRANSLATE_EXTRACTOR_HEADROOM;

function probeRequest(fileId: string, declaredCharacters = 1): Request {
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool: "translate-pdf",
      inputs: [fileId],
      options: { targetLanguage: "fr", sourceLanguage: "auto" },
      declaredCharacters,
    }),
  });
}

const bare = (): Request =>
  new Request("http://localhost/spend", { method: "POST" });

beforeEach(() => {
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
});
afterEach(() => {
  // Both hooks, and the env var deleted: `vitest.config.ts` runs
  // `isolate: false`, so the limiter singleton and `process.env` are shared
  // with every other file in this worker.
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
});

describe("the zero-cost allowance probe", () => {
  it("costs exactly one character's reservation when the allowance is available", async () => {
    const response = await POST(probeRequest(WELL_FORMED));

    // It got PAST the allowance. What it hits next is the unconfigured worker,
    // which is the point: no job is created, no worker runs, no AI call.
    expect(
      response.status,
      "the probe was refused before it could reveal anything",
    ).not.toBe(429);

    // Exactly `1 × headroom` was taken — proven by spending the rest and then
    // failing to spend one more, which pins the figure from both sides. A
    // single "is there room" assertion would pass for any cost at all.
    const rest = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE - PROBE_COST,
      bare(),
    );
    expect(
      rest.allowed,
      `the probe cost more than ${PROBE_COST} characters`,
    ).toBe(true);

    const oneMore = await enforceAiCharacterAllowance(1, bare());
    expect(
      oneMore.allowed,
      `the probe cost less than ${PROBE_COST} characters, so the documented ` +
        "figure is wrong in the cheap direction",
    ).toBe(false);
  });

  it("reveals an exhausted allowance, and spends nothing doing it", async () => {
    // Drain it first, the way a day of real jobs would.
    const drain = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      bare(),
    );
    expect(drain.allowed, "the bucket did not start full").toBe(true);

    const response = await POST(probeRequest(WELL_FORMED));
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: { message: string } };
    expect(
      body.error.message,
      "the refusal does not name the allowance, so an operator cannot tell it " +
        "apart from an ordinary throttle",
    ).toBe(AI_ALLOWANCE_USED_MESSAGE);

    // A refusal PEEKS. If it spent, a probe run while exhausted would push the
    // window out and punish the person asking a read-only question.
    const second = await POST(probeRequest(WELL_FORMED));
    expect(second.status).toBe(429);
    expect(
      Number(second.headers.get("retry-after")),
      "asking twice moved the retry window, so the probe is not free after all",
    ).toBeLessThanOrEqual(Number(response.headers.get("retry-after")));
  });

  it("CORRECTION: a MALFORMED file id never reaches the allowance", async () => {
    // The intuitive probe. It is refused earlier, by the contract — so it is
    // free, and it answers a question nobody asked. Pinned so the runbook
    // cannot drift back to describing it.
    const response = await POST(probeRequest(MALFORMED));
    expect(response.status).toBe(400);

    // Nothing was taken: the whole budget is still spendable in one go.
    const untouched = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      bare(),
    );
    expect(
      untouched.allowed,
      "a malformed request spent part of the allowance, which would make the " +
        "cheap probe expensive and the expensive one pointless",
    ).toBe(true);
  });

  it("and docs/RATE_LIMITING.md quotes the same figures the code enforces", () => {
    /**
     * The runbook section is prose with four numbers in it, and prose is where
     * this project's numbers go to die: `docs-integrity.test.ts` checks that
     * the NOUNS in a doc still exist, not that its FIGURES are still right, so
     * nothing else here would notice these drifting.
     *
     * Derived from the constants rather than retyped, and each pinned as a
     * distinctive string — a bare `toContain("4")` is satisfied by accident by
     * almost any number, which is how a copy guard in this repo stayed green
     * through a complete rewrite because "37,024" contains a "3".
     */
    const doc = readFileSync("docs/RATE_LIMITING.md", "utf8");
    const section = doc.slice(doc.indexOf("## Step 5"));
    expect(
      section.length,
      "the allowance-probe section is gone from the runbook, so this guard is asking nothing",
    ).toBeGreaterThan(500);

    expect(
      section,
      "the runbook quotes a daily allowance the code does not enforce",
    ).toContain(AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US"));
    expect(
      section,
      "the runbook quotes a bucket size the limiter does not use",
    ).toContain(AI_CHARACTER_ALLOWANCE.toLocaleString("en-US"));
    expect(
      section,
      `the runbook no longer says the probe costs ${PROBE_COST} characters`,
    ).toContain(`**${PROBE_COST}** characters`);
    expect(
      section,
      "the runbook quotes a refusal message the product does not send",
    ).toContain(AI_ALLOWANCE_USED_MESSAGE.slice(0, 60));

    // And the file id in the copy-pasteable command must actually parse, or an
    // operator following the runbook gets a 400 and concludes, wrongly, that
    // their allowance is fine.
    const fileId = /"inputs":\["(f_[^"]+)"\]/.exec(section)?.[1];
    expect(
      fileId,
      "no file id could be read out of the documented command",
    ).toBeTruthy();
    expect(isValidFileId(fileId!), `${fileId} is not a valid file id`).toBe(
      true,
    );
  });

  it("CONTROL: with no limiter configured the probe reveals nothing", async () => {
    // The default build. `enforceAiCharacterAllowance` short-circuits to
    // `allowUnenforced` before reading a header, so a 429 can never appear and
    // an operator running this against an unconfigured deployment would read
    // "allowance fine" from a system that is not counting at all.
    delete process.env[RATE_LIMIT_ENV.provider];
    resetRateLimitGuardForTests();

    const verdict = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE * 10,
      bare(),
    );
    expect(verdict.allowed).toBe(true);
    expect(
      verdict.enforced,
      "an unconfigured limiter reported itself as enforcing",
    ).toBe(false);
  });
});
