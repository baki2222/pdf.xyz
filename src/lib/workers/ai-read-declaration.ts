/**
 * What a READ-bound AI job declares before it uploads — Summarize, Chat with
 * PDF and AI Data Extraction.
 *
 * ── THE DEFECT THIS EXISTS FOR (2026-09-28) ─────────────────────────────────
 *
 * The free daily allowance is reserved in characters, against a count the
 * browser declares. Only Translate declared one. The other three AI tools sent
 * nothing, so `POST /api/jobs` reserved its undeclared fallback —
 * `TRANSLATE_MAX_INPUT_CHARS × headroom`, a THIRD of the day — for every job,
 * whatever the document held. Three one-page invoices (about 6,000 characters
 * together) spent the "30,774 free characters a day" and the fourth was
 * refused. In the other direction the worker never read the reservation at
 * all, so a 500,000-character document cost the same third and was read in
 * full. The published figure was false for three of the four AI tools in both
 * directions.
 *
 * ── WHAT IS DECLARED, AND WHY IT IS CLAMPED ─────────────────────────────────
 *
 * The browser-counted characters of selectable text, exactly as Translate
 * declares them (`extractPdfText(bytes).characterCount`) — the same unit the
 * allowance is published in, so the headroom cancels out the same way.
 *
 * CLAMPED to one whole day's allowance — `AI_READ_LIMIT_CHARACTERS`, the
 * per-run read limit every read-bound page publishes (`@/lib/jobs/ai-read-limit`).
 * A read-bound engine does not refuse a long document; it reads a prefix and
 * says which page it reached (see `ai/truncation.ts`). A declaration larger
 * than the whole bucket could never be admitted, so declaring it would turn
 * "read the first part and say so" into "refused, with nothing read". The
 * worker enforces what was reserved (`processor/read-cap.ts`), so the clamp is
 * also exactly how far it reads — which is why the published figure and this
 * clamp are one constant, and `ai-ceiling-surfaces.test.ts` measures both.
 *
 * ── WHEN NOTHING IS DECLARED ────────────────────────────────────────────────
 *
 * When pdfjs cannot open the file (encrypted, damaged) there is no count to
 * declare, and inventing one would be a claim about a document nobody read.
 * The job goes undeclared and the route reserves its fallback — what every
 * such job cost before this existed — and the worker gives its own verdict.
 */
import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";
import { AI_READ_LIMIT_CHARACTERS } from "@/lib/jobs/ai-read-limit";

/** The AI tools whose engine READS the document (and truncates), not writes it. */
export const READ_BOUND_AI_TOOLS = [
  "summarize-pdf",
  "chat-with-pdf",
  "ai-extract",
] as const;

export type ReadBoundAiTool = (typeof READ_BOUND_AI_TOOLS)[number];

export type AiReadDeclaration =
  | {
      ok: true;
      /**
       * Characters to declare with the job, or `undefined` when the browser
       * could not count. A REQUIRED key on every read-bound client's input, so
       * a panel cannot forget it — only say, explicitly, that it has no count.
       */
      declaredCharacters: number | undefined;
    }
  | { ok: false; message: string };

/**
 * Count what a read-bound AI job will use, before a byte is uploaded.
 *
 * pdfjs is imported on demand so a panel that never runs a job never
 * downloads it — the same reason `runSecurityJob`'s own pre-check does.
 */
export async function declareAiRead(
  tool: ReadBoundAiTool,
  bytes: Uint8Array,
): Promise<AiReadDeclaration> {
  let extracted: { hasText: boolean; characterCount: number };
  try {
    const { extractPdfText } = await import("@/lib/pdf/text");
    extracted = await extractPdfText(bytes);
  } catch {
    return { ok: true, declaredCharacters: undefined };
  }
  // Nothing to read is not a job: refuse with the worker's own words before
  // anything is uploaded or reserved (`@/lib/jobs/ai-no-text`).
  if (!extracted.hasText) {
    return { ok: false, message: NO_SELECTABLE_TEXT_MESSAGE[tool] };
  }
  return {
    ok: true,
    // The contract requires a positive whole number; a document with text has
    // at least one character, and the floor makes that unconditional.
    declaredCharacters: Math.max(
      1,
      Math.min(extracted.characterCount, AI_READ_LIMIT_CHARACTERS),
    ),
  };
}
