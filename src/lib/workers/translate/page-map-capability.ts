/**
 * Does THIS worker image head a multi-page chunk's reflowed PDF page by page
 * when the model keeps the page markers, and by range when it does not?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Slice 4 of competitor-audit backlog #29 puts a marker line between pages
 * inside each sent chunk (`./page-markers`), verifies the reply's markers
 * (`./page-map`), and prints one "Page N" section per page of a verified
 * chunk, or the chunk's "Pages a–b" range when the reply did not verify.
 * Merging that is not shipping it: the web tier auto-deploys and the worker
 * image is rebuilt and redeployed separately (CLAUDE.md rule 5). The
 * heartbeat key `translatePageMap` is published from THIS proof, run at the
 * daemon's start-up on the image's own `pdftotext` and Chromium. An image
 * built before the key does not contain this module, publishes nothing, and
 * the absence parses as `false`.
 *
 * ── WHAT IT RUNS ─────────────────────────────────────────────────────────────
 *
 * A three-page Letter PDF generated in memory (`./probe-pdf`,
 * {@link PAGE_MAP_PROBE_PAGES}: one short paragraph per page, each with
 * tokens no other page holds, all three in ONE chunk — so no part clause, the
 * commonest marked case) as two `translate-pdf` jobs through
 * `runThroughExecutorOrder` (registry → soundness → processor → manifest
 * gate). NOT `proveThroughExecutorOrder`: it returns `artifacts[0]`, the ZIP,
 * and is blind to the PDF by construction. The PDF is selected from
 * `result.artifacts` by its content type.
 *
 *  - the extractor is the image's real Translate extractor, so page numbering
 *    is poppler's positional numbering;
 *  - the PDF dep is the image's real renderer, and the target is DERIVED from
 *    the languages this image proved it can print ({@link pageMapProbeTarget}),
 *    never typed;
 *  - ARM A's provider echoes the delimited segment verbatim, markers and all;
 *  - ARM B's provider returns it with every `separatorFor(n)` put back to
 *    `PAGE_JOIN`, built from `./page-markers` itself, never a typed pattern.
 *
 * ── THE READER IS NOT THE ENGINE ────────────────────────────────────────────
 *
 * Every check reads what a consumer receives, and EVERY check is evaluated
 * (no short-circuit): the verdict lists each one that failed, so a control
 * can say why it failed.
 *
 *  - `stage_a` / `stage_b`: each job was delivered;
 *  - `markers_sent`: arm A made exactly one request, and the lines of its
 *    segment that hold the brand (after NFKC) are exactly the strict marker
 *    lines for pages 2 and 3, in order;
 *  - `prompt_a`: that request's user message holds the marker instruction
 *    (`pageMarkerClause(2)`) OUTSIDE the delimited segment. An echo stub
 *    ignores the prompt, so without this an engine that sent markers with no
 *    instruction would publish the key;
 *  - `wire_a` / `wire_b`: `results.ai.pageMap` as persisted on the job record
 *    is exactly the expected block (A: one marked chunk, verified, 42 marker
 *    characters; B: one marked chunk, fell back as `missing`), and both D7
 *    invariants hold on it;
 *  - `pdf_a`: the PDF, read back with the SAME reader the engine's
 *    conservation check uses, holds "Page 1", P1's tokens, "Page 2", P2's,
 *    "Page 3", P3's — each heading once, each token once and under its own
 *    heading — and no "Pages" heading;
 *  - `pdf_b`: exactly one "Pages 1–3" heading, no "Page N", and P1's, P2's
 *    and P3's tokens after it in order (a fallback that heads an empty body
 *    is not a fallback that works);
 *  - `zip_identity`: arm A's `translation.txt` equals arm B's (the ZIP keeps
 *    main's shape whatever the model did with the markers, seen at the
 *    consumer);
 *  - `zip_content`: arm A's `translation.txt` holds every page's tokens in
 *    order. Without it, `zip_identity` and `zip_clean` pass over two empty
 *    ZIPs;
 *  - `zip_clean`: neither ZIP's `translation.md`/`.txt` nor either PDF's text
 *    holds /pdfxyz/i after NFKC with whitespace and `\p{Cf}` removed (no
 *    marker reaches a reader, even one with a broken brand);
 *  - `control`: the two PDFs read back differently, arm A's heading
 *    predicate FAILS on arm B's PDF text, and arm B's fails on arm A's. If
 *    the reader cannot tell the two apart, the probe has proved nothing.
 *
 * `pdf_unavailable` is the WHOLE verdict when there is no PDF dep, no reader,
 * no settled language set, or no provable target: there is no PDF to label,
 * so the key is false and no page claim is made. `throw` is the whole probe
 * throwing, or no extractor.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * A pass means: on this image, a multi-page chunk's PDF is headed page by
 * page when the model keeps the markers, and by range when it does not, and
 * the ZIP is the same either way. It does NOT mean a real model keeps the
 * markers (`results.ai.pageMap.verified / marked` on real jobs measures
 * that), that every target language keeps them, or that a page's words all
 * stay under its own heading when a model moves text across a marker.
 */
