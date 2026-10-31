// @vitest-environment node
/**
 * Every engine family stops its child process when the attempt's signal aborts.
 *
 * WHY (PR #245 follow-up). The executor aborts `ProcessorInput.signal` when a
 * lease renewal is REJECTED — another attempt owns the job — and discards
 * whatever that attempt produces. Until this change no processor read the
 * signal, so a lost attempt ran its Ghostscript / qpdf / LibreOffice /
 * Chromium / pdftotext / OCRmyPDF child to completion on a single small VPS,
 * for nobody, holding an engine slot.
 *
 * WHAT IS REAL HERE, and what is not. Each case builds the PROCESSOR from the
 * family's own production deps builder and its own production exec/launch
 * function (`defaultXExec`, exported for exactly this), so the signal has to
 * travel processor → engine → native runner → `execFile`/`spawn` through the
 * code that ships. Only the command and argv are swapped, at the existing
 * `exec`/`launch` injection seam, for a Node child that sleeps for a minute
 * (`src/tests/long-child.ts`): no Ghostscript or LibreOffice is needed, and a
 * child that is still alive cannot be mistaken for one that was killed.
 *
 * Per case, the properties asked — not "was signal passed?":
 *  1. the child is GONE within a bound far below its own lifetime;
 *  2. the processor's own outcome says abort (rejects with an abort error, or
 *     returns `attempt_aborted`), never `timeout` / engine failure / a damaged
 *     file / `canceled` — read WITHOUT the executor's `settleAttempt`;
 *  3. the temp dir the runner made is removed, exactly as on failure;
 *  4. no second child is started after the abort.
 *
 * Health check: the cases are not hand-trusted to be all the families — the
 * spawn-site guard (`spawn-sites.guard.test.ts`) DISCOVERS the spawning modules
 * and that test asserts each one is exercised by a case here. Positive control:
 * the same harness with no abort reports the child ALIVE, so (1) can fail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  isAlive,
  longChild,
  waitForExit,
  waitForPid,
} from "@/tests/long-child";
import { ATTEMPT_ABORTED_CODE, isAttemptAbort } from "./attempt-abort";
import type {
  ProcessorInput,
  ProcessorResult,
  Processor,
} from "./processor/types";
import { createCompressionProcessor } from "./processor/compression";
import { createOfficeConversionProcessor } from "./processor/office-conversion";
import { createPdfArchiveProcessor } from "./processor/pdf-archive";
import { createPdfStructureProcessor } from "./processor/pdf-structure";
import { createPdfSecurityProcessor } from "./processor/pdf-security";
import { createHtmlRenderProcessor } from "./processor/html-render";
import { createTableExtractProcessor } from "./processor/table-extract";
import { createPdfOfficeExportProcessor } from "./processor/pdf-office-export";
import { createSummarizeProcessor } from "./processor/summarize";
import { createTranslateProcessor } from "./processor/translate";
import { createAiExtractProcessor } from "./processor/ai-extract";
import { createChatWithPdfProcessor } from "./processor/chat-with-pdf";
import { createOcrProcessor } from "./processor/ocr";
import {
  defaultNativeExec,
  nativeCompressionDeps,
  type NativeExec,
} from "./compression/native";
import {
  defaultLibreOfficeExec,
  nativeOfficeConversionDeps,
  type LibreOfficeExec,
} from "./office-conversion/native";
import {
  defaultGhostscriptExec,
  nativePdfArchiveDeps,
  type GhostscriptExec,
} from "./pdf-archive/native";
import {
  defaultQpdfStructureExec,
  nativePdfStructureDeps,
  type QpdfStructureExec,
} from "./pdf-structure/native";
import {
  defaultQpdfExec,
  nativePdfSecurityDeps,
  type QpdfExec,
} from "./pdf-security/native";
import {
  defaultChromiumLaunch,
  nativeHtmlRenderDeps,
  type ChromiumLaunch,
} from "./html-render/native";
import {
  createNativePdfTextExtractor,
  defaultPdfTextExec,
  nativeTableExtractDeps,
  type PdfTextExec,
} from "./pdf-text/native";
import { resolveNativePdfTextConfig } from "./pdf-text/native-config";
import { pdfOfficeExportDeps } from "./pdf-office-export/native";
import {
  defaultNativeOcrExec,
  nativeOcrDeps,
  type NativeOcrExec,
} from "./ocr-native";
import type { AiProvider } from "./ai/provider";
import { discoverWorkerSpawnSites, rel } from "@/tests/spawn-sites";

/** Far below the stand-in's 60 s life, far above a kill's few milliseconds. */
const ABORT_BOUND_MS = 5_000;

