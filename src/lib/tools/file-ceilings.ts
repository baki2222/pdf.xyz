import { getToolInputKind } from "@/lib/jobs/capabilities";
import { JOB_LIMITS } from "@/lib/jobs/types";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { getRunnerKind, type RunnerKind } from "@/lib/pdf/registry";
import {
  WORKER_ENGINE_FILE_CEILINGS,
  workerFileCeilingBytes,
} from "@/lib/workers/engine-file-ceilings";
import { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES } from "./limits";
import type { Tool } from "./types";

/**
 * ONE ceiling per tool: the byte cap a tool's page states IS the byte cap the
 * thing that runs that tool refuses with.
 *
 * `Tool` carried human-readable `accept` labels and nothing about size, so
 * every size a tool page could state came from one global figure. The tool
 * page's staging hint interpolated `JOB_LIMITS.maxFileBytes` — the WORKER's
 * per-file limit, 100 MB — for any tool at all, and the FAQ answered *"How
 * large can my file be?"* from the same constant for every tool that reached
 * that branch. Neither number was per-tool, so both were right by coincidence
 * and could only stay right by coincidence: the caps that actually refuse the
 * work are 25 MB per image (`MAX_IMAGE_BYTES`, `image-to-pdf`) and 2 MB of
 * source text (`MAX_SOURCE_BYTES`, `text-to-pdf` / `markdown-to-pdf`) — 4x and
 * 50x smaller, and overstating a cap always errs toward letting someone start
 * work they cannot finish.
 *
 * `limits.ts` already wrote down why this must not be two numbers that merely
 * happen to agree; that reasoning covered the engines and stopped at the
 * catalogue. This module carries it the last hop, to the page.
 *
 * WHY THIS IS DERIVED AND NOT A FIELD ON EVERY CATALOGUE ENTRY. A per-tool
 * `maxFileBytes:` written out fifty times is precisely the shape `limits.ts`
 * forbids — a second, independently maintained number beside the enforced one,
 * with nothing but review standing between them. The relationship already
 * exists in artifacts the app depends on to RUN, so it is read from those:
 *
 *  - `getRunnerKind(slug)` — the registry the tool page itself dispatches on to
 *    decide whether an in-browser runner mounts at all. A tool with a runner is
 *    gated in the browser, by that runner's constant.
 *  - {@link RUNNER_FILE_CEILINGS} keyed by `RunnerKind` — a `Record` over the
 *    union, so a new runner kind cannot compile until its ceiling is stated.
 *    Which constant each kind names is checked against the runner's own gate
 *    source in `file-ceilings.test.ts`; the compiler enforces coverage, the
 *    guard enforces correctness.
 *  - `getToolInputKind(slug)` — the same function `parseCreateUploadSessionRequest`
 *    uses to refuse uploads for a URL tool. A tool with no file input has no
 *    per-file ceiling to state, and `null` here is that fact, not a default.
 *  - everything else is worker-tier, and there the ceiling is the TIGHTER of
 *    two gates: `JOB_LIMITS.maxFileBytes`, which `evaluateIntake` and the
 *    worker store compare every upload against, and the input limit of the
 *    engine the worker routes the tool to — read through
 *    `workerFileCeilingBytes`, the same function the upload API refuses a
 *    session with. Until 2026-09-27 this branch returned the global cap alone,
 *    so Word, Excel and PowerPoint to PDF promised 100 MB against LibreOffice's
 *    50, and HTML to PDF 100 against Chromium's 20. The global cap is the
 *    FIRST gate a file meets; a page has to state the tightest one it must
 *    pass. The upload validator refuses above the same figure, so a file the
 *    page says is too big never moves. `worker-engine-ceilings.test.ts` walks
 *    the worker's own wiring to hold that for every engine, not only the two
 *    that bind today, and `worker-engine-ceilings-declared.test.ts` walks every
 *    `*native-config.ts` so an engine the daemon does not wire yet is seen too.
 *    When the engine is the lower refusal the result also names it
 *    ({@link ENGINE_INPUT_CEILINGS}), so a page can say which thing turns the
 *    file away.
 */

/**
 * Per-runner input ceiling: the constant that runner's own file gate compares
 * against, and the one its rejection message quotes.
 *
 * `Record<RunnerKind, number>` is deliberate — the union lives beside the
 * `RUNNERS` map in `@/lib/pdf/registry`, so adding a runner without a ceiling
 * is a type error rather than a page quietly stating someone else's number.
 */
