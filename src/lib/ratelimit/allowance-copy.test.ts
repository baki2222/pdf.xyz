// @vitest-environment node
/**
 * The allowance copy matches what the limiter can distinguish.
 *
 * INVERTED 2026-08-11, not deleted — the history is the point, and the guard
 * anticipated this moment in its own words.
 *
 * It used to assert the OPPOSITE: that the copy must NOT claim per-person
 * accounting, because `deriveClientToken` returned {@link SHARED_BUCKET_TOKEN}
 * for every caller and there was genuinely one bucket for the whole product. It
 * ended with: *"The moment identity keys on a real per-client address, the first
 * test here goes red and the copy must be re-strengthened ON PURPOSE."*
 *
 * That moment arrived by a route the guard did not anticipate. **Identity was
 * not changed — the deployment was.** `deriveClientToken` still returns the
 * shared token unless `trustForwardedFor` is on AND a salt is configured AND a
 * forwarded address is present; production sets all three, and its posture reads
 * `remote-configured` rather than `remote-configured-shared`. So the precondition
 * as originally written — "two clients share a bucket in the DEFAULT
 * configuration" — is *still true*, and stayed true while the claim it protected
 * became false.
 *
 * A guard anchored to the default build cannot see a claim that went stale
 * because of configuration. So the anchor moves to the configuration the product
 * actually runs, and the dependency is stated rather than assumed: this copy is
 * true of a deployment whose posture is `remote-configured`, and would be false
 * of one that shares. The posture names that difference, and alerts on it.
 */
import { describe, expect, it } from "vitest";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";
import { AI_ALLOWANCE_USED_MESSAGE } from "./response";
import { AI_ALLOWANCE_FACT } from "@/lib/tools/tool-facts";
import { AI_DAILY_ALLOWANCE_NOTE } from "@/lib/workers/ai-tool-availability";

/** Two genuinely different callers, as a proxy/CDN would present them. */
const headersFor = (address: string) =>
  new Headers({ "x-forwarded-for": address });

/** The configuration production runs: forwarded addresses trusted, salt set. */
const PRODUCTION_SHAPED = {
  trustForwardedFor: true,
  keySalt: "a-shared-salt-of-sufficient-length-for-the-validator",
};

const COPY: { where: string; text: string }[] = [
  {
    where: "tool-facts AI_ALLOWANCE_FACT (4 tool pages + FAQPage JSON-LD)",
    text: AI_ALLOWANCE_FACT,
  },
  {
    where: "ai-tool-availability AI_DAILY_ALLOWANCE_NOTE (the AI panels)",
    text: AI_DAILY_ALLOWANCE_NOTE,
  },
  { where: "the 429 body", text: AI_ALLOWANCE_USED_MESSAGE },
];

describe("the AI allowance copy matches what the limiter can distinguish", () => {
  it("separates two clients under the configuration production runs", () => {
    // THE PRECONDITION, re-anchored. The copy below claims a per-visitor
    // allowance; this is the fact that makes the claim true. If it ever fails,
    // the copy is lying again and must be weakened in the same change.
    const a = deriveClientToken(headersFor("203.0.113.7"), PRODUCTION_SHAPED);
    const b = deriveClientToken(headersFor("198.51.100.42"), PRODUCTION_SHAPED);
    expect(a).not.toBe(SHARED_BUCKET_TOKEN);
    expect(
      b,
      "two different clients now key into the SAME bucket under production's " +
        "own configuration — the allowance copy claims a per-visitor allowance " +
        "and would be false",
    ).not.toBe(a);
  });

  it("still shares one bucket in the DEFAULT configuration, which the copy depends on", () => {
    // Stated rather than assumed: the claim is deployment-dependent. A default
    // build — no trusted proxy, no salt — really does put everyone in one
    // bucket, and there the copy would be wrong. That is not invisible: the
    // posture reports `remote-configured-shared` for exactly this case and
    // alerts on it, which is the mechanism that makes a static sentence
    // survivable.
    const off = {
      trustForwardedFor: false,
      keySalt: PRODUCTION_SHAPED.keySalt,
    };
    expect(deriveClientToken(headersFor("203.0.113.7"), off)).toBe(
      SHARED_BUCKET_TOKEN,
    );
    // And with the proxy trusted but NO salt, it refuses to key per client
    // rather than bucketing each instance differently.
    expect(
      deriveClientToken(headersFor("203.0.113.7"), {
        trustForwardedFor: true,
        keySalt: undefined,
      }),
    ).toBe(SHARED_BUCKET_TOKEN);
  });

  it("no longer tells a first-time visitor a stranger may have spent their runs", () => {
    // The claim that went stale. It was true when written and the system was
    // fixed underneath it; `policy.ts` has said `per client per day` throughout.
    for (const { where, text } of COPY) {
      expect(text, `${where} still claims the allowance is shared`).not.toMatch(
        /shared across everyone/i,
      );
      expect(
        text,
        `${where} still hedges that the count may not be the visitor's own`,
      ).not.toMatch(/may not reflect your own/i);
    }
  });

  it("says whose the allowance is, rather than leaving it scopeless", () => {
    // Not merely the absence of the false claim — the presence of the true one.
    // A silently-scopeless "3 free AI runs a day" leaves the reader to guess,
    // and the guess a stranger makes after a refusal is the wrong one.
    for (const { where, text } of COPY) {
      expect(text, `${where} does not say whose allowance it is`).toMatch(
        /\byour\b/i,
      );
    }
  });
});
