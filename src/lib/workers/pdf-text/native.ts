/**
 * The host-side `pdftotext` runner behind PDF text and layout extraction on the
 * worker, plus a presence-only binary probe.
 *
 * This is the ONLY module here that touches Node built-ins. It exists because the
 * pdfjs-backed extractors in `@/lib/pdf/text` and `@/lib/pdf/layout` are browser
 * modules that cannot run under Node at all (see `./parse`), so the worker needs a
 * native path — the same shape `../office-conversion/native` uses for LibreOffice.
 *
 * Honesty rules it preserves:
 *  - the deps builders inject an extractor ONLY when the binary is actually present,
 *    so `capability().ready` reflects what the host can really do rather than the
 *    fact that a function was wired;
 *  - the input is written to an isolated temp dir under a fixed name, the binary is
 *    invoked with a fixed argv array (no shell, no user-supplied path), bounded by a
 *    timeout and byte ceilings, and the temp dir is removed on every exit path;
 *  - failures throw so the engines classify them, and no fabricated text is returned.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type {
  PdfLayout,
  PdfLayoutExtractor,
  TableExtractDeps,
} from "@/lib/workers/table-extract/engine";
import type {
  PdfOfficeExportDeps,
  PdfTextExtractor,
} from "@/lib/workers/pdf-office-export/engine";
import { parseBboxLayout, parseLayoutText } from "./parse";
import {
  resolveNativePdfTextConfig,
  type NativePdfTextConfig,
} from "./native-config";

/** Run a subprocess by argv (never a shell) and return its stdout. Injectable for tests. */
export type PdfTextExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<string>;

export interface PdfTextFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  rm: (dir: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
}

export interface PdfTextSeams {
  resolveOnPath?: (binary: string) => boolean;
  fileExists?: (filePath: string) => boolean;
  exec?: PdfTextExec;
  fs?: PdfTextFs;
}

const defaultExec: PdfTextExec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { ...options, encoding: "utf8" }, (error, stdout) => {
      if (error) return reject(new Error("pdftotext failed."));
      resolve(typeof stdout === "string" ? stdout : String(stdout));
    });
  });

const defaultFs: PdfTextFs = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  writeFile: (file, data) => writeFile(file, data),
  rm: (dir, options) => rm(dir, options),
};

function isRegularFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Presence-only PATH resolver; never executes the binary. */
export function resolveOnPath(binary: string): boolean {
  const pathVar = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (isRegularFile(path.join(dir, binary + ext))) return true;
    }
  }
  return false;
}

/** The resolved binary when it is genuinely available under `config`, else null. */
export function probePdfTextFromConfig(
  config: NativePdfTextConfig,
  seams: PdfTextSeams = {},
): string | null {
  if (!config.enabled) return null;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  const available = config.overridden
    ? fileExists(config.binary)
    : onPath(config.binary);
  return available ? config.binary : null;
}

/**
 * Build the fixed argv for an extraction mode. `-layout` preserves column spacing
 * (which the office-export engine relies on to recover spreadsheet rows) and
 * `-bbox-layout` emits per-word bounding boxes for table detection. `--` ends
 * option parsing, and the trailing `-` writes to stdout so no output file is read.
 */
export function pdfTextArgs(
  mode: "layout" | "bbox",
  inputPath: string,
): string[] {
  return [
    mode === "bbox" ? "-bbox-layout" : "-layout",
    "-q",
    "--",
    inputPath,
    "-",
  ];
}

/** Write the PDF to an isolated temp dir, run pdftotext, and always clean up. */
async function runPdfText(
  binary: string,
  config: NativePdfTextConfig,
  seams: PdfTextSeams,
  mode: "layout" | "bbox",
  input: Uint8Array,
): Promise<string> {
  if (input.byteLength > config.maxInputBytes) {
    throw new Error("Input exceeds the configured maximum size.");
  }
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const dir = await fs.mkdtemp(path.join(config.tmpDir ?? tmpdir(), "pdfxyz-pdftext-"));
  const inputPath = path.join(dir, "input.pdf");
  try {
    await fs.writeFile(inputPath, input);
    const stdout = await exec(binary, pdfTextArgs(mode, inputPath), {
      timeout: config.timeoutMs,
      maxBuffer: config.maxOutputBytes,
      windowsHide: true,
    });
    return stdout;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function createNativePdfTextExtractor(
  binary: string,
  config: NativePdfTextConfig,
  seams: PdfTextSeams = {},
): PdfTextExtractor {
  return async (bytes: Uint8Array): Promise<ExtractedPdfText> =>
    parseLayoutText(await runPdfText(binary, config, seams, "layout", bytes));
}

export function createNativePdfLayoutExtractor(
  binary: string,
  config: NativePdfTextConfig,
  seams: PdfTextSeams = {},
): PdfLayoutExtractor {
  return async (bytes: Uint8Array): Promise<PdfLayout> =>
    parseBboxLayout(await runPdfText(binary, config, seams, "bbox", bytes));
}

/**
 * The plain-text extractor for this host, or `undefined` when `pdftotext` is not
 * available. Returning `undefined` rather than a throwing stub is what lets every
 * consumer's `extract?` stay honestly absent, so the engine reports "this worker
 * cannot do it" instead of accepting a job it will always fail.
 *
 * Shared by the four AI engines (summarize, translate, ai-extract, chat-with-pdf),
 * which read a PDF's selectable text before prompting a model. They must not use
 * the pdfjs extractor in `@/lib/pdf/text`: it is browser-only and throws on Node
 * before reading a byte.
 */
export function resolveNativePdfTextExtractor(
  env: Record<string, string | undefined> = process.env,
  seams: PdfTextSeams = {},
): PdfTextExtractor | undefined {
  const config = resolveNativePdfTextConfig(env);
  const binary = probePdfTextFromConfig(config, seams);
  return binary ? createNativePdfTextExtractor(binary, config, seams) : undefined;
}

/**
 * PDF→Office export deps for this host. `extract` is present only when pdftotext
 * really is — otherwise the engine reports `unsupported` (an honest "this worker
 * cannot do it") instead of accepting jobs it will always fail.
 */
export function nativePdfOfficeExportDeps(
  env: Record<string, string | undefined> = process.env,
  seams: PdfTextSeams = {},
): PdfOfficeExportDeps {
  const config = resolveNativePdfTextConfig(env);
  const binary = probePdfTextFromConfig(config, seams);
  return {
    ...(binary ? { extract: createNativePdfTextExtractor(binary, config, seams) } : {}),
    limits: {
      maxInputBytes: config.maxInputBytes,
      maxOutputBytes: config.maxOutputBytes,
    },
  };
}

/** Table-extraction deps for this host, under the same presence-only rule. */
export function nativeTableExtractDeps(
  env: Record<string, string | undefined> = process.env,
  seams: PdfTextSeams = {},
): TableExtractDeps {
  const config = resolveNativePdfTextConfig(env);
  const binary = probePdfTextFromConfig(config, seams);
  return {
    ...(binary
      ? { extractLayout: createNativePdfLayoutExtractor(binary, config, seams) }
      : {}),
    limits: {
      maxInputBytes: config.maxInputBytes,
      maxOutputBytes: config.maxOutputBytes,
    },
  };
}
