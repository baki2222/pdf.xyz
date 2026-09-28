/**
 * What a job may DELIVER — decided by the server at submit time, carried to the
 * worker, and enforced where the work is produced.
 *
 * ── WHY A CAP EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * The free daily allowance is reserved in characters against a count the CLIENT
 * supplies (`declaredCharacters`). A claim is not a measurement: a browser can
 * send `1` and a twelve-page document. Without a cap the reservation is
 * decorative — worse than absent, because it looks enforced. **The rule this
 * type exists to make true is "a job delivers what it reserved, and no more."**
 *
 * ── WHY TWO BOUNDS AND NOT ONE ───────────────────────────────────────────────
 *
 * Each is blind in the dimension the other measures, and they fail for
 * different reasons:
 *
 *  - `characters` is the bound tied to money. It is what makes under-declaring
 *    unprofitable — declare one character and you are delivered one character's
 *    worth. It is also INEXACT, because the browser and the worker count
 *    differently (see `TRANSLATE_EXTRACTOR_HEADROOM`), so it rests on a chosen
 *    constant.
 *  - `pages` is EXACT. Both extractors read the same page tree and agree on
 *    which pages carry text — measured, including the invisible OCR text layers
 *    `ocr-pdf` produces — so for an honest caller this bound never binds. When
 *    it does bind, the document is not the document that was declared.
 *
 * **The second bound is what can see the first one being wrong.** The headroom
 * multiplier is a constant, and this codebase's rule about constants is that
 * they have no relationships to constrain them — nothing structural can tell
 * you a number is too small. A cut is therefore reported WITH the bound that
 * made it: a job that stops on `characters` while pages remain is the shape of
 * a headroom that does not cover some real geometry, and it is visible in the
 * artifact instead of arriving as a shorter translation nobody questions.
 *
 * ── IT IS SERVER-DERIVED, WHICH IS WHY IT IS NOT ON `CreateJobRequest` ───────
 *
 * The cap is computed by the route from what the caller declared, and it rides
 * beside the request rather than inside it. Putting it on the request type
 * would say, in the contract, that a caller may set its own cap — and a type
 * that permits the exploit is how the exploit eventually gets written.
 */

import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "./translate-limits";

/** Which bound stopped a delivery. */
export type DeliveryBound = "characters" | "pages";

export interface JobDeliveryCap {
  /**
   * Total WORKER-EXTRACTED characters this job may translate.
   *
   * The unit is named because the two extractors disagree and this file's whole
   * subject is a claim measured in one unit bounding work measured in another.
   * It already carries the extractor headroom — it is `declared × h`, not
   * `declared`.
   */
  readonly characters: number;
  /**
   * Total pages WITH TEXT this job may translate, when the caller declared a
   * count.
   *
   * Pages with no text are dropped before chunking (`pageTextChunks`), so a
   * bound denominated in "pages" and a bound denominated in "pages that carry
   * text" are different numbers for any document with a blank, a whitespace-only
   * or an image-only page. This is the latter, and the client must declare the
   * latter — measured 2026-08-21 to agree exactly across both extractors on
   * blank, whitespace-only, image-only and invisible-OCR-layer pages.
   *
   * Absent when the caller could not count (a direct API caller has bytes, not
   * extracted text). Absent means unbounded in this dimension, never zero.
   */
  readonly pages?: number;
}

/**
 * Read a cap that has round-tripped through the queue's JSON.
 *
 * FAIL-CLOSED, and deliberately: a malformed cap must not read as "no cap".
 * Absent is a supported state that means unbounded; present-and-nonsense is a
 * bug on our own write path, and the convenient reading of a bug — deliver
 * everything — is exactly the outcome the cap exists to prevent. A guard that
 * can license the defect it guards against is worse than no guard.
 */
export function readDeliveryCap(
  value: unknown,
): { ok: true; cap: JobDeliveryCap | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, cap: null };
  if (typeof value !== "object") {
    return { ok: false, reason: "the delivery cap is not an object" };
  }
  const raw = value as { characters?: unknown; pages?: unknown };
  if (
    typeof raw.characters !== "number" ||
    !Number.isFinite(raw.characters) ||
    raw.characters <= 0
  ) {
    return {
      ok: false,
      reason: "the delivery cap has no positive character bound",
    };
  }
  if (raw.pages !== undefined) {
    if (
      typeof raw.pages !== "number" ||
      !Number.isInteger(raw.pages) ||
      raw.pages <= 0
    ) {
      return {
        ok: false,
        reason:
          "the delivery cap has a page bound that is not a positive whole number",
      };
    }
  }
  return {
    ok: true,
    cap: {
      characters: raw.characters,
      ...(raw.pages !== undefined ? { pages: raw.pages } : {}),
    },
  };
}

