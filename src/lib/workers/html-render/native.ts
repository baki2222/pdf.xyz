import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { looksLikePdf } from "../compression/engine";
import type { ChromiumPdfRunner, HtmlRenderDeps } from "./engine";
import { resolveNativeHtmlRenderConfig, type NativeHtmlRenderConfig } from "./native-config";

const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

export interface ChromiumExecResult { code: number; timedOut: boolean }
export type ChromiumExec = (command: string, args: readonly string[], options: { timeout: number; maxBuffer: number; windowsHide: boolean }) => Promise<ChromiumExecResult>;

export interface ChromiumFs {
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
  rm: (dir: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
}

export interface ChromiumSeams {
  resolveOnPath?: (binary: string) => boolean;
  fileExists?: (filePath: string) => boolean;
  exec?: ChromiumExec;
  fs?: ChromiumFs;
}

const defaultExec: ChromiumExec = (command, args, options) =>
  new Promise((resolve) => {
    execFile(command, [...args], { ...options, encoding: "buffer" }, (error: (Error & { code?: number | string; killed?: boolean }) | null) => {
      if (!error) {
        resolve({ code: 0, timedOut: false });
        return;
      }
      resolve({ code: typeof error.code === "number" ? error.code : -1, timedOut: !!error.killed });
    });
  });

const defaultFs: ChromiumFs = {
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
  if (!pathVar) return false;
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) if (isRegularFile(path.join(dir, binary + ext))) return true;
  }
  return false;
}

export function chromiumPdfArgs(source: string, outputPath: string): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=10000",
    `--print-to-pdf=${outputPath}`,
    source,
  ];
}

export function probeChromiumFromConfig(config: NativeHtmlRenderConfig, seams: ChromiumSeams = {}): string | null {
  if (!config.enabled) return null;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  for (const candidate of config.candidates) {
    if (config.overridden ? fileExists(candidate) : onPath(candidate)) return candidate;
  }
  return null;
}

export function createNativeChromiumPdfRunner(config: NativeHtmlRenderConfig, seams: ChromiumSeams = {}): ChromiumPdfRunner {
  const exec = seams.exec ?? defaultExec;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();
  const binary = probeChromiumFromConfig(config, seams) ?? config.candidates[0] ?? "chromium";

  async function render(source: string, write?: { path: string; bytes: Uint8Array }): Promise<Uint8Array> {
    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-html-"));
    const outputPath = path.join(dir, "output.pdf");
    try {
      let renderSource = source;
      if (write) {
        const inputPath = path.join(dir, write.path);
        await fs.writeFile(inputPath, write.bytes);
        renderSource = pathToFileURL(inputPath).toString();
      }
      const result = await exec(binary, chromiumPdfArgs(renderSource, outputPath), { timeout: config.timeoutMs, maxBuffer: EXEC_MAX_BUFFER, windowsHide: true });
      if (result.timedOut || result.code !== 0) throw new Error("Chromium HTML rendering failed.");
      const output = await fs.readFile(outputPath);
      const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
      if (bytes.byteLength === 0 || bytes.byteLength > config.maxOutputBytes || !looksLikePdf(bytes)) {
        throw new Error("Chromium produced no usable PDF output.");
      }
      return bytes;
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    renderHtml(input) {
      if (input.byteLength > config.maxInputBytes) throw new Error("Input exceeds size limit.");
      return render("", { path: "input.html", bytes: input });
    },
    renderUrl(url) {
      return render(url);
    },
  };
}

export function nativeHtmlRenderDeps(env: Record<string, string | undefined> = process.env, seams: ChromiumSeams = {}): HtmlRenderDeps {
  const config = resolveNativeHtmlRenderConfig(env);
  const available = probeChromiumFromConfig(config, seams);
  return {
    ...(available ? { chromium: createNativeChromiumPdfRunner(config, seams) } : {}),
    limits: { maxInputBytes: config.maxInputBytes, maxOutputBytes: config.maxOutputBytes },
  };
}
