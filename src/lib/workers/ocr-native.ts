/**
 * The real, host-side implementation behind the OCR processor's injected
 * {@link OcrRunner}: a presence-only binary probe and a native OCR runner that
 * shells out to OCRmyPDF / Tesseract in an isolated temp directory.
 *
 * This is the OCR counterpart of `compression/native.ts`, and the ONLY OCR module
 * that touches Node built-ins (`fs`, `child_process`, …). It is pulled in
 * exclusively by the out-of-band daemon runtime (`daemon/runtime.ts`, a separate
 * Node process the web app never imports) and by its tests — never by a route,
 * component, barrel, or the client bundle. OCR deliberately does NOT run in the
 * in-process local-dev worker: turning a scan into a searchable PDF needs a native
 * engine, so it belongs on the secure worker only.
 *
 * Everything it does is driven by the typed, bounded {@link NativeOcrConfig} parsed
 * from the environment (`./ocr-native-config`):
 *  - OCR is **opt-in** (disabled unless an operator sets `PDFXYZ_OCR`) and may be
 *    **pinned** to one engine;
 *  - each engine is invoked by a fixed command name (auto-detected on PATH) or an
 *    allowlisted **absolute override path** (probed by existence, never executed
 *    during detection);
 *  - the runner uses a **fixed argv array** (no shell, no interpolation) over
 *    worker-owned temp paths (never a user-supplied path), a hard **timeout**, hard
 *    **input/output byte ceilings**, a structural PDF check on the searchable-PDF
 *    output, and **guaranteed temp-dir cleanup** on success, failure, and timeout.
 *
 * Honesty: it produces artifacts from ACTUAL recognition or throws a fixed,
 * content-free error — it never fabricates recognized text or a searchable PDF, and
 * it never leaks a path, filename, option value, or recognized text into an error.
 * The subprocess/filesystem/probe boundaries are all injectable seams, so every
 * branch is unit-tested without a real binary or child process.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildOcrResultMeta,
  OCR_LOW_CONFIDENCE_WORD_THRESHOLD,
  OCR_MAX_INPUT_FILES,
} from "@/lib/jobs/ocr";
import { sanitizeDisplayFilename } from "@/lib/jobs/filenames";
import { looksLikePdf } from "./compression/engine";
import { OCR_ENGINES, type OcrEngine, type OcrEngineAvailability } from "./ocr";
import { classifyOcrmypdfFailure, OcrEngineRefusal } from "./ocr-engine-errors";
import { fillSkippedSidecarPages, skippedSidecarPages } from "./ocr-sidecar";
import {
  resolveNativePdfTextExtractor,
  type PdfTextSeams,
} from "./pdf-text/native";
import {
  resolveNativeOcrConfig,
  type NativeOcrConfig,
} from "./ocr-native-config";
import type {
  OcrProcessorDeps,
  OcrRunner,
  OcrRunResult,
} from "./processor/ocr";
import type { ProcessorArtifact, ProcessorInputFile } from "./processor/types";
import { countPdfPages as countPdfPagesShared } from "@/lib/pdf/page-count";
import {
  rethrowIfAttemptAbort,
  signalOption,
  throwIfAttemptAborted,
  type RunControl,
} from "./attempt-abort";

/** stdout/stderr capture ceiling. Engines are `--quiet` and write to files, so this is generous. */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/** The searchable-PDF and text artifacts a completed OCR run yields. */
const PDF_CONTENT_TYPE = "application/pdf";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * Metadata measurement ceilings. Populating {@link OcrResultMeta} must never turn a
 * bounded worker into an unbounded one: we only STRUCTURALLY parse a produced PDF for
 * its page count, or decode a produced sidecar to count characters, when the artifact
 * is within these ceilings. Above them the count is honestly `null` ("not measured")
 * rather than fabricated or paid for with unbounded work. Both are well under the
 * config's output byte ceiling — this bounds the *metadata* pass, not the artifact.
 */
const META_PDF_MAX_PARSE_BYTES = 64 * 1024 * 1024;
const META_TEXT_MAX_MEASURE_BYTES = 32 * 1024 * 1024;
/**
 * Tesseract's TSV runs about 100 bytes per recognized word, so this ceiling covers
 * documents far larger than the worker's own output limit while still refusing to
 * parse a pathological file. Above it the confidence is honestly `null`.
 */
const META_TSV_MAX_PARSE_BYTES = 16 * 1024 * 1024;

/** Run a subprocess by argv (never a shell). Injectable so tests never spawn a real process. */
export type NativeOcrExec = (
  command: string,
  args: readonly string[],
  options: {
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    /** The attempt's abort signal: Node kills the child on abort. */
    signal?: AbortSignal;
  },
) => Promise<unknown>;

