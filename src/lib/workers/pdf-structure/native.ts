/**
 * Native qpdf runner for PDF structure operations. It shells out with fixed argv
 * arrays (never a shell) inside an isolated temp directory and validates output
 * before returning bytes.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PdfStructureDeps, QpdfStructureRunner } from "./engine";
import { looksLikePdf } from "../compression/engine";
import {
  resolveNativePdfStructureConfig,
  type NativePdfStructureConfig,
} from "./native-config";

const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

export interface QpdfStructureExecResult {
  code: number;
  timedOut: boolean;
}

export type QpdfStructureExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<QpdfStructureExecResult>;

export interface QpdfStructureFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (
    dir: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
}

export interface QpdfStructureSeams {
  resolveOnPath?: (binary: string) => boolean;
  fileExists?: (filePath: string) => boolean;
  exec?: QpdfStructureExec;
  fs?: QpdfStructureFs;
}

const defaultExec: QpdfStructureExec = (command, args, options) =>
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
        resolve({
          code: typeof error.code === "number" ? error.code : -1,
          timedOut: false,
        });
      },
    );
  });

const defaultFs: QpdfStructureFs = {
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
    if (dir.length === 0) continue;
    for (const ext of exts) {
      if (isRegularFile(path.join(dir, binary + ext))) return true;
    }
  }
  return false;
}

/** qpdf's plain input/output rewrite can recover and normalize damaged structure. */
export function repairArgs(inputPath: string, outputPath: string): string[] {
  return [inputPath, outputPath];
}

/** qpdf `--linearize` creates a fast-web-view/progressive-loading PDF. */
export function linearizeArgs(inputPath: string, outputPath: string): string[] {
  return ["--linearize", inputPath, outputPath];
}

export function createNativeQpdfStructureRunner(
  config: NativePdfStructureConfig,
  seams: QpdfStructureSeams = {},
): QpdfStructureRunner {
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();

  async function withJob(
    input: Uint8Array,
    build: (inputPath: string, outputPath: string) => string[],
  ): Promise<Uint8Array> {
    if (input.byteLength > config.maxInputBytes) {
      throw new Error("Input exceeds the configured maximum size.");
    }
    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-structure-"));
    const inputPath = path.join(dir, "input.pdf");
    const outputPath = path.join(dir, "output.pdf");
    try {
      await fs.writeFile(inputPath, input);
      const result = await exec(config.binary, build(inputPath, outputPath), {
        timeout: config.timeoutMs,
        maxBuffer: EXEC_MAX_BUFFER,
        windowsHide: true,
      });
      if (result.timedOut || result.code !== 0) {
        throw new Error("qpdf structure operation failed.");
      }
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
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    repair: (input) => withJob(input, repairArgs),
    linearize: (input) => withJob(input, linearizeArgs),
  };
}

export function probeQpdfStructureFromConfig(
  config: NativePdfStructureConfig,
  seams: QpdfStructureSeams = {},
): boolean {
  if (!config.enabled) return false;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  return config.overridden ? fileExists(config.binary) : onPath(config.binary);
}

export function nativePdfStructureDeps(
  env: Record<string, string | undefined> = process.env,
  seams: QpdfStructureSeams = {},
): PdfStructureDeps {
  const config = resolveNativePdfStructureConfig(env);
  const available = probeQpdfStructureFromConfig(config, seams);
  return {
    ...(available
      ? { qpdf: createNativeQpdfStructureRunner(config, seams) }
      : {}),
    limits: { maxInputBytes: config.maxInputBytes },
  };
}
