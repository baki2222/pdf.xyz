// @vitest-environment node
/**
 * What an AI run is CHARGED, spent the way `POST /api/jobs` spends it.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The allowance is published in characters — "30,774 free characters of AI
 * text a day" — and translate is charged by the characters it declares. The
 * other three AI tools never declared, so every run of Summarize, Chat or
 * Extract reserved the undeclared fallback, `TRANSLATE_MAX_INPUT_CHARS × h`:
 * exactly a third of the bucket. A one-page summary cost 10,258 characters of a
 * 30,774-character day, and chat — one job per QUESTION — gave a visitor three
 * questions in total. The number on the page was not the unit they were charged
 * in.
 *
 * Nothing caught it because every check here was about translate: the
 * advertised figure was proved against `deliverableInADay(translate)`, and the
 * route's only pricing test used a translate body.
 *
 * ── WHAT IS PINNED ──────────────────────────────────────────────────────────
 *
 * The corpus is the catalogue's AI tools, not a list typed here. Every run is
 * priced by the real `aiReservationFor` and debited from the REAL limiter
 * (`enforceAiCharacterAllowance`, local-memory), so "how many runs fit in a
 * day" is counted by the thing that refuses the next one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "./capabilities";
import {
  AI_RUN_PRICING,
  aiReservationFor,
  deliveryCapFor,
} from "./delivery-cap";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "./translate-limits";
import { AI_CHARACTER_ALLOWANCE } from "./ai-allowance";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";

const H = TRANSLATE_EXTRACTOR_HEADROOM;
const FALLBACK = Math.ceil(TRANSLATE_MAX_INPUT_CHARS * H);

/** The catalogue's AI tools — derived, never typed. */
function aiToolSlugs(): string[] {
  return tools
    .filter((tool) => capabilityForMode(tool.processing) === "ai")
    .map((tool) => tool.slug);
}

function perCallTools(): string[] {
  return aiToolSlugs().filter((slug) => AI_RUN_PRICING[slug] === "per-call");
}

const enforced = async () => true;
const notEnforced = async () => false;

async function reservation(
  tool: string,
  declaredCharacters: number | undefined,
  readCapEnforced: () => Promise<boolean>,
) {
  return aiReservationFor(
    tool,
    declaredCharacters === undefined ? {} : { declaredCharacters },
    {
      fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
      headroom: H,
      readCapEnforced,
    },
  );
}

/**
 * Runs that fit in one day for one connection, charged the way the route
 * charges: `enforceAiCharacterAllowance(reservation.charge)` until it refuses.
 */
async function runsInADay(
  tool: string,
  declaredCharacters: number | undefined,
  readCapEnforced: () => Promise<boolean>,
): Promise<number> {
  resetRateLimitGuardForTests();
  const request = () =>
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
  let runs = 0;
  // A hard bound, so a limiter that never refuses fails as a count rather than
  // as a hung test.
  for (let i = 0; i < 1_000; i += 1) {
    const { charge } = await reservation(
      tool,
      declaredCharacters,
      readCapEnforced,
    );
    const decision = await enforceAiCharacterAllowance(charge, request());
    if (!decision.allowed) return runs;
    runs += 1;
  }
  return runs;
}

beforeEach(() => {
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
});
afterEach(() => {
  // `isolate: false` shares the limiter singleton and process.env.
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
});