/** The temp-file operations the runner needs. Injectable for deterministic tests. */
export interface NativeOcrFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (
    dir: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
}

/** All the host seams the native OCR layer touches; each defaults to the real Node built-in. */
export interface NativeOcrSeams {
  /** Resolve whether a bare command exists on PATH (presence only; never executes). */
  resolveOnPath?: (binary: string) => boolean;
  /** Whether an absolute path exists and is a regular file (for override probing). */
  fileExists?: (filePath: string) => boolean;
  /** Subprocess runner. */
  exec?: NativeOcrExec;
  /** Temp-file operations. */
  fs?: NativeOcrFs;
  /**
   * Best-effort page counter for a produced searchable PDF (metadata only). Defaults
   * to {@link countPdfPages}, a bounded pdf-lib structural probe that returns `null`
   * (never throws) when the PDF can't be parsed. Injectable so tests are deterministic
   * without a real pdf-lib parse.
   */
  countPages?: (pdf: Uint8Array) => Promise<number | null>;
  /**
   * Read the text layer a PDF already carries, page by page — what fills the
   * pages OCRmyPDF skipped back into the text sidecar (see `./ocr-sidecar`).
   * Absent ⇒ the sidecar keeps OCRmyPDF's placeholder for those pages. The
   * runner has no default; {@link nativeOcrDeps} wires poppler's `pdftotext`
   * when the host has it.
   */
  readExistingText?: (
    pdf: Uint8Array,
    run?: RunControl,
  ) => Promise<{ pages: readonly { text: string }[] }>;
  /**
   * Seams for the `pdftotext` probe {@link nativeOcrDeps} uses to build
   * {@link readExistingText}. Only for tests that point it at a specific binary.
   */
  pdfText?: PdfTextSeams;
}

const runExecFile = promisify(execFile);
/** The real subprocess runner; exported so an abort test drives THIS function. */
export const defaultNativeOcrExec: NativeOcrExec = (command, args, options) =>
  runExecFile(command, [...args], options);

const defaultFs: NativeOcrFs = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  writeFile: (file, data) => writeFile(file, data),
  readFile: async (file) => new Uint8Array(await readFile(file)),
  rm: (dir, options) => rm(dir, options),
};

/** Is `filePath` an existing regular file? Swallows unreadable-path errors as "no". */
function isRegularFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Presence-only resolver: is `binary` an executable file on PATH? Never runs it.
 * Handles Windows PATHEXT so the probe is correct cross-platform. (Kept local to the
 * OCR native layer so importing it never pulls the compression subprocess module.)
 */
export function resolveOnPath(binary: string): boolean {
  const pathVar = process.env.PATH ?? "";
  if (pathVar.length === 0) return false;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir.length === 0) continue;
    for (const ext of exts) {
      if (isRegularFile(path.join(dir, binary + ext))) return true;
    }
  }
  return false;
}

/** Map an input content type to a safe, fixed temp-file extension for the engine. */
export function inputExtension(input: ProcessorInputFile): string {
  const type = input.contentType.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("tiff") || type.includes("tif")) return "tif";
  // OCRmyPDF's native input is a PDF; anything else (incl. an unknown type) is
  // written with a `.pdf` extension and left to the engine to accept or reject.
  return "pdf";
}

/** Where an engine writes its outputs, plus the argv that produces them. */
export interface NativeOcrInvocation {
  command: string;
  args: string[];
  /** Absolute path the searchable PDF lands at (read only when a PDF was requested). */
  pdfOut: string;
  /** Absolute path the text sidecar lands at (read only when text was requested). */
  txtOut: string;
  /**
   * Absolute path the per-word TSV lands at, or `null` for an engine that produces
   * none. Only Tesseract does: OCRmyPDF owns its own Tesseract sub-invocation and
   * writes into a private temp dir, so there is nothing here to read.
   *
   * Never published as an artifact — it is read for confidence figures and dropped
   * with the temp directory.
   */
  tsvOut: string | null;
}

/** Normalized inputs for {@link nativeOcrArgs} — all worker-owned, never user paths. */
export interface NativeOcrArgsContext {
  inputPath: string;
  /** The isolated temp dir; outputs are placed inside it. */
  workDir: string;
  languages: readonly string[];
  /** Replace an existing OCR text layer (`--redo-ocr`) instead of keeping it. */
  redoOcr: boolean;
  /**
   * Straighten skewed pages before recognition (`--deskew`). OCRmyPDF only;
   * never together with {@link redoOcr} (a usage error in OCRmyPDF).
   */
  deskew: boolean;
  /**
   * Turn sideways and upside-down pages upright before recognition
   * (`--rotate-pages`, at {@link OCR_ROTATE_PAGES_THRESHOLD}). OCRmyPDF only.
   */
  rotatePages: boolean;
  wantPdf: boolean;
  wantText: boolean;
}

