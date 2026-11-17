// @vitest-environment node
/**
 * THE PROPERTY: a withheld-pages notice offers no step that cannot work.
 *
 * Until 2026-11-17 a characters-bound withhold ended, in the package and on
 * the panel, "Translate the remaining pages as a separate document." This
 * runs that advice through the composed chain the reader would take, and it
 * fails: the browser declares what IT counted (`declareTranslateRun`, the
 * panel's own author), the route prices that declaration
 * (`aiReservationGiven`, under the route's own limits), and the engine walks
 * what the WORKER read. When the worker reads more than
 * `TRANSLATE_EXTRACTOR_HEADROOM` times the browser's count, a rerun of the
 * withheld pages is declared the same way and is short in the same
 * proportion. Both reruns a reader has (the page as its own document, and
 * the page chosen from the same document) end in the nothing-deliverable
 * refusal, with no model call.
 *
 * The page bound is held as a CONTROL: its advice does work, because a page
 * count is exact, and its arms are unchanged.
 *
 * So is a job that DECLARED NOTHING (review, 2026-11-17): a direct API
 * caller, or a panel scan sent for OCR. Its reservation is the flat fallback,
 * nothing was counted, and the remaining pages sent as another document get a
 * fresh fallback and ARE translated. The first version of this file covered
 * declared jobs only and gave that job "more text than was counted", which is
 * false of it. It now keeps the separate-document remedy, on both surfaces.
 *
 * The cap crosses the queue as JSON and is re-read by `readDeliveryCap`, and
 * the panel reads the meta after `buildAiResultMeta`: the two boundaries that
 * rebuild these objects field by field, so a flag either one drops is lost
 * here too.
 *
 * The last block pins the two surfaces to ONE sentence: the package's marker
 * and the panel's notice, for the same job record.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { joinPageTexts } from "@/lib/pdf/text";
import { selectExtraction } from "@/lib/pdf/page-selection";
import type { PageSpan } from "@/lib/pdf/page-spans";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  translateMaxInputChars,
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
} from "@/lib/jobs/translate-limits";
import {
  AI_DELIVERY_LIMITS,
  aiReservationGiven,
  readDeliveryCap,
  type JobDeliveryCap,
} from "@/lib/jobs/delivery-cap";
import { buildAiResultMeta, type AiDeliveryMeta } from "@/lib/jobs/ai-results";
import {
  NOTHING_UNDERCOUNT_SENTENCE,
  WITHHELD_UNDERCOUNT_SENTENCE,
} from "@/lib/jobs/translate-withheld-copy";
import { deliveryConsequence } from "@/components/tools/delivery-notice";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import { runTranslate } from "./engine";
import { declareTranslateRun } from "./preflight";
import { withheldPagesMarker } from "./chunking";
import type { ReadingOrderPage, TranslateExtracted } from "./reading-order";

const BROWSER_PER_PAGE = 100;
const WORKER_PER_PAGE = 500;
const BASE: TranslateOptions = { targetLanguage: "fr", sourceLanguage: "auto" };
const NOW = () => "2026-11-17T00:00:00.000Z";
const CEILING = translateMaxInputChars(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS);

/** `pageCount` pages of `perPage` characters each, numbered from 1. */
function documentOf(pageCount: number, perPage: number): TranslateExtracted {
  const pages: ReadingOrderPage[] = Array.from(
    { length: pageCount },
    (_, i) => {
      const n = i + 1;
      const text = `Page${n} `.padEnd(perPage, "w");
      return { pageNumber: n, text, characterCount: text.length };
    },
  );
  const text = joinPageTexts(pages);
  return {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

function recorder(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "test-model",
    calls,
    async complete(request): Promise<AiCompletionResult> {
      calls.push(request);
      return {
        ok: true,
        text: "traduit",
        model: "test-model",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
  };
}

/**
 * One job through the composed chain: the browser's declaration of `browser`
 * (optionally a selection), priced by the route, run by the engine on what
 * the worker read (`worker`).
 */
async function job(
  browser: TranslateExtracted,
  worker: TranslateExtracted,
  pages: PageSpan[] | null = null,
) {
  const judged = pages
    ? { pages, selected: selectExtraction(browser, pages) }
    : null;
  const { declared } = declareTranslateRun(browser, judged, CEILING);
  const reservation = aiReservationGiven(
    "translate-pdf",
    declared,
    AI_DELIVERY_LIMITS,
    false,
  );
  const run = await runUnder(worker, reservation.delivery!, pages);
  return { ...run, declared, reservation };
}

/** The engine under `delivery`, after the queue's JSON and its re-read. */
async function runUnder(
  worker: TranslateExtracted,
  delivery: JobDeliveryCap,
  pages: PageSpan[] | null = null,
) {
  const read = readDeliveryCap(JSON.parse(JSON.stringify(delivery)));
  if (!read.ok || !read.cap)
    throw new Error("the cap did not survive the queue");
  const provider = recorder();
  const options: TranslateOptions = pages
    ? { ...BASE, pages: pages.map(([a, b]) => [a, b] as const) }
    : BASE;
  const result = await runTranslate(new Uint8Array([1, 2, 3]), options, {
    extract: async () => worker,
    provider,
    now: NOW,
    limits: { delivery: read.cap },
  });
  return { result, provider };
}

/** The delivery block as the panel reads it, after the persistence boundary. */
function persisted(delivery: AiDeliveryMeta | undefined): AiDeliveryMeta {
  const built = buildAiResultMeta({
    truncation: {
      truncated: false,
      charactersSent: 1,
      charactersTotal: 1,
      totalPages: 1,
      lastCompletePage: 1,
      cutMidPage: false,
    },
    ...(delivery ? { delivery: JSON.parse(JSON.stringify(delivery)) } : {}),
  });
  if (!built.delivery) throw new Error("the delivery block was dropped");
  return built.delivery;
}

async function translationMd(output: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(output);
  return zip.file("translation.md")!.async("string");
}

describe("health: the fixture is the situation it claims to be", () => {
  it("the worker reads more than the headroom times the browser's count", () => {
    expect(WORKER_PER_PAGE).toBeGreaterThan(
      BROWSER_PER_PAGE * TRANSLATE_EXTRACTOR_HEADROOM,
    );
    // And every page fits one pass, so nothing is withheld for size.
    expect(WORKER_PER_PAGE).toBeLessThan(CEILING);
  });
});

describe("a characters-bound withhold: the old remedy, run", () => {
  const browser = documentOf(3, BROWSER_PER_PAGE);
  const worker = documentOf(3, WORKER_PER_PAGE);

  it("the first run withholds page 3, bound by characters", async () => {
    const { result, provider } = await job(browser, worker);
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;
    expect(result.meta.delivery).toEqual({
      deliveredPages: 2,
      withheldPages: 1,
      boundBy: "characters",
      // The engine's positive flag for a declared job (review, 2026-11-17):
      // a result without it, as every older worker writes, keeps the old
      // remedy in the panel.
      counted: true,
    });
    expect(provider.calls.length).toBeGreaterThan(0);
  });

  it("page 3 as a SEPARATE DOCUMENT is refused before any model call", async () => {
    const { result, provider } = await job(
      documentOf(1, BROWSER_PER_PAGE),
      documentOf(1, WORKER_PER_PAGE),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("over_reservation");
    expect(provider.calls).toHaveLength(0);
    // The refusal the reader gets offers no rerun either: it shipped as
    // "Submit the document again with its real length, or split it into
    // smaller files.", and this rerun IS a smaller file.
    expect(result.message).toContain(NOTHING_UNDERCOUNT_SENTENCE);
    expect(result.message).not.toMatch(/split|smaller file|again/i);
  });

  it("page 3 CHOSEN from the same document is refused the same way", async () => {
    const { result, provider } = await job(browser, worker, [[3, 3]]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("over_reservation");
    expect(provider.calls).toHaveLength(0);
    expect(result.message).toContain("the first page you chose");
    expect(result.message).toContain(NOTHING_UNDERCOUNT_SENTENCE);
    expect(result.message).not.toMatch(/split|smaller file|again/i);
  });

  it("so the package says what happened and offers no separate-document step", async () => {
    const { result } = await job(browser, worker);
    if (!result.ok) throw new Error(result.message);
    const md = await translationMd(result.output);
    expect(md).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
    expect(md).not.toMatch(/separate document/i);
    const panel = deliveryConsequence(persisted(result.meta.delivery));
    expect(panel).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
    expect(panel).not.toMatch(/separate document/i);
  });
});

describe("CONTROL: a job that declared NOTHING keeps the separate-document remedy, which works", () => {
  // A direct API caller, or a panel scan sent for OCR: no count, so the
  // reservation is the flat fallback (10,258 x 4 = 41,032 characters).
  const undeclared = () =>
    aiReservationGiven("translate-pdf", {}, AI_DELIVERY_LIMITS, false)
      .delivery!;
  const PER_PAGE = 5_000;

  it("health: the reservation is the fallback, flagged, and the fixture overruns it", () => {
    const cap = undeclared();
    expect(cap).toEqual({
      characters: Math.ceil(
        AI_DELIVERY_LIMITS.fallbackCharacters * AI_DELIVERY_LIMITS.headroom,
      ),
      undeclared: true,
    });
    expect(PER_PAGE).toBeLessThan(CEILING);
    expect(20 * PER_PAGE).toBeGreaterThan(cap.characters);
  });

  it("says nothing was counted wrongly, offers the rerun, and the rerun translates more", async () => {
    const first = await runUnder(documentOf(20, PER_PAGE), undeclared());
    if (!first.result.ok) throw new Error(first.result.message);
    const delivery = first.result.meta.delivery;
    expect(delivery).toEqual({
      deliveredPages: 8,
      withheldPages: 12,
      boundBy: "characters",
    });

    const md = await translationMd(first.result.output);
    expect(md).toContain(
      "Translate the remaining pages as a separate document.",
    );
    expect(md).not.toContain(WITHHELD_UNDERCOUNT_SENTENCE);
    const panel = deliveryConsequence(persisted(delivery));
    expect(panel).toContain("Translate them as a separate document.");
    expect(panel).not.toContain(WITHHELD_UNDERCOUNT_SENTENCE);

    // The advice, run: the 12 remaining pages as their own document.
    const rerun = await runUnder(documentOf(12, PER_PAGE), undeclared());
    expect(rerun.result.ok, rerun.result.ok ? "" : rerun.result.message).toBe(
      true,
    );
    if (!rerun.result.ok) return;
    expect(rerun.result.meta.delivery?.deliveredPages).toBe(8);
    expect(rerun.provider.calls.length).toBeGreaterThan(0);
  });
});

describe("CONTROL: a pages-bound withhold keeps its remedy, which works", () => {
  it("the page count declared again correctly translates the rest", async () => {
    // A caller that declared 2 text pages of a 3-page document: the third is
    // withheld by the page bound.
    const doc = documentOf(3, BROWSER_PER_PAGE);
    const provider = recorder();
    const short = await runTranslate(new Uint8Array([1]), BASE, {
      extract: async () => doc,
      provider,
      now: NOW,
      limits: {
        delivery: { characters: Number.POSITIVE_INFINITY, pages: 2 },
      },
    });
    if (!short.ok) throw new Error(short.message);
    expect(short.meta.delivery?.boundBy).toBe("pages");
    const md = await translationMd(short.output);
    expect(md).toContain(
      "Translate the remaining pages as a separate document.",
    );
    expect(md).not.toContain(WITHHELD_UNDERCOUNT_SENTENCE);

    // The remaining page as its own document, declared by the browser.
    const rerun = await job(
      documentOf(1, BROWSER_PER_PAGE),
      documentOf(1, BROWSER_PER_PAGE),
    );
    expect(rerun.result.ok, rerun.result.ok ? "" : rerun.result.message).toBe(
      true,
    );
    if (!rerun.result.ok) return;
    expect(rerun.result.meta.delivery).toBeUndefined();
  });
});

describe("the package and the panel say ONE sentence for the characters bound", () => {
  it("both surfaces carry the shared sentence, whole document and selection", () => {
    const panel = deliveryConsequence({
      deliveredPages: 2,
      withheldPages: 1,
      boundBy: "characters",
      counted: true,
    });
    const whole = withheldPagesMarker(
      [3],
      "characters",
      { characters: 1 },
      null,
    );
    const chosen = withheldPagesMarker([3], "characters", { characters: 1 }, [
      [2, 3],
    ]);
    for (const text of [panel, whole, chosen]) {
      expect(text).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
      expect(text).not.toMatch(/separate document/i);
    }
  });

  it("CONTROL: the page bound's arms are unchanged on both surfaces", () => {
    expect(
      deliveryConsequence({
        deliveredPages: 2,
        withheldPages: 1,
        boundBy: "pages",
      }),
    ).toContain("Upload it again to translate the rest.");
    expect(
      withheldPagesMarker([3], "pages", { characters: 1, pages: 2 }, null),
    ).toContain("Translate the remaining pages as a separate document.");
  });
});
