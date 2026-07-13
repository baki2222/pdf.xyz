/**
 * The real, host-side implementation behind the PDF security engine's injected
 * {@link QpdfRunner}: a presence-only binary probe and a qpdf runner that shells
 * out to `qpdf` in an isolated temp directory to encrypt, decrypt, and inspect a
 * single PDF.
 *
 * This is the ONLY module in the security layer that touches Node built-ins
 * (`fs`, `child_process`, …). It is pulled in exclusively by non-browser code —
 * the local-dev worker adapter and the `/api/worker/status` route (both via a lazy
 * `import()`, only in `PDFXYZ_WORKER_MODE=local-dev`) and the out-of-band daemon
 * runtime — so the default/remote request paths and the client bundle never pull
 * it in.
 *
 * PASSWORD HANDLING — the load-bearing security property of this file:
 *  - A password is NEVER placed on the process command line. qpdf is invoked as
 *    `qpdf @<argfile>`, where `<argfile>` is a qpdf "at-file" (one argument per
 *    line) written into the job's isolated temp directory. So the password appears
 *    neither in `/proc/<pid>/cmdline` NOR in any `execFile` "Command failed: …"
 *    error string — the argv the OS and Node see is just `qpdf @/tmp/…/args`.
 *  - The argfile (and the input PDF) live only in a per-job `mkdtemp` directory
 *    that is force-removed in a `finally` on EVERY exit path — success, engine
 *    failure, or timeout. Nothing sensitive outlives the call.
 *  - qpdf runs with a FIXED argv array (no shell, no interpolation) over
 *    worker-owned temp paths (never a user-supplied path), a hard timeout, and
 *    hard input/output byte ceilings.
 *
 * The subprocess / filesystem / probe boundaries are all injectable seams, so
 * every branch — argfile construction, wrong-password classification, timeout,
 * invalid output, cleanup — is unit-tested without a real binary or child process.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksLikePdf } from "../compression/engine";
import type {
  QpdfProtectInput,
  QpdfRunner,
  QpdfUnlockInput,
  QpdfUnlockOutcome,
} from "./engine";
import {
  resolveNativePdfSecurityConfig,
  type NativePdfSecurityConfig,
} from "./native-config";
import type { PdfSecurityDeps } from "./engine";

/** stdout/stderr capture ceiling. qpdf writes results to a file, so this is generous. */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/** The structured outcome of one qpdf invocation. Never carries a password. */
export interface QpdfExecResult {
  /** Process exit code, or a negative sentinel for a spawn error / timeout. */
  code: number;
  /** True when the process was killed by the timeout. */
  timedOut: boolean;
}

/**
 * Run qpdf by argv (never a shell) and resolve with its exit code — it does NOT
 * reject on a non-zero exit, because for this engine a non-zero code is a normal
 * signal (e.g. `--is-encrypted` returns 2 for "not encrypted", `--decrypt` returns
 * 2 for a wrong password). Injectable so tests never spawn a real process.
 */
export type QpdfExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<QpdfExecResult>;

/** The temp-file operations the runner needs. Injectable for deterministic tests. */
export interface QpdfFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (dir: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
}

/** All the host seams the native layer touches; each defaults to the real Node built-in. */
export interface QpdfSeams {
  /** Resolve whether a bare command exists on PATH (presence only; never executes). */
  resolveOnPath?: (binary: string) => boolean;
  /** Whether an absolute path exists and is a regular file (for override probing). */
  fileExists?: (filePath: string) => boolean;
  /** Subprocess runner. */
  exec?: QpdfExec;
  /** Temp-file operations. */
  fs?: QpdfFs;
}

/**
 * The default exec: runs `execFile` and resolves with the exit code instead of
 * rejecting on a non-zero status. A spawn error (e.g. qpdf not found) or a timeout
 * resolves with a negative code so the caller treats it as an engine failure. The
 * captured stdout/stderr are intentionally discarded — they can carry qpdf's own
 * diagnostics, which we never surface or log.
 */
