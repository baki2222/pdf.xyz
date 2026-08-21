/**
 * Does THIS worker image actually do the things the product says it does?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The web tier auto-deploys from `main`. The worker image does not — it is
 * built and swapped by hand. On 2026-08-21 that gap was measured: the running
 * image had been built on 2026-08-12, so the chunked-translate engine (#119),
 * the delivery cap (#120) and everything after had been merged, reviewed,
 * verified on the web surface, and **never executed**. `planTranslateChunks`
 * returned 0 hits inside the container.
 *
 * Meanwhile the FAQ said, in production, *"A longer document is NOT refused: it
 * is split at page boundaries and translated a few pages at a time."* A real
 * 12-page job came back with the pre-#119 refusal. **The product claimed a
 * capability the running worker did not have, for nine days, and every check
 * either side of the gap was green** — because both halves were verified and
 * nothing tied them together.
 *
 * ── WHY IT PROVES RATHER THAN DECLARES ──────────────────────────────────────
 *
 * A boolean somebody writes is worth nothing here: it would have said `true`
 * throughout those nine days, because it would have been written in `main`, and
 * `main` was never what was wrong. This project has paid for that distinction
 * already — a tool reporting `ready: true` is reporting its WIRING.
 *
 * ── AND IT PROBES AT THE SEAM THE ENGINE USES, NOT THE ONE BELOW IT ─────────
 *
 * The first version called `planTranslateChunks` directly. That is the same
 * trap one level in: it proves the planner is *present*, and a worker whose
 * engine no longer reaches the planner would have passed. So both probes run
 * the real `runTranslate` — the function the executor calls — with a stub
 * extractor and a stub provider, and read the outcome off the engine's own
 * accounting.
 *
 * `usage.calls` is the evidence, and it is the right evidence because chunking
 * IS "more than one provider call for one document". A stub that returned one
 * chunk, or an engine that stopped consulting the plan, cannot fake it.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * A start-up probe must not make a network call, so the provider is a stub.
 * The honest maximum is therefore: **this image's engine splits a multi-page
 * document into several calls and honours a delivery cap.** It does NOT prove a
 * real provider call succeeds, that credentials are valid, or that a live job
 * will complete — those need a real job, which is what the proof harness is
 * for. The capability's name must not promise more than that, which is why it
 * is `chunkedTranslate` (a property of this engine) and not `translateWorks`.
 *
 * An image that predates the feature does not contain this module at all, so it
 * publishes no such field and the reader parses the absence as `false`. **The
 * old image does not have to cooperate, which is the only design that could
 * work: it was built before anyone thought to ask.**
 */

import { runTranslate } from "./engine";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";

/**
 * A synthetic document that CANNOT fit in one provider call.
 *
 * Six pages of 4,000 characters against the ~10,258 per-pass ceiling: two pages
 * share a call, three calls are needed, and no single page is oversize.
 * Deliberately not one enormous page — that exercises the oversize path instead
 * of the splitting path, and splitting is what the FAQ promises.
 */
const PROOF_PAGES = 6;
const PROOF_PAGE_CHARS = 4_000;

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};

function proofExtraction(): ExtractedPdfText {
  const pages = Array.from({ length: PROOF_PAGES }, (_, index) => ({
    pageNumber: index + 1,
    text: "x".repeat(PROOF_PAGE_CHARS),
    characterCount: PROOF_PAGE_CHARS,
  }));
  const text = pages.map((page) => page.text).join("\n\n");
  return {
    pageCount: PROOF_PAGES,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

/** A provider that answers instantly and reports usage, so `calls` is countable. */
function stubProvider(): AiProvider {
  return {
    id: "anthropic",
    model: "capability-probe",
    async complete(): Promise<AiCompletionResult> {
      return {
        ok: true,
        text: "probe",
        model: "capability-probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** How many provider calls this engine made for the proof document. */
async function callsFor(delivery?: {
  characters: number;
  pages?: number;
}): Promise<number | null> {
  const extracted = proofExtraction();
  const run = await runTranslate(new Uint8Array([1, 2, 3, 4]), OPTIONS, {
    extract: async () => extracted,
    provider: stubProvider(),
    now: () => "1970-01-01T00:00:00.000Z",
    ...(delivery ? { limits: { delivery } } : {}),
  });
  return run.ok ? (run.meta.usage?.calls ?? null) : null;
}

/**
 * Does this image's translate engine split a document too long for one call
 * into several?
 *
 * More than one provider call for one document is chunking, definitionally, and
 * it is measured through `runTranslate` rather than through the planner — a
 * worker whose engine had stopped consulting the plan would pass a planner
 * probe and fail here, which is the whole point.
 */
export async function provesChunkedTranslate(): Promise<boolean> {
  try {
    const calls = await callsFor();
    return calls !== null && calls > 1;
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}

/**
 * Does this image enforce a per-job delivery bound?
 *
 * Measured as a REDUCTION in provider calls under a page cap, against the same
 * document uncapped. A cap that withheld pages without reducing the work would
 * be enforcing the artifact and not the spend, and the spend is the half that
 * matters — so the evidence is the calls the engine did not make.
 */
export async function provesDeliveryCap(): Promise<boolean> {
  try {
    const uncapped = await callsFor();
    if (uncapped === null || uncapped <= 1) return false;
    const capped = await callsFor({
      characters: Number.POSITIVE_INFINITY,
      pages: 2,
    });
    return capped !== null && capped < uncapped;
  } catch {
    return false;
  }
}
