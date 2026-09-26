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
 */
import { describe, expect, it } from "vitest";
import { AI_RUN_PRICING, aiReservationFor } from "@/lib/jobs/delivery-cap";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import {
  PER_CALL_PROCESSORS,
  documentCharactersSent,
  provesAiReadCap,
} from "./read-cap-proof";

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

describe("the capability published as aiReadCap", () => {
  it("is proven by this image", async () => {
    expect(await provesAiReadCap()).toBe(true);
  });
});