let PDF: Uint8Array;
const ROOT = mkdtempSync(path.join(tmpdir(), "pdfxyz-abort-test-"));

beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]).drawText("abort", { x: 20, y: 100 });
  PDF = await doc.save();
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const always = () => true;

/** Every argv a case's runner asked for, to find its temp dirs and count runs. */
type Calls = string[][];

/**
 * Wrap a family's REAL exec so it runs the stand-in instead of the binary,
 * with every option (timeout, signal, ...) exactly as the runner built them.
 */
function redirect<O, R>(
  real: (command: string, args: readonly string[], options: O) => R,
  child: { command: string; args: string[] },
  calls: Calls,
): (command: string, args: readonly string[], options: O) => R {
  return (command, args, options) => {
    calls.push([command, ...args]);
    return real(child.command, child.args, options);
  };
}

/** A provider that must never be reached: the abort lands before any model call. */
const unreachableProvider: AiProvider = {
  id: "anthropic",
  model: "claude-sonnet-5",
  async complete() {
    throw new Error("the provider was called after the attempt aborted");
  },
};

function pdfInput(tool: string, options: Record<string, unknown> = {}) {
  return {
    tool,
    options,
    inputs: [
      {
        fileId: "f_abort0000001",
        filename: "in.pdf",
        contentType: "application/pdf",
        bytes: PDF,
      },
    ],
  };
}

interface Case {
  /** The spawning module this case drives (matched by the discovery guard). */
  spawnModule: string;
  build(
    child: { command: string; args: string[] },
    calls: Calls,
  ): { processor: Processor; input: Omit<ProcessorInput, "signal"> };
}

/** A pdftotext extractor over the real exec, for the four AI processors. */
function pdfTextExtractor(
  child: { command: string; args: string[] },
  calls: Calls,
) {
  return createNativePdfTextExtractor(
    "pdftotext",
    resolveNativePdfTextConfig({}),
    "collapse",
    {
      exec: redirect<Parameters<PdfTextExec>[2], ReturnType<PdfTextExec>>(
        defaultPdfTextExec,
        child,
        calls,
      ),
    },
  );
}