const defaultExec: QpdfExec = (command, args, options) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { ...options, encoding: "buffer" },
      (error: (Error & { code?: number | string; killed?: boolean }) | null) => {
        if (!error) {
          resolve({ code: 0, timedOut: false });
          return;
        }
        if (error.killed) {
          resolve({ code: -1, timedOut: true });
          return;
        }
        // A numeric `code` is the process exit status; a string `code` (e.g.
        // "ENOENT") is a spawn failure. Both are engine failures except where the
        // caller explicitly interprets a specific exit status.
        resolve({
          code: typeof error.code === "number" ? error.code : -1,
          timedOut: false,
        });
      },
    );
  });

const defaultFs: QpdfFs = {
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
 * Handles Windows PATHEXT so the probe is correct cross-platform.
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

/** qpdf exit code that means "not encrypted" (`--is-encrypted`) or "wrong password" (`--decrypt`). */
const QPDF_EXIT_STATUS_2 = 2;

/**
 * Build the qpdf argument vector for encrypting a PDF. qpdf 11 uses positional
 * encryption operands: `--encrypt <user> <owner> <bits> -- input output`.
 * Passwords may begin with `-`, contain spaces, or contain `=`; because the whole
 * sensitive argv is written to a qpdf at-file (one token per line) and read by qpdf
 * as arguments, those values are operands, not shell text. AES is forced for the
 * 128-bit level so the legacy RC4 cipher can never be selected. 40-bit / RC4 is
 * never offered.
 */
export function protectArgs(
  inputPath: string,
  outputPath: string,
  opts: QpdfProtectInput,
): string[] {
  const encrypt = [
    "--encrypt",
    opts.userPassword,
    opts.ownerPassword,
    String(opts.keyLength),
  ];
  // AES-256 (bits=256) is always AES; force AES for the 128-bit level so it is
  // never RC4. 40-bit / RC4 is never offered.
  if (opts.keyLength === 128) encrypt.push("--use-aes=y");
  encrypt.push("--");
  return [...encrypt, inputPath, outputPath];
}

/** Build the qpdf argument vector for decrypting a PDF with a password. */
export function unlockArgs(
  inputPath: string,
  outputPath: string,
  opts: QpdfUnlockInput,
): string[] {
  return [`--password=${opts.password}`, "--decrypt", inputPath, outputPath];
}

/** Build the qpdf argument vector for the presence-only encryption check. */
export function isEncryptedArgs(inputPath: string): string[] {
  return ["--is-encrypted", inputPath];
}

/**
 * Build a native qpdf runner bound to a configuration. Every operation writes the
 * input to an isolated temp dir, runs qpdf via a fixed argv, and ALWAYS removes the
 * temp dir afterward — on success, engine failure, or timeout. Any argument list
 * that carries a password is passed to qpdf through an at-file in that same temp
 * dir, never on the command line.
 */
export function createNativeQpdfRunner(
  config: NativePdfSecurityConfig,
  seams: QpdfSeams = {},
): QpdfRunner {
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();

  /** Run one qpdf invocation inside a fresh temp dir; `build` produces the argv. */
  async function withJob<T>(
    input: Uint8Array,
    build: (inputPath: string, outputPath: string) => string[],
    interpret: (
      result: QpdfExecResult,
      readOutput: () => Promise<Uint8Array>,
    ) => Promise<T>,
    /** When true, the argv carries a password and MUST go through an at-file. */
    sensitive: boolean,
  ): Promise<T> {
    if (input.byteLength > config.maxInputBytes) {
      throw new Error("Input exceeds the configured maximum size.");
    }
    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-security-"));
    const inputPath = path.join(dir, "input.pdf");
    const outputPath = path.join(dir, "output.pdf");
    try {
      await fs.writeFile(inputPath, input);
      const argv = build(inputPath, outputPath);

      let commandArgs: string[];
      if (sensitive) {
        // Write the full argv (one token per line) to a qpdf at-file, so the
        // password never appears on the command line or in an exec error string.
        const argsPath = path.join(dir, "qpdf.args");
        await fs.writeFile(argsPath, new TextEncoder().encode(argv.join("\n")));
        commandArgs = [`@${argsPath}`];
      } else {
        commandArgs = argv;
      }

      const result = await exec(config.binary, commandArgs, {
        timeout: config.timeoutMs,
        maxBuffer: EXEC_MAX_BUFFER,
        windowsHide: true,
      });

      const readOutput = async (): Promise<Uint8Array> => {
        const output = await fs.readFile(outputPath);
        const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
        if (
          bytes.byteLength === 0 ||
          bytes.byteLength > config.maxOutputBytes ||
          !looksLikePdf(bytes)
        ) {
          throw new Error("qpdf produced no usable PDF output.");
        }
        return bytes;
      };

      return await interpret(result, readOutput);
    } finally {
      // Cleanup runs on every exit path — success, throw, or timeout. Never let a
      // cleanup error mask the real outcome or leak a path (and it removes the
      // at-file that briefly held the password).
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    async isEncrypted(input) {
      // No password involved, so the argv is not sensitive.
      return withJob(
        input,
        (inputPath) => isEncryptedArgs(inputPath),
        async (result) => {
          if (result.timedOut) throw new Error("qpdf timed out.");
          if (result.code === 0) return true;
          if (result.code === QPDF_EXIT_STATUS_2) return false;
          throw new Error("qpdf could not determine encryption status.");
        },
        false,
      );
    },

    async protect(input, opts) {
      return withJob(
        input,
        (inputPath, outputPath) => protectArgs(inputPath, outputPath, opts),
        async (result, readOutput) => {
          if (result.timedOut || result.code !== 0) {
            throw new Error("qpdf encryption failed.");
          }
          return readOutput();
        },
        true,
      );
    },

    async unlock(input, opts): Promise<QpdfUnlockOutcome> {
      return withJob(
        input,
        (inputPath, outputPath) => unlockArgs(inputPath, outputPath, opts),
        async (result, readOutput): Promise<QpdfUnlockOutcome> => {
          if (result.timedOut) throw new Error("qpdf timed out.");
          // Exit 2 on a decrypt of a known-encrypted file is a wrong password.
          if (result.code === QPDF_EXIT_STATUS_2) {
            return { ok: false, wrongPassword: true };
          }
          if (result.code !== 0) throw new Error("qpdf decryption failed.");
          return { ok: true, output: await readOutput() };
        },
        true,
      );
    },
  };
}

/**
 * Probe whether qpdf is usable under a configuration:
 *  - a disabled config yields false (the kill switch);
 *  - an overridden binary is probed by absolute-path existence, an auto-detected
 *    one by PATH presence.
 * Presence only — nothing is executed.
 */
export function probeQpdfFromConfig(
  config: NativePdfSecurityConfig,
  seams: QpdfSeams = {},
): boolean {
  if (!config.enabled) return false;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  return config.overridden ? fileExists(config.binary) : onPath(config.binary);
}

/**
 * Probe qpdf availability from the environment, honoring the enable flag and
 * binary override. Presence only; used by the client-facing status route (which
 * reports availability, never a path). `env`/`seams` are injectable for tests.
 */
export function probeQpdf(
  env: Record<string, string | undefined> = process.env,
  seams: QpdfSeams = {},
): boolean {
  return probeQpdfFromConfig(resolveNativePdfSecurityConfig(env), seams);
}

/**
 * The real PDF-security dependencies for this host: a config-aware qpdf probe (so a
 * newly installed or reconfigured binary is picked up without a restart) that wires
 * the native runner only when qpdf is actually usable, plus the config's
 * input-size limit. When qpdf is unavailable, `qpdf` is left undefined so the engine
 * reports itself honestly not-ready and fails requests as `unsupported`. Called by
 * the local-dev adapter and the worker daemon at wiring time.
 */
export function nativePdfSecurityDeps(
  env: Record<string, string | undefined> = process.env,
  seams: QpdfSeams = {},
): PdfSecurityDeps {
  const config = resolveNativePdfSecurityConfig(env);
  const available = probeQpdfFromConfig(config, seams);
  return {
    ...(available ? { qpdf: createNativeQpdfRunner(config, seams) } : {}),
    limits: { maxInputBytes: config.maxInputBytes },
  };
}