export const RUNNER_FILE_CEILINGS: Record<RunnerKind, number> = {
  merge: MAX_PDF_BYTES,
  split: MAX_PDF_BYTES,
  rotate: MAX_PDF_BYTES,
  "delete-pages": MAX_PDF_BYTES,
  "extract-pages": MAX_PDF_BYTES,
  organize: MAX_PDF_BYTES,
  compress: MAX_PDF_BYTES,
  "pdf-to-text": MAX_PDF_BYTES,
  "pdf-to-markdown": MAX_PDF_BYTES,
  "text-to-pdf": MAX_SOURCE_BYTES,
  "markdown-to-pdf": MAX_SOURCE_BYTES,
  "image-to-pdf": MAX_IMAGE_BYTES,
  "pdf-to-image": MAX_PDF_BYTES,
  "page-numbers": MAX_PDF_BYTES,
  watermark: MAX_PDF_BYTES,
  "header-footer": MAX_PDF_BYTES,
  crop: MAX_PDF_BYTES,
  sign: MAX_PDF_BYTES,
  flatten: MAX_PDF_BYTES,
  overlay: MAX_PDF_BYTES,
  grayscale: MAX_PDF_BYTES,
  redact: MAX_PDF_BYTES,
  "fill-forms": MAX_PDF_BYTES,
  "create-forms": MAX_PDF_BYTES,
  annotate: MAX_PDF_BYTES,
  edit: MAX_PDF_BYTES,
  "extract-images": MAX_PDF_BYTES,
  compare: MAX_PDF_BYTES,
  scan: MAX_IMAGE_BYTES,
  metadata: MAX_PDF_BYTES,
  resize: MAX_PDF_BYTES,
  "n-up": MAX_PDF_BYTES,
};

/**
 * The worker's GLOBAL per-file cap: what any worker-tier upload is refused
 * above, at the API and in the store. A tool whose engine refuses lower states
 * that engine's number instead (see {@link toolFileCeiling}).
 */
export const WORKER_FILE_CEILING = JOB_LIMITS.maxFileBytes;

/**
 * The engine's display name for each worker processor that can refuse below
 * the upload gate — keyed by `WORKER_ENGINE_FILE_CEILINGS`, so a processor
 * added there cannot compile until it is named here.
 */
const ENGINE_NAMES: Readonly<
  Record<keyof typeof WORKER_ENGINE_FILE_CEILINGS, string>
> = {
  "office-conversion": "LibreOffice",
  "html-render": "Chromium",
};

/**
 * Worker engines that refuse an input BELOW the upload gate, by tool: the
 * engine's own default `maxInputBytes` and its name.
 *
 * Added 2026-09-27 after a review of the tool-page content. The Word, Excel,
 * PowerPoint and HTML pages stated "Up to 100 MB per file" (this module's
 * ceiling, then the upload gate alone) and, a few lines higher, "the converter
 * refuses a Word file over 50 MB" — both in the FAQPage JSON-LD. The second was
 * true; the first was the gate, not the ceiling. A guard class had been added
 * that called the 50 MB and 20 MB "NOT the per-file ceiling of the file the
 * reader picks", which is exactly what they are; it licensed the false figure
 * and was removed in the same change as this table.
 *
 * DERIVED, not typed: the same defect was fixed in parallel by
 * `@/lib/workers/engine-file-ceilings`, whose `workerFileCeilingBytes` the
 * upload API refuses a session with. Two hand-kept tables of the same caps
 * drift, so this one is read out of that one — each processor's own tool list
 * and default — keeping only tools that take a file (a URL tool such as
 * Webpage to PDF has no per-file ceiling to state). `file-ceilings.test.ts`
 * holds it to every worker config whose default cap is below the gate, in both
 * directions.
 *
 * These are DEFAULTS: the worker's env can RAISE each
 * (`PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES`, `PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES`)
 * but never lower it below the published figure.
 */
export const ENGINE_INPUT_CEILINGS: Readonly<
  Record<string, { readonly engine: string; readonly bytes: number }>
