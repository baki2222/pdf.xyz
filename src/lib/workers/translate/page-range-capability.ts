/**
 * The start-up proof, published on the heartbeat as `translatePageRange`, that
 * THIS image's Translate PDF sends the AI model only the pages a person chose,
 * by their PHYSICAL page number, labels them by those pages and no range that
 * holds an unchosen one, and refuses a page past the end before any provider
 * call (competitor audit #29, slice 6).
 *
 * ── WHY A PROOF AND NOT A FLAG ──────────────────────────────────────────────
 *
 * The worker image is built by hand (CLAUDE.md rule 5: merging is not
 * shipping), and an image built before this slice IGNORES `pages`
 * (`parseTranslateOptions` is lenient to unknown keys): it would translate the
 * whole document under a delivery cap sized for the selection. And the page
 * numbers are poppler's: an extractor that dropped a blank page and numbered
 * by position would shift every later page. Neither is a fact about the
 * source tree, so this runs BY the image, on its own Translate extractor
 * (`translateDeps(env).extract`, the reading-order composite), and an image
 * built before the key publishes nothing, which the reader parses as `false`.
 *
 * ── WHAT IT RUNS ────────────────────────────────────────────────────────────
 *
 * Four `translate-pdf` jobs through `runThroughExecutorOrder` (registry →
 * soundness → processor, whose option parse is the shipped
 * `AI_TOOL_OPTION_PARSERS` entry → manifest gate), NOT
 * `proveThroughExecutorOrder` (it returns only `artifacts[0]`), over the
 * five-page probe of `./probe-pdf` ({@link PAGE_RANGE_PROBE_PAGES}: page 1
 * blank, pages 2-5 each with tokens no other page holds). The provider is a
 * recording fake (no network, and no call of a provider in this file), answering
 * with page-map's `echoAnswer` (keeps the markers) or `stripSeparatorsAnswer`
 * (drops them). The PDF dep is a RECORDER: it captures the `TypesetInput`
 * the engine would print and answers `render_failed`, so the proof needs no
 * Chromium and no language memo. The PDF's headings are read from
 * `typesetText(captured input)`, the same walk the printed HTML is built
 * from; Chromium's fidelity to that walk is `translatePageMap`'s proof, and
 * this one composes with it rather than re-proving it. If that key is ever
 * retired, this proof must read a real PDF.
 *
 * PASS requires ALL of (every check is evaluated; the verdict lists each
 * failure by step):
 *   (0) HEALTH, first: the extractor reads 5 pages, page 1 present as an entry
 *       numbered 1 with no text, and each page's tokens in the entry whose
 *       `pageNumber` is that page and in no other (by number, never by array
 *       position: an extractor that dropped the blank page and numbered by
 *       position would otherwise pass health and shift every step below);
 *   (1) ARM A, `pages: [[2,2],[4,4]]`, echo provider: delivered; exactly one
 *       request; its delimited segment holds pages 2's and 4's tokens and
 *       neither page 3's nor page 5's (page 5 is the index defect); its brand
 *       lines are exactly `markerFor(4)`; the user message holds
 *       `pageMarkerClause(4)`; the system prompt holds no "IMPORTANT" notice
 *       (an untruncated selection is not announced to the model); the stored
 *       record keeps `truncation.pagesSent` [[2,2],[4,4]]; the ZIP's manifest
 *       `source.pagesSent` is [[2,2],[4,4]]; translation.md and README.txt say
 *       "You chose pages 2 and 4 of 5."; the PDF's headings are exactly
 *       "Page 2", "Page 4";
 *   (2) ARM B, same pages, strip provider: delivered; headings exactly
 *       "Pages 2, 4"; no line names the range 2 to 4; translation.txt equals
 *       arm A's (the ZIP does not depend on the markers);
 *   (3) POSITIVE CONTROL, no pages: delivered, the provider saw pages 2, 3, 4
 *       and 5, and the manifest has no `source.pagesSent`. This is what proves
 *       the recorder records: (1)'s "did not see page 3" is an absence;
 *   (4) `pages: [[6,6]]`: failed as `unprocessable_entity`, not retryable,
 *       with ZERO provider calls, AND as the OUT-OF-RANGE refusal: its
 *       message is `translatePagesOutOfRangeMessage(5, [6,6])`. The code,
 *       the retry flag and the zero calls are shared with the chosen-pages
 *       `no_text` refusal, which an engine with its range check removed
 *       reaches instead ([[6,6]] selects nothing, and nothing has no text),
 *       so without the message this step passed on that image (review
 *       2026-11-17). The job error carries only code, message and retry
 *       flag, so the message IS the refusal's kind at the wire; a health
 *       check asserts the two refusals' messages differ, or the step would
 *       be blind again;
 *   (5) CONTROL: arm A's heading predicate fails on arm B's text and arm B's
 *       on arm A's (a reader that cannot tell them apart proved nothing).
 *   Any throw is `false`.
 *
 * TIME: four extractor runs and no render. It runs at daemon start-up beside
 * the other proofs; the HEALTHCHECK reads only the cache (see
 * `../daemon/proved-capabilities.ts`), never this.
 *
 * ── WHAT A PASS DOES NOT MEAN ───────────────────────────────────────────────
 *
 * The model is a fake: whether a real model translates only what it is given
 * is the production job's question. The charge (declared × 4 for the chosen
 * pages) is the browser's and the route's; `translate-page-range.chain.test.ts`
 * pairs them, and a real job's decoded ZIP is the production check.
 */
