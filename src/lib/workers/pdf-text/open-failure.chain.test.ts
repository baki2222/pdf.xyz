// @vitest-environment node
/**
 * A PDF the worker cannot OPEN must say why, on every tool that reads a PDF's
 * text on the worker, and must not be retried.
 *
 * THE DEFECT. `pdftotext` exits 1 on a PDF that needs a password. The runner
 * collapsed that into `new Error("pdftotext failed.")`, and every engine behind
 * it caught it with a bare `catch {}`. PDF to PowerPoint answered "The PDF could
 * not be exported to an Office file." as a RETRYABLE `internal_error`, so the
 * queue retried a file that could never open, and nothing mentioned the
 * password or Unlock PDF. Summarize, Translate, AI extraction, Chat with PDF and
 * Extract tables said "could not be read for text extraction".
 *
 * THE CHAIN, run whole: the runner's real argv (with `-q`) → an exec that fails
 * the way poppler does (exit 1; `native.integration.test.ts` proves the real
 * binary does exactly that on the same fixture) → the runner's classification
 * of the real fixture bytes → the extractor → the engine → the processor's
 * JobError, which is what the job record carries and the panel's ErrorNote
 * renders (it links Unlock PDF for every sentence in ENCRYPTED_PDF_MESSAGES).
 *
 * THE SUBJECTS ARE DISCOVERED, not named: every `src/lib/workers/<engine>/native.ts`
 * that imports the pdftotext runner. A new consumer without a driver below
 * fails the coverage check instead of passing unseen.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_PDF_MESSAGES,
  PDF_NEEDS_PASSWORD_MESSAGE,
  UNLOCK_TOOL_NAME,
} from "@/lib/pdf/encryption";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";
import type { AiProvider } from "../ai/provider";
import { createAiExtractProcessor } from "../processor/ai-extract";
import { createChatWithPdfProcessor } from "../processor/chat-with-pdf";
import { createPdfOfficeExportProcessor } from "../processor/pdf-office-export";
import { createSummarizeProcessor } from "../processor/summarize";
import { createTableExtractProcessor } from "../processor/table-extract";
import { createTranslateProcessor } from "../processor/translate";
import type { Processor, ProcessorResult } from "../processor/types";
import { PdfTextExecError, hasEncryptEntry } from "./errors";
import {
  createNativePdfLayoutExtractor,
  createNativePdfTextExtractor,
  pdfTextArgs,
  type PdfTextExec,
} from "./native";
import { resolveNativePdfTextConfig } from "./native-config";

const WORKERS = path.join(process.cwd(), "src", "lib", "workers");
const RUNNER_IMPORT =
  /from\s+["'](?:\.\.\/pdf-text\/native|@\/lib\/workers\/pdf-text\/native)["']/;

/** Every worker engine whose deps builder wires the pdftotext runner. */
function discoverConsumers(): string[] {
  return readdirSync(WORKERS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "pdf-text")
    .filter((entry) => {
      try {
        const source = readFileSync(
          path.join(WORKERS, entry.name, "native.ts"),
          "utf8",
        );
        return RUNNER_IMPORT.test(source);
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

type Mode = "layout" | "bbox";

/** An exec that fails the way poppler does, after checking it was given the real argv. */
function failingExec(exitCode: number | null, seen: Mode[]): PdfTextExec {
  return async (_command, args) => {
    const inputPath = args[args.length - 2]!;
    const mode: Mode = args[0] === "-bbox-layout" ? "bbox" : "layout";
    expect(args).toEqual(pdfTextArgs(mode, inputPath));
    expect(args).toContain("-q");
    seen.push(mode);
    throw new PdfTextExecError(exitCode);
  };
}

/** A provider the chain must never reach: extraction fails before any model call. */
function unreachableProvider(calls: { count: number }): AiProvider {
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete() {
      calls.count += 1;
      throw new Error("the model was called for a file that cannot open");
    },
  };
}

interface Seams {
  text: () => ReturnType<typeof createNativePdfTextExtractor>;
  layout: () => ReturnType<typeof createNativePdfLayoutExtractor>;
  provider: AiProvider;
}

/** How to build each discovered consumer's processor, and a valid request for it. */
const DRIVERS: Record<
  string,
  { build: (s: Seams) => Processor; options: Record<string, unknown> }
> = {
  "pdf-office-export": {
    build: (s) => createPdfOfficeExportProcessor({ extract: s.text() }),
    options: {},
  },
  summarize: {
    build: (s) =>
      createSummarizeProcessor({ extract: s.text(), provider: s.provider }),
    options: {},
  },
  translate: {
    build: (s) =>
      createTranslateProcessor({ extract: s.text(), provider: s.provider }),
    options: { targetLanguage: "fr" },
  },
  "ai-extract": {
    build: (s) =>
      createAiExtractProcessor({ extract: s.text(), provider: s.provider }),
    options: { mode: "prompt", prompt: "Extract totals" },
  },
  "chat-with-pdf": {
    build: (s) =>
      createChatWithPdfProcessor({ extract: s.text(), provider: s.provider }),
    options: { question: "What is the total?" },
  },
  "table-extract": {
    build: (s) => createTableExtractProcessor({ extractLayout: s.layout() }),
    options: {},
  },
};

async function runEvery(
  bytes: Uint8Array,
  exitCode: number | null,
): Promise<
  { consumer: string; tool: string; result: ProcessorResult; modes: Mode[] }[]
> {
  const config = resolveNativePdfTextConfig({});
  const out = [];
  for (const consumer of discoverConsumers()) {
    const driver = DRIVERS[consumer];
    if (!driver) throw new Error(`no driver for ${consumer}`);
    const modes: Mode[] = [];
    const calls = { count: 0 };
    const exec = failingExec(exitCode, modes);
    const processor = driver.build({
      text: () =>
        createNativePdfTextExtractor("pdftotext", config, "keep", { exec }),
      layout: () =>
        createNativePdfLayoutExtractor("pdftotext", config, { exec }),
      provider: unreachableProvider(calls),
    });
    for (const tool of processor.tools) {
      const result = await processor.process({
        tool,
        options: driver.options,
        inputs: [
          {
            fileId: "f1",
            filename: "locked.pdf",
            contentType: "application/pdf",
            bytes,
          },
        ],
      });
      expect(calls.count, `${tool} called the model`).toBe(0);
      out.push({ consumer, tool, result, modes: [...modes] });
    }
  }
  return out;
}

describe("the consumers of the pdftotext runner are discovered", () => {
  const consumers = discoverConsumers();

  it("finds a plausible set, and prints it", () => {
    // Six on 2026-09-27. A walk that collapses to one or two would pass
    // every assertion below for the wrong reason.
    console.info(`pdftotext consumers: ${consumers.join(", ")}`);
    expect(consumers.length).toBeGreaterThanOrEqual(6);
    expect(consumers).toContain("pdf-office-export");
  });

  it("has a driver for every consumer, and none for a consumer that is gone", () => {
    expect(Object.keys(DRIVERS).sort()).toEqual(consumers);
  });
});

describe("a PDF that needs a password, through every consumer", () => {
  it("fixture health: the user-password file carries /Encrypt, a plain PDF does not", () => {
    expect(hasEncryptEntry(userPasswordEncryptedPdf())).toBe(true);
    expect(hasEncryptEntry(ownerOnlyEncryptedPdf())).toBe(true);
    expect(
      hasEncryptEntry(new TextEncoder().encode("%PDF-1.4\n/EncryptMetadata\n")),
    ).toBe(false);
  });

  it("says it is password-protected, links Unlock PDF, and is not retried", async () => {
    const rows = await runEvery(userPasswordEncryptedPdf(), 1);
    expect(rows.length).toBeGreaterThanOrEqual(8); // 3 office tools + 5 others
    for (const { tool, result, modes } of rows) {
      expect(modes.length, `${tool} never ran pdftotext`).toBeGreaterThan(0);
      expect(result.ok, tool).toBe(false);
      if (result.ok) continue;
      expect(result.error, tool).toEqual({
        code: "unprocessable_entity",
        message: PDF_NEEDS_PASSWORD_MESSAGE,
        retryable: false,
      });
      // The panel's ErrorNote offers the Unlock PDF link for exactly these.
      expect(ENCRYPTED_PDF_MESSAGES).toContain(result.error.message);
      expect(result.error.message).toContain(UNLOCK_TOOL_NAME);
    }
  });
});

describe("a file that is not a readable PDF, through every consumer", () => {
  it("says so, without mentioning a password, and is not retried", async () => {
    const rows = await runEvery(new TextEncoder().encode("not a pdf"), 1);
    for (const { tool, result } of rows) {
      expect(result.ok, tool).toBe(false);
      if (result.ok) continue;
      expect(result.error, tool).toEqual({
        code: "unprocessable_entity",
        message: UNREADABLE_PDF_MESSAGE,
        retryable: false,
      });
    }
  });
});

describe("control: a failure that is not about opening the file", () => {
  it("a timeout (no exit code) keeps each engine's own generic failure", async () => {
    const rows = await runEvery(userPasswordEncryptedPdf(), null);
    for (const { tool, result } of rows) {
      expect(result.ok, tool).toBe(false);
      if (result.ok) continue;
      // The engine's own generic sentence: a timeout is not a fact about the
      // file, so it must not be reported as a password or a damaged PDF.
      expect(result.error.message, tool).toMatch(/could not be/);
      expect(result.error.message, tool).not.toBe(PDF_NEEDS_PASSWORD_MESSAGE);
      expect(result.error.message, tool).not.toBe(UNREADABLE_PDF_MESSAGE);
    }
  });
});
