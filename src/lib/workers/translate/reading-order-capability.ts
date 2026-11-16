/**
 * Does THIS worker image send a two-column page's columns to the model one
 * after the other, rather than line by line across the page?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Translate reads `pdftotext -layout` first and then, for a document with
 * text, poppler's `-bbox-layout` flow, and sends each page's flow text where
 * `./reading-order`'s gate passes (slice 3 of competitor-audit backlog #29).
 * Merging that is not shipping it: the web tier auto-deploys and the worker
 * image is rebuilt and redeployed separately (CLAUDE.md rule 5), and the flow
 * samples the unit tests read were captured on a different poppler from the
 * image's. The heartbeat key `translateReadingOrder` is published from THIS
 * proof, run at the daemon's start-up on the image's own `pdftotext`. An image
 * built before the key does not contain this module, publishes nothing, and
 * the absence parses as `false`.
 *
 * ── WHAT IT RUNS ─────────────────────────────────────────────────────────────
 *
 * A two-column Letter page generated here with pdf-lib (a title, then a left
 * column and a right column on the SAME baselines, each column one sentence
 * with its own tokens), as one `translate-pdf` job through
 * `runThroughExecutorOrder` — the registry resolves the processor, the
 * soundness gate checks the file, the processor runs, the manifest gate
 * validates the artifacts — with the extractor under test and a provider stub
 * that records each request and answers with the text between the prompt's
 * `---` delimiters, verbatim. No `pdf` dep: this proves reading order, not
 * printing, and stays a start-up job of about a hundred milliseconds.
 *
 * ── THE READER IS NOT THE ENGINE ────────────────────────────────────────────
 *
 * Every check reads what a consumer receives, and every check is evaluated —
 * the verdict lists each one that failed, so a control can say WHY it failed:
 *
 *  - `stage`: the job was delivered;
 *  - `health`: exactly one request reached the provider, with a non-empty
 *    delimited segment;
 *  - `order_sent`: {@link columnsSentInOrder} holds on that segment, the
 *    text the model literally received;
 *  - `order_delivered`: it holds on `translation.txt` unzipped from the
 *    delivered artifact (the reader's copy, not the author's);
 *  - `source`: the job record's `results.ai.readingOrder` says the flow run
 *    happened and at least one page was sent as flow;
 *  - `control`: the SAME extraction's `-layout` text FAILS the predicate. If
 *    `-layout` does not interleave this page on this binary, the probe has
 *    proved nothing about reading order and says so.
 *
 * A plain extractor (the shared resolver every other AI tool reads) fails
 * `source` AND `order_sent` AND `order_delivered`; a control that failed only
 * `source` would be a control that never looked at order, and every caller
 * that runs one asserts the order checks are in `failed`.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * A pass means: on this image, a two-column page reaches the model one column
 * after the other, and the delivered translation keeps that order. It does
 * NOT mean every layout is read in order (the gate is order-blind, and flow's
 * block order on an unusual layout is poppler's), that right-to-left pages
 * are sent as flow (they are not, by design: `./reading-order` gate c), or
 * that a real provider call succeeds. The key's name promises no more than
 * the two-column case.
 */

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import { runThroughExecutorOrder } from "../capability-chain";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import type { TranslateDeps } from "./engine";
import { translateDeps } from "./native";
import type { TranslateExtracted, TranslateExtractor } from "./reading-order";

type EnvSource = Record<string, string | undefined>;

/** The two columns a reader must find one after the other. */
export interface ProbeColumns {
  readonly left: readonly string[];
  readonly right: readonly string[];
}

/** The probe page's title, printed above both columns. */
export const READING_ORDER_PROBE_TITLE = "Reading Order Probe";

/**
 * The probe page's columns: each ONE sentence over three printed lines, with
 * tokens no other line carries (A101 and Oslo on the left, B202 and Lima on
 * the right), drawn on the same baselines so `-layout` puts each left line
 * beside its right-hand neighbour. No hyphens: flow keeps a line-end hyphen,
 * and the predicate compares lines joined by a space.
 */