import JSZip from "jszip";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { NO_TEXT_IN_CHOSEN_PAGES_MESSAGE } from "@/lib/jobs/chosen-pages-no-text";
import { translatePagesOutOfRangeMessage } from "@/lib/jobs/translate-pages";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import {
  runThroughExecutorOrder,
  type ExecutorOrderOutcome,
} from "../capability-chain";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import type { TypesetInput } from "./typeset";
import { typesetText } from "./typeset";
import {
  pageMarkerClause,
  type TranslateDeps,
  type TranslateLimits,
} from "./engine";
import { translateDeps } from "./native";
import { markerFor } from "./page-markers";
import {
  echoAnswer,
  stripSeparatorsAnswer,
  type PageMapAnswer,
} from "./page-map-capability";
import {
  PAGE_RANGE_PROBE_PAGES,
  pageMapProbePdf,
  type PageMapProbePage,
} from "./probe-pdf";
import type { TranslateExtractor } from "./reading-order";
import { delimitedSegment } from "./reading-order-capability";

type EnvSource = Record<string, string | undefined>;

const PROBE_NAME = "page-range-probe.pdf";
const SOURCE: TranslateLanguage = "en";
const TARGET: TranslateLanguage = "fr";
const CHOSEN: [number, number][] = [
  [2, 2],
  [4, 4],
];
const BEYOND: [number, number][] = [[6, 6]];
/** The out-of-range refusal of {@link BEYOND} on the five-page probe. */
const BEYOND_MESSAGE = translatePagesOutOfRangeMessage(5, [6, 6]);
/** What a reader of a selection job must be told (typed: it is the property). */
const SENTENCE = "You chose pages 2 and 4 of 5.";
/** The PDF's headings per arm, typed rather than built from the label author. */
const HEADINGS_A = ["Page 2", "Page 4"];
const HEADINGS_B = ["Pages 2, 4"];
/** "2–4" from code points: the range a first–last label would write. */
const RANGE_2_TO_4 = `2${String.fromCharCode(0x2013)}4`;
const NL = "\n";
const OPEN = `${NL}---${NL}`;