/**
 * The cap an AI job is submitted under, derived from what the caller declared.
 *
 * ── WHY THIS IS A FUNCTION AND NOT FOUR LINES IN THE ROUTE ──────────────────
 *
 * The route CHARGES the allowance and the worker SPENDS it, and those two
 * numbers have to be the same number. Written inline they were the same
 * expression written once and read twice, which is fine until someone edits one
 * reading. Written here they are one value: the route debits
 * `deliveryCapFor(...).characters` and hands the very same object to the
 * adapter, so a drift between what was charged and what may be delivered is not
 * expressible.
 *
 * It is also the only part of the route's create path that can be tested
 * without standing up an adapter — see the note in
 * `workers/delivery-cap.chain.test.ts` about why mocking the adapter module is
 * not available to us.
 *
 * ── THE FALLBACK IS NOT A PENALTY ───────────────────────────────────────────
 *
 * An undeclared job reserves a whole call's worth, because a direct API caller
 * has bytes and not extracted text and genuinely cannot count. That is exactly
 * the behaviour every caller had before the field existed, and it keeps the
 * rule intact for them: you are delivered what you reserved.
 */
export function deliveryCapFor(
  request: {
    readonly declaredCharacters?: number;
    readonly declaredTextPages?: number;
  },
  limits: { readonly fallbackCharacters: number; readonly headroom: number },
): JobDeliveryCap {
  const declared = request.declaredCharacters ?? limits.fallbackCharacters;
  return {
    characters: Math.ceil(declared * limits.headroom),
    ...(request.declaredTextPages !== undefined
      ? { pages: request.declaredTextPages }
      : {}),
  };
}

/**
 * How an AI tool's run is priced against the daily allowance.
 *
 *  - `per-character` — the work scales with the document. Translate splits a
 *    long document into several provider calls, so a job reserves
 *    `declared × h` with no upper clamp, and the cap it runs under is that same
 *    reservation ({@link deliveryCapFor}).
 *  - `per-call` — one provider call reads the document up to the engine's own
 *    per-run read limit (`AI_INPUT_LIMITS.maxInputCharacters` for Summarize and
 *    Extract; Chat's per-question ceiling, `CHAT_MAX_CHARACTERS_PER_QUESTION`,
 *    which the conversation is paid out of too). A run costs
 *    every character it can send (its declared document, its options, the
 *    engine's instructions) and never more than an undeclared run costs.
 */
export type AiRunPricing = "per-character" | "per-call";

/**
 * The pricing of every AI-capability tool.
 *
 * ⚠️ UNTIL 2026-09-27 ONLY TRANSLATE WAS PRICED BY SIZE. Summarize, Chat and
 * Extract never declared a count, so every run of them reserved the fallback —
 * `TRANSLATE_MAX_INPUT_CHARS × h`, exactly a third of the bucket — whatever the
 * document held. A visitor told they had 30,774 characters a day got three
 * summaries of a one-page PDF, or three chat QUESTIONS in total. The figure on
 * the page was not the unit anyone was charged in.
 *
 * A typed map rather than a rule, because the property that decides it — does
 * one job make one provider call or many — lives in the engines, not in the
 * catalog. `delivery-cap.pricing.test.ts` derives the AI tool set from the
 * catalog and fails if a tool is missing here, and proves every `per-call` tool's
 * processor actually truncates at the cap it is handed.
 */
export const AI_RUN_PRICING: Readonly<Record<string, AiRunPricing>> = {
  "translate-pdf": "per-character",
  "summarize-pdf": "per-call",
  "chat-with-pdf": "per-call",
  "ai-extract": "per-call",
};

