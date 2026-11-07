import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksLikePdf } from "../compression/engine";
import type { LibreOfficePdfRunner, OfficeConversionDeps } from "./engine";
import { LibreOfficeRunError } from "./errors";
import {
  AttemptAbortedError,
  isAttemptAbort,
  signalOption,
  throwIfAttemptAborted,
} from "../attempt-abort";
import {
  resolveNativeOfficeConversionConfig,
  type NativeOfficeConversionConfig,
} from "./native-config";

const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

export interface LibreOfficeExecResult {
  code: number;
  timedOut: boolean;
}
export type LibreOfficeExec = (
  command: string,
  args: readonly string[],
  options: {
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    /** The attempt's abort signal: Node kills the child on abort. */
    signal?: AbortSignal;
  },
) => Promise<LibreOfficeExecResult>;
export interface LibreOfficeFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (
    dir: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
}
export interface LibreOfficeSeams {
  resolveOnPath?: (binary: string) => boolean;
  fileExists?: (filePath: string) => boolean;
  exec?: LibreOfficeExec;
  fs?: LibreOfficeFs;
}

/** The real subprocess runner; exported so an abort test drives THIS function. */
export const defaultLibreOfficeExec: LibreOfficeExec = (
  command,
  args,
  options,
) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { ...options, encoding: "buffer" },
      (
        error: (Error & { code?: number | string; killed?: boolean }) | null,
      ) => {
        if (!error) return resolve({ code: 0, timedOut: false });
        // Not a timeout and not "stopped before it finished": nobody wants it.
        if (isAttemptAbort(error)) return reject(new AttemptAbortedError());
        resolve({
          code: typeof error.code === "number" ? error.code : -1,
          timedOut: !!error.killed,
        });
      },
    );
  });
const defaultFs: LibreOfficeFs = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  writeFile: (file, data) => writeFile(file, data),
  readFile: async (file) => new Uint8Array(await readFile(file)),
  rm: (dir, options) => rm(dir, options),
};

function isRegularFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveOnPath(binary: string): boolean {
  const pathVar = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts)
      if (isRegularFile(path.join(dir, binary + ext))) return true;
  }
  return false;
}

/**
 * LibreOffice's CSV import filter with its options: comma-separated,
 * double-quoted text, character set 76 (UTF-8), read from line 1.
 *
 * Measured 2026-11-07 in the production worker image (no LANG set): a CSV
 * handed to LibreOffice with no import options is read in its Western
 * default, so a UTF-8 "Zürich" printed as "ZÃ¼rich". That is how the
 * production proof "excel-to-pdf (csv)" failed. Forcing UTF-8 on every CSV
 * is no fix either, because a Windows-1252 "Zürich" then printed with U+FFFD
 * in place of the ü. So {@link csvImportFilter} passes this only for a CSV
 * whose bytes ARE UTF-8, and leaves any other CSV on the default that reads
 * it correctly.
 */
export const CSV_UTF8_INFILTER = "Text - txt - csv (StarCalc):44,34,76,1";

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * The import filter a file needs, or null for LibreOffice's own choice:
 * {@link CSV_UTF8_INFILTER} for a `.csv` that holds non-ASCII bytes and
 * decodes as UTF-8 (a byte-order mark included). An ASCII-only CSV reads
 * the same either way, and is handed over exactly as before.
 */
export function csvImportFilter(
  input: Uint8Array,
  inputName: string,
): string | null {
  if (!/\.csv$/i.test(inputName)) return null;
  if (input.every((byte) => byte < 0x80)) return null;
  try {
    STRICT_UTF8.decode(input);
  } catch {
    return null;
  }
  return CSV_UTF8_INFILTER;
}

export function libreOfficeConvertArgs(
  inputPath: string,
  outputDir: string,
  infilter: string | null = null,
): string[] {
  return [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    "--nodefault",
    "--nolockcheck",
    // Before --convert-to, as LibreOffice reads its options; the input file
    // stays LAST (a file named before --convert-to is opened, not converted).
    ...(infilter ? [`--infilter=${infilter}`] : []),
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    inputPath,
  ];
}

export function probeLibreOfficeFromConfig(
  config: NativeOfficeConversionConfig,
  seams: LibreOfficeSeams = {},
): string | null {
  if (!config.enabled) return null;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  for (const candidate of config.candidates) {
    if (config.overridden ? fileExists(candidate) : onPath(candidate))
      return candidate;
  }
  return null;
}

function safeInputName(filename: string): string {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).replace(/[^a-zA-Z0-9.]/g, "")
    : ".docx";
  return `input${ext || ".docx"}`;
}

export function createNativeLibreOfficePdfRunner(
  config: NativeOfficeConversionConfig,
  seams: LibreOfficeSeams = {},
): LibreOfficePdfRunner {
  const exec = seams.exec ?? defaultLibreOfficeExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();
  const binary =
    probeLibreOfficeFromConfig(config, seams) ??
    config.candidates[0] ??
    "soffice";
  return {
    async convertToPdf(input, filename, run = {}) {
      if (input.byteLength > config.maxInputBytes)
        throw new Error("Input exceeds size limit.");
      throwIfAttemptAborted(run.signal);
      const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-office-"));
      const inputName = safeInputName(filename);
      const inputPath = path.join(dir, inputName);
      const outputPath = path.join(
        dir,
        `${inputName.replace(/\.[^.]+$/, "")}.pdf`,
      );
      try {
        await fs.writeFile(inputPath, input);
        throwIfAttemptAborted(run.signal);
        const result = await exec(
          binary,
          libreOfficeConvertArgs(
            inputPath,
            dir,
            csvImportFilter(input, inputName),
          ),
          {
            timeout: config.timeoutMs,
            maxBuffer: EXEC_MAX_BUFFER,
            windowsHide: true,
            ...signalOption(run.signal),
          },
        );
        // Typed by what a retry could change (see `./errors`). A timeout and
        // an exit LibreOffice chose are answers about the DOCUMENT; a kill
        // nobody asked for (code -1, not `timedOut` — an OOM, say) is not, so
        // it stays a plain, retryable error.
        if (result.timedOut) throw new LibreOfficeRunError("timeout");
        if (result.code > 0) throw new LibreOfficeRunError("exit");
        if (result.code !== 0)
          throw new Error("LibreOffice was stopped before it finished.");
        let output: Uint8Array;
        try {
          output = await fs.readFile(outputPath);
        } catch (error) {
          // soffice exits 0 and writes nothing for a file it cannot load (an
          // encrypted or corrupt document). Any other read error is IO.
          if ((error as { code?: unknown } | null)?.code === "ENOENT")
            throw new LibreOfficeRunError("no_output");
          throw error;
        }
        const bytes =
          output instanceof Uint8Array ? output : new Uint8Array(output);
        if (bytes.byteLength > config.maxOutputBytes)
          throw new LibreOfficeRunError("too_large");
        if (bytes.byteLength === 0 || !looksLikePdf(bytes))
          throw new LibreOfficeRunError("bad_output");
        return bytes;
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

export function nativeOfficeConversionDeps(
  env: Record<string, string | undefined> = process.env,
  seams: LibreOfficeSeams = {},
): OfficeConversionDeps {
  const config = resolveNativeOfficeConversionConfig(env);
  const available = probeLibreOfficeFromConfig(config, seams);
  return {
    ...(available
      ? { libreoffice: createNativeLibreOfficePdfRunner(config, seams) }
      : {}),
    limits: {
      maxInputBytes: config.maxInputBytes,
      maxOutputBytes: config.maxOutputBytes,
    },
  };
}
