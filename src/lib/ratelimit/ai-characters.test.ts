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
import {
  TRANSLATE_EXTRACTOR_DIVERGENCE,
  TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED,
  TRANSLATE_EXTRACTOR_HEADROOM,
  extractorHorizontalRatioBound,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";

const LOCAL = { PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory" };
const T0 = 1_700_000_000_000;
const req = () => new Request("http://localhost/api/jobs", { method: "POST" });

beforeEach(() => {
  resetRateLimitGuardForTests();
});

describe("the daily budget is derived, never typed", () => {
  it("is exactly today's effective capacity", () => {
    // Three factors, all derived, none typed: the per-call ceiling, the runs it
    // replaces, and the extractor headroom. A typed `61_548` would go on
    // describing a tool that had changed underneath it.
    //
    // THE HEADROOM DOES NOT MAKE ANYONE RICHER, which is the part that reads
    // wrong at a glance. A reservation is `count × h` against a budget of
    // `ceiling × runs × h`, so documents per day is `ceiling × runs / count` —
    // `h` cancels. Capacity is still 30,774 browser-characters; the factor only
    // decides how often a reservation falls short of what the worker finds.
    expect(AI_CHARACTER_ALLOWANCE).toBe(
      Math.floor(
        TRANSLATE_MAX_INPUT_CHARS *
          RATE_LIMITS.aiRunsPerDayPerClient *
          TRANSLATE_EXTRACTOR_HEADROOM,
      ),
    );
    expect(AI_CHARACTER_ALLOWANCE).toBe(61_548);
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
    // Three tiny documents used to exhaust the day. They now cost 1,500 of the
    // budget rather than all of it.
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

/**
 * The headroom that keeps an HONEST caller from paying for our two extractors
 * disagreeing.
 *
 * The browser under-counts: pdfjs concatenates adjacent text items with nothing
 * between them, so it reads `North1200` as eleven characters where any reader
 * sees twelve. Reserving its raw count would truncate a legitimate document —
 * a broken result the caller did not cause.
 *
 * THE FIRST VERSION OF THIS CONSTANT WAS SAMPLED AND WRONG BY 1.6×, and the
 * history is the point. `Math.max` over the Xpdf table gave 1.2031; poppler on
 * the binary we actually ship reaches 1.9514 on a wide table of short cells —
 * any spreadsheet exported to PDF. That headroom would have truncated such a
 * document's honest owner at ~63% of their own file.
 */
describe("the extractor headroom", () => {
  it("is DERIVED and below 2 for every page, never sampled from a table", () => {
    // After collapsing, the worker emits at most `n items + (n-1) spaces + 1
    // newline` per line where the browser emits at least `n + 1`. So the ratio
    // is 2n/(n+1), which rises toward 2 and never reaches it.
    for (const n of [1, 2, 8, 16, 24, 40, 1_000, 100_000]) {
      expect(extractorHorizontalRatioBound(n)).toBeLessThan(2);
    }
    expect(extractorHorizontalRatioBound(1)).toBeCloseTo(1, 6);
    // The supremum is what the constant is, so nothing a page can do exceeds it
    // on the horizontal term.
    expect(TRANSLATE_EXTRACTOR_HEADROOM).toBe(2);
  });

  it("matches the SHIPPED binary to four significant figures", () => {
    // The derivation checked against measurement — poppler 22.12.0 on the
    // worker box, not the Xpdf build this table was first taken on. A bound
    // that agrees with the real binary to four figures is the second,
    // independent check a derived constant needs.
    const shipped = TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED.collapsed;
    expect(extractorHorizontalRatioBound(24)).toBeCloseTo(
      shipped.twentyFourColumnOneChar,
      3,
    );
    expect(extractorHorizontalRatioBound(40)).toBeCloseTo(
      shipped.fortyColumnOneChar,
      3,
    );
    // And every shipped measurement sits under the bound, which is the claim.
    for (const ratio of Object.values(shipped)) {
      expect(ratio).toBeLessThan(TRANSLATE_EXTRACTOR_HEADROOM);
    }
  });

  it("covers the case the sampled maximum missed", () => {
    // The regression this constant exists to prevent: a spreadsheet-shaped page
    // that the Xpdf table's maximum did not reach.
    const worstXpdf = Math.max(
      ...Object.values(TRANSLATE_EXTRACTOR_DIVERGENCE.collapsed),
    );
    const worstShipped = Math.max(
      ...Object.values(TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED.collapsed),
    );
    expect(
      worstShipped,
      "the shipped binary no longer exceeds the Xpdf table — if that is real, " +
        "the derivation still stands, but re-read why this test was written",
    ).toBeGreaterThan(worstXpdf);
    expect(worstShipped).toBeLessThan(TRANSLATE_EXTRACTOR_HEADROOM);
  });

  it("records that the table and the shipped run are different binaries", () => {
    expect(TRANSLATE_EXTRACTOR_DIVERGENCE.binary).toMatch(/xpdf/i);
    expect(TRANSLATE_EXTRACTOR_DIVERGENCE.shippedBinary).toMatch(/poppler/i);
    expect(TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED.binary).toBe(
      TRANSLATE_EXTRACTOR_DIVERGENCE.shippedBinary,
    );
    for (const on of [
      TRANSLATE_EXTRACTOR_DIVERGENCE.measuredOn,
      TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED.measuredOn,
    ]) {
      expect(on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("costs an honest user nothing, because the factor cancels", () => {
    // Budget = ceiling x runs x h and a reservation is count x h, so documents
    // per day is ceiling x runs / count — independent of h. This is why the
    // size of the headroom is not worth trading against capacity.
    const count = 5_000;
    const docsPerDay = (h: number) =>
      Math.floor(
        TRANSLATE_MAX_INPUT_CHARS * RATE_LIMITS.aiRunsPerDayPerClient * h,
      ) /
      (count * h);
    expect(docsPerDay(2)).toBeCloseTo(docsPerDay(1.2031), 3);
    expect(docsPerDay(2)).toBeCloseTo(docsPerDay(7), 3);
  });
});
