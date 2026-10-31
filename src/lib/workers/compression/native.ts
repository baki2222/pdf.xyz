/**
 * The real, host-side implementations behind the compression engine's injected
 * dependencies: a presence-only binary probe and a native deep-compressor that
 * shells out to Ghostscript / qpdf / mutool in an isolated temp directory.
 *
 * This is the ONLY module that touches Node built-ins (`fs`, `child_process`,
 * …). It is pulled in exclusively by non-browser code — the local-dev worker
 * adapter and the `/api/worker/status` route (both via a lazy `import()`, only in
 * `PDFXYZ_WORKER_MODE=local-dev`) and the out-of-band daemon runtime
 * (`daemon/runtime.ts`, a separate Node process the web app never imports). So the
 * default/remote request paths and the client bundle never pull it in.
 *
 * Everything it does is driven by the typed, bounded {@link NativeCompressionConfig}
 * parsed from the environment (`./native-config`):
 *  - the engine is **enable-gated** (a kill switch can force it off) and may be
 *    **pinned** to one engine;
 *  - each engine is invoked by a fixed command name (auto-detected on PATH) or an
 *    allowlisted **absolute override path** (probed by existence, never executed
 *    during detection);
 *  - the compressor runs with a **fixed argv array** (no shell, no interpolation)
 *    over fixed temp paths (never a user-supplied path), a hard **timeout**, hard
 *    **input/output byte ceilings**, a structural PDF check on the output, and
 *    **guaranteed temp-dir cleanup** on success, failure, and timeout alike.
 *
 * The subprocess/filesystem/probe boundaries are all injectable seams, so every
 * branch — argv construction, timeout, engine failure, invalid output, cleanup —
 * is unit-tested without a real binary or child process.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  looksLikePdf,
  type CompressionDeps,
  type CompressionTool,
  type NativeCompressor,
  type ToolAvailability,
} from "./engine";
import {
  resolveNativeCompressionConfig,
  type NativeCompressionConfig,
} from "./native-config";

/** stdout/stderr capture ceiling. Our engines are `-QUIET` and write to a file, so this is generous. */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/** Run a subprocess by argv (never a shell). Injectable so tests never spawn a real process. */
export type NativeExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<unknown>;

/** The temp-file operations the compressor needs. Injectable for deterministic tests. */
export interface NativeFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (
    dir: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
}

/** All the host seams the native layer touches; each defaults to the real Node built-in. */
export interface NativeSeams {
  /** Resolve whether a bare command exists on PATH (presence only; never executes). */
  resolveOnPath?: (binary: string) => boolean;
  /** Whether an absolute path exists and is a regular file (for override probing). */
  fileExists?: (filePath: string) => boolean;
  /** Subprocess runner. */
  exec?: NativeExec;
  /** Temp-file operations. */
  fs?: NativeFs;
}

const runExecFile = promisify(execFile);
const defaultExec: NativeExec = (command, args, options) =>
  runExecFile(command, [...args], options);