export const READING_ORDER_PROBE_COLUMNS: ProbeColumns = {
  left: [
    "Harbour note A101 says the morning",
    "ferry from the northern quay sails",
    "at nine every weekday towards Oslo.",
  ],
  right: [
    "Market note B202 says the river",
    "stalls beside the old station open",
    "at noon each Sunday for guests from Lima.",
  ],
};

/** The probe's PDF: one Letter page, generated here (no file ships for it). */
export async function readingOrderProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { left, right } = READING_ORDER_PROBE_COLUMNS;
  const font = await embedDrawingFont(doc, [
    READING_ORDER_PROBE_TITLE,
    ...left,
    ...right,
  ]);
  const page = doc.addPage([612, 792]);
  page.drawText(READING_ORDER_PROBE_TITLE, { x: 50, y: 740, size: 18, font });
  left.forEach((line, i) =>
    page.drawText(line, { x: 50, y: 690 - i * 14, size: 11, font }),
  );
  right.forEach((line, i) =>
    page.drawText(line, { x: 320, y: 690 - i * 14, size: 11, font }),
  );
  return doc.save();
}

/**
 * The two-column property, over text as the model or a reader gets it (one
 * paragraph per line, as `flowPageText` joins paragraphs): the left column's
 * sentence is contiguous inside exactly ONE paragraph, the right column's
 * likewise, the left one comes first, and no paragraph holds a line of BOTH
 * columns. The `-layout` reading of a two-column page — each left line beside
 * its right-hand neighbour — fails it on the first line.
 *
 * Production code: the probe's reader. `reading-order-capability.test.ts`
 * holds it equal to the test suite's `columnsReadInOrder` on PDF to Word's
 * paragraph shapes, in both directions.
 */
export function columnsSentInOrder(
  text: string,
  columns: ProbeColumns = READING_ORDER_PROBE_COLUMNS,
): boolean {
  const paragraphs = text.split("\n");
  const leftSentence = columns.left.join(" ");
  const rightSentence = columns.right.join(" ");
  const leftAt = paragraphs.flatMap((p, i) =>
    p.includes(leftSentence) ? [i] : [],
  );
  const rightAt = paragraphs.flatMap((p, i) =>
    p.includes(rightSentence) ? [i] : [],
  );
  if (leftAt.length !== 1 || rightAt.length !== 1) return false;
  if (!(leftAt[0]! < rightAt[0]!)) return false;
  return paragraphs.every(
    (p) =>
      !(
        columns.left.some((line) => p.includes(line)) &&
        columns.right.some((line) => p.includes(line))
      ),
  );
}

/** One check of the probe; `throw` is the whole probe throwing. */
export type ReadingOrderCheck =
  | "stage"
  | "health"
  | "order_sent"
  | "order_delivered"
  | "source"
  | "control"
  | "throw";

/** Every check the probe evaluated that failed. `ok` iff none did. */
export interface ReadingOrderVerdict {
  readonly ok: boolean;
  readonly failed: readonly ReadingOrderCheck[];
}

export interface ReadingOrderProbeDeps {
  /** The extractor under test: the image's composite, in production. */
  readonly extract: TranslateExtractor | undefined;
  /** Where the executor's default gates read their policy. */
  readonly env?: EnvSource;
  /**
   * The columns the reader looks for. Defaults to the probe page's; a test
   * whose stub extractor reads a different verbatim page passes that page's.
   */
  readonly columns?: ProbeColumns;
  /**
   * How the registry is built from the probe's deps. Defaults to a registry
   * holding exactly the translate processor; tests swap it to remove the
   * processor or the recording provider (each must fail the probe).
   */
  readonly registry?: (deps: TranslateDeps) => ProcessorRegistry;
}

const NL = "\n";
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;

/** The text between the prompt's `---` delimiters, or null. */
function delimitedSegment(request: AiCompletionRequest): string | null {
  const content = request.messages.map((m) => m.content).join(NL);
  const open = content.indexOf(OPEN);
  const close = content.lastIndexOf(CLOSE);
  if (open < 0 || close <= open) return null;
  return content.slice(open + OPEN.length, close);
}

