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
import {
  QPDF_EXIT_ERROR,
  QPDF_EXIT_WARNINGS,
  qpdfWroteOutput,
} from "../qpdf-exit";
import type {
  QpdfPasswordRequirement,
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
 * signal (e.g. `--is-encrypted` returns 2 for "not encrypted" — or for a file it
 * could not open at all, the same number — `--decrypt` returns 2 for a wrong
 * password AND for every other error, and any write returns 3 when it had to
 * repair the input on the way — see `../qpdf-exit`). Because one number carries
 * several answers, the runner asks qpdf a second, narrower question whenever it
 * sees 2 (see {@link openCheckArgs} and {@link passwordCheckArgs}). Injectable
 * so tests never spawn a real process.
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
  rm: (
    dir: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
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
      (
        error: (Error & { code?: number | string; killed?: boolean }) | null,
      ) => {
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

/**
 * Build the qpdf argument vector for "does opening this file with THIS password
 * work?" — `--requires-password` with the supplied password. qpdf answers 0 when
 * a password is needed and the one supplied does not open the file, 3 when it
 * does, and 2 when the file is not encrypted or cannot be opened at all. It
 * reads the file and writes nothing. It carries the password, so it goes through
 * the at-file like the decrypt it follows.
 *
 * Why it exists: `--decrypt` exits 2 for a wrong password and for EVERY other
 * error, and qpdf has no status of its own for a wrong password. Reading qpdf's
 * stderr would tell them apart, but stderr is deliberately discarded (it can
 * carry qpdf's diagnostics, which are never surfaced or logged), so the wrong
 * password is established by this exit status instead.
 */
export function passwordCheckArgs(
  inputPath: string,
  opts: QpdfUnlockInput,
): string[] {
  return [`--password=${opts.password}`, "--requires-password", inputPath];
}

/**
 * Build the qpdf argument vector for "can qpdf open this file, with no password,
 * at all?" — `--show-npages` reads the file and its page tree and writes
 * nothing: 0 (or 3, opened with warnings) yes; 2 no. It is asked only after an
 * encryption check answered 2, which means "not encrypted" OR "could not open
 * the file" — one number, two answers, and only the first is "not encrypted".
 */
export function openCheckArgs(inputPath: string): string[] {
  return ["--show-npages", inputPath];
}

/** Build the qpdf argument vector for the presence-only encryption check. */
export function isEncryptedArgs(inputPath: string): string[] {
  return ["--is-encrypted", inputPath];
}

/**
 * Build the qpdf argument vector for "does opening this file need a password?".
 * No `--password` is passed, so qpdf tries the empty user password: a file that
 * opens with it answers 3, one that does not answers 0.
 */
export function requiresPasswordArgs(inputPath: string): string[] {
  return ["--requires-password", inputPath];
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

  /**
   * One job's qpdf invocations, all over the same isolated temp dir: `run`
   * builds an argv over the job's input/output paths and executes it (through
   * the at-file when `sensitive`), `readOutput` reads and bounds the output.
   */
  interface QpdfJob {
    run: (
      build: (inputPath: string, outputPath: string) => string[],
      /** When true, the argv carries a password and MUST go through an at-file. */
      sensitive: boolean,
    ) => Promise<QpdfExecResult>;
    readOutput: () => Promise<Uint8Array>;
  }

  /** Run `body` inside a fresh temp dir holding the input; ALWAYS removes the dir. */
  async function withJob<T>(
    input: Uint8Array,
    body: (job: QpdfJob) => Promise<T>,
  ): Promise<T> {
    if (input.byteLength > config.maxInputBytes) {
      throw new Error("Input exceeds the configured maximum size.");
    }
    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-security-"));
    const inputPath = path.join(dir, "input.pdf");
    const outputPath = path.join(dir, "output.pdf");
    try {
      await fs.writeFile(inputPath, input);

      const run: QpdfJob["run"] = async (build, sensitive) => {
        const argv = build(inputPath, outputPath);
        let commandArgs: string[];
        if (sensitive) {
          // Write the full argv (one token per line) to a qpdf at-file, so the
          // password never appears on the command line or in an exec error string.
          const argsPath = path.join(dir, "qpdf.args");
          await fs.writeFile(
            argsPath,
            new TextEncoder().encode(argv.join("\n")),
          );
          commandArgs = [`@${argsPath}`];
        } else {
          commandArgs = argv;
        }
        return exec(config.binary, commandArgs, {
          timeout: config.timeoutMs,
          maxBuffer: EXEC_MAX_BUFFER,
          windowsHide: true,
        });
      };

      const readOutput = async (): Promise<Uint8Array> => {
        const output = await fs.readFile(outputPath);
        const bytes =
          output instanceof Uint8Array ? output : new Uint8Array(output);
        if (
          bytes.byteLength === 0 ||
          bytes.byteLength > config.maxOutputBytes ||
          !looksLikePdf(bytes)
        ) {
          throw new Error("qpdf produced no usable PDF output.");
        }
        return bytes;
      };

      return await body({ run, readOutput });
    } finally {
      // Cleanup runs on every exit path — success, throw, or timeout. Never let a
      // cleanup error mask the real outcome or leak a path (and it removes the
      // at-file that briefly held the password).
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * After an encryption check answered 2: does the file open at all? 2 from
   * `--is-encrypted` / `--requires-password` is "not encrypted" only when it
   * does; otherwise qpdf could not open it (damaged beyond repair, or an
   * encryption scheme qpdf does not support) and "not encrypted" would be a lie.
   */
  async function opensAtAll(job: QpdfJob): Promise<boolean> {
    const check = await job.run((inputPath) => openCheckArgs(inputPath), false);
    if (check.timedOut) throw new Error("qpdf timed out.");
    // 0, or 3 = opened with warnings (a repaired xref still opens).
    if (check.code === 0 || check.code === QPDF_EXIT_WARNINGS) return true;
    if (check.code === QPDF_EXIT_ERROR) return false;
    throw new Error("qpdf could not determine whether the file opens.");
  }

  return {
    async isEncrypted(input) {
      // No password involved, so the argv is not sensitive.
      return withJob(input, async (job) => {
        const result = await job.run(
          (inputPath) => isEncryptedArgs(inputPath),
          false,
        );
        if (result.timedOut) throw new Error("qpdf timed out.");
        if (result.code === 0) return true;
        if (result.code === QPDF_EXIT_ERROR) {
          // "Not encrypted" only for a file qpdf can open; an unreadable one
          // throws, so it can never pass as a successfully decrypted output.
          if (await opensAtAll(job)) return false;
          throw new Error("qpdf could not open the file.");
        }
        throw new Error("qpdf could not determine encryption status.");
      });
    },

    async requiresPassword(input): Promise<QpdfPasswordRequirement> {
      // No password involved (qpdf tries the empty one), so not sensitive.
      return withJob(input, async (job): Promise<QpdfPasswordRequirement> => {
        const result = await job.run(
          (inputPath) => requiresPasswordArgs(inputPath),
          false,
        );
        if (result.timedOut) throw new Error("qpdf timed out.");
        // qpdf's documented answers to `--requires-password`. 3 here is NOT
        // "warnings": it is "encrypted, and the (empty) password opens it".
        // 2 is "not encrypted" OR "qpdf could not open the file" — one
        // number, so it is split by asking whether the file opens at all.
        if (result.code === 0) return "needs-password";
        if (result.code === QPDF_EXIT_WARNINGS) return "opens-freely";
        if (result.code === QPDF_EXIT_ERROR) {
          return (await opensAtAll(job)) ? "not-encrypted" : "unreadable";
        }
        throw new Error("qpdf could not determine the password requirement.");
      });
    },

    async protect(input, opts) {
      return withJob(input, async (job) => {
        const result = await job.run(
          (inputPath, outputPath) => protectArgs(inputPath, outputPath, opts),
          true,
        );
        // 0, or 3 = "warnings, output written": qpdf had to repair the input
        // (a broken xref, a wrong startxref) and then encrypted it. The output
        // is still read and validated here, and the engine re-proves it needs
        // the new password to open, so accepting 3 accepts no unproven bytes.
        if (!qpdfWroteOutput(result)) {
          throw new Error("qpdf encryption failed.");
        }
        return job.readOutput();
      });
    },

    async unlock(input, opts): Promise<QpdfUnlockOutcome> {
      return withJob(input, async (job): Promise<QpdfUnlockOutcome> => {
        const result = await job.run(
          (inputPath, outputPath) => unlockArgs(inputPath, outputPath, opts),
          true,
        );
        if (result.timedOut) throw new Error("qpdf timed out.");
        if (result.code === QPDF_EXIT_ERROR) {
          // 2 is qpdf's status for ANY error, not a wrong-password status (it
          // has none). Ask the narrower question with the same password.
          const check = await job.run(
            (inputPath) => passwordCheckArgs(inputPath, opts),
            true,
          );
          if (check.timedOut) throw new Error("qpdf timed out.");
          // 0: a password is needed and this one does not open the file.
          if (check.code === 0) return { ok: false, reason: "wrong-password" };
          // 2: qpdf cannot open the file at all (damaged, or an encryption
          // scheme it does not support) — the password was never the problem.
          if (check.code === QPDF_EXIT_ERROR) {
            return { ok: false, reason: "unreadable" };
          }
          // 3 (the password opens it, yet the decrypt failed) or anything else:
          // neither the password nor provably the file — an engine failure.
          throw new Error("qpdf decryption failed.");
        }
        // 0, or 3 = decrypted a damaged file with warnings (see protect).
        if (!qpdfWroteOutput(result)) {
          throw new Error("qpdf decryption failed.");
        }
        return { ok: true, output: await job.readOutput() };
      });
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