import JSZip from "jszip";
import { PAGE_JOIN } from "@/lib/pdf/text";
import {
  TRANSLATE_PDF_CI_REQUIRED,
  type TranslateLanguage,
} from "@/lib/jobs/translate-pdf";
import type { AiPageMapMeta } from "@/lib/jobs/ai-results";
import { sanitizeJobResults } from "@/lib/jobs/results";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import { runThroughExecutorOrder } from "../capability-chain";
import { resolveNativePdfTextReader } from "../pdf-text/native";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import {
  pageMarkerClause,
  type TranslateDeps,
  type TranslatePdfDeps,
} from "./engine";
import { translateDeps } from "./native";
import { translatePdfLanguages } from "./pdf-capability";
import { markerFor, separatorFor, separatorOverhead } from "./page-markers";
import {
  PAGE_MAP_PROBE_PAGES,
  pageMapProbePdf,
  type PageMapProbePage,
} from "./probe-pdf";
import type { TranslateExtractor } from "./reading-order";
import { delimitedSegment } from "./reading-order-capability";
import { pageRangeLabel } from "./typeset";

type EnvSource = Record<string, string | undefined>;

/** The probe's source language: its pages are English. */
export const PAGE_MAP_PROBE_SOURCE: TranslateLanguage = "en";

/** One check of the probe (see the module header). */
export type PageMapCheck =
  | "stage_a"
  | "stage_b"
  | "markers_sent"
  | "prompt_a"
  | "wire_a"
  | "wire_b"
  | "pdf_a"
  | "pdf_b"
  | "zip_identity"
  | "zip_content"
  | "zip_clean"
  | "control"
  | "pdf_unavailable"
  | "throw";

/** What one arm's job came to, for the proof script to print. No document text. */
export interface PageMapArmReport {
  readonly stage: string;
  readonly requests: number;
  readonly pageMap: AiPageMapMeta | null;
  /** The PDF text's lines that look like a heading ("Page N", "Pages a–b"). */
  readonly headings: readonly string[];
}

/** Every check that failed (`ok` iff none did), the derived target, and each arm. */
export interface PageMapVerdict {
  readonly ok: boolean;
  readonly failed: readonly PageMapCheck[];
  readonly target: TranslateLanguage | null;
  readonly arms: {
    readonly a: PageMapArmReport;
    readonly b: PageMapArmReport;
  } | null;
}

/** A provider's answer to one delimited segment. */
export type PageMapAnswer = (segment: string) => string;

