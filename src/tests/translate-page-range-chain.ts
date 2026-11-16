/**
 * The COMPOSED chain for Translate's chosen pages (competitor audit #29,
 * slice 6), each hop the shipped function, over ONE real PDF: the harness
 * `translate-page-range.chain.test.ts` and
 * `translate-page-range.property.test.ts` both drive.
 *
 *   1. the panel's lazy measure (`judgeTranslatePages`) over the panel's one
 *      extraction, then the panel's declaration step `declareTranslateRun`
 *      (preflight of the counted pages, the declared counts and `pages`),
 *      the SAME function the panel's Run calls;
 *   2. the browser client (`runWorkerTranslate`) through a capturing
 *      transport: the body as sent;
 *   3. the route's REAL `parseCreateJobRequest`, then
 *      `aiReservationGiven("translate-pdf", …)`: the charge and the cap;
 *   4. the worker's translate processor through `runThroughExecutorOrder`
 *      UNDER that cap (the processor parses the options with the shipped
 *      parser, the engine selects and labels), with pdfjs's legacy build as
 *      the worker's extractor stand-in and a recording provider and PDF dep;
 *   5. `sanitizeJobResults` + a JSON round trip: the record the browser reads;
 *   6. the panel's `selectionConfirmed`.
 *
 * LIMIT (stated in both tests): pdfjs on both sides proves the PAIRING, not
 * production. The worker extracts with poppler; the two extractors' character
 * counts disagree by an unbounded factor while their PAGES agree (memory "two
 * extractors, one ceiling"), so "nothing withheld for an honest selection" is
 * a same-extractor claim here. The ×4 headroom absorbs the difference in
 * production, as for whole-document jobs; a real job's decoded ZIP is the
 * only production check.
 *
 * WHAT THIS HARNESS DOES NOT DO: write any hop itself. Until review
 * (2026-11-16) step 1 typed the panel's declaration —
 * `declaredCharacters = selected.characterCount`, `declaredTextPages =
 * preflight.textPages.length` — so a panel declaring the whole document's
 * characters (M6) or text pages (M11) turned only the panel test red, and
 * this header's "each hop the shipped function" was false for that hop. The
 * step is now `declareTranslateRun`, imported from the module the panel
 * imports it from; the one override left (`ChainOptions.declare`) exists
 * only for the property test's mis-declared POSITIVE CONTROL and is applied
 * on top of the shipped declaration, never instead of computing it.
 *
 * A test helper (`src/tests/`), imported by those two tests only, so its
 * hops are written once.
 */
import JSZip from "jszip";
import { parseCreateJobRequest } from "@/lib/jobs";
import { AI_JOB_DELIVERY_LIMITS } from "@/lib/jobs/ai-allowance";
import {
  aiReservationGiven,
  type JobDeliveryCap,
} from "@/lib/jobs/delivery-cap";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { selectionConfirmed } from "@/lib/jobs/selection-echo";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import type { PageSpan } from "@/lib/pdf/page-spans";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import type {
  AiCompletionRequest,
  AiProvider,
} from "@/lib/workers/ai/provider";
import { runThroughExecutorOrder } from "@/lib/workers/capability-chain";
import { ProcessorRegistry } from "@/lib/workers/processor/registry";
import { createTranslateProcessor } from "@/lib/workers/processor/translate";
import { judgeTranslatePages } from "@/lib/workers/translate-measure";
import { runWorkerTranslate } from "@/lib/workers/translate-client";
import { separatorFor } from "@/lib/workers/translate/page-markers";
import { declareTranslateRun } from "@/lib/workers/translate/preflight";
import { delimitedSegment } from "@/lib/workers/translate/reading-order-capability";
import {
  typesetText,
  type TypesetInput,
} from "@/lib/workers/translate/typeset";

/** pdf.js's legacy build, the one Node runs. */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;
export const pdfjsExtract = (bytes: Uint8Array) =>
  extractPdfText(bytes, legacy);

const NL = "\n";

