// @vitest-environment node
/**
 * The withheld-pages notice does NOT offer page choice, because choosing
 * those pages does not get them translated.
 *
 * ── HISTORY (inverted, not deleted: house rule) ─────────────────────────────
 *
 * Slice 7 of competitor audit #29 first shipped, on its branch, a second
 * remedy for a characters-bound withhold: "To translate them, run this PDF
 * again and choose only those pages.", offered when the worker had proved
 * `translatePageRange`, the job was not OCR, the bound was the characters
 * reserved, and no withheld page was over one pass. This file pinned that it
 * was offered under exactly those conditions, and asserted only WHICH
 * sentence was printed. Review found the property false: a characters bound
 * means the server read more than `TRANSLATE_EXTRACTOR_HEADROOM` times the
 * text the browser declared, and the browser declares the chosen pages the
 * same way on a rerun, so the rerun's reservation is again too small for
 * them. The same argument that excluded the pages bound ("it would count the
 * chosen ones the same way") applied to the characters bound. The remedy, its
 * `withheldRemedy` predicate, and the worker's `page-range-proved` record
 * were removed; the notice keeps main's sentence for every bound.
 *
 * What this file pins now:
 *  1. THE PROPERTY, through the composed chain (`deliveryCapFor` →
 *     `runTranslate`): the advised rerun of the withheld pages, declared the
 *     way the browser declared them, delivers nothing. This is why no
 *     page-choice remedy may come back without a different mechanism.
 *  2. No per-job notice (withheld marker, panel notice, nothing-deliverable
 *     refusal), in any arm, offers choosing pages; with a positive control on
 *     the retired sentence.
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import { AI_DELIVERY_LIMITS, deliveryCapFor } from "@/lib/jobs/delivery-cap";
import { deliveryConsequence } from "@/components/tools/delivery-notice";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { nothingDeliverableMessage, withheldPagesMarker } from "./chunking";
import { runTranslate, type PdfTextExtractor } from "./engine";

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};
const INPUT = new Uint8Array([1, 2, 3, 4]);
const NOW = () => "2026-11-17T00:00:00.000Z";

function extraction(sizes: readonly number[]): ExtractedPdfText {
  const pages = sizes.map((size, i) => ({
    pageNumber: i + 1,
    text: `p${i + 1} `.padEnd(size, "x"),
    characterCount: size,
  }));
  const text = pages.map((p) => p.text).join("\n\n");
  return {
    pageCount: sizes.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

const extractorOf = (sizes: readonly number[]): PdfTextExtractor =>
  vi.fn(async () => extraction(sizes));

function provider(): { provider: AiProvider; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    provider: {
      id: "anthropic",
      model: "claude-sonnet-5",
      async complete(): Promise<AiCompletionResult> {
        n += 1;
        return {
          ok: true,
          text: `translated part ${n}`,
          model: "claude-sonnet-5",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    },
  };
}

/** The retired remedy, verbatim as it stood on the branch (history). */
const RETIRED_CHOOSE_PAGES =
  "To translate them, run this PDF again and choose only those pages.";
/** The shape of any page-choice remedy in a per-job notice. */
const OFFERS_PAGE_CHOICE = /\bchoose\b[^.]*\bpages?\b/i;
/** Main's last sentence of the withheld notice. */
const SEPARATE_DOCUMENT =
  "Translate the remaining pages as a separate document.";