export interface PageMapProbeDeps {
  /** The extractor under test: the image's Translate composite, in production. */
  readonly extract: TranslateExtractor | undefined;
  /** The image's reflowed-PDF renderer and its proven languages, or absent. */
  readonly pdf: TranslatePdfDeps | undefined;
  /** The engine's conservation-check reader (`resolveNativePdfTextReader`). */
  readonly readPdfText: ((bytes: Uint8Array) => Promise<string>) | undefined;
  /** Where the executor's default gates read their policy. */
  readonly env?: EnvSource;
  /** The probe's pages. Defaults to {@link PAGE_MAP_PROBE_PAGES}; tests only. */
  readonly pages?: readonly PageMapProbePage[];
  /**
   * How the registry is built from each arm's deps. Defaults to a registry
   * holding exactly the translate processor; tests swap it (no processor, a
   * provider seam that drops the prompt clause), and each must fail.
   */
  readonly registry?: (deps: TranslateDeps) => ProcessorRegistry;
  /** Arm A's model. Defaults to {@link echoAnswer}. */
  readonly answerA?: PageMapAnswer;
  /** Arm B's model. Defaults to {@link stripSeparatorsAnswer}. */
  readonly answerB?: PageMapAnswer;
}

/** Arm A: the delimited segment, verbatim. */
export const echoAnswer: PageMapAnswer = (segment) => segment;

/** Far above any page the probe has; separators are rebuilt, never matched by a typed pattern. */
const MAX_PAGE = 999;

/** Arm B: every `separatorFor(n)` put back to the `PAGE_JOIN` it replaced. */
export const stripSeparatorsAnswer: PageMapAnswer = (segment) => {
  let out = segment;
  for (let n = 1; n <= MAX_PAGE; n += 1)
    out = out.split(separatorFor(n)).join(PAGE_JOIN);
  return out;
};

/**
 * A third model, for the in-image proof's glued case: every `separatorFor(n)`
 * replaced by the marker GLUED between the two pages' words with its brand
 * broken by a zero-width space (review minors 1 and 5). The reply cannot
 * verify, so the chunk falls back to its range; what the proof reads is that
 * the real image's PDF and ZIP hold no trace of the broken brand.
 */
export const gluedBrokenBrandAnswer: PageMapAnswer = (segment) => {
  let out = segment;
  for (let n = 1; n <= MAX_PAGE; n += 1)
    out = out
      .split(separatorFor(n))
      .join(` <<<PDF${String.fromCharCode(0x200b)}XYZ_PAGE_${n}>>> `);
  return out;
};

/**
 * What the probe must report with {@link gluedBrokenBrandAnswer} as arm A,
 * sorted: arm A falls back (wire_a), its PDF is headed by range (pdf_a), the
 * two arms read alike (control), and its ZIP joins the pages with a space
 * where arm B's has a blank line (zip_identity). Never zip_clean: no trace
 * of the broken brand may reach a reader.
 */
export const GLUED_FAILED: readonly PageMapCheck[] = [
  "control",
  "pdf_a",
  "wire_a",
  "zip_identity",
];

/**
 * The target the probe prints, DERIVED: the first CI-required PDF language
 * this image proved it can print that is not the probe's source (the
 * translate job refuses source === target, and that list starts with "en").
 * Null when the set has not settled or holds no such language.
 */
export function pageMapProbeTarget(
  proven: ReadonlySet<TranslateLanguage> | null,
): TranslateLanguage | null {
  if (!proven) return null;
  return (
    TRANSLATE_PDF_CI_REQUIRED.find(
      (l) => l !== PAGE_MAP_PROBE_SOURCE && proven.has(l),
    ) ?? null
  );
}

/**
 * P5's predicate: NFKC of the whole text with every whitespace and format
 * (`\p{Cf}`) character removed, then /pdfxyz/i, so a brand a model broke with
 * a space or a zero-width character reads as the brand (review minor 1).
 */
const hasBrand = (text: string) =>
  /pdfxyz/i.test(text.normalize("NFKC").replace(/[\s\p{Cf}]/gu, ""));