function defaultRegistry(deps: TranslateDeps): ProcessorRegistry {
  return new ProcessorRegistry().register(createTranslateProcessor(deps));
}

async function deliveredTranslation(
  artifacts: readonly { contentType: string; bytes: Uint8Array }[],
): Promise<string | null> {
  const zip = artifacts.find((a) => a.contentType === "application/zip");
  if (!zip) return null;
  const entry = (await JSZip.loadAsync(zip.bytes)).file("translation.txt");
  return entry ? entry.async("string") : null;
}

/**
 * Run the probe and report every check that failed (see the module header).
 * Never throws: a throw anywhere is the verdict `failed: ["throw"]`.
 */
export async function probeTranslateReadingOrder(
  deps: ReadingOrderProbeDeps,
): Promise<ReadingOrderVerdict> {
  const extract = deps.extract;
  if (!extract) return { ok: false, failed: ["throw"] };
  const columns = deps.columns ?? READING_ORDER_PROBE_COLUMNS;
  try {
    const requests: AiCompletionRequest[] = [];
    const seen: TranslateExtracted[] = [];
    const provider: AiProvider = {
      id: "anthropic",
      model: "capability-probe",
      async complete(request) {
        requests.push(request);
        return {
          ok: true,
          text: delimitedSegment(request) ?? "",
          model: "capability-probe",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const build = deps.registry ?? defaultRegistry;
    const registry = build({
      extract: async (bytes, run) => {
        const extracted = await extract(bytes, run);
        seen.push(extracted);
        return extracted;
      },
      provider,
      now: () => "1970-01-01T00:00:00.000Z",
    });
    const outcome = await runThroughExecutorOrder({
      tool: "translate-pdf",
      input: {
        bytes: await readingOrderProbePdf(),
        filename: "reading-order-probe.pdf",
        contentType: "application/pdf",
      },
      options: { targetLanguage: "fr", sourceLanguage: "en" },
      registry,
      ...(deps.env ? { env: deps.env } : {}),
    });

    const failed: ReadingOrderCheck[] = [];
    const delivered = outcome.stage === "delivered" ? outcome : null;
    if (!delivered) failed.push("stage");

    const segment =
      requests.length === 1 ? delimitedSegment(requests[0]!) : null;
    if (segment === null || segment.trim().length === 0) failed.push("health");

    if (segment === null || !columnsSentInOrder(segment, columns))
      failed.push("order_sent");

    const translation = delivered
      ? await deliveredTranslation(delivered.result.artifacts)
      : null;
    if (translation === null || !columnsSentInOrder(translation, columns))
      failed.push("order_delivered");

    const readingOrder = delivered?.result.results?.ai?.readingOrder;
    if (
      !readingOrder ||
      readingOrder.source !== "flow" ||
      !(readingOrder.flowPages >= 1)
    )
      failed.push("source");

    // The in-probe control: the -layout reading of the SAME bytes on THIS
    // binary must interleave the columns, or the page tests nothing here.
    const layoutText = seen[0]?.text;
    if (layoutText === undefined || columnsSentInOrder(layoutText, columns))
      failed.push("control");

    return { ok: failed.length === 0, failed };
  } catch {
    return { ok: false, failed: ["throw"] };
  }
}

/**
 * The heartbeat's `translateReadingOrder`: the probe over THIS image's real
 * Translate extractor (`translateDeps(env).extract`, the composite of the
 * image's `pdftotext -layout` and `-bbox-layout`). No `pdftotext`, no
 * extractor, `false`; any throw, `false`.
 */
export async function provesTranslateReadingOrder(
  env: EnvSource = process.env,
): Promise<boolean> {
  try {
    const verdict = await probeTranslateReadingOrder({
      extract: translateDeps(env).extract,
      env,
    });
    return verdict.ok;
  } catch {
    return false;
  }
}
