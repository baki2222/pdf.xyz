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
} from "@/lib/jobs/delivery-cap";
import { WITHHELD_UNDERCOUNT_SENTENCE } from "@/lib/jobs/translate-withheld-copy";
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
  const provider = recorder();
  const options: TranslateOptions = pages
    ? { ...BASE, pages: pages.map(([a, b]) => [a, b] as const) }
    : BASE;
  const result = await runTranslate(new Uint8Array([1, 2, 3]), options, {
    extract: async () => worker,
    provider,
    now: NOW,
    limits: { delivery: reservation.delivery! },
  });
  return { result, provider, declared, reservation };
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
  });

  it("page 3 CHOSEN from the same document is refused the same way", async () => {
    const { result, provider } = await job(browser, worker, [[3, 3]]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("over_reservation");
    expect(provider.calls).toHaveLength(0);
  });

  it("so the package says what happened and offers no separate-document step", async () => {
    const { result } = await job(browser, worker);
    if (!result.ok) throw new Error(result.message);
    const md = await translationMd(result.output);
    expect(md).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
    expect(md).not.toMatch(/separate document/i);
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
