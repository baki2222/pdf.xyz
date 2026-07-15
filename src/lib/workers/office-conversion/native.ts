import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksLikePdf } from "../compression/engine";
import type { LibreOfficePdfRunner, OfficeConversionDeps } from "./engine";
import { resolveNativeOfficeConversionConfig, type NativeOfficeConversionConfig } from "./native-config";

const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

export interface LibreOfficeExecResult { code: number; timedOut: boolean }
export type LibreOfficeExec = (command: string, args: readonly string[], options: { timeout: number; maxBuffer: number; windowsHide: boolean }) => Promise<LibreOfficeExecResult>;
export interface LibreOfficeFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (dir: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
}
export interface LibreOfficeSeams {
  resolveOnPath?: (binary: string) => boolean;
  fileExists?: (filePath: string) => boolean;
  exec?: LibreOfficeExec;
  fs?: LibreOfficeFs;
}

const defaultExec: LibreOfficeExec = (command, args, options) => new Promise((resolve) => {
  execFile(command, [...args], { ...options, encoding: "buffer" }, (error: (Error & { code?: number | string; killed?: boolean }) | null) => {
    if (!error) return resolve({ code: 0, timedOut: false });
    resolve({ code: typeof error.code === "number" ? error.code : -1, timedOut: !!error.killed });
  });
});
const defaultFs: LibreOfficeFs = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  writeFile: (file, data) => writeFile(file, data),
  readFile: async (file) => new Uint8Array(await readFile(file)),
  rm: (dir, options) => rm(dir, options),
};

function isRegularFile(filePath: string): boolean {
  try { return existsSync(filePath) && statSync(filePath).isFile(); } catch { return false; }
}

export function resolveOnPath(binary: string): boolean {
  const pathVar = process.env.PATH ?? "";
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) if (isRegularFile(path.join(dir, binary + ext))) return true;
  }
  return false;
}

export function libreOfficeConvertArgs(inputPath: string, outputDir: string): string[] {
  return ["--headless", "--nologo", "--nofirststartwizard", "--nodefault", "--nolockcheck", "--convert-to", "pdf", "--outdir", outputDir, inputPath];
}

export function probeLibreOfficeFromConfig(config: NativeOfficeConversionConfig, seams: LibreOfficeSeams = {}): string | null {
  if (!config.enabled) return null;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  for (const candidate of config.candidates) {
    if (config.overridden ? fileExists(candidate) : onPath(candidate)) return candidate;
  }
  return null;
}

function safeInputName(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).replace(/[^a-zA-Z0-9.]/g, "") : ".docx";
  return `input${ext || ".docx"}`;
}

export function createNativeLibreOfficePdfRunner(config: NativeOfficeConversionConfig, seams: LibreOfficeSeams = {}): LibreOfficePdfRunner {
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();
  const binary = probeLibreOfficeFromConfig(config, seams) ?? config.candidates[0] ?? "soffice";
  return {
    async convertToPdf(input, filename) {
      if (input.byteLength > config.maxInputBytes) throw new Error("Input exceeds size limit.");
      const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-office-"));
      const inputName = safeInputName(filename);
      const inputPath = path.join(dir, inputName);
      const outputPath = path.join(dir, `${inputName.replace(/\.[^.]+$/, "")}.pdf`);
      try {
        await fs.writeFile(inputPath, input);
        const result = await exec(binary, libreOfficeConvertArgs(inputPath, dir), { timeout: config.timeoutMs, maxBuffer: EXEC_MAX_BUFFER, windowsHide: true });
        if (result.timedOut || result.code !== 0) throw new Error("LibreOffice conversion failed.");
        const output = await fs.readFile(outputPath);
        const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
        if (bytes.byteLength === 0 || bytes.byteLength > config.maxOutputBytes || !looksLikePdf(bytes)) throw new Error("LibreOffice produced no usable PDF output.");
        return bytes;
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

export function nativeOfficeConversionDeps(env: Record<string, string | undefined> = process.env, seams: LibreOfficeSeams = {}): OfficeConversionDeps {
  const config = resolveNativeOfficeConversionConfig(env);
  const available = probeLibreOfficeFromConfig(config, seams);
  return {
    ...(available ? { libreoffice: createNativeLibreOfficePdfRunner(config, seams) } : {}),
    limits: { maxInputBytes: config.maxInputBytes, maxOutputBytes: config.maxOutputBytes },
  };
}