/**
 * The confidence OCRmyPDF's orientation check (Tesseract OSD) must reach
 * before `--rotate-pages` turns a page: passed as `--rotate-pages-threshold`
 * with every `--rotate-pages`. Not offered in the panel.
 *
 * WHY NOT THE DEFAULT. OCRmyPDF 14's own threshold is 14, and at 14 the
 * option does nothing useful. Measured 2026-11-01 in a throwaway container
 * of the live worker image (OCRmyPDF 14.0.1, Tesseract with the `osd`
 * pack): on a full page of body text (30 lines) OSD named the orientation
 * correctly every time — turned 90°, 180° and 270° — but with a confidence
 * of 12.2 to 13.4, under 14, so OCRmyPDF logged "confidence too low to
 * rotate" and changed nothing. A box that does nothing to the very page it
 * exists for is a false claim, whatever the argv says.
 *
 * WHY 5. At `--rotate-pages-threshold 5`, the same sample:
 *  - full pages turned 90 / 180 / 270 came back with page `/Rotate` 90 /
 *    180 / 270, and their text was read (27 to 30 of 30 lines);
 *  - an upright full page was left at `/Rotate` 0;
 *  - a 3-line upside-down page (confidence 5.46) was turned 180;
 *  - a 3-line upright page was left alone;
 *  - a 1-line page (confidence 1.80) was left alone.
 * No page in that sample was turned the wrong way, and threshold 2 gave the
 * same results, so 5 is not balanced on an edge. A lower figure trades a
 * page left unturned for the risk of turning a page that was right; the
 * upright control in `pnpm worker:ocr-rotate-proof` (an upright page with
 * the option on must stay at `/Rotate` 0) is the guard on that side.
 */
export const OCR_ROTATE_PAGES_THRESHOLD = 5;

/**
 * Build the fixed argument list for a native OCR engine. `command` is the resolved
 * invocation (a bare command name or an allowlisted override path); every path is a
 * separate argv element — there is no shell, no string concatenation of a command
 * line, and no user-supplied path, so filenames and options can never be
 * interpreted as flags or shell syntax.
 *
 *  - **OCRmyPDF** takes a PDF in and always writes a searchable PDF out; a text
 *    sidecar is produced with `--sidecar`. `--output-type pdf` avoids the PDF/A
 *    path (which would additionally require Ghostscript). Exactly ONE of
 *    `--skip-text` (the default: a page that already has text is kept as it is)
 *    or `--redo-ocr` (the opt-in: invisible OCR text is replaced, typed text is
 *    kept) is always passed. Passing neither is not a neutral default — OCRmyPDF
 *    then aborts the whole job on the first page with text (exit 6) or on a
 *    tagged PDF, which is what every "searchable" scan and office export used to
 *    hit. Passing both is a usage error. `--force-ocr` is never passed: it
 *    rasterizes every page and destroys vector text.
 *
 *    `--deskew` is passed only when asked (since 2026-11-01; until then this
 *    said "no `--deskew`", and the page said nothing straightens). It acts on
 *    the pages OCRmyPDF recognizes — under `--skip-text` a page with text is
 *    copied through and is NOT straightened — and a straightened page's
 *    image is re-rendered, not copied. OCRmyPDF rejects `--redo-ocr` with
 *    `--deskew` as a usage error, so the pair throws here rather than being
 *    resolved by dropping one; `parseOcrOptions` refuses it first, with the
 *    reason, so this is the backstop and never the user's message.
 *
 *    `--rotate-pages` is passed only when asked (since 2026-11-01; until then
 *    the OCR page said nothing turns a sideways page upright), always with
 *    `--rotate-pages-threshold` {@link OCR_ROTATE_PAGES_THRESHOLD}, because
 *    at OCRmyPDF's default threshold it turns nothing (see the constant).
 *    It sets a page's `/Rotate` rather than redrawing it, acts only on the
 *    pages OCRmyPDF recognizes (a text page under `--skip-text` is copied
 *    through), and is accepted beside `--redo-ocr` and `--deskew`.
 *  - **Tesseract** OCRs an image and writes `<base>.pdf` / `<base>.txt` selected by
 *    trailing `pdf`/`txt` config tokens. An image has no text layer, so neither
 *    text flag applies to it, and Tesseract has no deskew step, so `deskew`
 *    passes nothing here (the panel disables it for an image). Nor does
 *    `rotatePages`: this Tesseract call runs no orientation step, and a
 *    forged job asking for one is read as it is.
 */