> = Object.fromEntries(
  (
    Object.entries(WORKER_ENGINE_FILE_CEILINGS) as [
      keyof typeof WORKER_ENGINE_FILE_CEILINGS,
      (typeof WORKER_ENGINE_FILE_CEILINGS)[keyof typeof WORKER_ENGINE_FILE_CEILINGS],
    ][]
  ).flatMap(([id, entry]) =>
    entry.tools
      .filter((slug) => getToolInputKind(slug) !== "url")
      .map((slug) => [slug, { engine: ENGINE_NAMES[id], bytes: entry.bytes }]),
  ),
);

/**
 * Where a tool's ceiling comes from. The tier is carried, not just the number,
 * so a surface can say *which* thing refuses the file and a guard can check the
 * classification rather than only the value.
 */
export type ToolFileCeiling =
  | {
      readonly tier: "in-browser";
      readonly runner: RunnerKind;
      readonly bytes: number;
    }
  | {
      readonly tier: "worker";
      readonly bytes: number;
      /** Set when the engine, not the upload gate, is the lower refusal. */
      readonly engine?: string;
    }
  | { readonly tier: "no-file-input"; readonly bytes: null };

export function toolFileCeiling(tool: Tool): ToolFileCeiling {
  // Asked FIRST: a URL tool has no per-file ceiling to overstate, and the API
  // refuses its uploads outright. This is the one named exception.
  if (getToolInputKind(tool.slug) === "url") {
    return { tier: "no-file-input", bytes: null };
  }
  const runner = getRunnerKind(tool.slug);
  if (runner) {
    return { tier: "in-browser", runner, bytes: RUNNER_FILE_CEILINGS[runner] };
  }
  const bytes = workerFileCeilingBytes(tool.slug);
  const engine = Object.hasOwn(ENGINE_INPUT_CEILINGS, tool.slug)
    ? ENGINE_INPUT_CEILINGS[tool.slug]
    : undefined;
  // The engine is named only when it IS the refusal the figure states.
  if (engine && engine.bytes === bytes && bytes < WORKER_FILE_CEILING) {
    return { tier: "worker", bytes, engine: engine.engine };
  }
  return { tier: "worker", bytes };
}

/** The tool's ceiling in bytes, or `null` when it takes no file at all. */
export function toolFileCeilingBytes(tool: Tool): number | null {
  return toolFileCeiling(tool).bytes;
}

/**
 * The ceiling in whole megabytes — the unit every one of these surfaces states
 * it in. Every constant it can return is an exact multiple of a mebibyte today, so this
 * neither rounds a cap up (advertising bytes the gate refuses) nor down.
 */
export function toolFileCeilingMb(tool: Tool): number | null {
  const bytes = toolFileCeilingBytes(tool);
  return bytes === null ? null : Math.round(bytes / (1024 * 1024));
}

/**
 * What a panel says when a picked file is over the tool's ceiling, BEFORE it
 * uploads anything — the same figure the page states, so the refusal can
 * never disagree with the promise. `null` when the file fits (or the tool
 * takes no file).
 */
export function fileOverCeilingMessage(
  tool: Tool,
  size: number,
): string | null {
  const bytes = toolFileCeilingBytes(tool);
  if (bytes === null || size <= bytes) return null;
  return `This file is larger than ${toolFileCeilingMb(tool)} MB, the most ${tool.name} accepts.`;
}

/**
 * The caption a tool page's staging drop zone shows: what this tool accepts,
 * and the cap it refuses above.
 *
 * The same move as `acceptHint()` in `@/components/upload/accepted-kinds` — one
 * source behind both halves of a drop zone's promise — narrowed to a page that
 * is about exactly one tool, so the formats come from `tool.accept` and the cap
 * from that tool's own gate rather than from the widest kind on the homepage.
 *
 * It lives here, not inline in a page, so it can be RENDERED through the drop
 * primitive (a guide's desk) by a test for all fifty tools. Shown under every
 * guide's desk since WP-07 (`src/app/guides/[slug]/page.tsx`), for the tool
 * the guide teaches; before that no page showed it — the
 * tool page's staging branch rendered for no tool and was removed (WP-06),
 * and the home page's zone became the desk (WP-05) — which is why the test
 * renders it for every tool rather than waiting for a page to.
 */
export function stagingHint(tool: Tool): string {
  const formats = tool.accept.join(", ");
  const mb = toolFileCeilingMb(tool);
  return mb === null
    ? `Accepts ${formats}`
    : `Accepts ${formats} · Max ${mb} MB per file`;
}
