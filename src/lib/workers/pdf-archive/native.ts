import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksLikePdf } from "../compression/engine";
import {
  GhostscriptRunError,
  type GhostscriptPdfARunner,
  type PdfArchiveDeps,
} from "./engine";
import {
  resolveNativePdfArchiveConfig,
  type NativePdfArchiveConfig,
} from "./native-config";
import { sanitizeNativeDiagnostics } from "../native-diagnostics";
import { PDF_ARCHIVE_PASSWORD_PROBE_TIMEOUT_MS } from "./contract";
import { QPDF_EXIT_ERROR, QPDF_EXIT_WARNINGS } from "../qpdf-exit";
import {
  AttemptAbortedError,
  isAttemptAbort,
  rethrowIfAttemptAbort,
  signalOption,
  throwIfAttemptAborted,
} from "../attempt-abort";

const EXEC_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_BUFFER_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
/**
 * Ghostscript's success status. Named because this module also runs qpdf, whose
 * statuses are NOT "zero or failure" (3 is "warnings, output written"); a bare
 * `!== 0` here would read as the qpdf defect `qpdf-exit.test.ts` hunts for.
 * For Ghostscript it is the contract: any other exit is a failed conversion.
 */
const GHOSTSCRIPT_EXIT_OK = 0;

/**
 * What qpdf `--requires-password` answers about opening a file with no
 * password, read with the shared statuses (`../qpdf-exit`), as
 * `pdf-security/native.ts` reads the same option.
 */
type OpenPasswordAnswer =
  /** 0: encrypted, and the empty password does not open it. */
  | "needs-password"
  /** QPDF_EXIT_WARNINGS: encrypted, but it opens (owner-password only). */
  | "opens"
  /** QPDF_EXIT_ERROR: not encrypted — or qpdf cannot open it either. */
  | "not-encrypted-or-unreadable"
  /** Anything else, a timeout, or a probe that did not run. */
  | "unknown";

function readOpenPasswordAnswer(
  probe: { code: number; timedOut: boolean; spawnError?: string } | null,
): OpenPasswordAnswer {
  if (probe === null || probe.timedOut || probe.spawnError !== undefined)
    return "unknown";
  if (probe.code === 0) return "needs-password";
  if (probe.code === QPDF_EXIT_WARNINGS) return "opens";
  if (probe.code === QPDF_EXIT_ERROR) return "not-encrypted-or-unreadable";
  return "unknown";
}

export interface GhostscriptExecResult {
  code: number;
  timedOut: boolean;
  /**
   * Everything Ghostscript said while converting.
   *
   * Captured because a PDF/A conversion DELETES what PDF/A cannot represent and
   * announces each deletion here while exiting 0 — measured on the production
   * worker, gs 10.00.0, production argv: two `discarding DOCINFO` lines and a
   * font substitution, exit code 0, `looksLikePdf` satisfied, job completed.
   * This prose was the only record that anything was removed, and it was read
   * by nobody.
   *
   * Both streams, not just stderr: gs routes routine messages to STDOUT and only
   * errors to stderr, so a stderr-only capture would miss most of what it says.
   */
  diagnostics?: string;
  /**
   * The spawn failure's code (`ENOENT`, `EAGAIN`, …) when the process never ran.
   * Kept apart from `code` because it is the one failure that is about the
   * worker rather than the file, and so the one worth retrying.
   */
  spawnError?: string;
}

export type GhostscriptExec = (
  command: string,
  args: readonly string[],
  options: {
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    /** The attempt's abort signal: Node kills the child on abort. */
    signal?: AbortSignal;
  },
) => Promise<GhostscriptExecResult>;

export interface GhostscriptFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (
    dir: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
}

export interface GhostscriptSeams {
  resolveOnPath?: (binary: string) => boolean;
  fileExists?: (filePath: string) => boolean;
  exec?: GhostscriptExec;
  fs?: GhostscriptFs;
}