export function nativeOcrArgs(
  engine: OcrEngine,
  command: string,
  ctx: NativeOcrArgsContext,
): NativeOcrInvocation {
  const lang = ctx.languages.join("+");
  switch (engine) {
    case "ocrmypdf": {
      if (ctx.deskew && ctx.redoOcr) {
        throw new Error("OCR deskew cannot be combined with redo OCR.");
      }
      const pdfOut = path.join(ctx.workDir, "output.pdf");
      const txtOut = path.join(ctx.workDir, "output.txt");
      const args = [
        "--language",
        lang,
        "--output-type",
        "pdf",
        ctx.redoOcr ? "--redo-ocr" : "--skip-text",
        ...(ctx.deskew ? ["--deskew"] : []),
        ...(ctx.rotatePages
          ? [
              "--rotate-pages",
              "--rotate-pages-threshold",
              String(OCR_ROTATE_PAGES_THRESHOLD),
            ]
          : []),
        ...(ctx.wantText ? ["--sidecar", txtOut] : []),
        "--quiet",
        ctx.inputPath,
        pdfOut,
      ];
      return { command, args, pdfOut, txtOut, tsvOut: null };
    }
    case "tesseract": {
      const base = path.join(ctx.workDir, "output");
      const pdfOut = `${base}.pdf`;
      const txtOut = `${base}.txt`;
      const args = [
        ctx.inputPath,
        base,
        "-l",
        lang,
        ...(ctx.wantPdf ? ["pdf"] : []),
        ...(ctx.wantText ? ["txt"] : []),
        // Every renderer is served by ONE recognition pass, so asking for the TSV
        // costs serialization only — no second OCR, no second subprocess. It is what
        // makes a confidence figure available at all; without it a wrong-language run
        // returns fluent nonsense with nothing to signal it.
        "tsv",
      ];
      return { command, args, pdfOut, txtOut, tsvOut: `${base}.tsv` };
    }
  }
}

/** Whether an engine is usable under a config (pin + enable + override existence / PATH). */
function engineUsable(
  engine: OcrEngine,
  config: NativeOcrConfig,
  seams: NativeOcrSeams,
): boolean {
  if (!config.enabled) return false;
  if (config.engine && config.engine !== engine) return false;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  return config.overridden[engine]
    ? fileExists(config.binaries[engine])
    : onPath(config.binaries[engine]);
}

/** The first usable OCR engine in preference order, or null when none is available. */
export function firstUsableOcrEngine(
  config: NativeOcrConfig,
  seams: NativeOcrSeams = {},
): OcrEngine | null {
  return (
    OCR_ENGINES.find((engine) => engineUsable(engine, config, seams)) ?? null
  );
}

/**
 * Whether an input is a raster image rather than a PDF, decided from the same
 * content-type mapping the temp-file extension uses so the two can never disagree.
 */
export function isImageInput(input: ProcessorInputFile): boolean {
  const ext = inputExtension(input);
  return ext === "png" || ext === "jpg" || ext === "tif";
}

/**
 * Which engine can actually handle THIS input, or null when none installed here can.
 *
 * The two engines are not interchangeable, and the tool accepts both kinds of input:
 * OCRmyPDF is PDF-in/PDF-out and rejects a raster outright, while Tesseract reads an
 * image. Picking by a fixed preference order alone ignored that — with both engines
 * installed, OCRmyPDF always won, so every PNG and JPG upload died in the engine and
 * surfaced as "The OCR engine could not process this file". The tool advertises
 * `PDF, JPG, PNG`; two of the three were broken.
 *
 * Order still matters within a kind: for a PDF, OCRmyPDF is preferred because it adds
 * an invisible text layer to the existing pages, which is the tool's actual promise —
 * Tesseract would rasterize and rebuild the document instead.
 */
export function engineForInput(
  input: ProcessorInputFile,
  config: NativeOcrConfig,
  seams: NativeOcrSeams = {},
): OcrEngine | null {
  const usable = (engine: OcrEngine) => engineUsable(engine, config, seams);
  // A raster can only be read by Tesseract; OCRmyPDF has no path for it.
  if (isImageInput(input)) return usable("tesseract") ? "tesseract" : null;
  // A PDF: OCRmyPDF preferred, and it is the only one that takes a PDF directly.
  return usable("ocrmypdf") ? "ocrmypdf" : null;
}