/** A transport that records the `POST /api/jobs` body and stops there. */
function captureTransport() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target === "/api/uploads")
      return {
        ok: true,
        status: 201,
        json: async () => ({
          slots: [{ fileId: "f_chain0000000001", url: "/upload/slot-1" }],
        }),
      };
    if (target === "/upload/slot-1")
      return { ok: true, status: 200, json: async () => ({}) };
    if (target === "/api/jobs") {
      const raw = init?.body;
      const text =
        typeof raw === "string"
          ? raw
          : new TextDecoder().decode(raw as ArrayBuffer);
      bodies.push(JSON.parse(text) as Record<string, unknown>);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          jobId: "job_chain00001",
          tool: "translate-pdf",
          status: "failed",
          progress: 0,
          error: { code: "internal_error", message: "stop", retryable: false },
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          expiresAt: new Date(3_600_000).toISOString(),
          retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
        }),
      };
    }
    throw new Error(`unexpected request: ${target}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

/** What one run of the chain observed at each hop. No assertion is made here. */
export interface ChainRun {
  readonly extracted: ExtractedPdfText;
  /** The panel's spans, or null for the whole document. */
  readonly pages: PageSpan[] | null;
  /**
   * The judged selection, or the whole document: what the panel's
   * declaration step was given to count (the tests compare the declared
   * counts against it).
   */
  readonly selected: ExtractedPdfText;
  readonly declaredCharacters: number;
  readonly declaredTextPages: number;
  /** The body as the client sent it. */
  readonly body: Record<string, unknown>;
  readonly charge: number;
  readonly cap: JobDeliveryCap;
  readonly stage: string;
  /** Every request's delimited segment, in order. */
  readonly segments: readonly string[];
  readonly stored: {
    readonly truncation?: { truncated: boolean; pagesSent?: PageSpan[] };
    readonly readingOrder?: { sentCharacters?: number };
    readonly pageMap?: { markerCharacters?: number };
    readonly delivery?: unknown;
  } | null;
  readonly confirmed: boolean | null;
  /** Every line a reader meets that could name pages: ZIP files and the PDF walk. */
  readonly labelText: string;
  readonly manifestPagesSent: unknown;
}

/** Recording provider: echoes the segment (markers kept). */
function recorder(seen: AiCompletionRequest[]): AiProvider {
  return {
    id: "anthropic",
    model: "chain-model",
    async complete(request) {
      seen.push(request);
      return {
        ok: true,
        text: delimitedSegment(request) ?? "",
        model: "chain-model",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

export interface ChainOptions {
  /**
   * The characters the panel DECLARES, given its counted selection. The
   * shipped panel declares `selected.characterCount`; a mis-declaring control
   * passes another.
   */
  readonly declare?: (run: {
    extracted: ExtractedPdfText;
    selected: ExtractedPdfText;
  }) => number;
}

/** Run the chain once for `text` typed into the Pages field ("" = empty). */
export async function runChain(
  bytes: Uint8Array,
  text: string,
  opts: ChainOptions = {},
): Promise<ChainRun> {
  // 1. The panel: one extraction, the lazy judgement, the panel's own
  //    declaration step (the function its Run calls, not a copy of it).
  const extracted = await pdfjsExtract(bytes);
  let judged: { pages: PageSpan[] | null; selected: ExtractedPdfText } | null =
    null;
  if (text.trim() !== "") {
    const answer = judgeTranslatePages(extracted, text);
    if (!answer.ok) throw new Error(`panel refused: ${answer.message}`);
    judged = answer;
  }
  const declaration = declareTranslateRun(
    extracted,
    judged,
    TRANSLATE_MAX_INPUT_CHARS,
  );
  if (declaration.refusal !== null)
    throw new Error(`panel preflight refused: ${declaration.refusal}`);
  const pages = declaration.pages;
  const selected = judged ? judged.selected : extracted;
  // The positive control's override, applied ON TOP of the shipped
  // declaration (it replaces one number; it never computes the others).
  const declared = opts.declare
    ? {
        ...declaration.declared,
        declaredCharacters: opts.declare({ extracted, selected }),
      }
    : declaration.declared;
  const { declaredCharacters, declaredTextPages } = declared;

  // 2. The client, through a capturing transport.
  const { fetchImpl, bodies } = captureTransport();
  await runWorkerTranslate(
    {
      filename: "chain.pdf",
      bytes,
      targetLanguage: "fr",
      sourceLanguage: "en",
      ...declared,
    },
    { fetchImpl, pollIntervalMs: 0, maxPollAttempts: 1 },
  );
  if (bodies.length !== 1)
    throw new Error(`the client posted ${bodies.length} job bodies (need 1)`);
  const body = bodies[0]!;

  // 3. The route: the real contract, then the one pricing function.
  const parsed = parseCreateJobRequest(body);
  if (!parsed.ok) throw new Error("the route's contract refused the body");
  const reservation = aiReservationGiven(
    "translate-pdf",
    {
      ...(parsed.value.declaredCharacters !== undefined
        ? { declaredCharacters: parsed.value.declaredCharacters }
        : {}),
      ...(parsed.value.declaredTextPages !== undefined
        ? { declaredTextPages: parsed.value.declaredTextPages }
        : {}),
      options: parsed.value.options ?? {},
    },
    AI_JOB_DELIVERY_LIMITS,
    false,
  );
  const cap = reservation.delivery!;

  // 4. The worker, under that cap, through the executor's order.
  const seen: AiCompletionRequest[] = [];
  const captured: TypesetInput[] = [];
  const registry = new ProcessorRegistry().register(
    createTranslateProcessor({
      extract: async () => extracted,
      provider: recorder(seen),
      pdf: {
        languages: () => new Set(["fr"]),
        render: async ({ input }) => {
          captured.push(input);
          return { ok: false, reason: "render_failed" };
        },
      },
      now: () => "1970-01-01T00:00:00.000Z",
    }),
  );
  const outcome = await runThroughExecutorOrder({
    tool: "translate-pdf",
    input: { bytes, filename: "chain.pdf", contentType: "application/pdf" },
    options: (parsed.value.options ?? {}) as Record<string, unknown>,
    delivery: cap,
    registry,
    env: {},
  });

  // 5. The record the browser reads.
  let stored: ChainRun["stored"] = null;
  let labelText = "";
  let manifestPagesSent: unknown = undefined;
  if (outcome.stage === "delivered") {
    stored =
      (
        JSON.parse(
          JSON.stringify(
            sanitizeJobResults({ ai: outcome.result.results?.ai }) ?? {},
          ),
        ) as { ai?: ChainRun["stored"] }
      ).ai ?? null;
    const zip = outcome.result.artifacts.find(
      (a) => a.contentType === "application/zip",
    );
    if (zip) {
      const archive = await JSZip.loadAsync(zip.bytes);
      const read = async (name: string) =>
        (await archive.file(name)?.async("string")) ?? "";
      const manifest = await read("manifest.json");
      manifestPagesSent = manifest
        ? (JSON.parse(manifest) as { source?: { pagesSent?: unknown } }).source
            ?.pagesSent
        : undefined;
      labelText = [
        await read("translation.md"),
        await read("README.txt"),
        ...captured.map(typesetText),
      ].join(NL);
    }
  }

  // 6. The panel's echo check (only meaningful when pages were sent).
  const confirmed =
    pages === null ? null : selectionConfirmed(pages, stored?.truncation);

  return {
    extracted,
    pages,
    selected,
    declaredCharacters,
    declaredTextPages,
    body,
    charge: reservation.charge,
    cap,
    stage: outcome.stage,
    segments: seen.map((r) => delimitedSegment(r) ?? ""),
    stored,
    confirmed,
    labelText,
    manifestPagesSent,
  };
}

/** A segment with every page marker removed (rebuilt, never a typed pattern). */
export function withoutMarkers(segment: string, maxPage: number): string {
  let out = segment;
  for (let n = 1; n <= maxPage; n += 1)
    out = out.split(separatorFor(n)).join(NL + NL);
  return out;
}