/** The real subprocess runner; exported so an abort test drives THIS function. */
export const defaultGhostscriptExec: GhostscriptExec = (
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
        stdout: Buffer,
        stderr: Buffer,
      ) => {
        const diagnostics = `${decode(stdout)}\n${decode(stderr)}`;
        if (!error) {
          resolve({ code: 0, timedOut: false, diagnostics });
          return;
        }
        // Checked before the string-code branch below, which would otherwise
        // read `ABORT_ERR` as a spawn failure and call it transient.
        if (isAttemptAbort(error)) {
          reject(new AttemptAbortedError());
          return;
        }
        // A string `code` means Node never got an exit status: either the spawn
        // failed (ENOENT, EAGAIN, …) or Node killed the child for flooding the
        // capture buffer. Only the first is a fact about the worker.
        if (typeof error.code === "string") {
          resolve({
            code: -1,
            timedOut: false,
            diagnostics,
            ...(error.code === MAX_BUFFER_CODE
              ? {}
              : { spawnError: error.code }),
          });
          return;
        }
        resolve({
          code: typeof error.code === "number" ? error.code : -1,
          timedOut: !!error.killed,
          diagnostics,
        });
      },
    );
  });

/** Decode a captured stream without ever throwing on odd bytes. */
function decode(buf: Buffer | string | undefined): string {
  if (buf === undefined) return "";
  return typeof buf === "string" ? buf : buf.toString("utf8");
}

