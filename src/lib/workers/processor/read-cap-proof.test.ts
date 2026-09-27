// @vitest-environment node
/**
 * A per-call AI run reads no more of a document than it was charged for — read
 * off what the PROVIDER received, through the processor the executor calls.
 *
 * The route may charge Summarize, Chat and Extract by the characters the
 * browser declared only because the worker then reads no more than that. Before
 * 2026-09-27 the three processors ignored `input.delivery` entirely, so a
 * declared count would have been a discount on a full read: declare one
 * character, pay four, have 500,000 sent to the model.
 *
 * The evidence is the document text inside the provider request — the
 * consumer's input — not the `maxInputChars` the processor computes, because a
 * processor that computed the right bound and failed to hand it on would pass a
 * check of the number and fail this one.
 *
 * ── AND NO MORE IN TOTAL THAN IT WAS CHARGED (review, 2026-09-27) ───────────
 *
 * The first version of this file counted `MARK`, the document, and nothing
 * else, and so certified a spend hole: the read cap bounds the document only,
 * and the chat question and turns, the extract prompt or schema and the
 * summarize focus reach the model verbatim. The route charged the declared
 * document alone, so a caller declaring 1 paid 4 and sent 8 KB of
 * conversation. The route now charges what the server measures of the options
 * plus an allowance for the engine's own instructions, and the tests below
 * count EVERY character the provider received against that charge.
 */
import { describe, expect, it } from "vitest";
import {
  AI_PER_CALL_INSTRUCTION_CHARACTERS,
  AI_RUN_PRICING,
  aiReservationFor,
  optionCharacters,
} from "@/lib/jobs/delivery-cap";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import {
  PER_CALL_PROCESSORS,
  PROOF_PAGE_COUNTS,
  documentCharactersSent,
  providerCharactersSent,
  provesAiReadCap,
} from "./read-cap-proof";

const WHOLE_RUN = Math.ceil(
  TRANSLATE_MAX_INPUT_CHARS * TRANSLATE_EXTRACTOR_HEADROOM,
);

/** Every body a tool is probed with: its minimal one, then the heavy ones. */
function bodiesOf(tool: string): Record<string, unknown>[] {
  const entry = PER_CALL_PROCESSORS[tool]!;
  return [entry.options, ...entry.heavyOptions];
}

/** The route's price and read bound for `declared` characters and `options`. */
function priceOf(
  tool: string,
  declared: number,
  options: Record<string, unknown>,
) {
  return aiReservationFor(
    tool,
    { declaredCharacters: declared, options },
    {
      fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
      headroom: TRANSLATE_EXTRACTOR_HEADROOM,
      readCapEnforced: async () => true,
    },
  );
}

/** The per-call tools, from the pricing — never typed here. */
function perCallTools(): string[] {
  return Object.entries(AI_RUN_PRICING)
    .filter(([, pricing]) => pricing === "per-call")
    .map(([slug]) => slug);
}

describe("the proof covers every tool priced per call", () => {
  it("probes exactly the per-call tools", () => {
    const priced = perCallTools();
    expect(
      priced.length,
      "no tool is priced per call — the corpus, not the code, failed",
    ).toBeGreaterThanOrEqual(3);
    expect(
      Object.keys(PER_CALL_PROCESSORS).sort(),
      "a tool is charged by its declaration while nothing proves its worker " +
        "reads only that much, or a probed tool is not priced per call",
    ).toEqual([...priced].sort());
  });
});

describe.each(perCallTools())("%s", (tool) => {
  it("CONTROL: uncapped, the whole proof document reaches the provider", async () => {
    // Without this, a processor that sent nothing would "honour" every cap.
    expect(await documentCharactersSent(tool)).toBe(20_000);
  });

  it("an under-declared job, priced by the route, is read only as far as it paid", async () => {
    // The composed chain: the route's own pricing → the cap it hands the
    // adapter → the processor → the provider request.
    const declared = 100;
    const priced = await aiReservationFor(
      tool,
      { declaredCharacters: declared },
      {
        fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
        headroom: TRANSLATE_EXTRACTOR_HEADROOM,
        readCapEnforced: async () => true,
      },
    );
    expect(priced.delivery, "the route set no read bound").toBeDefined();
    const sent = await documentCharactersSent(tool, priced.delivery);
    expect(
      sent,
      "the run did not complete, so nothing was measured",
    ).not.toBeNull();
    expect(
      sent!,
      "the provider was sent more of the document than the job was charged for",
    ).toBeLessThanOrEqual(priced.delivery!.characters);
    expect(sent!).toBeGreaterThan(0);
  });

  it("a large honest declaration is not cut below the engine's own limit", async () => {
    // The cap is `min(engine, cap)`, never a new, smaller ceiling for honest
    // callers: 20,000 declared characters read in full.
    expect(
      await documentCharactersSent(tool, {
        characters: 20_000 * TRANSLATE_EXTRACTOR_HEADROOM,
      }),
    ).toBe(20_000);
  });

  it("fails closed on a malformed cap rather than reading everything", async () => {
    // `null` = the run did not complete; the provider was never called.
    expect(await documentCharactersSent(tool, { characters: -1 })).toBeNull();
    expect(
      await documentCharactersSent(tool, { characters: Number.NaN }),
    ).toBeNull();
  });
});

