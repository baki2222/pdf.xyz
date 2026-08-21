// @vitest-environment node
/**
 * The free AI allowance, denominated in CHARACTERS rather than runs.
 *
 * A "run" priced a job correctly while every job was one provider call. Chunked
 * translation broke that: a thirty-page document is ten calls, so one run
 * misprices it by 10× — and three runs a day makes it impossible on the free
 * tier while three one-page documents cost the same three runs.
 *
 * PAGES WERE RULED FIRST AND THE PREMISE FAILED THE MEASUREMENT. Today's
 * capacity is `3 × 10,258 = 30,774` characters a day; expressed in pages using
 * the density figures already measured on 2026-08-10 that is **5.00 pages of
 * dense text or 17.91 of sparse** — a 3.58× spread, so no single pages/day
 * number preserves it. Five would cut sparse documents to 0.28× of today;
 * eighteen would hand dense ones 3.60×. Characters carry no such error bar
 * because they ARE the quantity the ceiling bounds.
 *
 * AND THE UNIT IS CHOSEN FOR LEGIBILITY, NOT COST FIDELITY. `ai.run` is a
 * per-client FAIRNESS device; `ai.spend` is the cost control, and the two are
 * deliberately separate (`policy.ts:107` — "conflating them is what let the gap
 * sit unnoticed"). What this unit has to be is *knowable by the person about to
 * spend it*, and the panel extracts the text before it uploads, so it can name
 * the real figure for the real file.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "./guard";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { RATE_LIMITS } from "@/lib/jobs/types";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";

const LOCAL = { PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory" };
const T0 = 1_700_000_000_000;
const req = () => new Request("http://localhost/api/jobs", { method: "POST" });

beforeEach(() => {
  resetRateLimitGuardForTests();
});

describe("the daily budget is derived, never typed", () => {
  it("is exactly today's effective capacity", () => {
    // Ships behind today's capacity so nothing gets more expensive by accident,
    // and DERIVED from both factors so it moves if either does — a typed 30774
    // would silently stop describing the tool the day the ceiling changed.
    expect(AI_CHARACTER_ALLOWANCE).toBe(
      TRANSLATE_MAX_INPUT_CHARS * RATE_LIMITS.aiRunsPerDayPerClient,
    );
    expect(AI_CHARACTER_ALLOWANCE).toBe(30_774);
  });
});

describe("a job reserves the characters it will actually use", () => {
  it("charges a small document a small amount", async () => {
    // THE DEFECT THIS REPLACES: under `ai.run` a 500-character document and a
    // 10,000-character one both cost one of three runs.
    const first = await enforceAiCharacterAllowance(500, req(), LOCAL, T0);
    expect(first.allowed).toBe(true);
    const second = await enforceAiCharacterAllowance(500, req(), LOCAL, T0);
    expect(second.allowed).toBe(true);
    // Three tiny documents used to exhaust the day. They now cost 1,500 of
    // 30,774 — a twentieth of it.
    for (let i = 0; i < 20; i += 1) {
      const more = await enforceAiCharacterAllowance(500, req(), LOCAL, T0);
      expect(
        more.allowed,
        `run ${i + 3} of 500 characters was refused; under characters the day ` +
          "holds sixty of them, not three",
      ).toBe(true);
    }
  });

  it("refuses once the day's characters are gone, not before", async () => {
    const ok = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      req(),
      LOCAL,
      T0,
    );
    expect(ok.allowed, "the whole day's budget in one job must fit").toBe(true);
    const over = await enforceAiCharacterAllowance(1, req(), LOCAL, T0);
    expect(over.allowed).toBe(false);
  });

  it("does not let a single job silently overspend the day", async () => {
    // A document larger than the whole daily budget must be refused rather than
    // accepted and then partly delivered on someone else's behalf.
    const huge = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE + 1,
      req(),
      LOCAL,
      T0,
    );
    expect(huge.allowed).toBe(false);
  });

  it("resets on its own daily clock", async () => {
    await enforceAiCharacterAllowance(AI_CHARACTER_ALLOWANCE, req(), LOCAL, T0);
    expect(
      (await enforceAiCharacterAllowance(1, req(), LOCAL, T0)).allowed,
    ).toBe(false);
    const tomorrow = T0 + 86_400_000 + 1;
    expect(
      (await enforceAiCharacterAllowance(1, req(), LOCAL, tomorrow)).allowed,
    ).toBe(true);
  });

  it("charges nothing for a claim that is not a positive count", async () => {
    // A malformed claim must not be treated as free, and must not be treated as
    // infinite either. It is refused: the caller has to say what it will use.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const verdict = await enforceAiCharacterAllowance(bad, req(), LOCAL, T0);
      expect(verdict.allowed, `a claim of ${bad} was accepted`).toBe(false);
    }
  });

  it("fails OPEN when no limiter is configured, and says so", async () => {
    const verdict = await enforceAiCharacterAllowance(500, req(), {}, T0);
    expect(verdict.allowed).toBe(true);
    expect(verdict.enforced).toBe(false);
  });
});
