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
import type { SheetLayout } from "./sheet-layout";
import type { CsvImportChoice } from "./csv-import";
import { csvInfilter, resolveCsvImport } from "./csv-filter";
import { officeInputName, officeOutputName } from "./input-name";

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
    /** LibreOffice's environment ({@link libreOfficeEnv}). */
    env?: NodeJS.ProcessEnv;
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
  /**
   * The import filter for a file; {@link csvImportFilter} unless replaced.
   * Only the in-image proof replaces it, with `() => null`, to convert a CSV
   * the way LibreOffice imports it with no options and compare the output.
   */
  importFilter?: typeof csvImportFilter;
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
 * double-quoted text, character set 76 (UTF-8), read from line 1, and
 * since 2026-11-17 tokens 5 to 8 as an import with no options sets them.
 * The 2026-11-07 production fix shipped `44,34,76,1`, which left "detect
 * special numbers" on, so a UTF-8 file's `1/2` printed as a date
 * (`./csv-filter`). Derived from `./csv-filter` so the two cannot drift.
 *
 * Measured 2026-11-07 in the production worker image (no LANG set): a CSV
 * handed to LibreOffice with no import options is read in its Western
 * default, so a UTF-8 "Zürich" printed as mojibake. That is how the
 * production proof "excel-to-pdf (csv)" failed. Forcing UTF-8 on every CSV
 * is no fix either, because a Windows-1252 "Zürich" then printed with
 * U+FFFD in place of the letter.
 */
export const CSV_UTF8_INFILTER = csvInfilter("comma", "utf-8");

/**
 * The import filter a file needs, or null for LibreOffice's own choice.
 *
 * Every `.csv` gets one since 2026-11-17 (competitor audit #18): its
 * delimiter and character set are the job's choices (`./csv-import`), each
 * Auto resolved from the bytes (`./csv-filter`). WAS, 2026-11-07 to
 * 2026-11-17: {@link CSV_UTF8_INFILTER} for a non-ASCII UTF-8 CSV and null
 * for every other, so a semicolon CSV printed as one column. Auto's
 * character set is still that rule plus a UTF-16 byte-order mark, and a
 * CSV it reads as Windows-1252 gets `44,34,1,1,,0,false,false`, which
 * prints what LibreOffice printed with no options (measured in the image,
 * `./input-proof` "csv default import"; four tokens did NOT, see
 * `./csv-filter`). Any other file: null, exactly as before.
 */
export function csvImportFilter(
  input: Uint8Array,
  inputName: string,
  choice?: CsvImportChoice,
): string | null {
  if (!/\.csv$/i.test(inputName)) return null;
  const { delimiter, charset, firstLine } = resolveCsvImport(input, choice);
  return csvInfilter(delimiter, charset, firstLine);
}

/**
 * LibreOffice's Calc PDF export with `SinglePageSheets` on: every sheet
 * becomes one page sized to its content (`./sheet-layout`). JSON filter
 * options on `--convert-to` are LibreOffice 7.4's syntax; the worker image's
 * Debian bookworm ships 7.4. No shell sees this string: `execFile` passes it
 * as one argument.
 */
export const CALC_SINGLE_PAGE_SHEETS_TARGET = `pdf:calc_pdf_Export:${JSON.stringify(
  { SinglePageSheets: { type: "boolean", value: "true" } },
)}`;

/** What follows `--convert-to`: plain `pdf` unless a layout asks for more. */
export function pdfConvertTarget(layout?: SheetLayout): string {
  return layout?.onePagePerSheet ? CALC_SINGLE_PAGE_SHEETS_TARGET : "pdf";
}

export function libreOfficeConvertArgs(
  inputPath: string,
  outputDir: string,
  infilter: string | null = null,
  convertTarget: string = "pdf",
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
    convertTarget,
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

/**
 * The environment LibreOffice runs with: the worker's own, plus a UTF-8
 * character type when nothing in it already names one.
 *
 * Since 2026-11-17 the upload is written under the user's own file name
 * (`./input-name`), which may be Bengali, Cyrillic or CJK. LibreOffice
 * decodes a path it is handed, and the document URL it builds from it,
 * in the character set of its locale, and the worker image sets no locale
 * at all (the C locale, whose character set is ASCII). What LibreOffice does
 * with a UTF-8 name there was NOT measured when this was written; the
 * image's own proof (`worker:office-input-proof`, "csv file name") converts
 * Cyrillic, Bengali and CJK names and reads the header back, and is the
 * check that this setting is needed and enough. `LC_CTYPE=C.UTF-8` changes
 * only the character type; the C locale's language (LibreOffice reads it as
 * en-US) is unchanged. An explicit `LC_ALL` is the operator's choice and is
 * left alone.
 */
export function libreOfficeEnv(
  env: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const effective = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  const out = { ...env } as NodeJS.ProcessEnv;
  if (!env.LC_ALL && !/utf-?8/i.test(effective)) out.LC_CTYPE = "C.UTF-8";
  return out;
}

export function createNativeLibreOfficePdfRunner(
  config: NativeOfficeConversionConfig,
  seams: LibreOfficeSeams = {},
): LibreOfficePdfRunner {
  const exec = seams.exec ?? defaultLibreOfficeExec;
  const fs = seams.fs ?? defaultFs;
  const importFilter = seams.importFilter ?? csvImportFilter;
  const baseTmp = config.tmpDir ?? tmpdir();
  const binary =
    probeLibreOfficeFromConfig(config, seams) ??
    config.candidates[0] ??
    "soffice";
  return {
    async convertToPdf(input, filename, run = {}, layout, csv) {
      if (input.byteLength > config.maxInputBytes)
        throw new Error("Input exceeds size limit.");
      throwIfAttemptAborted(run.signal);
      const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-office-"));
      // The user's own stem (`./input-name`): LibreOffice names a CSV's
      // sheet, and so its printed header, after the file it opens.
      const inputName = officeInputName(filename);
      const inputPath = path.join(dir, inputName);
      const outputPath = path.join(dir, officeOutputName(inputName));
      try {
        await fs.writeFile(inputPath, input);
        throwIfAttemptAborted(run.signal);
        const result = await exec(
          binary,
          libreOfficeConvertArgs(
            inputPath,
            dir,
            importFilter(input, inputName, csv),
            pdfConvertTarget(layout),
          ),
          {
            timeout: config.timeoutMs,
            maxBuffer: EXEC_MAX_BUFFER,
            windowsHide: true,
            env: libreOfficeEnv(process.env),
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