/**
 * Probe which OCR engines are actually usable under a configuration:
 *  - a disabled config yields no engines (the opt-in switch is off);
 *  - a pinned config considers only that engine;
 *  - an overridden engine is probed by absolute-path existence, an auto-detected one
 *    by PATH presence.
 * Presence only — nothing is executed.
 */
export function probeNativeOcrEnginesFromConfig(
  config: NativeOcrConfig,
  seams: NativeOcrSeams = {},
): OcrEngineAvailability {
  return {
    ocrmypdf: engineUsable("ocrmypdf", config, seams),
    tesseract: engineUsable("tesseract", config, seams),
  };
}

/** Deterministic output base name for OCR artifacts: sanitized input basename, extension dropped. */
function ocrOutputBase(displayName: string): string {
  const safe = sanitizeDisplayFilename(displayName);
  const dot = safe.lastIndexOf(".");
  return (dot > 0 ? safe.slice(0, dot) : safe) || "document";
}

/**
 * Best-effort structural page count of a produced searchable PDF, for
 * {@link OcrResultMeta}. Bounded (skips a very large PDF) and total: it NEVER throws
 * and returns `null` on an empty/oversized/unparseable input, so a missing page count
 * is honestly `null` rather than a fabricated number. The bytes here are the OCR
 * engine's own output (already validated as a PDF), not raw user input.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  // Delegates since 2026-08-11. This was a second, subtly different copy of the
  // same parse: it lacked `ignoreEncryption`, so a protected PDF read as "no
  // count", and it collapsed unparseable / too-large / zero-pages into one
  // `null` — three facts a gate has to tell apart. OCR only needs the hint, so
  // it keeps the lossy shape; it no longer keeps its own parser.
  return countPdfPagesShared(bytes, META_PDF_MAX_PARSE_BYTES);
}

/**
 * Count the characters in a produced text sidecar for {@link OcrResultMeta}. Returns a
 * COUNT ONLY — the decoded text is never returned, logged, or retained. Bounded: a
 * sidecar above the measure ceiling reports `null` ("not measured") rather than
 * decoding an unbounded string. `0` bytes ⇒ `0` characters.
 */
export function countTextCharacters(bytes: Uint8Array): number | null {
  if (bytes.byteLength === 0) return 0;
  if (bytes.byteLength > META_TEXT_MAX_MEASURE_BYTES) return null;
  try {
    // Decode only to measure length, then drop the string — nothing is retained.
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).length;
  } catch {
    return null;
  }
}

/**
 * Read the confidence figures for a run, or an all-null triple when there are none.
 * Swallows every failure by design — see the call site.
 */
async function readConfidence(
  fs: NativeOcrFs,
  tsvOut: string | null,
): Promise<{
  meanConfidence: number | null;
  lowConfidenceWordRatio: number | null;
  recognizedWords: number | null;
}> {
  const none = {
    meanConfidence: null,
    lowConfidenceWordRatio: null,
    recognizedWords: null,
  };
  if (!tsvOut) return none;
  try {
    return parseTesseractConfidence(await fs.readFile(tsvOut)) ?? none;
  } catch {
    return none;
  }
}

/** The confidence figures a Tesseract TSV yields. Numbers only — never a word. */
export interface TesseractConfidence {
  /** Mean per-word confidence, converted to [0, 1]. */
  meanConfidence: number;
  /** Share of words below {@link OCR_LOW_CONFIDENCE_WORD_THRESHOLD}, in [0, 1]. */
  lowConfidenceWordRatio: number;
  /** How many words the figures cover. */
  recognizedWords: number;
}

/**
 * Read per-word confidence out of Tesseract's TSV renderer output.
 *
 * The format (Tesseract 4 and 5) is a header row followed by tab-separated rows of
 * `level page_num block_num par_num line_num word_num left top width height conf text`.
 * Only `level === 5` rows are words; everything above is layout structure and carries
 * `conf = -1`. Rows whose text is blank are dropped too — Tesseract emits them for
 * spacing, and counting them would drag the mean toward whatever it felt about
 * whitespace.
 *
 * Like {@link countTextCharacters}, this decodes only to measure: the `text` column is
 * recognized content and is never returned, logged, or retained. Returns `null` when
 * the file is missing, oversized, malformed, or contains no qualifying words — every
 * one of which means "not measured", never a fabricated score.
 *
 * **Units.** Tesseract reports confidence on 0-100 and the meta contract is [0, 1], so
 * the conversion happens here, once. Forgetting it would not raise an error anywhere:
 * `buildOcrResultMeta` would reject every real value as out of range and null the
 * field, putting it right back to permanently invisible.
 */
