// @vitest-environment node
/**
 * The number we advertise is in the unit the reader can count in.
 *
 * The allowance is DEBITED in worker-extracted characters, because that is what
 * the reservation multiplies out to. Nobody outside this codebase can measure
 * that quantity: a visitor with a document counts the characters in it, and the
 * panel counts them with pdfjs. So a headline of "N free characters of AI text"
 * is a claim in the browser's unit whatever the bucket is denominated in, and
 * publishing the bucket size instead makes the claim wrong by exactly the
 * headroom factor — 2× at h=2, 4× at h=4.
 *
 * **This is the defect this project keeps paying for, one layer up.**
 * `AI_INPUT_LIMITS.maxInputCharacters` named reading while translate was bound
 * by writing. `AI_MAX_OUTPUT_TOKENS_BOUNDS.default` named a budget nothing
 * consumed. `TRANSLATE_CALIBRATION` recorded two ends of one bracket in two
 * different units. Each was a correct number wearing the wrong name, and each
 * was found by someone comparing it to something.
 *
 * So the check is not "does the copy contain the constant". It SPENDS the
 * budget the way the route spends it and adds up what a client actually gets,
 * then compares that to the sentence. A number that survives this cannot be in
 * the wrong unit, and it is invariant under the headroom by construction —
 * which is the property `h` cancelling was supposed to give and the code did
 * not yet have.
 */
import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/lib/jobs/types";
import {
  AI_ALLOWANCE_FACT,
  AI_ALLOWANCE_RUNS,
  AI_ALLOWANCE_USED_MESSAGE,
  AI_CHARACTER_ALLOWANCE,
} from "@/lib/jobs/ai-allowance";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";

/**
 * Spend the day the way `POST /api/jobs` spends it.
 *
 * Deliberately the route's arithmetic rather than a formula: `Math.ceil(declared
 * × headroom)` debited from the bucket until the next job will not fit. What
 * comes back is the total the client DECLARED — browser characters, the unit
 * they can see.
 */
function deliverableInADay(declaredPerJob: number): number {
  let remaining = AI_CHARACTER_ALLOWANCE;
  let delivered = 0;
  const cost = Math.ceil(declaredPerJob * TRANSLATE_EXTRACTOR_HEADROOM);
  while (cost <= remaining) {
    remaining -= cost;
    delivered += declaredPerJob;
  }
  return delivered;
}

describe("the advertised allowance is what a client can actually translate", () => {
  it("equals the day's deliverable characters, in the browser's unit", () => {
    const advertised = Number(
      AI_ALLOWANCE_RUNS.replace(/[^\d]/g, "").slice(0, undefined),
    );
    expect(
      advertised,
      "no figure could be read out of the advertised sentence, so this test measured nothing",
    ).toBeGreaterThan(0);

    expect(
      deliverableInADay(TRANSLATE_MAX_INPUT_CHARS),
      "the sentence advertises the size of the internal bucket, not the amount " +
        "of the reader's own text they can translate — the two differ by the " +
        "extractor headroom, and only one of them is a quantity anybody outside " +
        "this codebase can measure",
    ).toBe(advertised);
  });

  it("holds for any document size, to within the last document", () => {
    /**
     * `h` cancels out of documents-per-day, so the daily total must not depend
     * on how the day is split up — but a bucket always strands its remainder,
     * and the FIRST version of this test asserted exact equality and was wrong:
     * 500-character documents deliver 30,500, not 30,774, because the 62nd job
     * does not fit.
     *
     * That is a real property of any budget and not a defect, so the assertion
     * is the true one: never MORE than advertised (which would be a promise the
     * limiter does not keep) and never short by more than one document (which
     * would mean the headline is wrong rather than rounded). Written this way
     * because the over-strong version would have had to be deleted the first
     * time someone changed a constant, and a deleted assertion protects nothing.
     */
    const whole = deliverableInADay(TRANSLATE_MAX_INPUT_CHARS);
    for (const size of [500, 1_000, 2_053, 5_129]) {
      const got = deliverableInADay(size);
      expect(
        got,
        `${size}-character documents deliver MORE than the day advertises`,
      ).toBeLessThanOrEqual(whole);
      expect(
        got,
        `${size}-character documents fall more than one document short of the day`,
      ).toBeGreaterThan(whole - size);
    }
  });

  it("does not move when the headroom moves", () => {
    // THE PROPERTY, stated directly. The headroom exists to stop an honest
    // caller being truncated by an extractor disagreement; it is not capacity
    // and must never read as capacity. A change to it that moved this number
    // would be a change to what the product promises.
    const advertised = deliverableInADay(TRANSLATE_MAX_INPUT_CHARS);
    expect(advertised).toBe(
      TRANSLATE_MAX_INPUT_CHARS * RATE_LIMITS.aiRunsPerDayPerClient,
    );
    expect(
      AI_CHARACTER_ALLOWANCE,
      "the bucket is not the advertised figure times the headroom, so one of " +
        "the two is typed rather than derived",
    ).toBe(advertised * TRANSLATE_EXTRACTOR_HEADROOM);
  });

  it("says the same number in the offer and in the refusal", () => {
    // Two surfaces, one quantity. They legitimately read differently; a reader
    // who is told one number before and another after has been told one lie.
    const figure = deliverableInADay(TRANSLATE_MAX_INPUT_CHARS).toLocaleString(
      "en-US",
    );
    expect(AI_ALLOWANCE_FACT).toContain(figure);
    expect(AI_ALLOWANCE_USED_MESSAGE).toContain(figure);
  });
});