describe.each(perCallTools())(
  "%s: every character the provider receives",
  (tool) => {
    it("has heavy bodies, each carrying far more than the minimal one", () => {
      // BOUND THE CORPUS: with no heavy body the tests below ask only about a
      // six-character question.
      const entry = PER_CALL_PROCESSORS[tool]!;
      expect(entry.heavyOptions.length).toBeGreaterThan(0);
      for (const options of entry.heavyOptions) {
        expect(optionCharacters(options)).toBeGreaterThan(
          optionCharacters(entry.options) + 250,
        );
      }
    });

    it("CONTROL: the counter sees the options, not only the document", async () => {
      // A counter blind to the options (MARK only, or the system prompt only,
      // which is where two of the three engines put them and the third does not)
      // would report every body the same. The heavy bodies must arrive.
      const minimal = await providerCharactersSent(
        tool,
        { characters: 400 },
        PER_CALL_PROCESSORS[tool]!.options,
      );
      expect(minimal).not.toBeNull();
      for (const options of PER_CALL_PROCESSORS[tool]!.heavyOptions) {
        const heavy = await providerCharactersSent(
          tool,
          { characters: 400 },
          options,
        );
        expect(heavy, "a heavy body did not run").not.toBeNull();
        expect(
          heavy!.total - minimal!.total,
          "the heavy body's text did not show up in what the provider received",
        ).toBeGreaterThanOrEqual(
          (optionCharacters(options) -
            optionCharacters(PER_CALL_PROCESSORS[tool]!.options)) /
            2,
        );
      }
    });

    it.each([1, 100, 2_000])(
      "declared %i: the route's charge covers every character sent, whatever the body",
      async (declared) => {
        // The composed chain: the route's own pricing -> the read bound it hands
        // the worker -> the processor -> the provider request, counted whole.
        for (const options of bodiesOf(tool)) {
          const priced = await priceOf(tool, declared, options);
          expect(
            priced.charge,
            "the run was charged a whole run, so this asks nothing about options",
          ).toBeLessThan(WHOLE_RUN);
          for (const pageCount of PROOF_PAGE_COUNTS) {
            const sent = await providerCharactersSent(
              tool,
              priced.delivery,
              options,
              pageCount,
            );
            expect(sent, "the run did not complete").not.toBeNull();
            expect(
              sent!.total,
              `${optionCharacters(options)} characters of options on ` +
                `${pageCount} page(s): the provider received more than was charged`,
            ).toBeLessThanOrEqual(priced.charge);
          }
        }
      },
    );
  },
);

describe("the instruction allowance the route charges", () => {
  it("covers what every per-call engine adds, and is not a multiple of it", async () => {
    // The second, independent bound on a constant: measured through the real
    // processors, over every tool, body and page count the proof uses.
    let largest = 0;
    let runs = 0;
    for (const tool of perCallTools()) {
      for (const options of bodiesOf(tool)) {
        for (const pageCount of PROOF_PAGE_COUNTS) {
          const sent = await providerCharactersSent(
            tool,
            { characters: 400 },
            options,
            pageCount,
          );
          expect(sent).not.toBeNull();
          runs += 1;
          largest = Math.max(
            largest,
            sent!.total - sent!.document - optionCharacters(options),
          );
        }
      }
    }
    expect(
      runs,
      "the measurement corpus is implausibly small",
    ).toBeGreaterThanOrEqual(
      perCallTools().length * 2 * PROOF_PAGE_COUNTS.length,
    );
    expect(largest, "no engine added any text of its own").toBeGreaterThan(0);
    expect(
      AI_PER_CALL_INSTRUCTION_CHARACTERS,
      `an engine adds ${largest} characters of its own; the route charges less`,
    ).toBeGreaterThanOrEqual(largest);
    expect(
      AI_PER_CALL_INSTRUCTION_CHARACTERS,
      `the route charges ${AI_PER_CALL_INSTRUCTION_CHARACTERS} for ${largest} ` +
        "characters of instructions: every run is overcharged",
    ).toBeLessThanOrEqual(largest * 3);
  });
});

describe("the capability published as aiReadCap", () => {
  it("is proven by this image", async () => {
    expect(await provesAiReadCap()).toBe(true);
  });
});
