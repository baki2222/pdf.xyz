// @vitest-environment node
/**
 * A document larger than one provider call must deliver the pages that FIT,
 * and name the ones it could not.
 *
 * Today it delivers nothing. `runTranslate` compares the whole extracted text
 * against `translateMaxInputChars(maxOutputTokens)` — a single-call ceiling of
 * 10,258 characters — and returns `too_much_text` for the entire job. A
 * twelve-page document whose pages are 1,000 characters each is refused in
 * full, even though eleven of them would fit in one call and all twelve fit in
 * two. The user pays a daily AI run and receives nothing.
 *
 * THE CEILING IS REAL AND IS NOT THE DEFECT. It is the OUTPUT budget: translate
 * writes as much as it reads, so one call cannot exceed it (measured — a
 * 135,280-character document was billed and rejected after 49 seconds before
 * that check existed). The defect is that the ceiling is applied to the JOB
 * when it is a property of a CALL.
 *
 * ── WHAT THESE PIN, AND WHY EACH IS SEPARATE ─────────────────────────────────
 *
 * The conservation property is first because it is the one whose violation is
 * silent: a chunker that drops a page produces a shorter translation that reads
 * perfectly. Every other failure here is visible in the output; that one is not.
 */
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import { runTranslate, type PdfTextExtractor } from "./engine";
import {
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  translateMaxInputChars,
} from "@/lib/jobs/translate-limits";

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};
const INPUT = new Uint8Array([1, 2, 3, 4]);

/** The single-call ceiling the engine already enforces. */
const CALL_CEILING = translateMaxInputChars(
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
);

/**
 * A document of `pageCount` pages, each `charsPerPage` characters of distinct,
 * checkable text — so a dropped or reordered page is visible in the output
 * rather than blending in.
 */