/** One step's failure, by name. */
export type PageRangeCheck =
  | "health"
  | "stage_a"
  | "one_request_a"
  | "chosen_sent"
  | "unchosen_not_sent"
  | "markers_sent"
  | "prompt_a"
  | "no_notice_a"
  | "stored_a"
  | "manifest_a"
  | "sentence_a"
  | "headings_a"
  | "stage_b"
  | "headings_b"
  | "no_range_b"
  | "zip_identity"
  | "control_sent"
  | "control_manifest"
  | "beyond"
  | "beyond_kind"
  | "control_headings"
  | "throw";

export interface PageRangeVerdict {
  readonly ok: boolean;
  readonly failed: readonly PageRangeCheck[];
  /** One `PASS (n) …` / `FAIL (n) …` line per check, content-free. */
  readonly lines: readonly string[];
}

export interface PageRangeProbeDeps {
  /** The extractor under test: the image's Translate composite, in production. */
  readonly extract?: TranslateExtractor;
  /** The production Translate limits, in production. */
  readonly limits?: TranslateLimits;
  readonly env?: EnvSource;
  /** The probe's pages. Defaults to {@link PAGE_RANGE_PROBE_PAGES}; tests only. */
  readonly pages?: readonly (PageMapProbePage | null)[];
  /** How the registry is built from each job's deps (tests and mutants). */
  readonly registry?: (deps: TranslateDeps) => ProcessorRegistry;
  /** Arm A's model. Defaults to page-map's {@link echoAnswer}. */
  readonly answerA?: PageMapAnswer;
  /** Arm B's model. Defaults to page-map's {@link stripSeparatorsAnswer}. */
  readonly answerB?: PageMapAnswer;
}