const CASES: Record<string, Case> = {
  "compress-pdf (Ghostscript)": {
    spawnModule: "src/lib/workers/compression/native.ts",
    build: (child, calls) => ({
      processor: createCompressionProcessor(
        nativeCompressionDeps(
          {},
          {
            resolveOnPath: always,
            exec: redirect<Parameters<NativeExec>[2], ReturnType<NativeExec>>(
              defaultNativeExec,
              child,
              calls,
            ),
          },
        ),
      ),
      input: pdfInput("compress-pdf", { profile: "deep" }),
    }),
  },
  "word-to-pdf (LibreOffice)": {
    spawnModule: "src/lib/workers/office-conversion/native.ts",
    build: (child, calls) => ({
      processor: createOfficeConversionProcessor(
        nativeOfficeConversionDeps(
          {},
          {
            resolveOnPath: always,
            exec: redirect<
              Parameters<LibreOfficeExec>[2],
              ReturnType<LibreOfficeExec>
            >(defaultLibreOfficeExec, child, calls),
          },
        ),
      ),
      input: {
        tool: "word-to-pdf",
        options: {},
        inputs: [
          {
            fileId: "f_abort0000002",
            filename: "letter.docx",
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            bytes: new TextEncoder().encode("docx"),
          },
        ],
      },
    }),
  },
  "pdf-to-pdfa (qpdf probe, then Ghostscript)": {
    spawnModule: "src/lib/workers/pdf-archive/native.ts",
    build: (child, calls) => ({
      processor: createPdfArchiveProcessor(
        nativePdfArchiveDeps(
          {},
          {
            resolveOnPath: always,
            fileExists: always,
            exec: redirect<
              Parameters<GhostscriptExec>[2],
              ReturnType<GhostscriptExec>
            >(defaultGhostscriptExec, child, calls),
          },
        ),
      ),
      input: pdfInput("pdf-to-pdfa"),
    }),
  },
  "repair-pdf (qpdf)": {
    spawnModule: "src/lib/workers/pdf-structure/native.ts",
    build: (child, calls) => ({
      processor: createPdfStructureProcessor(
        nativePdfStructureDeps(
          {},
          {
            resolveOnPath: always,
            exec: redirect<
              Parameters<QpdfStructureExec>[2],
              ReturnType<QpdfStructureExec>
            >(defaultQpdfStructureExec, child, calls),
          },
        ),
      ),
      input: pdfInput("repair-pdf"),
    }),
  },
  "protect-pdf (qpdf)": {
    spawnModule: "src/lib/workers/pdf-security/native.ts",
    build: (child, calls) => ({
      processor: createPdfSecurityProcessor(
        nativePdfSecurityDeps(
          {},
          {
            resolveOnPath: always,
            exec: redirect<Parameters<QpdfExec>[2], ReturnType<QpdfExec>>(
              defaultQpdfExec,
              child,
              calls,
            ),
          },
        ),
      ),
      input: pdfInput("protect-pdf", { password: "SENTINEL-PW-42" }),
    }),
  },
  "html-to-pdf (Chromium)": {
    spawnModule: "src/lib/workers/html-render/native.ts",
    build: (child, calls) => ({
      processor: createHtmlRenderProcessor(
        nativeHtmlRenderDeps(
          {},
          {
            resolveOnPath: always,
            fileExists: always,
            launch: redirect<
              Parameters<ChromiumLaunch>[2],
              ReturnType<ChromiumLaunch>
            >(defaultChromiumLaunch, child, calls),
          },
        ),
      ),
      input: {
        tool: "html-to-pdf",
        options: {},
        inputs: [
          {
            fileId: "f_abort0000003",
            filename: "page.html",
            contentType: "text/html",
            bytes: new TextEncoder().encode("<p>abort</p>"),
          },
        ],
      },
    }),
  },
  "extract-tables (pdftotext)": {
    spawnModule: "src/lib/workers/pdf-text/native.ts",
    build: (child, calls) => ({
      processor: createTableExtractProcessor(
        nativeTableExtractDeps(
          {},
          {
            resolveOnPath: always,
            exec: redirect<Parameters<PdfTextExec>[2], ReturnType<PdfTextExec>>(
              defaultPdfTextExec,
              child,
              calls,
            ),
          },
        ),
      ),
      input: pdfInput("extract-tables"),
    }),
  },
  "pdf-to-excel (pdftotext)": {
    spawnModule: "src/lib/workers/pdf-text/native.ts",
    build: (child, calls) => ({
      processor: createPdfOfficeExportProcessor(
        pdfOfficeExportDeps(
          {},
          {
            resolveOnPath: always,
            pdfjsAvailable: () => false,
            exec: redirect<Parameters<PdfTextExec>[2], ReturnType<PdfTextExec>>(
              defaultPdfTextExec,
              child,
              calls,
            ),
          },
        ),
      ),
      input: pdfInput("pdf-to-excel"),
    }),
  },
  "summarize-pdf (pdftotext)": {
    spawnModule: "src/lib/workers/pdf-text/native.ts",
    build: (child, calls) => ({
      processor: createSummarizeProcessor({
        extract: pdfTextExtractor(child, calls),
        provider: unreachableProvider,
      }),
      input: pdfInput("summarize-pdf"),
    }),
  },
  "translate-pdf (pdftotext)": {
    spawnModule: "src/lib/workers/pdf-text/native.ts",
    build: (child, calls) => ({
      processor: createTranslateProcessor({
        extract: pdfTextExtractor(child, calls),
        provider: unreachableProvider,
      }),
      input: pdfInput("translate-pdf", { targetLanguage: "fr" }),
    }),
  },
  "ai-extract (pdftotext)": {
    spawnModule: "src/lib/workers/pdf-text/native.ts",
    build: (child, calls) => ({
      processor: createAiExtractProcessor({
        extract: pdfTextExtractor(child, calls),
        provider: unreachableProvider,
      }),
      input: pdfInput("ai-extract", {
        mode: "schema",
        schema: [{ name: "invoice_number", type: "string" }],
      }),
    }),
  },
  "chat-with-pdf (pdftotext)": {
    spawnModule: "src/lib/workers/pdf-text/native.ts",
    build: (child, calls) => ({
      processor: createChatWithPdfProcessor({
        extract: pdfTextExtractor(child, calls),
        provider: unreachableProvider,
      }),
      input: pdfInput("chat-with-pdf", { question: "What is the total?" }),
    }),
  },
  "ocr-pdf (OCRmyPDF)": {
    spawnModule: "src/lib/workers/ocr-native.ts",
    build: (child, calls) => ({
      processor: createOcrProcessor({
        ...nativeOcrDeps(
          { PDFXYZ_OCR: "on" },
          {
            resolveOnPath: always,
            exec: redirect<
              Parameters<NativeOcrExec>[2],
              ReturnType<NativeOcrExec>
            >(defaultNativeOcrExec, child, calls),
          },
        ),
        installedLanguages: ["eng"],
      }),
      input: pdfInput("ocr-pdf", {
        languages: ["eng"],
        outputMode: "searchable-pdf",
      }),
    }),
  },
};

