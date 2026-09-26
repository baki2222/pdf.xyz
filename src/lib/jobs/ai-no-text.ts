/**
 * What an AI tool says about a PDF with no selectable text — said once, for
 * both sides of the upload.
 *
 * The worker's engines have always refused such a PDF honestly (`no_text`,
 * "run OCR PDF first"). But they refuse it AFTER the browser has uploaded the
 * whole file and the route has reserved a third of the connection's daily AI
 * allowance — a reservation a worker-side failure never gives back. Three
 * scanned PDFs sent to Summarize or Chat locked the connection out of AI for
 * the day with nothing to show for it (audit at 67e8d0f).
 *
 * So the browser now asks the same question first (`runSecurityJob`, via
 * `pdfHasSelectableText`), and gives the SAME answer: one string per tool,
 * imported by the engine that refuses on the worker and by the client that
 * refuses before upload, so the two can never tell a user different things.
 *
 * The key set is the catalog's AI-capability tools, exactly — pinned in both
 * directions by `src/lib/workers/ai-text-preflight.test.ts` ("is exactly the
 * catalog's AI tools, in both directions"). A key the catalog does not have is
 * decoration; an AI tool with no key would upload a scan and spend the
 * allowance on it. And it must NEVER contain OCR, whose whole input is a PDF
 * with no selectable text.
 */

export const NO_SELECTABLE_TEXT_MESSAGE = {
  "summarize-pdf":
    "This PDF has no selectable text to summarize. It may be a scan or image-only PDF — run OCR PDF first, then summarize the result.",
  "chat-with-pdf":
    "This PDF has no selectable text to answer from. It may be a scan or image-only PDF — run OCR PDF first, then chat with the result.",
  "ai-extract":
    "This PDF has no selectable text to extract from. It may be a scan or image-only PDF — run OCR PDF first, then extract from the result.",
  "translate-pdf":
    "This PDF has no selectable text to translate. It may be a scan or image-only PDF — run OCR PDF first, then translate the result.",
} as const;

/** A tool that reads only a PDF's selectable text. */
export type SelectableTextTool = keyof typeof NO_SELECTABLE_TEXT_MESSAGE;

/** True when `tool` reads only selectable text, so a text-less PDF is futile. */
export function readsOnlySelectableText(
  tool: string,
): tool is SelectableTextTool {
  return Object.prototype.hasOwnProperty.call(NO_SELECTABLE_TEXT_MESSAGE, tool);
}
