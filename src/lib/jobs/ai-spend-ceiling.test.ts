// @vitest-environment node
/**
 * The two ceilings, compared — which is the thing nobody had done.
 *
 * Ours is a token bound; OpenAI's is a dollar bound. Each was correct at its own
 * layer and they had never been put side by side, so **we could not say which
 * trips first.** That matters entirely: if the provider's cap binds first, ours
 * never fires — the balance runs out, calls fail as generic provider errors, and
 * the honest 503 in `AI_CEILING_REACHED_MESSAGE` never renders. A guard that
 * cannot fire, arriving through the FIGURE rather than the wiring.
 *
 * The blended price is unmeasured, so these tests do not assert which one wins.
 * They assert the things that ARE true today: the threshold is derived rather
 * than guessed, the unmeasured price is recorded as unmeasured, and nothing
 * claims ours binds first without evidence.
 */
import { describe, expect, it } from "vitest";
import {
  AI_BLENDED_PRICE_USD_PER_MTOK,
  AI_CEILING_BREAKEVEN_USD_PER_MTOK,
  AI_SPEND_CEILING,
  AI_SPEND_DAILY_TOKEN_CEILING,
  AI_SPEND_EXTERNAL_BOUND,
  AI_CEILING_MONTHLY_COST_USD,
  AI_PRICE_SOURCE,
  AI_CEILING_REACHED_MESSAGE,
  aiCeilingBindsFirst,
} from "./ai-spend-ceiling";
import {
  ACCOUNT_CLAIMS,
  PERSONAL_CONDUCT_CLAIMS,
} from "@/tests/identity-claims";

