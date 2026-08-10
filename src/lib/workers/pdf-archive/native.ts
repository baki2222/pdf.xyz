import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksLikePdf } from "../compression/engine";
import type { GhostscriptPdfARunner, PdfArchiveDeps } from "./engine";
import {
  resolveNativePdfArchiveConfig,
  type NativePdfArchiveConfig,
} from "./native-config";

const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

export interface GhostscriptExecResult {
  code: number;
  timedOut: boolean;
}

export type GhostscriptExec = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
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

const defaultExec: GhostscriptExec = (command, args, options) =>
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
        resolve({
          code: typeof error.code === "number" ? error.code : -1,
          timedOut: !!error.killed,
        });
      },
    );
  });

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

export function ghostscriptPdfAArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    "-dPDFA=2",
    "-dBATCH",
    "-dNOPAUSE",
    "-dNOOUTERSAVE",
    "-dSAFER",
    "-sProcessColorModel=DeviceRGB",
    "-sDEVICE=pdfwrite",
    "-dPDFACompatibilityPolicy=1",
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
}

export function createNativeGhostscriptPdfARunner(
  config: NativePdfArchiveConfig,
  seams: GhostscriptSeams = {},
): GhostscriptPdfARunner {
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();
  return {
    async convertToPdfA(input) {
      if (input.byteLength > config.maxInputBytes)
        throw new Error("Input exceeds size limit.");
      const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-pdfa-"));
      const inputPath = path.join(dir, "input.pdf");
      const outputPath = path.join(dir, "output.pdf");
      try {
        await fs.writeFile(inputPath, input);
        const result = await exec(
          config.binary,
          ghostscriptPdfAArgs(inputPath, outputPath),
          {
            timeout: config.timeoutMs,
            maxBuffer: EXEC_MAX_BUFFER,
            windowsHide: true,
          },
        );
        if (result.timedOut || result.code !== 0)
          throw new Error("Ghostscript PDF/A conversion failed.");
        const output = await fs.readFile(outputPath);
        const bytes =
          output instanceof Uint8Array ? output : new Uint8Array(output);
        if (
          bytes.byteLength === 0 ||
          bytes.byteLength > config.maxOutputBytes ||
          !looksLikePdf(bytes)
        ) {
          throw new Error("Ghostscript produced no usable PDF output.");
        }
        return bytes;
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
  return config.overridden ? fileExists(config.binary) : onPath(config.binary);
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
