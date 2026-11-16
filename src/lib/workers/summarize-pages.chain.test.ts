// @vitest-environment node
// @native-canvas
/**
 * The COMPOSED chain for Summarize's chosen pages (competitor audit
 * summarize-pdf#5): panel → route → worker → record → panel, each hop the
 * shipped function, over ONE real PDF.
 *
 *   1. the panel's `measureSummarizeRun` (real pdfjs, the legacy build Node
 *      runs) gives the spans and the declared characters;
 *   2. the route's `aiReservationFor`, with the read cap proven, charges
 *      `min(declared × 4 + optionCharacters + 2,000, 41,032)`;
 *   3. the worker's `runSummarize` over the SAME document reads exactly the
 *      chosen pages' text — the characters it sends equal
 *      `selectExtraction(...)`'s trimmed length, within the delivery bound;
 *   4. `sanitizeJobResults` (what every queue runs before the browser sees
 *      a record) keeps `pagesSent`;
 *   5. the panel's echo check `selectionConfirmed` is true.
 *
 * Each unit has its own tests. This exists because two boundaries can each
 * pass and the path through them still drop everything (CLAUDE.md, "verify
 * the composed chain"): mutation m4 (the pagesSent clause removed from
 * `buildAiResultMeta`) leaves every unit green and turns hop 4 red here.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { AI_JOB_DELIVERY_LIMITS } from "@/lib/jobs/ai-allowance";
import {
  AI_PER_CALL_INSTRUCTION_CHARACTERS,
  aiReservationFor,
  optionCharacters,
} from "@/lib/jobs/delivery-cap";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { selectionConfirmed } from "@/lib/jobs/selection-echo";
import { parseSummarizeOptions } from "@/lib/jobs/summarize-pdf";
import { selectExtraction } from "@/lib/pdf/page-selection";
import { extractPdfText } from "@/lib/pdf/text";
import { extractSelectionOnDemand } from "@/lib/pdf/text-lazy";
import type { AiCompletionRequest, AiProvider } from "./ai/provider";
import { runSummarize } from "./summarize/engine";
import { measureSummarizeRun } from "./summarize-client";

/** pdf.js's legacy build, the one Node runs. */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

const LINES = [
  "CHAINALPHA opens the document on page one.",
  "",
  "CHAINGAMMA is page three, with a longer sentence than the others here.",
  "CHAINDELTA is page four.",
  "CHAINEPSILON closes it on page five.",
];

async function pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of LINES) {
    const page = doc.addPage([400, 200]);
    if (line) page.drawText(line, { x: 20, y: 100, size: 10, font });
  }
  return doc.save();
}

function recorder(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "chain-model",
    calls,
    async complete(request) {
      calls.push(request);
      return {
        ok: true,
        text: "A summary.",
        model: "chain-model",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

describe("Summarize chosen pages: the composed chain", () => {
  it("panel → route → worker → record → panel agree on [[3,4]]", async () => {
    const bytes = await pdf();

    // 1. The panel.
    const measured = await measureSummarizeRun(
      bytes,
      { kind: "pages", text: "3-4" },
      (b) => extractSelectionOnDemand(b, legacy),
    );
    if (!measured.ok) throw new Error(measured.message);
    expect(measured.pages).toEqual([[3, 4]]);
    const declared = measured.declaredCharacters!;
    expect(declared).toBeGreaterThan(0);

    // 2. The route's charge, read cap proven.
    const options = {
      length: "brief",
      format: "paragraphs",
      pages: measured.pages,
    };
    const contract = parseSummarizeOptions(options);
    expect(contract.ok, "the contract refused the panel's body").toBe(true);
    const reservation = await aiReservationFor(
      "summarize-pdf",
      { declaredCharacters: declared, options },
      { ...AI_JOB_DELIVERY_LIMITS, readCapEnforced: async () => true },
    );
    const fallback = Math.ceil(
      AI_JOB_DELIVERY_LIMITS.fallbackCharacters *
        AI_JOB_DELIVERY_LIMITS.headroom,
    );
    expect(reservation.charge).toBe(
      Math.min(
        Math.ceil(declared * AI_JOB_DELIVERY_LIMITS.headroom) +
          optionCharacters(options) +
          AI_PER_CALL_INSTRUCTION_CHARACTERS,
        fallback,
      ),
    );
    // Health: below the clamp, so the declaration is what priced it.
    expect(reservation.charge).toBeLessThan(fallback);

    // 3. The worker, over the same document (the browser's extractor stands
    // in for pdftotext; the two agree on pages, and the worker's own
    // extractor is proved in the image by `provesSummarizePages`).
    const extracted = await extractPdfText(bytes, legacy);
    const provider = recorder();
    if (!contract.ok) throw new Error("unreachable");
    const run = await runSummarize(bytes, contract.value, {
      extract: async () => extracted,
      provider,
    });
    if (!run.ok) throw new Error(run.message);
    const chosen = selectExtraction(extracted, [[3, 4]]).text.trim();
    const window = run.meta.window;
    expect(window.charactersSent).toBe(chosen.length);
    expect(window.charactersSent).toBeLessThanOrEqual(
      reservation.delivery!.characters,
    );
    const seen = provider.calls
      .flatMap((c) => c.messages.map((m) => m.content))
      .join("\n");
    expect(seen).toContain("CHAINGAMMA");
    expect(seen).toContain("CHAINDELTA");
    expect(seen).not.toContain("CHAINALPHA");
    expect(seen).not.toContain("CHAINEPSILON");

    // 4. The record the browser receives.
    const record = sanitizeJobResults({ ai: { truncation: window } });
    expect(record?.ai?.truncation.pagesSent).toEqual([[3, 4]]);

    // 5. The panel's echo check.
    expect(selectionConfirmed(measured.pages!, record?.ai?.truncation)).toBe(
      true,
    );
  });
});