describe("the token ceiling and the dollar cap are comparable", () => {
  it("derives the breakeven price from both bounds rather than stating one", () => {
    // $100 / (2,000,000 tokens/day × 30 days) = $1.667 per million tokens.
    // Below that price ours binds first; above it, OpenAI's does.
    const monthlyMtok = (AI_SPEND_DAILY_TOKEN_CEILING * 30) / 1_000_000;
    expect(AI_CEILING_BREAKEVEN_USD_PER_MTOK).toBeCloseTo(
      AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd / monthlyMtok,
      10,
    );
    expect(AI_CEILING_BREAKEVEN_USD_PER_MTOK).toBeCloseTo(1.6667, 3);
  });

  it("answers YES from a measured price, not from an assumption", () => {
    // It answered "unknown" until the rate card was read on 2026-08-11. The
    // verdict is evidence now; the machinery that refuses to guess is unchanged
    // and is what makes the answer worth anything.
    expect(AI_BLENDED_PRICE_USD_PER_MTOK).toBe(1.2);
    expect(aiCeilingBindsFirst()).toBe("yes");
  });

  it("SELF-CHECKS that our ceiling costs less than the provider's cap", () => {
    // THE SECOND, INDEPENDENT BOUND, made executable. A constant has no
    // relationships for a structural defence to constrain, so the only thing
    // that can see a wrong number is a comparison against something outside it.
    //
    // This goes red — rather than the ceiling quietly becoming decoration — if
    // anyone raises `fullRunsPerDay`, if OpenAI's cap drops, or if the price
    // moves. Those are the three ways this feature silently stops bounding
    // anything, and none of them is visible in a diff.
    expect(
      AI_CEILING_MONTHLY_COST_USD,
      `our ceiling would cost $${AI_CEILING_MONTHLY_COST_USD}/month at ` +
        `$${AI_BLENDED_PRICE_USD_PER_MTOK}/Mtok, against OpenAI's ` +
        `$${AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd} cap. The provider's bound ` +
        "would trip first, so the honest 503 would never render and the " +
        "balance would simply run out as generic provider errors.",
    ).toBeLessThan(AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd);
    // $72 against $100 today — stated so the margin is visible, not just the pass.
    expect(AI_CEILING_MONTHLY_COST_USD).toBeCloseTo(72, 6);
  });

  it("records why the long-context rate is excluded", () => {
    // The question a future reader gets wrong: $1.80 exists on the rate card and
    // is not used. A blend can only reach it with 100% output at long-context
    // pricing, and long context is entered by a large INPUT priced well below
    // output — so the rate always arrives attached to what drags the blend down.
    expect(AI_PRICE_SOURCE.usedRateUsdPerMTok).toBe(1.2);
    expect(AI_PRICE_SOURCE.excludedRateUsdPerMTok).toBe(1.8);
    expect(AI_PRICE_SOURCE.excludedBecause.length).toBeGreaterThan(40);
    expect(AI_PRICE_SOURCE.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(AI_PRICE_SOURCE.model).toBe("gpt-5.6-luna");
  });

  it("resolves in both directions once a price exists", () => {
    // Proven with hypothetical inputs so the derivation is exercised without
    // inventing the real number. When the measurement lands, setting one
    // constant answers the question — no new logic.
    const decide = (price: number) =>
      price < AI_CEILING_BREAKEVEN_USD_PER_MTOK ? "yes" : "no";
    expect(decide(0.5)).toBe("yes");
    expect(decide(5)).toBe("no");
    // And the boundary is not silently inclusive.
    expect(decide(AI_CEILING_BREAKEVEN_USD_PER_MTOK)).toBe("no");
  });

  it("records the external bound with its provenance and a re-check route", () => {
    // It cannot be verified by any test — it lives in a billing console. So the
    // discipline is `densityMeasuredOn`'s: date it, name the source, and make
    // the staleness visible rather than implicit.
    expect(AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd).toBeGreaterThan(0);
    expect(AI_SPEND_EXTERNAL_BOUND.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(AI_SPEND_EXTERNAL_BOUND.source.toLowerCase()).toContain("openai");
  });

  it("keeps the ceiling's own figure labelled provisional", () => {
    // Unchanged by this work, and it must stay labelled: the run count is still
    // the one invented factor, and the dollar comparison does not measure it.
    expect(AI_SPEND_CEILING.measuredOn).toBe("provisional");
  });
});

/**
 * The message a visitor reads when the GLOBAL ceiling is spent makes no claim
 * about who they are.
 *
 * This module is outside the copy walk (copy-surface.test.ts records why), so
 * account-honesty and allowance-copy never read it — and its wording was wrong
 * twice in the same family. Both ban lists run here, over the constant every
 * route returns, from the one shared definition. Each earlier wording is a
 * positive control: the check must catch the defect it exists for, or a
 * passing result says nothing.
 */
describe("the ceiling message makes no identity claim", () => {
  // Shipped until 2026-10-09: an account, on a product with no accounts.
  const HAD_AN_ACCOUNT =
    "AI features are temporarily unavailable — the service has reached its daily processing limit. This is a limit on our side, not on your file or your account. Please try again tomorrow; every other PDF tool is unaffected.";
  // Its first fix, the same day: an allowance the reader owns, when the
  // limiter counts a connection.
  const OWNED_THE_ALLOWANCE =
    "AI features are temporarily unavailable — the service has reached its daily processing limit. This is a limit on our side, not a problem with your file or your own allowance. Please try again tomorrow; every other PDF tool is unaffected.";

  const accountClaims = (text: string) =>
    ACCOUNT_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(
      ({ label }) => label,
    );
  const conductClaims = (text: string) =>
    PERSONAL_CONDUCT_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(
      ({ name }) => name,
    );

  it("positive controls: each earlier wording is caught by its list", () => {
    expect(accountClaims(HAD_AN_ACCOUNT)).toEqual([
      "a claim that the visitor has an account",
    ]);
    expect(conductClaims(OWNED_THE_ALLOWANCE)).toEqual([
      "a possessive over the allowance itself — whose runs these are",
    ]);
  });

  it("the shipped message carries neither", () => {
    expect(accountClaims(AI_CEILING_REACHED_MESSAGE)).toEqual([]);
    expect(conductClaims(AI_CEILING_REACHED_MESSAGE)).toEqual([]);
    // Still says what the docblock requires: whose limit it is, that it is
    // temporary, and that the file is fine.
    expect(AI_CEILING_REACHED_MESSAGE).toContain("a limit on our side");
    expect(AI_CEILING_REACHED_MESSAGE).toContain("try again tomorrow");
    expect(AI_CEILING_REACHED_MESSAGE).toContain(
      "not a problem with your file",
    );
  });
});