/** The lines of a text, trimmed, blank lines dropped. */
const linesOf = (text: string) =>
  text
    .split(/[\r\n\f]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** The heading lines of a typeset text ("Page N", "Pages …"). */
export const headingsOf = (text: string): string[] =>
  linesOf(text).filter((l) => /^Pages? \d/.test(l));

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Arm A's predicate: the headings are exactly "Page 2", "Page 4". */
export const headedPageByPage = (text: string) =>
  sameList(headingsOf(text), HEADINGS_A);
/** Arm B's predicate: the one heading is exactly "Pages 2, 4". */
export const headedByChosenList = (text: string) =>
  sameList(headingsOf(text), HEADINGS_B);

/** The brand check of page-map's probe: NFKC, whitespace and Cf removed. */
const hasBrand = (text: string) =>
  /pdfxyz/i.test(text.normalize("NFKC").replace(/[\s\p{Cf}]/gu, ""));

const sameSpans = (value: unknown, expected: [number, number][]) =>
  JSON.stringify(value) === JSON.stringify(expected);

interface JobRun {
  readonly outcome: ExecutorOrderOutcome;
  readonly requests: readonly AiCompletionRequest[];
  readonly typeset: string | null;
  readonly zip: {
    readonly manifest: { source?: Record<string, unknown> } | null;
    readonly md: string | null;
    readonly txt: string | null;
    readonly readme: string | null;
  };
  readonly storedPagesSent: unknown;
}

function defaultRegistry(deps: TranslateDeps): ProcessorRegistry {
  return new ProcessorRegistry().register(createTranslateProcessor(deps));
}

async function runJob(
  answer: PageMapAnswer,
  pages: [number, number][] | undefined,
  input: Uint8Array,
  extract: TranslateExtractor,
  deps: PageRangeProbeDeps,
): Promise<JobRun> {
  const requests: AiCompletionRequest[] = [];
  const captured: TypesetInput[] = [];
  const provider: AiProvider = {
    id: "anthropic",
    model: "capability-probe",
    async complete(request) {
      requests.push(request);
      return {
        ok: true,
        text: answer(delimitedSegment(request) ?? ""),
        model: "capability-probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
  const registry = (deps.registry ?? defaultRegistry)({
    extract,
    provider,
    // A RECORDER, not a renderer: the headings are read from the input the
    // engine would print (see the header).
    pdf: {
      languages: () => new Set([TARGET]),
      render: async ({ input: typeset }) => {
        captured.push(typeset);
        return { ok: false, reason: "render_failed" };
      },
    },
    ...(deps.limits ? { limits: deps.limits } : {}),
    now: () => "1970-01-01T00:00:00.000Z",
  });
  const outcome = await runThroughExecutorOrder({
    tool: "translate-pdf",
    input: {
      bytes: input,
      filename: PROBE_NAME,
      contentType: "application/pdf",
    },
    options: {
      targetLanguage: TARGET,
      sourceLanguage: SOURCE,
      ...(pages ? { pages } : {}),
    },
    registry,
    ...(deps.env ? { env: deps.env } : {}),
  });
  const empty = { manifest: null, md: null, txt: null, readme: null };
  if (outcome.stage !== "delivered")
    return {
      outcome,
      requests,
      typeset: null,
      zip: empty,
      storedPagesSent: null,
    };
  const zipArtifact = outcome.result.artifacts.find(
    (a) => a.contentType === "application/zip",
  );
  let zip: JobRun["zip"] = empty;
  if (zipArtifact) {
    const archive = await JSZip.loadAsync(zipArtifact.bytes);
    const read = (name: string) =>
      archive.file(name)?.async("string") ?? Promise.resolve(null);
    const [manifest, md, txt, readme] = await Promise.all([
      read("manifest.json"),
      read("translation.md"),
      read("translation.txt"),
      read("README.txt"),
    ]);
    zip = {
      manifest:
        manifest === null
          ? null
          : (JSON.parse(manifest) as { source?: Record<string, unknown> }),
      md,
      txt,
      readme,
    };
  }
  // As PERSISTED: through the one redaction boundary, then a JSON round trip.
  const stored = JSON.parse(
    JSON.stringify(
      sanitizeJobResults({ ai: outcome.result.results?.ai }) ?? {},
    ),
  ) as { ai?: { truncation?: { pagesSent?: unknown } } };
  return {
    outcome,
    requests,
    typeset: captured.length === 1 ? typesetText(captured[0]!) : null,
    zip,
    storedPagesSent: stored.ai?.truncation?.pagesSent ?? null,
  };
}

const sentText = (run: JobRun) =>
  run.requests.map((r) => delimitedSegment(r) ?? "").join(NL);

/**
 * Run the proof and report every check by step (see the header). Never
 * throws: a throw anywhere is the verdict `failed: ["throw"]`.
 */
export async function probeTranslatePageRange(
  deps: PageRangeProbeDeps,
): Promise<PageRangeVerdict> {
  const failed: PageRangeCheck[] = [];
  const lines: string[] = [];
  const check = (
    step: string,
    name: PageRangeCheck,
    pass: boolean,
    what: string,
  ) => {
    lines.push(`${pass ? "PASS" : "FAIL"} (${step}) ${what}`);
    if (!pass) failed.push(name);
  };
  const { extract } = deps;
  if (!extract) {
    check("0", "health", false, "this image has a Translate text extractor");
    return { ok: false, failed, lines };
  }
  try {
    const probe = deps.pages ?? PAGE_RANGE_PROBE_PAGES;
    const input = await pageMapProbePdf(probe);
    const tokensOf = (n: number) => probe[n - 1]?.tokens ?? [];

    // (0) HEALTH, by page NUMBER, never by array position.
    const read = await extract(input);
    const entry = (n: number) => read.pages.find((p) => p.pageNumber === n);
    const blankFirst =
      entry(1) !== undefined && entry(1)!.text.trim().length === 0;
    const tokensOnTheirPages = [2, 3, 4, 5].every(
      (n) =>
        tokensOf(n).length > 0 &&
        tokensOf(n).every(
          (token) =>
            entry(n)?.text.includes(token) === true &&
            read.pages.every(
              (p) => p.pageNumber === n || !p.text.includes(token),
            ),
        ),
    );
    check(
      "0",
      "health",
      read.pageCount === 5 && blankFirst && tokensOnTheirPages,
      `the extractor reads ${read.pageCount} pages (need 5), page 1 an entry with no text, each page's tokens in the entry numbered for it and no other`,
    );
    if (failed.length > 0) return { ok: false, failed, lines };

    const a = await runJob(
      deps.answerA ?? echoAnswer,
      CHOSEN,
      input,
      extract,
      deps,
    );
    const b = await runJob(
      deps.answerB ?? stripSeparatorsAnswer,
      CHOSEN,
      input,
      extract,
      deps,
    );
    const all = await runJob(echoAnswer, undefined, input, extract, deps);
    const beyond = await runJob(echoAnswer, BEYOND, input, extract, deps);

    // (1) ARM A
    check(
      "1",
      "stage_a",
      a.outcome.stage === "delivered",
      `pages [[2,2],[4,4]] is delivered (stage ${a.outcome.stage})`,
    );
    check(
      "1",
      "one_request_a",
      a.requests.length === 1,
      `arm A made ${a.requests.length} provider requests (need 1)`,
    );
    const sentA = sentText(a);
    check(
      "1",
      "chosen_sent",
      [...tokensOf(2), ...tokensOf(4)].every((t) => sentA.includes(t)),
      "the provider saw pages 2's and 4's tokens",
    );
    check(
      "1",
      "unchosen_not_sent",
      ![...tokensOf(3), ...tokensOf(5)].some((t) => sentA.includes(t)),
      "the provider saw neither page 3's nor page 5's tokens",
    );
    const brandLines = sentA.split(NL).filter(hasBrand);
    check(
      "1",
      "markers_sent",
      sameList(brandLines, [markerFor(4)]),
      `the segment's marker lines are exactly page 4's (${brandLines.length} brand lines)`,
    );
    const request = a.requests.length === 1 ? a.requests[0]! : null;
    const content = request
      ? request.messages.map((m) => m.content).join(NL)
      : "";
    const open = content.indexOf(OPEN);
    check(
      "1",
      "prompt_a",
      open >= 0 && content.slice(0, open).includes(pageMarkerClause(4)),
      "the user message holds the marker instruction for page 4",
    );
    check(
      "1",
      "no_notice_a",
      request !== null && !(request.system ?? "").includes("IMPORTANT"),
      "the system prompt holds no notice about the selection",
    );
    check(
      "1",
      "stored_a",
      sameSpans(a.storedPagesSent, CHOSEN),
      `the stored record keeps pagesSent [[2,2],[4,4]] (${JSON.stringify(a.storedPagesSent)})`,
    );
    check(
      "1",
      "manifest_a",
      sameSpans(a.zip.manifest?.source?.pagesSent, CHOSEN),
      `the ZIP's manifest source.pagesSent is [[2,2],[4,4]] (${JSON.stringify(a.zip.manifest?.source?.pagesSent ?? null)})`,
    );
    check(
      "1",
      "sentence_a",
      a.zip.md?.includes(SENTENCE) === true &&
        a.zip.readme?.includes(SENTENCE) === true,
      `translation.md and README.txt both say "${SENTENCE}"`,
    );
    check(
      "1",
      "headings_a",
      a.typeset !== null && headedPageByPage(a.typeset),
      `the PDF is headed exactly ${JSON.stringify(HEADINGS_A)} (${JSON.stringify(a.typeset === null ? null : headingsOf(a.typeset))})`,
    );

    // (2) ARM B
    check(
      "2",
      "stage_b",
      b.outcome.stage === "delivered",
      `arm B is delivered (stage ${b.outcome.stage})`,
    );
    check(
      "2",
      "headings_b",
      b.typeset !== null && headedByChosenList(b.typeset),
      `the PDF is headed exactly ${JSON.stringify(HEADINGS_B)} (${JSON.stringify(b.typeset === null ? null : headingsOf(b.typeset))})`,
    );
    check(
      "2",
      "no_range_b",
      b.typeset !== null &&
        [b.typeset, b.zip.md ?? "", b.zip.txt ?? ""].every(
          (text) => !text.includes(RANGE_2_TO_4),
        ),
      "no line names the range from page 2 to page 4",
    );
    check(
      "2",
      "zip_identity",
      a.zip.txt !== null && a.zip.txt === b.zip.txt,
      "arm A's translation.txt equals arm B's",
    );

    // (3) POSITIVE CONTROL
    const sentAll = sentText(all);
    check(
      "3",
      "control_sent",
      all.outcome.stage === "delivered" &&
        [2, 3, 4, 5].every((n) =>
          tokensOf(n).every((t) => sentAll.includes(t)),
        ),
      `no pages: delivered (stage ${all.outcome.stage}) and the provider saw pages 2, 3, 4 and 5`,
    );
    check(
      "3",
      "control_manifest",
      all.zip.manifest !== null &&
        all.zip.manifest.source !== undefined &&
        !("pagesSent" in all.zip.manifest.source),
      "no pages: the manifest has no source.pagesSent",
    );

    // (4) BEYOND
    const error =
      beyond.outcome.stage === "failed" ? beyond.outcome.result.error : null;
    check(
      "4",
      "beyond",
      error !== null &&
        error.code === "unprocessable_entity" &&
        error.retryable === false &&
        beyond.requests.length === 0,
      `pages [[6,6]] fails as ${error?.code ?? beyond.outcome.stage} (retryable ${String(error?.retryable)}) with ${beyond.requests.length} provider calls (need 0)`,
    );
    // Which refusal: the code above is shared with the chosen-pages no-text
    // refusal, so only the message tells them apart (see the header).
    const kind =
      error === null
        ? beyond.outcome.stage
        : error.message === BEYOND_MESSAGE
          ? "pages_out_of_range"
          : error.message === NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["translate-pdf"]
            ? "chosen-pages no_text"
            : "another refusal";
    check(
      "4",
      "beyond_kind",
      BEYOND_MESSAGE !== NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["translate-pdf"] &&
        kind === "pages_out_of_range",
      `pages [[6,6]] is the out-of-range refusal, told apart from the chosen-pages no-text refusal (${kind})`,
    );

    // (5) CONTROL: the two readers tell the arms apart.
    check(
      "5",
      "control_headings",
      a.typeset !== null &&
        b.typeset !== null &&
        !headedPageByPage(b.typeset) &&
        !headedByChosenList(a.typeset),
      "arm A's heading predicate fails on arm B's text, and arm B's on arm A's",
    );

    return { ok: failed.length === 0, failed, lines };
  } catch {
    return {
      ok: false,
      failed: [...failed, "throw"],
      lines: [...lines, "FAIL (throw) the probe threw"],
    };
  }
}

/**
 * The probe over THIS image's real Translate extractor and production limits,
 * on `env`: the verdict the heartbeat publishes and the CI step prints.
 */
export async function runTranslatePageRangeProof(
  env: EnvSource = process.env,
): Promise<PageRangeVerdict> {
  const deps = translateDeps(env);
  return probeTranslatePageRange({
    ...(deps.extract ? { extract: deps.extract } : {}),
    ...(deps.limits ? { limits: deps.limits } : {}),
    env,
  });
}

/**
 * The heartbeat's `translatePageRange`: {@link runTranslatePageRangeProof}'s
 * verdict. No extractor, any throw: `false`.
 */
export async function provesTranslatePageRange(
  env: EnvSource = process.env,
): Promise<boolean> {
  try {
    const verdict = await runTranslatePageRangeProof(env);
    return verdict.ok;
  } catch {
    return false;
  }
}