function documentOf(pageCount: number, charsPerPage: number): ExtractedPdfText {
  const pages: ExtractedTextPage[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    const marker = `PAGE${String(n).padStart(3, "0")}`;
    const body = `${marker} `.repeat(
      Math.max(1, Math.ceil(charsPerPage / (marker.length + 1))),
    );
    const text = body.slice(0, charsPerPage);
    pages.push({ pageNumber: n, text, characterCount: text.length });
  }
  const text = pages.map((p) => p.text).join("\n\n");
  return {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

function extractorOf(doc: ExtractedPdfText): PdfTextExtractor {
  return vi.fn(async () => doc);
}

/**
 * A provider that echoes each request back as its "translation", tagged with
 * the call index — so the assembled output shows exactly which calls happened
 * and in what order.
 */
function echoProvider(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request): Promise<AiCompletionResult> {
      calls.push(request);
      const body = request.messages.map((m) => m.content).join("\n");
      const markers = [...body.matchAll(/PAGE\d{3}/g)].map((m) => m[0]);
      return {
        ok: true,
        text: `CALL${calls.length}:${[...new Set(markers)].join(",")}`,
        model: "claude-sonnet-5",
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    },
  };
}

/** The pages named in the assembled translation text, in the order they appear. */
async function deliveredPages(output: Uint8Array): Promise<number[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(output);
  const names = Object.keys(zip.files);
  const textName = names.find((n) => n.endsWith(".txt") || n.endsWith(".md"));
  if (!textName) throw new Error(`no text member in package: ${names.join()}`);
  const body = await zip.file(textName)!.async("string");
  return [...body.matchAll(/PAGE(\d{3})/g)].map((m) => Number(m[1]));
}

describe("a document larger than one call is chunked at page boundaries", () => {
  it("CONSERVATION: every page is delivered exactly once, in order", async () => {
    // The silent failure. A chunker that drops or duplicates a page produces
    // output that reads perfectly and is wrong, so this is asserted before
    // anything about formatting, notices or cost.
    const pagesTotal = 12;
    const perPage = Math.floor(CALL_CEILING / 5); // ~2 pages per call
    const doc = documentOf(pagesTotal, perPage);
    expect(
      doc.text.length,
      "precondition: the document must exceed ONE call's ceiling",
    ).toBeGreaterThan(CALL_CEILING);
    expect(
      perPage,
      "precondition: every individual page must fit in one call",
    ).toBeLessThan(CALL_CEILING);

    const provider = echoProvider();
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorOf(doc),
      provider,
    });

    expect(
      run.ok,
      run.ok ? "" : `the whole job was refused: ${run.kind} — ${run.message}`,
    ).toBe(true);
    if (!run.ok) return;

    const delivered = await deliveredPages(run.output);
    expect(
      delivered,
      "pages were dropped, duplicated or reordered — a translation that reads " +
        "fine and is missing page 7 is the failure nobody can see",
    ).toEqual(Array.from({ length: pagesTotal }, (_, i) => i + 1));
  });

  it("splits ONLY at page boundaries — no call carries half a page", async () => {
    const doc = documentOf(12, Math.floor(CALL_CEILING / 5));
    const provider = echoProvider();
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorOf(doc),
      provider,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    expect(
      provider.calls.length,
      "the document exceeded one ceiling, so it must have taken more than one call",
    ).toBeGreaterThan(1);

    // Every page marker that appears in a call must appear the SAME number of
    // times as it does in that call's slice of the source: a page cut in half
    // shows up in two calls.
    const seen = new Map<string, number>();
    for (const call of provider.calls) {
      const body = call.messages.map((m) => m.content).join("\n");
      for (const marker of new Set(
        [...body.matchAll(/PAGE\d{3}/g)].map((m) => m[0]),
      )) {
        seen.set(marker, (seen.get(marker) ?? 0) + 1);
      }
    }
    const split = [...seen.entries()].filter(([, n]) => n > 1);
    expect(
      split.map(([m]) => m),
      "these pages appear in more than one call, so a page was cut in half — " +
        "half a page of context produces a translation of a fragment",
    ).toEqual([]);
  });

  it("keeps every call under the single-call ceiling", async () => {
    const doc = documentOf(12, Math.floor(CALL_CEILING / 5));
    const provider = echoProvider();
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorOf(doc),
      provider,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    for (const [i, call] of provider.calls.entries()) {
      const sent = call.messages.map((m) => m.content).join("\n").length;
      expect(
        sent,
        `call ${i + 1} carries ${sent} characters, over the ${CALL_CEILING} ` +
          "ceiling — the call the ceiling exists to prevent",
      ).toBeLessThanOrEqual(CALL_CEILING);
    }
  });

  it("delivers 11 of 12 and NAMES the missing page when one page cannot fit", async () => {
    // The positioned gap. One page alone exceeds a single call, so it cannot be
    // translated at all — but the other eleven can, and refusing the job would
    // spend the user's allowance for nothing. What must never happen is a
    // package that silently omits it: the artifact has to carry what is MISSING
    // and where it was.
    const pages: ExtractedTextPage[] = [];
    for (let n = 1; n <= 12; n += 1) {
      const marker = `PAGE${String(n).padStart(3, "0")}`;
      const size = n === 7 ? CALL_CEILING + 5_000 : 500;
      const body = `${marker} `.repeat(Math.ceil(size / (marker.length + 1)));
      const text = body.slice(0, size);
      pages.push({ pageNumber: n, text, characterCount: text.length });
    }
    const text = pages.map((p) => p.text).join("\n\n");
    const doc: ExtractedPdfText = {
      pageCount: 12,
      pages,
      text,
      characterCount: text.length,
      hasText: true,
    };

    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorOf(doc),
      provider: echoProvider(),
    });
    expect(
      run.ok,
      run.ok
        ? ""
        : `refused entirely instead of delivering 11 pages: ${run.kind}`,
    ).toBe(true);
    if (!run.ok) return;

    const delivered = await deliveredPages(run.output);
    expect(
      delivered.includes(7),
      "page 7 alone exceeds one call, so it cannot have been translated",
    ).toBe(false);
    expect(
      delivered,
      "the eleven translatable pages must all be delivered, in order",
    ).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(run.output);
    const bodies = await Promise.all(
      Object.keys(zip.files).map((n) => zip.file(n)!.async("string")),
    );
    const all = bodies.join("\n");
    expect(
      /\b7\b/.test(all),
      "the package does not name page 7 anywhere — a translation missing a page " +
        "without saying so is a confident false claim about the document",
    ).toBe(true);
  });
});
