/**
 * The real, host-side implementations behind the OCR engine's injected
 * dependencies: a presence-only PATH probe (shared with every native engine) and
 * a native OCR runner that shells out to OCRmyPDF / Tesseract in an isolated temp
 * directory.
 *
 * Like the compression native layer, this is a Node-only module imported lazily
 * — only when `PDFXYZ_WORKER_MODE=local-dev` — so the default/remote code paths
 * and the client bundle never pull it in. Every engine invocation uses:
 *   - fixed argv over fixed temp paths (never a user-supplied path),
 *   - `execFile` (no shell — so validated languages / page-ranges cannot inject),
 *   - a hard timeout and output-size ceiling, and
 *   - guaranteed temp-directory cleanup.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveOnPath } from "../native-path";
import {
  probeOcrEngines,
  type NativeOcr,
  type OcrDeps,
  type OcrEngine,
  type OcrInputKind,
  type OcrOptions,
} from "./engine";

const run = promisify(execFile);

/** OCR can be slow; give it a generous ceiling but never let it hang forever. */
const EXEC_TIMEOUT_MS = 300_000;
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
/** Assumed resolution when OCRmyPDF is handed a bare image (it needs a DPI). */
const IMAGE_DPI = 300;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

/** Fixed temp paths a native OCR invocation reads from and writes to. */
export interface OcrNativePaths {
  inputPath: string;
  /** Base path (no extension) Tesseract appends its output extension to. */
  outBase: string;
  outPdfPath: string;
  outTxtPath: string;
}

/** Map the existing-text strategy to its OCRmyPDF flag. */
function existingTextFlag(options: OcrOptions): string {
  switch (options.onExistingText) {
    case "force":
      return "--force-ocr";
    case "redo":
      return "--redo-ocr";
    case "skip":
    default:
      return "--skip-text";
  }
}

/**
 * Build the fixed command + argument list for a native OCR engine, and report
 * which file the produced artefact should be read from. Pure and exported so the
 * exact flags for every option combination are unit-tested without a binary.
 */
export function ocrNativeArgs(
  engine: OcrEngine,
  options: OcrOptions,
  inputKind: OcrInputKind,
  paths: OcrNativePaths,
): { command: string; args: string[]; outputFile: string } {
  const langs = options.languages.join("+");

  if (engine === "ocrmypdf") {
    const args = ["-l", langs];
    if (options.deskew) args.push("--deskew");
    if (options.rotate) args.push("--rotate-pages");
    if (options.clean) args.push("--clean");
    args.push(existingTextFlag(options));
    if (options.pages !== undefined) args.push("--pages", options.pages);
    if (inputKind === "image") args.push("--image-dpi", String(IMAGE_DPI));
    // A plain tagged PDF with a text layer — no Ghostscript PDF/A pass, keeping
    // the foundation's dependency surface to OCRmyPDF + Tesseract.
    args.push("--output-type", "pdf", "--quiet");
    const textSidecar = options.outputMode === "text-sidecar";
    if (textSidecar) args.push("--sidecar", paths.outTxtPath);
    // OCRmyPDF always writes a PDF as its primary output; positional args last.
    args.push(paths.inputPath, paths.outPdfPath);
    return {
      command: "ocrmypdf",
      args,
      outputFile: textSidecar ? paths.outTxtPath : paths.outPdfPath,
    };
  }

  // Tesseract: single-image inputs only (the planner guarantees this).
  const textSidecar = options.outputMode === "text-sidecar";
  const args = [paths.inputPath, paths.outBase, "-l", langs];
  // `--psm 1` runs automatic page segmentation with orientation + script
  // detection, i.e. Tesseract's auto-rotate.
  if (options.rotate) args.push("--psm", "1");
  args.push(textSidecar ? "txt" : "pdf");
  return {
    command: "tesseract",
    args,
    outputFile: `${paths.outBase}.${textSidecar ? "txt" : "pdf"}`,
  };
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/** Give the temp input a truthful extension so strict loaders open it correctly. */
function inputFileName(input: Uint8Array, inputKind: OcrInputKind): string {
  if (inputKind === "pdf") return "input.pdf";
  return startsWith(input, PNG_MAGIC) ? "input.png" : "input.jpg";
}

/**
 * Run a native OCR engine in an isolated temp directory. Writes the input,
 * invokes the tool with fixed arguments, reads the produced artefact, and always
 * removes the temp directory afterward. Throws on any failure so the engine can
 * classify it honestly as a `failed` run.
 */
export const spawnNativeOcr: NativeOcr = async (input, ctx) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-ocr-"));
  const inputPath = path.join(dir, inputFileName(input, ctx.inputKind));
  const outBase = path.join(dir, "output");
  const paths: OcrNativePaths = {
    inputPath,
    outBase,
    outPdfPath: `${outBase}.pdf`,
    outTxtPath: `${outBase}.txt`,
  };
  try {
    await writeFile(inputPath, input);
    const { command, args, outputFile } = ocrNativeArgs(
      ctx.engine,
      ctx.options,
      ctx.inputKind,
      paths,
    );
    await run(command, args, {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
      windowsHide: true,
    });
    const output = await readFile(outputFile);
    if (output.byteLength === 0 || output.byteLength > MAX_OUTPUT_BYTES) {
      throw new Error("Native OCR engine produced no usable output.");
    }
    return new Uint8Array(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * The real OCR dependencies for this host: a fresh PATH probe (so a newly
 * installed engine is picked up without a restart) plus the native runner.
 * Called by the local-dev adapter at job time.
 */
export function nativeOcrDeps(): OcrDeps {
  return {
    engines: probeOcrEngines(resolveOnPath),
    native: spawnNativeOcr,
  };
}