describe("the advised rerun of withheld pages does not deliver them (the property)", () => {
  // The browser counts 100 characters on each page; the worker's extractor
  // reads 500 (ratio 5, over the headroom of 4). The browser's count is what
  // the job declares, and what the reservation is priced from.
  const BROWSER_PER_PAGE = 100;
  const WORKER_SIZES = [500, 500, 500];

  it("health: the scenario is a characters bound over the headroom", () => {
    expect(AI_DELIVERY_LIMITS.headroom).toBe(4);
    expect(WORKER_SIZES[2]! / BROWSER_PER_PAGE).toBeGreaterThan(
      AI_DELIVERY_LIMITS.headroom,
    );
  });

  it("the first run withholds page 3 on the characters bound, with main's sentence", async () => {
    const delivery = deliveryCapFor(
      { declaredCharacters: BROWSER_PER_PAGE * WORKER_SIZES.length },
      AI_DELIVERY_LIMITS,
    );
    expect(delivery.characters).toBe(1_200);
    const ai = provider();
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorOf(WORKER_SIZES),
      provider: ai.provider,
      now: NOW,
      limits: { delivery },
    });
    expect(run.ok, run.ok ? "" : run.message).toBe(true);
    if (!run.ok) return;
    const md = await (
      await JSZip.loadAsync(run.output)
    )
      .file("translation.md")!
      .async("string");
    expect(md).toContain("**Page 3 is not translated.**");
    expect(md).toContain("reserved enough of the daily allowance");
    expect(md).toContain(SEPARATE_DOCUMENT);
    expect(md).not.toMatch(OFFERS_PAGE_CHOICE);
  });

  it("rerunning only page 3, declared as the browser counts it, translates nothing", async () => {
    const delivery = deliveryCapFor(
      { declaredCharacters: BROWSER_PER_PAGE },
      AI_DELIVERY_LIMITS,
    );
    expect(delivery.characters).toBe(400);
    const ai = provider();
    const run = await runTranslate(
      INPUT,
      { ...OPTIONS, pages: [[3, 3]] },
      {
        extract: extractorOf(WORKER_SIZES),
        provider: ai.provider,
        now: NOW,
        limits: { delivery },
      },
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.message).toBe(
      nothingDeliverableMessage("characters", delivery, true),
    );
    expect(ai.calls()).toBe(0);
  });
});

describe("no per-job notice offers choosing pages", () => {
  const notices = (): { at: string; text: string }[] => [
    ...(["characters", "pages"] as const).flatMap((boundBy) =>
      [null, [[2, 2] as const]].flatMap((chosen) => [
        {
          at: `withheldPagesMarker ${boundBy} ${chosen ? "selection" : "whole"}`,
          text: withheldPagesMarker(
            [3, 4],
            boundBy,
            { characters: 9, pages: 2 },
            chosen as never,
          ),
        },
        {
          at: `nothingDeliverableMessage ${boundBy} ${chosen ? "selection" : "whole"}`,
          text: nothingDeliverableMessage(
            boundBy,
            { characters: 9, pages: 2 },
            chosen !== null,
          ),
        },
      ]),
    ),
    ...(["characters", "pages"] as const).map((boundBy) => ({
      at: `deliveryConsequence ${boundBy}`,
      text: deliveryConsequence({
        boundBy,
        deliveredPages: 2,
        withheldPages: 2,
      }),
    })),
  ];

  it("positive control: the shape catches the retired remedy", () => {
    expect(RETIRED_CHOOSE_PAGES).toMatch(OFFERS_PAGE_CHOICE);
  });

  it("health: ten notices, each non-empty", () => {
    const all = notices();
    expect(all).toHaveLength(10);
    for (const n of all) expect(n.text.length, n.at).toBeGreaterThan(40);
  });

  it("none of them carries a page-choice remedy", () => {
    expect(
      notices()
        .filter((n) => OFFERS_PAGE_CHOICE.test(n.text))
        .map((n) => n.at),
    ).toEqual([]);
  });

  it("the package and the panel give the same remedy for a characters bound", () => {
    const marker = withheldPagesMarker(
      [3],
      "characters",
      { characters: 9 },
      null,
    );
    const panel = deliveryConsequence({
      boundBy: "characters",
      deliveredPages: 2,
      withheldPages: 1,
    });
    expect(marker).toContain(SEPARATE_DOCUMENT);
    expect(panel).toMatch(/\bas a separate document\.$/);
  });
});