/** The worker temp dirs named anywhere in a run's argv (`pdfxyz-<family>-XXXXXX`). */
function tempDirsIn(calls: Calls): string[] {
  const dirs = new Set<string>();
  for (const arg of calls.flat()) {
    const m =
      /^(?:--user-data-dir=|@)?(.*?[\\/]pdfxyz-[a-z]+-[A-Za-z0-9]{6})(?:[\\/]|$)/.exec(
        arg,
      );
    if (m) dirs.add(m[1]!);
  }
  return [...dirs];
}

type Outcome = { result: ProcessorResult } | { error: unknown };

function settle(p: Promise<ProcessorResult>): Promise<Outcome> {
  return p.then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
}

/** Start a case and wait until its stand-in child is running. */
async function start(name: string, signal: AbortSignal | undefined) {
  const dir = mkdtempSync(path.join(ROOT, "case-"));
  const child = longChild(dir);
  const calls: Calls = [];
  const { processor, input } = CASES[name]!.build(child, calls);
  const outcome = settle(
    processor.process({ ...input, ...(signal ? { signal } : {}) }),
  );
  const pid = await Promise.race([
    waitForPid(child.pidFile),
    outcome.then((o) => {
      throw new Error(
        `the processor settled before any child started: ${JSON.stringify(
          "result" in o ? o.result : String(o.error),
        )}`,
      );
    }),
  ]);
  return { pid, calls, outcome };
}

describe("engines honour the attempt's abort signal", () => {
  it.each(Object.keys(CASES))(
    "%s: abort mid-run kills the child, reports the abort, cleans up",
    async (name) => {
      const controller = new AbortController();
      const { pid, calls, outcome } = await start(name, controller.signal);
      expect(isAlive(pid)).toBe(true);
      const calledBefore = calls.length;

      const abortedAt = Date.now();
      controller.abort();
      const settled = await outcome;
      const elapsed = Date.now() - abortedAt;

      // 1. Gone, and promptly — not after its 60 s.
      expect(await waitForExit(pid, ABORT_BOUND_MS)).toBe(true);
      expect(elapsed).toBeLessThan(ABORT_BOUND_MS);
      // 2. Recognisably an abort, from the processor itself.
      if ("error" in settled) {
        expect(isAttemptAbort(settled.error)).toBe(true);
      } else {
        expect(settled.result.ok).toBe(false);
        if (!settled.result.ok)
          expect(settled.result.error.code).toBe(ATTEMPT_ABORTED_CODE);
      }
      // 3. The runner's temp dir is gone (health: there WAS one).
      const dirs = tempDirsIn(calls);
      expect(dirs.length).toBeGreaterThan(0);
      for (const dir of dirs) expect(existsSync(dir)).toBe(false);
      // 4. Nothing new started after the abort.
      expect(calls.length).toBe(calledBefore);
    },
    20_000,
  );

  it("health: every spawning module the guard DISCOVERS is driven by a case here", () => {
    // Not a typed list of families: a new spawning module with no case here
    // fails this, and so does a case naming a module that no longer spawns.
    const discovered = discoverWorkerSpawnSites().modules.map((f) => rel(f));
    const driven = [...new Set(Object.values(CASES).map((c) => c.spawnModule))];
    expect(discovered.length).toBeGreaterThanOrEqual(8);
    expect(driven.sort()).toEqual([...discovered].sort());
  });

  it("positive control: with no abort the stand-in is still running", async () => {
    const controller = new AbortController();
    const name = "compress-pdf (Ghostscript)";
    const { pid, outcome } = await start(name, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 750));
    // The harness CAN see a live child: "gone" above is not vacuous.
    expect(isAlive(pid)).toBe(true);
    controller.abort();
    await outcome;
    expect(await waitForExit(pid, ABORT_BOUND_MS)).toBe(true);
  }, 20_000);
});