const defaultFs: NativeFs = {
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
 * Build the fixed argument list for a native engine. `command` is the resolved
 * invocation (a bare command name or an allowlisted override path); `inputPath`
 * and `outputPath` are worker-owned temp paths. Every value is a separate argv
 * element — there is no shell, no string concatenation of a command line, and no
 * user-supplied path, so filenames and options can never be interpreted as flags
 * or shell syntax.
 */
export function nativeArgs(
  engine: CompressionTool,
  command: string,
  inputPath: string,
  outputPath: string,
  targetDpi: number,
  opts: { grayscale?: boolean } = {},
): { command: string; args: string[] } {
  // Only Ghostscript re-renders through a colour model. Building a grayscale
  // argv for the others would run a job that cannot do what it was asked;
  // the planner never routes one here (`GRAYSCALE_TOOLS`), and this is the
  // backstop if something does.
  if (opts.grayscale && engine !== "ghostscript") {
    throw new Error(`${engine} cannot convert colour to grayscale.`);
  }
  switch (engine) {
    case "ghostscript":
      return {
        command,
        args: [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.7",
          "-dPDFSETTINGS=/ebook",
          "-dNOPAUSE",
          "-dBATCH",
          "-dQUIET",
          "-dSAFER",
          "-dDownsampleColorImages=true",
          "-dDownsampleGrayImages=true",
          "-dDownsampleMonoImages=true",
          `-dColorImageResolution=${targetDpi}`,
          `-dGrayImageResolution=${targetDpi}`,
          `-dMonoImageResolution=${targetDpi}`,
          // Every colour — images, text, drawing — through DeviceGray. The
          // engine re-reads the output's images (`image-colour.ts`) and fails
          // the run if one still has more than one component.
          ...(opts.grayscale
            ? [
                "-sColorConversionStrategy=Gray",
                "-dProcessColorModel=/DeviceGray",
              ]
            : []),
          `-sOutputFile=${outputPath}`,
          inputPath,
        ],
      };
    case "qpdf":
      return {
        command,
        args: [
          "--object-streams=generate",
          "--compress-streams=y",
          "--recompress-flate",
          "--optimize-images",
          inputPath,
          outputPath,
        ],
      };
    case "mutool":
      return {
        command,
        args: ["clean", "-ggg", "-z", inputPath, outputPath],
      };
  }
}

/**
 * Build a native deep-compressor bound to a configuration. Writes the input to an
 * isolated temp dir, invokes the engine with a fixed argv array, reads the output,
 * and ALWAYS removes the temp dir afterward — on success, engine failure, or
 * timeout. Throws on any failure (oversized input/output, empty or non-PDF output,
 * subprocess error) so the engine can classify it honestly; it never returns
 * fabricated bytes.
 */
export function createNativeCompressor(
  config: NativeCompressionConfig,
  seams: NativeSeams = {},
): NativeCompressor {
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();

  return async (input, ctx) => {
    // Backstop the input ceiling here too, in case a caller reaches the native
    // runner without the engine-level `limits` guard. Deterministic → the engine
    // classifies the throw as a failure rather than looping.
    if (input.byteLength > config.maxInputBytes) {
      throw new Error("Input exceeds the configured maximum size.");
    }
    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-compress-"));
    const inputPath = path.join(dir, "input.pdf");
    const outputPath = path.join(dir, "output.pdf");
    try {
      await fs.writeFile(inputPath, input);
      const { command, args } = nativeArgs(
        ctx.engine,
        config.binaries[ctx.engine],
        inputPath,
        outputPath,
        ctx.options.targetDpi,
        { grayscale: ctx.options.grayscale === true },
      );
      await exec(command, args, {
        // A target ladder's rung gets what is left of the ladder's budget;
        // never MORE than the configured ceiling, whatever it was handed.
        timeout:
          ctx.timeoutMs === undefined
            ? config.timeoutMs
            : Math.max(
                1,
                Math.min(config.timeoutMs, Math.floor(ctx.timeoutMs)),
              ),
        maxBuffer: EXEC_MAX_BUFFER,
        windowsHide: true,
      });
      const output = await fs.readFile(outputPath);
      if (
        output.byteLength === 0 ||
        output.byteLength > config.maxOutputBytes ||
        !looksLikePdf(output)
      ) {
        throw new Error("Native compressor produced no usable PDF output.");
      }
      return output instanceof Uint8Array ? output : new Uint8Array(output);
    } finally {
      // Cleanup runs on every exit path — success, throw, or timeout. Never let a
      // cleanup error mask the real outcome or leak a path.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/**
 * Probe which deep-compression engines are actually usable under a configuration:
 *  - a disabled config yields no engines (the kill switch);
 *  - a pinned config considers only that engine;
 *  - an overridden engine is probed by absolute-path existence, an auto-detected
 *    one by PATH presence.
 * Presence only — nothing is executed.
 */
export function probeNativeToolsFromConfig(
  config: NativeCompressionConfig,
  seams: NativeSeams = {},
): ToolAvailability {
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;

  const usable = (tool: CompressionTool): boolean => {
    if (!config.enabled) return false;
    if (config.engine && config.engine !== tool) return false;
    return config.overridden[tool]
      ? fileExists(config.binaries[tool])
      : onPath(config.binaries[tool]);
  };

  return {
    ghostscript: usable("ghostscript"),
    qpdf: usable("qpdf"),
    mutool: usable("mutool"),
  };
}

/**
 * Probe deep-compression engine availability from the environment, honoring the
 * enable flag, pin, and binary overrides. Presence only; used by the client-facing
 * status route (which reports engine *names*, never paths). `env`/`seams` are
 * injectable for tests.
 */
export function probeNativeTools(
  env: Record<string, string | undefined> = process.env,
  seams: NativeSeams = {},
): ToolAvailability {
  return probeNativeToolsFromConfig(resolveNativeCompressionConfig(env), seams);
}

/**
 * The real compression dependencies for this host: a config-aware engine probe
 * (so a newly installed or reconfigured engine is picked up without a restart),
 * the native compressor bound to the same config, and the config's input-size
 * limit. Called by the local-dev adapter and the worker daemon at wiring time.
 * `env` defaults to `process.env`, so existing zero-argument call sites keep
 * working and simply pick up the environment's configuration.
 */
export function nativeCompressionDeps(
  env: Record<string, string | undefined> = process.env,
  seams: NativeSeams = {},
): CompressionDeps {
  const config = resolveNativeCompressionConfig(env);
  return {
    tools: probeNativeToolsFromConfig(config, seams),
    native: createNativeCompressor(config, seams),
    limits: {
      maxInputBytes: config.maxInputBytes,
      // Every rung of a target-size ladder shares the time ONE run is allowed,
      // so a target job can never outlast an ordinary deep job.
      targetBudgetMs: config.timeoutMs,
    },
  };
}
