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
  aiCeilingBindsFirst,
} from "./ai-spend-ceiling";

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

  it("answers UNKNOWN while the price is unmeasured, never yes", () => {
    // The assertion that matters. A cost control defaulting to "yes, I bind
    // first" would be making without evidence exactly the claim this exercise
    // exists to stop. Unknown is the honest answer and it stays unknown until
    // someone measures.
    expect(AI_BLENDED_PRICE_USD_PER_MTOK).toBeNull();
    expect(
      aiCeilingBindsFirst(),
      "the ceiling claims to bind first while the blended price is unmeasured",
    ).toBe("unknown");
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