/**
 * The characters of a job's OPTIONS, measured by the server from the body it
 * received — never taken from the caller.
 *
 * The serialised JSON rather than a walk of chosen fields, so the measure
 * DISCOVERS what a body carries instead of naming it: a new option that
 * reaches the model is counted the day it is added. It over-counts (keys,
 * quotes, escapes, whitespace the parsers trim) and never under-counts a string
 * the engines send verbatim. The one thing an engine renders that the JSON may
 * not hold (a default field type, a label around a value) is its own text, and
 * {@link AI_PER_CALL_INSTRUCTION_CHARACTERS} covers it; `read-cap-proof`
 * measures the two together.
 *
 * Bounded by the byte cap `POST /api/jobs` puts on every job's options
 * (`JOB_LIMITS.maxOptionsBytes`, 8 KB): a character is at least one UTF-8 byte.
 */
export function optionCharacters(
  options: Readonly<Record<string, unknown>> | undefined,
): number {
  return options === undefined ? 0 : JSON.stringify(options).length;
}

/**
 * What a per-call engine sends besides the document and the options: its own
 * instructions, the delimiters around the text, the truncation notice.
 *
 * ⚠️ A CONSTANT ON THE WEB TIER DESCRIBING THE WORKER'S PROMPTS. Nothing
 * structural can tell it is too small, so it has a second, independent bound:
 * the worker's start-up proof (`read-cap-proof.ts`) runs every per-call
 * processor with the heaviest bodies the route accepts and publishes
 * `aiReadCap: true` only if every character that reached the provider fits
 * `read bound + optionCharacters + this`. An image whose prompts outgrew it
 * gets no discount. Measured 2026-09-27 at 1,131 at most (ai-extract, fifty
 * fields sent by name alone, each rendered with a type the body never held);
 * `read-cap-proof.test.ts` also fails if it drifts to more than three times
 * what it covers.
 */
export const AI_PER_CALL_INSTRUCTION_CHARACTERS = 2_000;

/** What an AI job is debited, and what it may then read or deliver. */
export interface AiReservation {
  /** Debited from the daily allowance, in WORKER-EXTRACTED characters. */
  readonly charge: number;
  /**
   * The bound handed to the worker, or `undefined` for "the engine's own
   * per-run limit". Never smaller than what an honest declaration needs: it is
   * `declared × h`, the same headroom the charge carries.
   *
   * It bounds the DOCUMENT and nothing else. What else a per-call run sends
   * (the options, the engine's instructions) is not bounded by the worker; it
   * is measured by the server and charged, see {@link aiReservationFor}.
   */
  readonly delivery: JobDeliveryCap | undefined;
}

/**
 * Price an AI job and derive the bound it runs under.
 *
 * ── WHY A DECLARATION IS HONOURED ONLY WHEN THE RUNNING WORKER ENFORCES IT ──
 *
 * A declared count is a client claim about the DOCUMENT. For a `per-call` tool
 * it is safe to charge less of the document for a smaller claim only because
 * the worker then reads no more of the document than the claim — declare one
 * character, be read four. Before the summarize, chat and extract processors
 * honoured the cap, that was false: a caller could declare 1, pay 4, and have
 * 500,000 characters sent to the provider.
 *
 * ── WHAT THE WORKER DOES NOT BOUND, AND SO THE SERVER CHARGES ───────────────
 *
 * The read cap bounds the document only. The chat question and carried turns,
 * the extract prompt or schema, and the summarize focus reach the model
 * verbatim whatever the cap says, and so do the engine's own instructions.
 * Until the review of 2026-09-27 the charge was the declared document alone,
 * and the honest chat client folded its question and turns into its own
 * declaration, which the route trusted: a direct caller declaring 1 paid 4 and
 * sent a full 8 KB of conversation, as often as `jobs.create` allowed. Those
 * characters are now measured HERE, from the body the route received
 * ({@link optionCharacters}), plus {@link AI_PER_CALL_INSTRUCTION_CHARACTERS},
 * and a client declares its document and nothing else.
 *
 * The worker image is built by hand and the web tier auto-deploys, so "the code
 * that enforces it is merged" is a MECHANISM, and it arrives first. The PROPERTY
 * is "the worker that will run this job enforces it", and the only witness to
 * that is the running image's own proof, published on its heartbeat
 * (`aiReadCap`). `readCapEnforced` is asked for exactly that, and only when the
 * answer could change the price. Until it says yes, a declaration on a
 * `per-call` tool is ignored and the run costs what it cost before — the
 * convenient failure here is a discount nobody can collect on, never a spend
 * hole.
 *
 * ── THE PRICE, AND THE CLAMP ────────────────────────────────────────────────
 *
 * A `per-call` run costs
 *
 *     min(declared × h + optionCharacters + instructions, fallback × h)
 *
 * which is every character it can put in front of the provider, up to the
 * price of a whole run. The clamp is what keeps this from refusing documents
 * that work today: Summarize and Extract read up to 500,000 characters, and a
 * document that large, charged at its size, would not fit in the bucket at
 * all. (Chat reads no more than the clamp itself, conversation included.) With the
 * clamp a large document costs exactly what an undeclared run always cost, and
 * a small one costs what it sends.
 *
 * Its read bound is NOT clamped: it stays `declared × h`, so an honest large
 * document is still read to the engine's own limit. Under-declaring buys a
 * smaller read, never a cheaper full one: below the clamp a run pays for all it
 * sends, and at the clamp it pays what an undeclared run pays and can send no
 * more than one.
 *
 * An AI tool missing from {@link AI_RUN_PRICING} is treated as a `per-call`
 * tool whose worker enforces nothing: its declaration is ignored.
 */
