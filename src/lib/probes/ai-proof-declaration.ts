/**
 * What the BROWSER declares with an AI job for a given PDF — so the deployment
 * proof (`scripts/worker-prove-tools.ts`) declares exactly that, for the same
 * file, through the same functions the panels call.
 *
 * ── WHY (2026-10-09) ────────────────────────────────────────────────────────
 *
 * The harness sent every AI job with no `declaredCharacters` and no
 * `declaredTextPages`. The route's answer to an undeclared job is correct and
 * SILENT: it reserves the fallback, a whole run's worth of the daily AI
 * allowance, whatever the document holds (`aiReservationFor`). Every AI panel
 * counts the document before it uploads, so a user's run of the same file is
 * charged what it holds; the proof's run of a one-page fixture was charged the
 * maximum, five times, and one run of the AI proofs spent the day. On
 * 2026-10-09 the chat proofs were refused as UNPROVEN for exactly that reason.
 * It is the 415 of 2026-09-27 again in a new field: a proof that builds its
 * own request proves the request it built, not the one users send.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 *
 * Per tool, the counter that tool's panel calls, called the way it calls it:
 *
 *  - summarize-pdf, ai-extract — `countDeclaredCharacters(bytes)`;
 *  - chat-with-pdf — `measureChatDocument(bytes, extract)`: the DOCUMENT's
 *    characters only (the route measures the question and the carried turns
 *    off the options and charges them itself), the same for every turn;
 *  - translate-pdf — the extraction's `characterCount`, and the text pages of
 *    `translatePreflight(extracted, TRANSLATE_MAX_INPUT_CHARS)` — pages WITH
 *    TEXT, not the page count. A preflight refusal is what the panel shows
 *    instead of sending anything.
 *
 * This is a second statement of four call sites, and a copy goes stale. So
 * `ai-proof-declaration.test.tsx` drops every AI proof's fixture into the
 * REAL panel for its tool, reads the `POST /api/jobs` body that panel puts on
 * the wire, and holds it equal to what this returns: a panel that changes how
 * it counts turns that test red instead of leaving the proof declaring
 * something no user sends.
 */
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import { countDeclaredCharacters } from "@/lib/workers/ai-declared-characters";
import { measureChatDocument } from "@/lib/workers/chat-with-pdf-client";
import { translatePreflight } from "@/lib/workers/translate/preflight";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";

/** The declaration fields of a `POST /api/jobs` body, as a panel sends them. */
export interface AiJobDeclaration {
  declaredCharacters?: number;
  declaredTextPages?: number;
}

export type BrowserDeclaration =
  /** The panel would send the job with this declaration. */
  | { kind: "declared"; declaration: AiJobDeclaration }
  /** The panel could not count the file and would send it UNDECLARED. */
  | { kind: "undeclared"; reason: string }
  /** The panel would refuse the file before anything is uploaded. */
  | { kind: "refused"; reason: string };

type Extract = (bytes: Uint8Array) => Promise<ExtractedPdfText>;

const characters = (count: number | null): BrowserDeclaration =>
  count === null
    ? {
        kind: "undeclared",
        reason: "the browser could not count its selectable text",
      }
    : { kind: "declared", declaration: { declaredCharacters: count } };

/** Each AI tool's panel counter, keyed by tool slug. */
const COUNTERS: Readonly<
  Record<
    string,
    (bytes: Uint8Array, extract: Extract) => Promise<BrowserDeclaration>
  >
> = {
  // summarize-worker-panel.tsx: `declaredCharacters: await countDeclaredCharacters(bytes)`
  "summarize-pdf": async (bytes, extract) =>
    characters(await countDeclaredCharacters(bytes, extract)),
  // ai-extract-worker-panel.tsx: `const declaredCharacters = await countDeclaredCharacters(bytes)`
  "ai-extract": async (bytes, extract) =>
    characters(await countDeclaredCharacters(bytes, extract)),
  // chat-with-pdf-worker-panel.tsx: `documentCharacters: measured.kind === "counted" ? measured.count.characters : null`
  "chat-with-pdf": async (bytes, extract) => {
    const measured = await measureChatDocument(bytes, extract);
    if (measured.kind === "no-text")
      return {
        kind: "refused",
        reason: "the browser found no selectable text to ask about",
      };
    return characters(
      measured.kind === "counted" ? measured.count.characters : null,
    );
  },
  // translate-worker-panel.tsx: `declaredCharacters: extracted.characterCount`,
  // `declaredTextPages: textPages.length` from `translatePreflight(...)`.
  "translate-pdf": async (bytes, extract) => {
    let extracted: ExtractedPdfText;
    try {
      extracted = await extract(bytes);
    } catch (error) {
      return {
        kind: "refused",
        reason: `the browser could not read it: ${(error as Error).message}`,
      };
    }
    const { textPages, refusal } = translatePreflight(
      extracted,
      TRANSLATE_MAX_INPUT_CHARS,
    );
    if (refusal !== null) return { kind: "refused", reason: refusal };
    return {
      kind: "declared",
      declaration: {
        declaredCharacters: extracted.characterCount,
        declaredTextPages: textPages.length,
      },
    };
  },
};

/** The AI tools this module can declare for — every one the catalogue has. */
export const DECLARING_AI_TOOLS: readonly string[] = Object.keys(COUNTERS);

/**
 * What the panel for `tool` declares with its job for `bytes`. Throws for a
 * tool with no known panel counter: a guess here would be a declaration no
 * user sends, which is the defect this module exists to remove.
 */
export async function browserAiDeclaration(
  tool: string,
  bytes: Uint8Array,
  extract: Extract = (b) => extractPdfText(b),
): Promise<BrowserDeclaration> {
  const counter = Object.hasOwn(COUNTERS, tool) ? COUNTERS[tool] : undefined;
  if (!counter)
    throw new Error(
      `no browser declaration is known for "${tool}" — add its panel's counter to ai-proof-declaration.ts`,
    );
  return counter(bytes, extract);
}
