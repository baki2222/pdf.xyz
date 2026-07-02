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
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";
import { sanitizeDisplayFilename } from "@/lib/jobs/filenames";
import { looksLikePdf } from "./compression/engine";
import {
  OCR_ENGINES,
  type OcrEngine,
  type OcrEngineAvailability,
} from "./ocr";
import {
  resolveNativeOcrConfig,
  type NativeOcrConfig,
} from "./ocr-native-config";
import type { OcrProcessorDeps, OcrRunner, OcrRunResult } from "./processor/ocr";
import type { ProcessorArtifact, ProcessorInputFile } from "./processor/types";

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

/** Run a subprocess by argv (never a shell). Injectable so tests never spawn a real process. */
export type NativeOcrExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<unknown>;

/** The temp-file operations the runner needs. Injectable for deterministic tests. */
export interface NativeOcrFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (dir: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
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
}

const runExecFile = promisify(execFile);
const defaultExec: NativeOcrExec = (command, args, options) =>
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
}

/** Normalized inputs for {@link nativeOcrArgs} — all worker-owned, never user paths. */
export interface NativeOcrArgsContext {
  inputPath: string;
  /** The isolated temp dir; outputs are placed inside it. */
  workDir: string;
  languages: readonly string[];
  skipTextPages: boolean;
  wantPdf: boolean;
  wantText: boolean;
}

/**
 * Build the fixed argument list for a native OCR engine. `command` is the resolved
 * invocation (a bare command name or an allowlisted override path); every path is a
 * separate argv element — there is no shell, no string concatenation of a command
 * line, and no user-supplied path, so filenames and options can never be
 * interpreted as flags or shell syntax.
 *
 *  - **OCRmyPDF** takes a PDF in and always writes a searchable PDF out; a text
 *    sidecar is produced with `--sidecar`. `--skip-text` leaves pages that already
 *    carry a text layer untouched. `--output-type pdf` avoids the PDF/A path (which
 *    would additionally require Ghostscript).
 *  - **Tesseract** OCRs an image and writes `<base>.pdf` / `<base>.txt` selected by
 *    trailing `pdf`/`txt` config tokens. It has no page-level skip-text notion, so
 *    `skipTextPages` does not apply to it.
 */
export function nativeOcrArgs(
  engine: OcrEngine,
  command: string,
  ctx: NativeOcrArgsContext,
): NativeOcrInvocation {
  const lang = ctx.languages.join("+");
  switch (engine) {
    case "ocrmypdf": {
      const pdfOut = path.join(ctx.workDir, "output.pdf");
      const txtOut = path.join(ctx.workDir, "output.txt");
      const args = [
        "--language",
        lang,
        "--output-type",
        "pdf",
        ...(ctx.skipTextPages ? ["--skip-text"] : []),
        ...(ctx.wantText ? ["--sidecar", txtOut] : []),
        "--quiet",
        ctx.inputPath,
        pdfOut,
      ];
      return { command, args, pdfOut, txtOut };
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
      ];
      return { command, args, pdfOut, txtOut };
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
  return OCR_ENGINES.find((engine) => engineUsable(engine, config, seams)) ?? null;
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
  if (bytes.byteLength === 0 || bytes.byteLength > META_PDF_MAX_PARSE_BYTES) {
    return null;
  }
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = doc.getPageCount();
    return Number.isInteger(pages) && pages > 0 ? pages : null;
  } catch {
    return null;
  }
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
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const countPages = seams.countPages ?? countPdfPages;
  const baseTmp = config.tmpDir ?? tmpdir();

  return async ({ options, inputs }): Promise<OcrRunResult> => {
    const input = inputs[0];
    // OCR runs over a single document; the contract and UI submit exactly one file.
    if (inputs.length !== 1 || !input) {
      throw new Error("OCR accepts exactly one input file.");
    }
    // Backstop the input ceiling here too, in case a caller reaches the runner
    // without an engine-level guard. Deterministic → recorded as a failure.
    if (input.bytes.byteLength > config.maxInputBytes) {
      throw new Error("Input exceeds the configured maximum size.");
    }
    const engine = firstUsableOcrEngine(config, seams);
    if (!engine) {
      // The processor only invokes the runner when an engine is present, so this is
      // a defensive backstop; the message stays content-free regardless.
      throw new Error("No OCR engine is available on this worker.");
    }

    const wantPdf = options.outputMode === "searchable-pdf" || options.outputMode === "both";
    const wantText = options.outputMode === "text" || options.outputMode === "both";

    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-ocr-"));
    const inputPath = path.join(dir, `input.${inputExtension(input)}`);
    try {
      await fs.writeFile(inputPath, input.bytes);
      const { command, args, pdfOut, txtOut } = nativeOcrArgs(engine, config.binaries[engine], {
        inputPath,
        workDir: dir,
        languages: options.languages,
        skipTextPages: options.skipTextPages,
        wantPdf,
        wantText,
      });
      await exec(command, args, {
        timeout: config.timeoutMs,
        maxBuffer: EXEC_MAX_BUFFER,
        windowsHide: true,
      });

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
        const txt = await fs.readFile(txtOut);
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
        artifacts.find((artifact) => artifact.contentType === PDF_CONTENT_TYPE) ?? null;
      const textSidecar =
        artifacts.find((artifact) => artifact.contentType === TEXT_CONTENT_TYPE) ?? null;
      const meta = buildOcrResultMeta({
        engine,
        languages: options.languages,
        outputMode: options.outputMode,
        producedSearchablePdf: searchablePdf !== null,
        producedTextSidecar: textSidecar !== null,
        pageCount: searchablePdf ? await countPages(searchablePdf.bytes) : null,
        textCharacters: textSidecar ? countTextCharacters(textSidecar.bytes) : null,
        meanConfidence: null,
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
  return {
    engines: probeNativeOcrEnginesFromConfig(config, seams),
    runner: createNativeOcrRunner(config, seams),
  };
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