export async function aiReservationFor(
  tool: string,
  request: {
    readonly declaredCharacters?: number;
    readonly declaredTextPages?: number;
    /** The body's options, measured here rather than taken from the caller. */
    readonly options?: Readonly<Record<string, unknown>>;
  },
  limits: {
    readonly fallbackCharacters: number;
    readonly headroom: number;
    /** Does the worker that will run this job enforce a per-call read cap? */
    readonly readCapEnforced: () => Promise<boolean>;
  },
): Promise<AiReservation> {
  if (AI_RUN_PRICING[tool] === "per-character") {
    const cap = deliveryCapFor(request, limits);
    return { charge: cap.characters, delivery: cap };
  }
  const fallback = Math.ceil(limits.fallbackCharacters * limits.headroom);
  const declared = request.declaredCharacters;
  if (
    declared === undefined ||
    AI_RUN_PRICING[tool] !== "per-call" ||
    !(await limits.readCapEnforced())
  ) {
    return { charge: fallback, delivery: undefined };
  }
  const read = Math.ceil(declared * limits.headroom);
  const sent =
    read +
    optionCharacters(request.options) +
    AI_PER_CALL_INSTRUCTION_CHARACTERS;
  return {
    charge: Math.min(sent, fallback),
    // Characters only. The page bound is translate's exact half; a per-call
    // engine reads a prefix of the joined text and has no page loop to stop.
    delivery: { characters: read },
  };
}

/**
 * The limits every AI job is priced under.
 *
 * ONE OBJECT, because two routes read it: `POST /api/jobs` prices every AI job
 * with it (`aiReservationFor`, spread with the running worker's read-cap
 * witness), and `POST /api/uploads` asks whether ANY such charge could still
 * fit before a byte is uploaded (see {@link smallestAiReservation}). Two copies
 * of these two numbers would let the question and the charge drift apart —
 * which is why `AI_JOB_DELIVERY_LIMITS` in `./ai-allowance`, where the
 * published allowance is computed, is this same object and not a second
 * literal of it.
 */
export const AI_DELIVERY_LIMITS = {
  fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
  headroom: TRANSLATE_EXTRACTOR_HEADROOM,
} as const;

/**
 * The least any AI job can reserve: the smallest declaration the job contract
 * accepts (one character — `declaredCharacters` must be a positive whole
 * number), under the same limits the charge uses. It is translate's price for
 * that declaration; a per-call run never costs less (`aiReservationFor`
 * charges it at least its read bound, and at most the whole-run fallback), so
 * it is below every AI tool's cheapest job.
 *
 * It is a LOWER bound on purpose. The upload route uses it to refuse a file
 * whose job no declaration could get admitted — never one that some honest
 * declaration could. The relationship to the validator and to the job route's
 * own refusal is pinned in `api/uploads/ai-admission.chain.test.ts`.
 */
export function smallestAiReservation(): number {
  return deliveryCapFor({ declaredCharacters: 1 }, AI_DELIVERY_LIMITS)
    .characters;
}