export function parseTesseractConfidence(
  bytes: Uint8Array,
): TesseractConfidence | null {
  if (bytes.byteLength === 0 || bytes.byteLength > META_TSV_MAX_PARSE_BYTES)
    return null;
  let total = 0;
  let words = 0;
  let low = 0;
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    for (const line of text.split("\n")) {
      const columns = line.split("\t");
      if (columns.length < 12 || columns[0] !== "5") continue;
      const confidence = Number(columns[10]);
      // `-1` marks a non-word row; a blank word is layout, not recognition.
      if (!Number.isFinite(confidence) || confidence < 0) continue;
      if (columns.slice(11).join("\t").trim() === "") continue;
      total += confidence;
      words += 1;
      if (confidence < OCR_LOW_CONFIDENCE_WORD_THRESHOLD) low += 1;
    }
  } catch {
    return null;
  }
  if (words === 0) return null;
  return {
    meanConfidence: total / words / 100,
    lowConfidenceWordRatio: low / words,
    recognizedWords: words,
  };
}

/**
 * Put the text of the pages OCRmyPDF skipped (they already had text) into its
 * sidecar in place of the `[OCR skipped on page N]` placeholders. See
 * `./ocr-sidecar` for why, and for the rules that keep it from misplacing a page.
 *
 * Best-effort and never fatal, like the confidence read: no reader wired, a
 * reader that throws, or pages that cannot be mapped all return the sidecar as
 * OCRmyPDF wrote it — a job that produced good output must not fail because it
 * could not be improved. The reader is not called at all when nothing was
 * skipped, so a pure scan pays nothing.
 */