const defaultFs: GhostscriptFs = {
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
  if (pathVar.length === 0) return false;
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

/** A PostScript literal string: backslash-escape the three characters that end or escape one. */
function postscriptString(text: string): string {
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/**
 * The PDF/A prefix file, written into each job's temp dir and run immediately
 * before the input. This is Ghostscript's documented recipe (its own
 * `lib/PDFA_def.ps`) with three deliberate differences:
 *
 *   - the ICC path is ABSOLUTE and is the same path `--permit-file-read`
 *     unlocks — the stock file's `(srgb.icc)` is a relative placeholder, and
 *     under `-dSAFER` a path that is not permitted fails with
 *     `invalidfileaccess`;
 *   - `/N 3` is stated, not inferred: the profile is RGB and the conversion is
 *     `-sColorConversionStrategy=RGB`, so the stock file's guess is not needed;
 *   - the stock `/Title (Title) /DOCINFO pdfmark` is gone. It is a placeholder
 *     the recipe tells users to customise, and running it as-is would overwrite
 *     every user's document title with the word "Title".
 *
 * Without this file there is no OutputIntent, and a PDF/A file that uses
 * device-dependent colour without one is not PDF/A: that was the argv until
 * this function existed.
 */
export function pdfaDefinition(iccProfilePath: string): string {
  return [
    "%!",
    "% pdf.xyz PDF/A-2b prefix: Ghostscript's PDFA_def.ps recipe (see native.ts).",
    `/ICCProfile ${postscriptString(iccProfilePath)} def`,
    "[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark",
    "[{icc_PDFA} << /N 3 >> /PUT pdfmark",
    "[{icc_PDFA} ICCProfile (r) file /PUT pdfmark",
    "[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark",
    "[{OutputIntent_PDFA} <<",
    "  /Type /OutputIntent",
    "  /S /GTS_PDFA1",
    "  /DestOutputProfile {icc_PDFA}",
    "  /OutputConditionIdentifier (sRGB)",
    ">> /PUT pdfmark",
    "[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark",
    "",
  ].join("\n");
}

export function ghostscriptPdfAArgs(
  inputPath: string,
  outputPath: string,
  pdfaDefPath: string,
  iccProfilePath: string,
): string[] {
  return [
    // OBSERVED, UNRESOLVED, RECORDED HERE BECAUSE WE QUOTE IT TO USERS: with
    // this flag set to 2, Ghostscript 10.00.0 nonetheless says "PDF/A1" in its
    // discard notices — "cannot be represented in XMP for PDF/A1" — verbatim, on
    // every one. Whether that is a stale message template in gs or the converter
    // genuinely applying A-1 metadata rules is a Ghostscript question and not
    // ours to answer. It is no longer taken on trust either way: every output
    // is parsed by `inspectPdfAMarkers` (engine.ts) and refused unless its XMP
    // says part 2 / conformance B and it carries a /GTS_PDFA1 OutputIntent.
    "-dPDFA=2",
    "-dBATCH",
    "-dNOPAUSE",
    // Required by the PDF/A prefix: its pdfmarks must survive into the
    // document that follows it.
    "-dNOOUTERSAVE",
    "-dSAFER",
    // -dSAFER forbids reading a file that was not named on the command line.
    // The prefix opens the ICC profile itself, so that one path is permitted —
    // the exact path the prefix embeds, and nothing wider.
    `--permit-file-read=${iccProfilePath}`,
    // SILENCE THE BOILERPLATE AT THE SOURCE, not with a filter afterwards.
    //
    // Without it Ghostscript prints its version banner, copyright, AGPL notice,
    // "Processing pages 1 through N.", and one "Page N" line per page — on
    // STDOUT, which this runner captures so it can report what the conversion
    // removed. Measured on the production worker with this exact argv:
    //
    //     flag       stdout    stderr   DOCINFO deletion notices
    //     (none)     7 lines   2 lines  present
    //     -dQUIET    0 lines   2 lines  PRESENT
    //     -q         0 lines   2 lines  PRESENT
    //
    // Two things went wrong without it, both measured, and the second is worse:
    // a CLEAN conversion reported `hadNotes: true` and offered the user a
    // software licence as evidence their document had been altered; and from
    // five pages up the banner plus the per-page lines filled every slot, so the
    // one line that matters — the deletion notice — was pushed into "N further
    // message(s) not shown."
    //
    // A filter list would have been the alternative and it is the worse one: if
    // it silently stopped matching, noise would come back VISIBLY. A notice
    // classifier that stops matching goes silently quiet. Removing the noise at
    // the source has neither failure mode.
    //
    // Same flag, same reason, already at `compression/native.ts:146`.
    "-dQUIET",
    // WAS `-sProcessColorModel=DeviceRGB`. The PDF/A recipe converts colour
    // with ColorConversionStrategy and describes it with the OutputIntent the
    // prefix embeds; the old flag did neither.
    "-sColorConversionStrategy=RGB",
    "-sDEVICE=pdfwrite",
    "-dPDFACompatibilityPolicy=1",
    `-sOutputFile=${outputPath}`,
    // The prefix runs first, then the document: the order is the recipe.
    pdfaDefPath,
    inputPath,
  ];
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

export function createNativeGhostscriptPdfARunner(
  config: NativePdfArchiveConfig,
  seams: GhostscriptSeams = {},
): GhostscriptPdfARunner {
  const exec = seams.exec ?? defaultGhostscriptExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();
  const qpdfAvailable = config.qpdfBinary.startsWith("/")
    ? (seams.fileExists ?? isRegularFile)(config.qpdfBinary)
    : (seams.resolveOnPath ?? resolveOnPath)(config.qpdfBinary);

  /**
   * Asked BEFORE Ghostscript runs. `--requires-password`, not `--is-encrypted`:
   * a permissions-only (owner-password) PDF is encrypted, opens without a
   * password, and converts — rejecting it would break files that work today.
   *
   * WAS: asked only after Ghostscript had failed, "so the happy path pays
   * nothing". The image proof (`pnpm worker:pdfa-proof`, first run in CI on
   * 2026-10-08) then locked a PDF with an open password and the conversion came
   * back `ok`: Ghostscript did not fail, so the question was never asked, and
   * whatever it wrote passed the PDF/A gate. A user would have received a
   * "PDF/A" that is not their document. One qpdf probe up front (milliseconds)
   * is the price of asking the question where it can still change the answer.
   *
   * "no-qpdf" when the worker has no qpdf: nothing can be asked, now or later.
   */
  async function openPasswordAnswer(
    inputPath: string,
    signal: AbortSignal | undefined,
  ): Promise<OpenPasswordAnswer | "no-qpdf"> {
    if (!qpdfAvailable) return "no-qpdf";
    throwIfAttemptAborted(signal);
    const probe = await exec(
      config.qpdfBinary,
      ["--requires-password", inputPath],
      {
        timeout: PDF_ARCHIVE_PASSWORD_PROBE_TIMEOUT_MS,
        maxBuffer: EXEC_MAX_BUFFER,
        windowsHide: true,
        ...signalOption(signal),
      },
    ).catch((error: unknown) => {
      // An inconclusive probe is "unknown"; a lost attempt is not a probe.
      rethrowIfAttemptAbort(error);
      return null;
    });
    return readOpenPasswordAnswer(probe);
  }

  /**
   * The file's own failure: an open-password file if qpdf says so, otherwise
   * `reason`. Whether Ghostscript exits non-zero on a file it cannot open, or
   * exits 0 having written nothing usable, is its choice; the user's fix is the
   * same either way. qpdf is asked AGAIN only when the up-front answer was
   * inconclusive (a timeout, a probe that did not run): a definite answer about
   * the same, unchanged input cannot have changed, so re-asking it only doubled
   * the failure path's latency (ultrareview, 2026-10-09).
   */
  async function fileFailure(
    inputPath: string,
    upFront: OpenPasswordAnswer | "no-qpdf",
    reason: "engine_exit" | "bad_output",
    message: string,
    signal: AbortSignal | undefined,
  ): Promise<GhostscriptRunError> {
    const answer =
      upFront === "unknown"
        ? await openPasswordAnswer(inputPath, signal)
        : upFront;
    return answer === "needs-password"
      ? new GhostscriptRunError(
          "password_required",
          "The input needs an open password.",
        )
      : new GhostscriptRunError(reason, message);
  }

  return {
    async convertToPdfA(input, options) {
      const signal = options?.signal;
      if (input.byteLength > config.maxInputBytes)
        throw new Error("Input exceeds size limit.");
      throwIfAttemptAborted(signal);
      let dir: string;
      try {
        dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-pdfa-"));
      } catch {
        throw new GhostscriptRunError("io", "Could not create a temp dir.");
      }
      const inputPath = path.join(dir, "input.pdf");
      const outputPath = path.join(dir, "output.pdf");
      const defPath = path.join(dir, "pdfa-def.ps");
      try {
        try {
          await fs.writeFile(inputPath, input);
          await fs.writeFile(
            defPath,
            new TextEncoder().encode(pdfaDefinition(config.iccProfile)),
          );
        } catch {
          throw new GhostscriptRunError("io", "Could not stage the input.");
        }
        // Before Ghostscript: its success is not evidence the file opened.
        const upFront = await openPasswordAnswer(inputPath, signal);
        if (upFront === "needs-password")
          throw new GhostscriptRunError(
            "password_required",
            "The input needs an open password.",
          );
        throwIfAttemptAborted(signal);
        const result = await exec(
          config.binary,
          ghostscriptPdfAArgs(
            inputPath,
            outputPath,
            defPath,
            config.iccProfile,
          ),
          {
            timeout: config.timeoutMs,
            maxBuffer: EXEC_MAX_BUFFER,
            windowsHide: true,
            ...signalOption(signal),
          },
        );
        if (result.spawnError !== undefined)
          throw new GhostscriptRunError("spawn", "Ghostscript did not start.");
        if (result.timedOut)
          throw new GhostscriptRunError("timeout", "Ghostscript timed out.");
        if (result.code !== GHOSTSCRIPT_EXIT_OK)
          throw await fileFailure(
            inputPath,
            upFront,
            "engine_exit",
            "Ghostscript PDF/A conversion failed.",
            signal,
          );
        let output: Uint8Array;
        try {
          output = await fs.readFile(outputPath);
        } catch (error) {
          // gs reported success and wrote nothing: that is about the file.
          if (isNotFound(error))
            throw await fileFailure(
              inputPath,
              upFront,
              "bad_output",
              "Ghostscript produced no usable PDF output.",
              signal,
            );
          throw new GhostscriptRunError("io", "Could not read the output.");
        }
        const bytes =
          output instanceof Uint8Array ? output : new Uint8Array(output);
        if (
          bytes.byteLength === 0 ||
          bytes.byteLength > config.maxOutputBytes ||
          !looksLikePdf(bytes)
        ) {
          throw await fileFailure(
            inputPath,
            upFront,
            "bad_output",
            "Ghostscript produced no usable PDF output.",
            signal,
          );
        }
        return {
          bytes,
          notes: sanitizeNativeDiagnostics(decode(result.diagnostics), [
            inputPath,
            outputPath,
            defPath,
            config.iccProfile,
            dir,
          ]),
        };
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

export function probeGhostscriptFromConfig(
  config: NativePdfArchiveConfig,
  seams: GhostscriptSeams = {},
): boolean {
  if (!config.enabled) return false;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  const gs = config.overridden
    ? fileExists(config.binary)
    : onPath(config.binary);
  // Ghostscript alone is not the capability. Without the ICC profile the
  // OutputIntent cannot be embedded, every output fails the PDF/A gate, and a
  // `ready: true` worker would refuse every job. Report the truth at boot.
  return gs && fileExists(config.iccProfile);
}

export function nativePdfArchiveDeps(
  env: Record<string, string | undefined> = process.env,
  seams: GhostscriptSeams = {},
): PdfArchiveDeps {
  const config = resolveNativePdfArchiveConfig(env);
  const available = probeGhostscriptFromConfig(config, seams);
  return {
    ...(available
      ? { ghostscript: createNativeGhostscriptPdfARunner(config, seams) }
      : {}),
    limits: { maxInputBytes: config.maxInputBytes },
  };
}
