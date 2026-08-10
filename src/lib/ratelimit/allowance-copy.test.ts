// @vitest-environment node
/**
 * The allowance copy may not claim per-person accounting the limiter cannot do.
 *
 * `deriveClientToken` returns {@link SHARED_BUCKET_TOKEN} whenever
 * `trustForwardedFor` is off — which is the default, and which the operator
 * docs actively recommended — so every request keys into ONE bucket. While
 * that is true, "3 free AI runs a day per device" is false on four tool pages
 * and inside `FAQPage` JSON-LD, and the 429 tells a first-time visitor that
 * *they* have used *their* allowance.
 *
 * This guard is deliberately PRECONDITION-ANCHORED rather than a string ban:
 * it asserts the copy matches what the limiter can actually distinguish. The
 * moment identity keys on a real per-client address, the first test here goes
 * red and the copy must be re-strengthened ON PURPOSE — which is the correct
 * direction for a claim to move, and the opposite of letting a stale sentence
 * quietly become true again by accident.
 */
import { describe, expect, it } from "vitest";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";
import { AI_ALLOWANCE_USED_MESSAGE } from "./response";
import { AI_ALLOWANCE_FACT } from "@/lib/tools/tool-facts";
import { AI_DAILY_ALLOWANCE_NOTE } from "@/lib/workers/ai-tool-availability";

/** Two genuinely different callers, as a proxy/CDN would present them. */
const headersFor = (address: string) =>
  new Headers({ "x-forwarded-for": address });

const PER_PERSON_CLAIMS = [
  /\bper device\b/i,
  /\bper user\b/i,
  /\bper person\b/i,
  /\byour\s+\d+\s+free\b/i,
  /\byou'?ve used your\b/i,
];

const COPY: { where: string; text: string }[] = [
  { where: "tool-facts AI_ALLOWANCE_FACT (4 tool pages + FAQPage JSON-LD)", text: AI_ALLOWANCE_FACT },
  { where: "ai-tool-availability AI_DAILY_ALLOWANCE_NOTE (the AI panels)", text: AI_DAILY_ALLOWANCE_NOTE },
  { where: "the 429 body", text: AI_ALLOWANCE_USED_MESSAGE },
];

describe("the AI allowance copy matches what the limiter can distinguish", () => {
  it("still cannot tell two clients apart in the default configuration", () => {
    // The precondition. If this ever fails, identity has been fixed — GOOD:
    // go strengthen the copy in the same change, then delete this test.
    const off = { trustForwardedFor: false };
    const a = deriveClientToken(headersFor("203.0.113.7"), off);
    const b = deriveClientToken(headersFor("198.51.100.42"), off);
    expect(a).toBe(SHARED_BUCKET_TOKEN);
    expect(
      b,
      "identity now separates two clients — the allowance copy may (and should) " +
        "claim per-person accounting again, and this guard should be deleted",
    ).toBe(a);
  });

  it("claims no per-person accounting while every request shares one bucket", () => {
    const offenders: string[] = [];
    for (const { where, text } of COPY) {
      for (const pattern of PER_PERSON_CLAIMS) {
        if (pattern.test(text)) {
          offenders.push(
            `${where}: ${pattern} matches "${text}" — but deriveClientToken returns ` +
              `"${SHARED_BUCKET_TOKEN}" for every caller, so the allowance is shared, ` +
              "not per person",
          );
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("says plainly that the allowance is shared", () => {
    // Not just the absence of a false claim — the presence of the true one.
    // A silently-scopeless "3 free AI runs a day" still reads as per-person.
    for (const { where, text } of COPY) {
      expect(text, `${where} does not say the allowance is shared`).toMatch(
        /shared/i,
      );
    }
  });
});
