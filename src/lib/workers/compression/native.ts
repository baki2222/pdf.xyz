/**
 * The real, host-side implementations behind the compression engine's injected
 * dependencies: a presence-only PATH probe and a native deep-compressor that
 * shells out to Ghostscript / qpdf / mutool in an isolated temp directory.
 *
 * This is the ONLY module that touches Node built-ins (`fs`, `child_process`,
 * …), and it is imported lazily — only when `PDFXYZ_WORKER_MODE=local-dev` —
 * so the default/remote code paths and the client bundle never pull it in. The
 * PATH probe reads the *presence* of a binary; it never executes it. The
 * compressor runs with fixed arguments over fixed temp paths (no user-supplied
 * paths), a hard timeout, and guaranteed cleanup.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveOnPath } from "../native-path";
import {
  probeCompressionTools,
  type CompressionDeps,
  type CompressionTool,
  type NativeCompressor,
} from "./engine";

// Re-exported so existing importers (e.g. the worker status route) can keep
// resolving the presence-only PATH probe from this module. The implementation
// now lives in the shared `native-path` module used by every native engine.
export { resolveOnPath } from "../native-path";

const run = promisify(execFile);

/** Hard ceilings so a wedged or hostile engine can't hang or exhaust the host. */
const EXEC_TIMEOUT_MS = 120_000;
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;

/** Build the fixed argument list for each native engine. */
function nativeArgs(
  engine: CompressionTool,
  inputPath: string,
  outputPath: string,
  targetDpi: number,
): { command: string; args: string[] } {
  switch (engine) {
    case "ghostscript":
      return {
        command: "gs",
        args: [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.7",
          "-dPDFSETTINGS=/ebook",
          "-dNOPAUSE",
          "-dBATCH",
          "-dQUIET",
          "-dDownsampleColorImages=true",
          "-dDownsampleGrayImages=true",
          "-dDownsampleMonoImages=true",
          `-dColorImageResolution=${targetDpi}`,
          `-dGrayImageResolution=${targetDpi}`,
          `-dMonoImageResolution=${targetDpi}`,
          `-sOutputFile=${outputPath}`,
          inputPath,
        ],
      };
    case "qpdf":
      return {
        command: "qpdf",
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
        command: "mutool",
        args: ["clean", "-ggg", "-z", inputPath, outputPath],
      };
  }
}

/**
 * Run a native deep-compression engine in an isolated temp directory. Writes the
 * input, invokes the tool with fixed arguments, reads the output, and always
 * removes the temp directory afterward. Throws on any failure so the engine can
 * classify it honestly as a `failed` run.
 */
export const spawnNativeCompressor: NativeCompressor = async (input, ctx) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-compress-"));
  const inputPath = path.join(dir, "input.pdf");
  const outputPath = path.join(dir, "output.pdf");
  try {
    await writeFile(inputPath, input);
    const { command, args } = nativeArgs(
      ctx.engine,
      inputPath,
      outputPath,
      ctx.options.targetDpi,
    );
    await run(command, args, {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
      windowsHide: true,
    });
    const output = await readFile(outputPath);
    if (output.byteLength === 0 || output.byteLength > MAX_OUTPUT_BYTES) {
      throw new Error("Native compressor produced no usable output.");
    }
    return new Uint8Array(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * The real compression dependencies for this host: a fresh PATH probe (so a
 * newly installed engine is picked up without a restart) plus the native
 * compressor. Called by the local-dev adapter at job time.
 */
export function nativeCompressionDeps(): CompressionDeps {
  return {
    tools: probeCompressionTools(resolveOnPath),
    native: spawnNativeCompressor,
  };
}