async function fillSkippedPages(
  sidecar: Uint8Array,
  inputPdf: Uint8Array,
  readExistingText: NativeOcrSeams["readExistingText"],
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (!readExistingText || sidecar.byteLength > META_TEXT_MAX_MEASURE_BYTES) {
    return sidecar;
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(sidecar);
  if (skippedSidecarPages(text).length === 0) return sidecar;
  try {
    const existing = await readExistingText(inputPdf, signalOption(signal));
    const { text: filled, filled: pages } = fillSkippedSidecarPages(
      text,
      existing.pages.map((page) => page.text),
    );
    return pages.length > 0 ? new TextEncoder().encode(filled) : sidecar;
  } catch (error) {
    // Best-effort for a reader that failed; not for an attempt that is over.
    rethrowIfAttemptAbort(error);
    return sidecar;
  }
}

/**
 * Build a native OCR runner bound to a configuration. Writes the single input to an
 * isolated temp dir, invokes the engine with a fixed argv array, reads the requested
 * outputs, validates them, and ALWAYS removes the temp dir afterward — on success,
 * engine failure, or timeout. Throws a fixed, content-free error on any failure
 * (oversized input/output, empty or non-PDF output, subprocess error) so the OCR
 * processor records an honest job failure; it never returns fabricated bytes.
 */
export function createNativeOcrRunner(
  config: NativeOcrConfig,
  seams: NativeOcrSeams = {},
): OcrRunner {
  const exec = seams.exec ?? defaultNativeOcrExec;
  const fs = seams.fs ?? defaultFs;
  const countPages = seams.countPages ?? countPdfPages;
  const baseTmp = config.tmpDir ?? tmpdir();

  return async ({ options, inputs, signal }): Promise<OcrRunResult> => {
    throwIfAttemptAborted(signal);
    const input = inputs[0];
    // OCR runs over a single document; the processor refuses more before this,
    // and the tool page states the same number.
    if (inputs.length > OCR_MAX_INPUT_FILES || !input) {
      throw new Error("OCR accepts exactly one input file.");
    }
    // Backstop the input ceiling here too, in case a caller reaches the runner
    // without an engine-level guard. Deterministic → recorded as a failure.
    if (input.bytes.byteLength > config.maxInputBytes) {
      throw new Error("Input exceeds the configured maximum size.");
    }
    // Chosen from the INPUT KIND, not a fixed preference: OCRmyPDF cannot read a
    // raster and Tesseract cannot take a PDF, and this tool accepts both.
    const engine = engineForInput(input, config, seams);
    if (!engine) {
      // Some engine is installed (the processor checks that before invoking us) but
      // not one that can read this kind of file. Say which kind, so the failure is
      // about our missing engine rather than the user's document.
      throw new Error(
        isImageInput(input)
          ? "No OCR engine on this worker can read an image input."
          : "No OCR engine on this worker can read a PDF input.",
      );
    }

    const wantPdf =
      options.outputMode === "searchable-pdf" || options.outputMode === "both";
    const wantText =
      options.outputMode === "text" || options.outputMode === "both";

    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-ocr-"));
    const inputPath = path.join(dir, `input.${inputExtension(input)}`);
    try {
      await fs.writeFile(inputPath, input.bytes);
      const { command, args, pdfOut, txtOut, tsvOut } = nativeOcrArgs(
        engine,
        config.binaries[engine],
        {
          inputPath,
          workDir: dir,
          languages: options.languages,
          redoOcr: options.redoOcr,
          deskew: options.deskew,
          rotatePages: options.rotatePages,
          wantPdf,
          wantText,
        },
      );
      throwIfAttemptAborted(signal);
      try {
        await exec(command, args, {
          timeout: config.timeoutMs,
          maxBuffer: EXEC_MAX_BUFFER,
          windowsHide: true,
          ...signalOption(signal),
        });
      } catch (error) {
        // Before the refusal reading: an abort is neither the document's
        // fault nor a crash worth retrying.
        rethrowIfAttemptAbort(error);
        // A failure that belongs to the DOCUMENT (encrypted, signed, unreadable,
        // already has text) is thrown typed, so the processor can report it as
        // final with its next step instead of retrying it three times. Exit
        // statuses are per-program, so only OCRmyPDF's are read. Everything else
        // (a timeout, a crash) is rethrown untouched and stays retryable.
        const refusal =
          engine === "ocrmypdf" ? classifyOcrmypdfFailure(error) : null;
        if (refusal) throw new OcrEngineRefusal(refusal);
        throw error;
      }

      const base = ocrOutputBase(input.filename);
      const artifacts: ProcessorArtifact[] = [];

      if (wantPdf) {
        const pdf = await fs.readFile(pdfOut);
        if (
          pdf.byteLength === 0 ||
          pdf.byteLength > config.maxOutputBytes ||
          !looksLikePdf(pdf)
        ) {
          throw new Error("OCR produced no usable PDF output.");
        }
        artifacts.push({
          filename: `${base}-ocr.pdf`,
          contentType: PDF_CONTENT_TYPE,
          bytes: pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf),
        });
      }

      if (wantText) {
        let txt = await fs.readFile(txtOut);
        if (engine === "ocrmypdf") {
          txt = await fillSkippedPages(
            txt,
            input.bytes,
            seams.readExistingText,
            signal,
          );
        }
        if (txt.byteLength === 0 || txt.byteLength > config.maxOutputBytes) {
          throw new Error("OCR produced no usable text output.");
        }
        artifacts.push({
          filename: `${base}.txt`,
          contentType: TEXT_CONTENT_TYPE,
          bytes: txt instanceof Uint8Array ? txt : new Uint8Array(txt),
        });
      }

      if (artifacts.length === 0) {
        // outputMode always requests at least one artifact; a run yielding none is a
        // failure, never a fabricated success.
        throw new Error("OCR produced no output.");
      }

      // Derive the bounded, content-free result metadata from the artifacts ACTUALLY
      // produced, so the produced-kind flags and the counts can never drift from what the
      // job returns. The searchable-PDF page count is measured from the produced
      // searchable-PDF artifact's bytes, and the sidecar character count from the produced
      // sidecar's bytes — never from a parallel bookkeeping variable, and never from the
      // INPUT. `meanConfidence` is null — the native OCRmyPDF/Tesseract path exposes no
      // safe document-level confidence, so we never invent one. No recognized text,
      // filename, or path enters the metadata.
      const searchablePdf =
        artifacts.find(
          (artifact) => artifact.contentType === PDF_CONTENT_TYPE,
        ) ?? null;
      const textSidecar =
        artifacts.find(
          (artifact) => artifact.contentType === TEXT_CONTENT_TYPE,
        ) ?? null;
      const meta = buildOcrResultMeta({
        engine,
        languages: options.languages,
        outputMode: options.outputMode,
        producedSearchablePdf: searchablePdf !== null,
        producedTextSidecar: textSidecar !== null,
        pageCount: searchablePdf ? await countPages(searchablePdf.bytes) : null,
        textCharacters: textSidecar
          ? countTextCharacters(textSidecar.bytes)
          : null,
        // Best-effort and never fatal. An older Tesseract without the TSV renderer, a
        // failed write, or an unreadable file leaves the figures null — a job that
        // produced a good artifact must not fail because it could not be SCORED.
        // `null` here is the normal answer for every PDF input, which OCRmyPDF handles.
        ...(await readConfidence(fs, tsvOut)),
      });
      return { artifacts, meta };
    } finally {
      // Cleanup runs on every exit path — success, throw, or timeout. Never let a
      // cleanup error mask the real outcome or leak a path.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/**
 * The real OCR processor dependencies for this host: a config-aware engine probe and
 * the native runner bound to the same config. When OCR is disabled (the default —
 * `PDFXYZ_OCR` unset), it returns EMPTY deps, so the OCR processor is honestly not
 * ready and fails `ocr-pdf` jobs as `not_implemented`. When enabled, the processor
 * is ready only if an engine is actually installed on the host. Called by the worker
 * daemon runtime at wiring time. `env` defaults to `process.env`.
 */
export function nativeOcrDeps(
  env: Record<string, string | undefined> = process.env,
  seams: NativeOcrSeams = {},
): OcrProcessorDeps {
  const config = resolveNativeOcrConfig(env);
  if (!config.enabled) return {};
  // The existing-text reader: poppler, when this host has it (it ships in the
  // worker image for the text tools). Resolved here rather than defaulted in
  // the runner, so the runner's own tests never probe the host.
  const readExistingText =
    seams.readExistingText ??
    resolveNativePdfTextExtractor(env, seams.pdfText ?? {});
  return {
    engines: probeNativeOcrEnginesFromConfig(config, seams),
    runner: createNativeOcrRunner(config, {
      ...seams,
      ...(readExistingText ? { readExistingText } : {}),
    }),
    // What this host can genuinely recognize, so a request for a language with no
    // pack is refused by name instead of surfacing as a broken document.
    installedLanguages: probeInstalledOcrLanguages(env),
  };
}

/**
 * Where Tesseract keeps its `traineddata` packs, in the order they are searched.
 * `TESSDATA_PREFIX` wins when an operator sets it; the rest are the standard
 * Debian/Homebrew locations. The versioned Debian path is expanded by listing the
 * parent, so a Tesseract major-version bump needs no change here.
 */
function tessdataDirectories(
  env: Record<string, string | undefined>,
): string[] {
  const dirs: string[] = [];
  const prefix = env.TESSDATA_PREFIX?.trim();
  if (prefix) dirs.push(prefix);

  // /usr/share/tesseract-ocr/<version>/tessdata — the Debian layout.
  const versioned = "/usr/share/tesseract-ocr";
  try {
    for (const entry of readdirSync(versioned, { withFileTypes: true })) {
      if (entry.isDirectory())
        dirs.push(path.join(versioned, entry.name, "tessdata"));
    }
  } catch {
    // Not this layout on this host — the fixed paths below still apply.
  }

  dirs.push("/usr/share/tessdata", "/usr/local/share/tessdata", versioned);
  return dirs;
}

/**
 * The recognition languages this host can ACTUALLY run, read from the installed
 * `traineddata` packs.
 *
 * Presence-only, exactly like {@link resolveOnPath}: it lists a directory and never
 * executes Tesseract. That matters beyond convention — `tesseract --list-langs`
 * would mean spawning a subprocess on the status path, which the capability layer
 * must never do.
 *
 * `osd` is excluded deliberately. It is the orientation-and-script-detection model,
 * not a language a user can pick, and reporting it as one would misrepresent what
 * the worker can recognize.
 *
 * Why this exists at all: the advertised list (`OCR_LANGUAGES`) is a product
 * promise, while recognition needs a pack in the image. When those two drifted, a
 * user could select Spanish, upload a document, and be told "The OCR engine could
 * not process this file" — their file blamed for our missing dependency. Reading
 * the real packs lets both the status payload and the processor tell the truth even
 * if a deployment ships an image the Dockerfile no longer describes.
 */
export function probeInstalledOcrLanguages(
  env: Record<string, string | undefined> = process.env,
  seams: { readDir?: (dir: string) => string[] } = {},
): string[] {
  const readDir =
    seams.readDir ??
    ((dir: string): string[] => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    });

  const found = new Set<string>();
  for (const dir of tessdataDirectories(env)) {
    for (const file of readDir(dir)) {
      if (!file.endsWith(".traineddata")) continue;
      const code = file.slice(0, -".traineddata".length);
      // `osd` is script detection, not a selectable recognition language.
      if (code && code !== "osd") found.add(code);
    }
  }
  return [...found].sort();
}

/**
 * Probe OCR engine availability from the environment, honoring the opt-in flag,
 * pin, and binary overrides. Presence only; used where only the availability (not a
 * runner) is needed. `env`/`seams` are injectable for tests.
 */
export function probeNativeOcrEngines(
  env: Record<string, string | undefined> = process.env,
  seams: NativeOcrSeams = {},
): OcrEngineAvailability {
  return probeNativeOcrEnginesFromConfig(resolveNativeOcrConfig(env), seams);
}