describe("the pricing corpus is the catalogue's AI tools", () => {
  it("prices every AI tool, and nothing else", () => {
    const slugs = aiToolSlugs();
    // BOUND THE CORPUS: `[] ⊆ X` is the strongest possible pass.
    expect(
      slugs.length,
      "the catalogue's AI tool set is implausibly small — the corpus failed",
    ).toBeGreaterThanOrEqual(4);
    expect(
      Object.keys(AI_RUN_PRICING).sort(),
      "an AI tool is not priced (it would silently cost the fallback), or a " +
        "priced tool is not an AI tool",
    ).toEqual([...slugs].sort());
    expect(
      perCallTools().length,
      "no tool is priced per call, so every assertion below asks nothing",
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("a per-call run is charged the characters it declares", () => {
  it("fits MORE than three one-page runs a day once the worker enforces the read", async () => {
    // A one-page document: 2,000 characters, the order of ordinary prose.
    for (const tool of perCallTools()) {
      const runs = await runsInADay(tool, 2_000, enforced);
      expect(
        runs,
        `${tool}: a one-page run still costs a third of the day`,
      ).toBeGreaterThan(3);
      // And exactly the number the published unit implies — the day's
      // characters divided by the document's, with nothing lost to rounding
      // but the last run that does not fit.
      expect(runs).toBe(Math.floor(AI_CHARACTER_ALLOWANCE / (2_000 * H)));
    }
  });

  it("still charges a large document exactly the old fallback, and does not refuse it", async () => {
    // The clamp. The engines read up to 500,000 characters; charged at its
    // size such a document would not fit in the bucket at all, and it works
    // today at a third of the day.
    for (const tool of perCallTools()) {
      const priced = await reservation(tool, 400_000, enforced);
      expect(
        priced.charge,
        `${tool}: a large run costs more than it used to`,
      ).toBe(FALLBACK);
      expect(await runsInADay(tool, 400_000, enforced)).toBe(3);
    }
  });

  it("is never charged for more than it may read", async () => {
    // The relationship between the two numbers, over the whole range: a run
    // whose read bound is below its charge would bill for text it cannot see.
    for (const tool of perCallTools()) {
      for (const declared of [1, 17, 2_000, 10_257, 10_258, 10_259, 400_000]) {
        const priced = await reservation(tool, declared, enforced);
        expect(
          priced.delivery,
          `${tool}@${declared}: no read bound`,
        ).toBeDefined();
        expect(priced.delivery!.characters).toBeGreaterThanOrEqual(
          priced.charge,
        );
        // …and an under-declaration buys a SMALLER read, never a cheap full
        // one: the read bound is the declaration times the headroom, exactly.
        expect(priced.delivery!.characters).toBe(Math.ceil(declared * H));
        expect(
          "pages" in priced.delivery!,
          `${tool}: a page bound was set that no per-call engine enforces`,
        ).toBe(false);
      }
    }
  });
});

describe("a declaration nothing enforces is ignored", () => {
  it("charges the fallback, with no read bound, while the running worker has not proved the cap", async () => {
    for (const tool of perCallTools()) {
      const priced = await reservation(tool, 2_000, notEnforced);
      expect(priced).toEqual({ charge: FALLBACK, delivery: undefined });
      expect(await runsInADay(tool, 2_000, notEnforced)).toBe(3);
    }
  });

  it("charges the fallback for an undeclared run, and does not ask the worker", async () => {
    let asked = 0;
    for (const tool of perCallTools()) {
      const priced = await reservation(tool, undefined, async () => {
        asked += 1;
        return true;
      });
      expect(priced).toEqual({ charge: FALLBACK, delivery: undefined });
    }
    expect(asked, "the heartbeat is read for a job it cannot discount").toBe(0);
  });

  it("ignores a declaration on an AI tool it has no pricing for", async () => {
    const priced = await reservation("some-future-ai-tool", 1, enforced);
    expect(priced).toEqual({ charge: FALLBACK, delivery: undefined });
  });
});

describe("translate is priced exactly as before", () => {
  it("charges the cap it runs under, pages included, whatever the worker says", async () => {
    const translate = aiToolSlugs().filter(
      (slug) => AI_RUN_PRICING[slug] === "per-character",
    );
    expect(translate.length, "no per-character tool to check").toBeGreaterThan(
      0,
    );
    for (const tool of translate) {
      for (const witness of [enforced, notEnforced]) {
        const priced = await aiReservationFor(
          tool,
          { declaredCharacters: 14_204, declaredTextPages: 9 },
          {
            fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
            headroom: H,
            readCapEnforced: witness,
          },
        );
        const cap = deliveryCapFor(
          { declaredCharacters: 14_204, declaredTextPages: 9 },
          { fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS, headroom: H },
        );
        expect(priced).toEqual({ charge: cap.characters, delivery: cap });
        // Not clamped: a long translation is several calls and costs its size.
        expect(priced.charge).toBe(14_204 * H);
        expect(priced.charge).toBeGreaterThan(FALLBACK);
      }
    }
  });
});
