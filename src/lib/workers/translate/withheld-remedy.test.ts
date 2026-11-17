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
 * Then (fix/allowance-window-words, merged with main after #351): main's
 * sentence itself, "Translate the remaining pages as a separate document.",
 * is false for a DECLARED job on the characters bound by the same argument:
 * the browser declares the separate document's text the same way, so its
 * reservation is again too small. A declared job now gets
 * `WITHHELD_UNDERCOUNT_SENTENCE` in the package and the panel; an UNDECLARED
 * one (an API caller, an OCR scan) reserved a flat amount and keeps the
 * separate-document remedy. Test 1 below pinned main's sentence for a
 * declared job; it is inverted, and the last test pins both arms.
 *
 * What this file pins now:
 *  1. THE PROPERTY, through the composed chain (`deliveryCapFor` →
 *     `runTranslate`): the advised rerun of the withheld pages, declared the
 *     way the browser declared them, delivers nothing. This is why no
 *     page-choice remedy may come back without a different mechanism.
 *  2. No per-job notice (withheld marker, panel notice, nothing-deliverable
 *     refusal), in any arm, declared or undeclared, offers choosing pages;
 *     with a positive control on the retired sentence.
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import { AI_DELIVERY_LIMITS, deliveryCapFor } from "@/lib/jobs/delivery-cap";
import { deliveryConsequence } from "@/components/tools/delivery-notice";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { WITHHELD_UNDERCOUNT_SENTENCE } from "@/lib/jobs/translate-withheld-copy";
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
/**
 * Main's last sentence of the withheld notice; since the merge with
 * fix/allowance-window-words, only an UNDECLARED job's.
 */
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

  // INVERTED (merge with main after #351): this was "..., with main's
  // sentence" and asserted toContain(SEPARATE_DOCUMENT). The job is
  // DECLARED, so that advice fails the way the page-choice rerun below does.
  it("the first run withholds page 3 on the characters bound, and advises no rerun", async () => {
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
    expect(delivery.undeclared).toBeUndefined();
    expect(md).not.toContain(SEPARATE_DOCUMENT);
    expect(md).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
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
  // Declared and undeclared arms, since the merge with
  // fix/allowance-window-words: the undeclared flag picks the words.
  const ARMS = [
    { arm: "declared", limit: { characters: 9, pages: 2 } },
    {
      arm: "undeclared",
      limit: { characters: 9, pages: 2, undeclared: true as const },
    },
  ] as const;
  const notices = (): { at: string; text: string }[] =>
    ARMS.flatMap(({ arm, limit }) => [
      ...(["characters", "pages"] as const).flatMap((boundBy) =>
        [null, [[2, 2] as const]].flatMap((chosen) => [
          {
            at: `withheldPagesMarker ${arm} ${boundBy} ${chosen ? "selection" : "whole"}`,
            text: withheldPagesMarker([3, 4], boundBy, limit, chosen as never),
          },
          {
            at: `nothingDeliverableMessage ${arm} ${boundBy} ${chosen ? "selection" : "whole"}`,
            text: nothingDeliverableMessage(boundBy, limit, chosen !== null),
          },
        ]),
      ),
      ...(["characters", "pages"] as const).map((boundBy) => ({
        at: `deliveryConsequence ${arm} ${boundBy}`,
        text: deliveryConsequence({
          boundBy,
          deliveredPages: 2,
          withheldPages: 2,
          // The panel reads the result's POSITIVE flag (review, 2026-11-17).
          ...(arm === "declared" ? { counted: true as const } : {}),
        }),
      })),
    ]);

  it("positive control: the shape catches the retired remedy", () => {
    expect(RETIRED_CHOOSE_PAGES).toMatch(OFFERS_PAGE_CHOICE);
  });

  it("health: twenty notices (ten per arm), each non-empty, the arms differing", () => {
    const all = notices();
    expect(all).toHaveLength(20);
    // Health of the arm itself: the flag must change some words, or the
    // undeclared half is the declared half twice.
    const declared = all
      .filter((n) => n.at.includes(" declared "))
      .map((n) => n.text);
    const undeclared = all
      .filter((n) => n.at.includes(" undeclared "))
      .map((n) => n.text);
    expect(declared).toHaveLength(10);
    expect(undeclared).toHaveLength(10);
    expect(undeclared).not.toEqual(declared);
    for (const n of all) expect(n.text.length, n.at).toBeGreaterThan(40);
  });

  it("none of them carries a page-choice remedy", () => {
    expect(
      notices()
        .filter((n) => OFFERS_PAGE_CHOICE.test(n.text))
        .map((n) => n.at),
    ).toEqual([]);
  });

  // INVERTED (merge with main after #351): this pinned "as a separate
  // document" in both for every characters-bound job. Now only an
  // undeclared job is told that; a declared one gets the undercount sentence.
  it("the package and the panel give the same remedy for a characters bound, per arm", () => {
    const declaredMarker = withheldPagesMarker(
      [3],
      "characters",
      { characters: 9 },
      null,
    );
    const declaredPanel = deliveryConsequence({
      boundBy: "characters",
      deliveredPages: 2,
      withheldPages: 1,
      counted: true,
    });
    expect(declaredMarker).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
    expect(declaredPanel.endsWith(WITHHELD_UNDERCOUNT_SENTENCE)).toBe(true);
    expect(declaredMarker).not.toContain(SEPARATE_DOCUMENT);
    expect(declaredPanel).not.toMatch(/\bas a separate document\b/);

    const undeclaredMarker = withheldPagesMarker(
      [3],
      "characters",
      { characters: 9, undeclared: true },
      null,
    );
    const undeclaredPanel = deliveryConsequence({
      boundBy: "characters",
      deliveredPages: 2,
      withheldPages: 1,
    });
    expect(undeclaredMarker).toContain(SEPARATE_DOCUMENT);
    expect(undeclaredPanel).toMatch(/\bas a separate document\.$/);
  });
});