const linesOf = (text: string) =>
  text
    .split(/[\r\n\f]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

const count = (text: string, token: string) => text.split(token).length - 1;

/** The index of the one line holding `token`, or -1 if it is on none or several. */
function lineOfToken(lines: readonly string[], token: string): number {
  const at = lines.flatMap((l, i) => (l.includes(token) ? [i] : []));
  return at.length === 1 ? at[0]! : -1;
}

/**
 * Arm A's predicate over PDF text: "Page 1" … "Page n" each on exactly one
 * line, in order; each page's tokens once in the whole text, on lines after
 * its own heading and before the next; no "Pages" heading.
 */
export function headedByPage(
  text: string,
  pages: readonly PageMapProbePage[] = PAGE_MAP_PROBE_PAGES,
): boolean {
  const lines = linesOf(text);
  if (lines.some((l) => /^Pages /.test(l))) return false;
  const headingAt: number[] = [];
  for (let n = 1; n <= pages.length; n += 1) {
    const at = lines.flatMap((l, i) => (l === pageRangeLabel([n]) ? [i] : []));
    if (at.length !== 1) return false;
    headingAt.push(at[0]!);
  }
  for (let i = 1; i < headingAt.length; i += 1)
    if (!(headingAt[i - 1]! < headingAt[i]!)) return false;
  return pages.every((page, i) =>
    page.tokens.every((token) => {
      if (count(text, token) !== 1) return false;
      const at = lineOfToken(lines, token);
      const next = headingAt[i + 1] ?? Infinity;
      return at > headingAt[i]! && at < next;
    }),
  );
}

/**
 * Arm B's predicate over PDF text: exactly one line is the chunk's range
 * heading, no line is a single-page heading, and every page's tokens occur
 * once, after that heading, in page order.
 */
export function headedByRange(
  text: string,
  pages: readonly PageMapProbePage[] = PAGE_MAP_PROBE_PAGES,
): boolean {
  const lines = linesOf(text);
  if (lines.some((l) => /^Page \d+$/.test(l))) return false;
  const range = pageRangeLabel(pages.map((_, i) => i + 1));
  const at = lines.flatMap((l, i) => (l === range ? [i] : []));
  if (at.length !== 1) return false;
  let last = at[0]!;
  for (const page of pages)
    for (const token of page.tokens) {
      if (count(text, token) !== 1) return false;
      const line = lineOfToken(lines, token);
      if (!(line > at[0]!) || line < last) return false;
      last = line;
    }
  return true;
}

/** Every page's tokens once in `text`, in page order. */
export function tokensInOrder(
  text: string,
  pages: readonly PageMapProbePage[] = PAGE_MAP_PROBE_PAGES,
): boolean {
  let last = -1;
  for (const page of pages)
    for (const token of page.tokens) {
      if (count(text, token) !== 1) return false;
      const at = text.indexOf(token);
      if (at <= last) return false;
      last = at;
    }
  return true;
}

/** The pageMap block a one-chunk probe job must persist, per arm. */
export function expectedPageMap(
  arm: "a" | "b",
  pageCount: number,
): AiPageMapMeta {
  let markerCharacters = 0;
  for (let n = 2; n <= pageCount; n += 1)
    markerCharacters += separatorOverhead(n);
  return {
    multiPageChunks: 1,
    marked: 1,
    verified: arm === "a" ? 1 : 0,
    unanswered: 0,
    fellBack: {
      collision: 0,
      budget: 0,
      missing: arm === "a" ? 0 : 1,
      order: 0,
      empty: 0,
    },
    markerCharacters,
  };
}

/** Both D7 invariants, on the record as persisted. */
export function pageMapInvariantsHold(m: AiPageMapMeta): boolean {
  const f = m.fellBack;
  return (
    m.marked + f.collision + f.budget === m.multiPageChunks &&
    m.verified + f.missing + f.order + f.empty + m.unanswered === m.marked
  );
}

/** Plain-data equality: same keys at every level, same leaves. */
function sameData(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || !a || !b)
    return Object.is(a, b);
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return (
    ka.length === kb.length &&
    ka.every(
      (k, i) =>
        k === kb[i] &&
        sameData(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}

const sameBlock = (a: AiPageMapMeta | null, b: AiPageMapMeta) =>
  a !== null && sameData(a, b);

interface ArmRun {
  readonly stage: string;
  readonly requests: readonly AiCompletionRequest[];
  readonly pageMap: AiPageMapMeta | null;
  readonly txt: string | null;
  readonly md: string | null;
  readonly pdfText: string | null;
}

function defaultRegistry(deps: TranslateDeps): ProcessorRegistry {
  return new ProcessorRegistry().register(createTranslateProcessor(deps));
}

async function zipEntry(
  artifacts: readonly { contentType: string; bytes: Uint8Array }[],
  name: string,
): Promise<string | null> {
  const zip = artifacts.find((a) => a.contentType === "application/zip");
  if (!zip) return null;
  const entry = (await JSZip.loadAsync(zip.bytes)).file(name);
  return entry ? entry.async("string") : null;
}

async function runArm(
  answer: PageMapAnswer,
  deps: PageMapProbeDeps,
  extract: TranslateExtractor,
  pdf: TranslatePdfDeps,
  readPdfText: (bytes: Uint8Array) => Promise<string>,
  input: Uint8Array,
  target: TranslateLanguage,
): Promise<ArmRun> {
  const requests: AiCompletionRequest[] = [];
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
  const build = deps.registry ?? defaultRegistry;
  const registry = build({
    extract,
    provider,
    pdf,
    now: () => "1970-01-01T00:00:00.000Z",
  });
  const outcome = await runThroughExecutorOrder({
    tool: "translate-pdf",
    input: {
      bytes: input,
      filename: "page-map-probe.pdf",
      contentType: "application/pdf",
    },
    options: { targetLanguage: target, sourceLanguage: PAGE_MAP_PROBE_SOURCE },
    registry,
    ...(deps.env ? { env: deps.env } : {}),
  });
  if (outcome.stage !== "delivered")
    return {
      stage: outcome.stage,
      requests,
      pageMap: null,
      txt: null,
      md: null,
      pdfText: null,
    };
  const artifacts = outcome.result.artifacts;
  const pdfArtifact = artifacts.find(
    (a) => a.contentType === "application/pdf",
  );
  return {
    stage: outcome.stage,
    requests,
    // As PERSISTED: through the one redaction boundary every job record's
    // write funnels through, so a block the whitelist drops reads as absent.
    pageMap: sanitizeJobResults(outcome.result.results)?.ai?.pageMap ?? null,
    txt: await zipEntry(artifacts, "translation.txt"),
    md: await zipEntry(artifacts, "translation.md"),
    pdfText: pdfArtifact ? await readPdfText(pdfArtifact.bytes) : null,
  };
}

const NL = "\n";
const OPEN = `${NL}---${NL}`;

function report(run: ArmRun): PageMapArmReport {
  return {
    stage: run.stage,
    requests: run.requests.length,
    pageMap: run.pageMap,
    headings:
      run.pdfText === null
        ? []
        : linesOf(run.pdfText).filter((l) => /^Pages? \d/.test(l)),
  };
}

const FAILED = (
  failed: PageMapCheck[],
  target: TranslateLanguage | null = null,
): PageMapVerdict => ({ ok: false, failed, target, arms: null });

/**
 * Run both arms and report every check that failed (see the module header).
 * Never throws: a throw anywhere is the verdict `failed: ["throw"]`.
 */
export async function probeTranslatePageMap(
  deps: PageMapProbeDeps,
): Promise<PageMapVerdict> {
  const { extract, pdf, readPdfText } = deps;
  if (!extract) return FAILED(["throw"]);
  if (!pdf || !readPdfText) return FAILED(["pdf_unavailable"]);
  try {
    const target = pageMapProbeTarget(pdf.languages());
    if (!target) return FAILED(["pdf_unavailable"]);
    const pages = deps.pages ?? PAGE_MAP_PROBE_PAGES;
    const input = await pageMapProbePdf(pages);
    const a = await runArm(
      deps.answerA ?? echoAnswer,
      deps,
      extract,
      pdf,
      readPdfText,
      input,
      target,
    );
    const b = await runArm(
      deps.answerB ?? stripSeparatorsAnswer,
      deps,
      extract,
      pdf,
      readPdfText,
      input,
      target,
    );

    const failed: PageMapCheck[] = [];
    if (a.stage !== "delivered") failed.push("stage_a");
    if (b.stage !== "delivered") failed.push("stage_b");

    const request = a.requests.length === 1 ? a.requests[0]! : null;
    const segment = request ? delimitedSegment(request) : null;
    const wantLines = pages.slice(1).map((_, i) => markerFor(i + 2));
    const brandLines =
      segment === null ? null : segment.split(NL).filter(hasBrand);
    if (
      brandLines === null ||
      brandLines.length !== wantLines.length ||
      brandLines.some((l, i) => l !== wantLines[i])
    )
      failed.push("markers_sent");

    const content = request
      ? request.messages.map((m) => m.content).join(NL)
      : null;
    const open = content === null ? -1 : content.indexOf(OPEN);
    if (
      content === null ||
      open < 0 ||
      !content.slice(0, open).includes(pageMarkerClause(2))
    )
      failed.push("prompt_a");

    const pageCount = pages.length;
    if (
      !sameBlock(a.pageMap, expectedPageMap("a", pageCount)) ||
      !pageMapInvariantsHold(a.pageMap!)
    )
      failed.push("wire_a");
    if (
      !sameBlock(b.pageMap, expectedPageMap("b", pageCount)) ||
      !pageMapInvariantsHold(b.pageMap!)
    )
      failed.push("wire_b");

    if (a.pdfText === null || !headedByPage(a.pdfText, pages))
      failed.push("pdf_a");
    if (b.pdfText === null || !headedByRange(b.pdfText, pages))
      failed.push("pdf_b");

    if (a.txt === null || b.txt === null || a.txt !== b.txt)
      failed.push("zip_identity");
    if (a.txt === null || !tokensInOrder(a.txt, pages))
      failed.push("zip_content");
    if (
      [a.txt, a.md, b.txt, b.md, a.pdfText, b.pdfText].some(
        (t) => t !== null && hasBrand(t),
      )
    )
      failed.push("zip_clean");

    if (
      a.pdfText === null ||
      b.pdfText === null ||
      a.pdfText === b.pdfText ||
      headedByPage(b.pdfText, pages) ||
      headedByRange(a.pdfText, pages)
    )
      failed.push("control");

    return {
      ok: failed.length === 0,
      failed,
      target,
      arms: { a: report(a), b: report(b) },
    };
  } catch {
    return FAILED(["throw"]);
  }
}

/**
 * The heartbeat's `translatePageMap`: the probe over THIS image's real
 * Translate extractor, its real reflowed-PDF renderer and the engine's own
 * `pdftotext` read-back, after the PDF-language memo (`./pdf-languages`) has
 * settled — the same promise the heartbeat's `translatePdfLanguages` awaits,
 * so no second language proof runs. No extractor, no renderer, no reader, no
 * provable target, any throw: `false`.
 */
export async function provesTranslatePageMap(
  env: EnvSource = process.env,
): Promise<boolean> {
  try {
    await translatePdfLanguages(env);
    const deps = translateDeps(env);
    const verdict = await probeTranslatePageMap({
      extract: deps.extract,
      pdf: deps.pdf,
      readPdfText: resolveNativePdfTextReader(env),
      env,
    });
    return verdict.ok;
  } catch {
    return false;
  }
}
