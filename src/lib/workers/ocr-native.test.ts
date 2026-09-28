// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { OCR_MAX_INPUT_FILES, type OcrOptions } from "@/lib/jobs/ocr";
import { findPopplerPdfToText } from "@/tests/pdf-office-fixtures";
import {
  MIXED_TYPED_LINE,
  mixedScanPdf,
  mixedSidecarVerdict,
} from "@/tests/ocr-proof-fixtures";
import { OcrEngineRefusal } from "./ocr-engine-errors";
import { skippedSidecarPages } from "./ocr-sidecar";
import type { ProcessorInputFile } from "./processor/types";
import type { NativeOcrConfig } from "./ocr-native-config";
import {
  countPdfPages,
  countTextCharacters,
  createNativeOcrRunner,
  firstUsableOcrEngine,
  inputExtension,
  nativeOcrArgs,
  nativeOcrDeps,
  probeNativeOcrEngines,
  probeNativeOcrEnginesFromConfig,
  type NativeOcrExec,
  type NativeOcrFs,
  type NativeOcrSeams,
} from "./ocr-native";

/** A full config with sane defaults; override any field per test. */
function cfg(over: Partial<NativeOcrConfig> = {}): NativeOcrConfig {
  return {
    enabled: true,
    binaries: { ocrmypdf: "ocrmypdf", tesseract: "tesseract" },
    overridden: { ocrmypdf: false, tesseract: false },
    timeoutMs: 300_000,
    maxInputBytes: 200 * 1024 * 1024,
    maxOutputBytes: 500 * 1024 * 1024,
    ...over,
  };
}

const BOTH: OcrOptions = {
  languages: ["eng", "spa"],
  outputMode: "both",
  redoOcr: false,
};
const PDF_ONLY: OcrOptions = {
  languages: ["eng"],
  outputMode: "searchable-pdf",
  redoOcr: false,
};
const TEXT_ONLY: OcrOptions = {
  languages: ["eng"],
  outputMode: "text",
  redoOcr: false,
};

const scan: ProcessorInputFile = {
  fileId: "f_1234567890",
  filename: "Client Scan.pdf",
  contentType: "application/pdf",
  bytes: new Uint8Array([1, 2, 3]),
};

/** Minimal bytes that satisfy the structural PDF check (header + trailer). */
const VALID_PDF = new TextEncoder().encode(
  `%PDF-1.7\n${"x".repeat(64)}\n%%EOF\n`,
);
const NOT_PDF = new TextEncoder().encode("this is plainly not a pdf document");
const TEXT_OUT = new TextEncoder().encode("Recognized text from the scan.");

interface FsCalls {
  mkdtemp: string[];
  writeFile: { file: string; len: number }[];
  readFile: string[];
  rm: string[];
}

/** A recording fake fs whose readFile returns bytes chosen per path (pdf vs txt). */
function fakeFs(read: (file: string) => Uint8Array): {
  fs: NativeOcrFs;
  calls: FsCalls;
} {
  const calls: FsCalls = { mkdtemp: [], writeFile: [], readFile: [], rm: [] };
  const fs: NativeOcrFs = {
    async mkdtemp(prefix) {
      calls.mkdtemp.push(prefix);
      return `${prefix}ab12cd`;
    },
    async writeFile(file, data) {
      calls.writeFile.push({ file, len: data.byteLength });
    },
    async readFile(file) {
      calls.readFile.push(file);
      return read(file);
    },
    async rm(dir) {
      calls.rm.push(dir);
    },
  };
  return { fs, calls };
}

/** readFile that returns a searchable PDF for *.pdf and text for *.txt. */
const pdfOrText = (file: string): Uint8Array =>
  file.endsWith(".txt") ? TEXT_OUT : VALID_PDF;

/** Force one engine "present" so engine selection is deterministic in tests. */
const onlyEngine =
  (present: string): NativeOcrSeams["resolveOnPath"] =>
  (bin) =>
    bin === present;

describe("nativeOcrArgs — fixed argv, no shell interpolation", () => {
  it("builds OCRmyPDF args: joined languages, sidecar, and separate input/output paths", () => {
    const inv = nativeOcrArgs("ocrmypdf", "ocrmypdf", {
      inputPath: "/tmp/j/input.pdf",
      workDir: "/tmp/j",
      languages: ["eng", "spa"],
      redoOcr: false,
      wantPdf: true,
      wantText: true,
    });
    expect(inv.command).toBe("ocrmypdf");
    expect(inv.args).toContain("--language");
    expect(inv.args).toContain("eng+spa");
    expect(inv.args).toContain("--sidecar");
    // Input and output are DISTINCT argv elements — never concatenated, so a path can
    // never be reinterpreted as a flag or shell syntax.
    expect(inv.args[inv.args.length - 2]).toBe("/tmp/j/input.pdf");
    expect(inv.args[inv.args.length - 1]).toBe(inv.pdfOut);
    expect(inv.pdfOut).toBe(join("/tmp/j", "output.pdf"));
  });

  // INVERTED 2026-09-27. This test used to read "adds --skip-text only when
  // requested" — and it pinned the defect. With the option off (the panel's
  // default), OCRmyPDF was given neither --skip-text nor --redo-ocr, so it
  // aborted the WHOLE job on any PDF where one page already had text
  // (PriorOcrFoundError, exit 6) or that was tagged: every scanner-app
  // "searchable PDF", every scan with a typed cover page, every Word export.
  // Now a page that already has text is always kept as it is, and the only
  // opt-in is --redo-ocr (never --force-ocr, which rasterizes vector text).
  it("skips pages that already have text by default, redoes them only on request, never both", () => {
    const ctx = {
      inputPath: "/t/in.pdf",
      workDir: "/t",
      languages: ["eng"],
      wantPdf: true,
      wantText: false,
    };
    const byDefault = nativeOcrArgs("ocrmypdf", "ocrmypdf", {
      ...ctx,
      redoOcr: false,
    }).args;
    expect(byDefault).toContain("--skip-text");
    expect(byDefault).not.toContain("--redo-ocr");
    expect(byDefault).not.toContain("--sidecar");

    const redo = nativeOcrArgs("ocrmypdf", "ocrmypdf", {
      ...ctx,
      redoOcr: true,
    }).args;
    expect(redo).toContain("--redo-ocr");
    // OCRmyPDF rejects the two together as conflicting arguments.
    expect(redo).not.toContain("--skip-text");
    // And never the destructive mode, under either setting.
    for (const args of [byDefault, redo])
      expect(args).not.toContain("--force-ocr");
  });

  it("builds Tesseract args with an output base and pdf/txt config tokens", () => {
    const inv = nativeOcrArgs("tesseract", "tesseract", {
      inputPath: "/t/in.png",
      workDir: "/t",
      languages: ["eng", "deu"],
      redoOcr: true, // ignored for tesseract
      wantPdf: true,
      wantText: true,
    });
    expect(inv.command).toBe("tesseract");
    expect(inv.args.slice(0, 4)).toEqual([
      "/t/in.png",
      join("/t", "output"),
      "-l",
      "eng+deu",
    ]);
    expect(inv.args).toContain("pdf");
    expect(inv.args).toContain("txt");
    // tesseract reads a raster, which has no text layer to skip or redo.
    expect(inv.args).not.toContain("--skip-text");
    expect(inv.args).not.toContain("--redo-ocr");
    expect(inv.pdfOut).toBe(join("/t", "output.pdf"));
    expect(inv.txtOut).toBe(join("/t", "output.txt"));
  });

  it("passes an override command path through verbatim", () => {
    const inv = nativeOcrArgs("ocrmypdf", "/opt/ocr/bin/ocrmypdf", {
      inputPath: "/t/in.pdf",
      workDir: "/t",
      languages: ["eng"],
      redoOcr: false,
      wantPdf: true,
      wantText: false,
    });
    expect(inv.command).toBe("/opt/ocr/bin/ocrmypdf");
  });
});

describe("inputExtension — safe, fixed temp extension by content type", () => {
  it("maps common types and defaults unknown to pdf", () => {
    expect(inputExtension({ ...scan, contentType: "application/pdf" })).toBe(
      "pdf",
    );
    expect(inputExtension({ ...scan, contentType: "image/png" })).toBe("png");
    expect(inputExtension({ ...scan, contentType: "image/jpeg" })).toBe("jpg");
    expect(
      inputExtension({ ...scan, contentType: "application/octet-stream" }),
    ).toBe("pdf");
  });
});

describe("createNativeOcrRunner — success paths", () => {
  it("writes input, runs OCRmyPDF by argv, returns validated PDF + text artifacts, cleans up", async () => {
    const execCalls: { command: string; args: string[]; options: unknown }[] =
      [];
    const exec: NativeOcrExec = async (command, args, options) => {
      execCalls.push({ command, args: [...args], options });
    };
    const { fs, calls } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg({ tmpDir: "/base" }), {
      exec,
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      countPages: async () => 5,
    });

    const { artifacts, meta } = await runner({ options: BOTH, inputs: [scan] });

    expect(artifacts.map((a) => a.filename)).toEqual([
      "Client Scan-ocr.pdf",
      "Client Scan.txt",
    ]);
    expect(artifacts[0]?.contentType).toBe("application/pdf");
    expect(artifacts[0]?.bytes).toEqual(VALID_PDF);
    expect(artifacts[1]?.contentType).toContain("text/plain");
    expect(artifacts[1]?.bytes).toEqual(TEXT_OUT);
    // The whole temp lifecycle happened and the dir was removed.
    expect(calls.mkdtemp[0]).toContain(join("/base", "pdfxyz-ocr-"));
    expect(calls.writeFile).toHaveLength(1);
    expect(calls.rm).toHaveLength(1);
    // The subprocess was invoked by argv with the configured timeout.
    expect(execCalls[0]!.command).toBe("ocrmypdf");
    expect(execCalls[0]!.options).toMatchObject({
      timeout: 300_000,
      windowsHide: true,
    });

    // Metadata is derived from the ACTUAL run: engine family, validated languages,
    // produced artifact kinds, and real COUNTS — never invented, never leaking text.
    expect(meta).toEqual({
      engine: "ocrmypdf",
      languages: ["eng", "spa"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 5,
      textCharacters: TEXT_OUT.byteLength, // "Recognized text from the scan." → 30 ASCII chars
      // OCRmyPDF drives its own Tesseract in a private temp dir, so there is no TSV to
      // read and every confidence figure is honestly absent. The tesseract path, which
      // the runner drives directly, does report them.
      meanConfidence: null,
      lowConfidenceWordRatio: null,
      recognizedWords: null,
    });
    // The recognized text itself never rides along in the metadata.
    expect(JSON.stringify(meta)).not.toContain("Recognized text");
  });

  it("returns only the searchable PDF for pdf-only mode, with pdf-only metadata", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      countPages: async () => 2,
    });
    const { artifacts, meta } = await runner({
      options: PDF_ONLY,
      inputs: [scan],
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.filename).toBe("Client Scan-ocr.pdf");
    expect(meta.producedSearchablePdf).toBe(true);
    expect(meta.producedTextSidecar).toBe(false);
    expect(meta.pageCount).toBe(2);
    // No sidecar ⇒ no character count (honestly null, not zero).
    expect(meta.textCharacters).toBeNull();
  });

  it("returns only the text sidecar for text-only mode (no PDF validation needed)", async () => {
    const readCalls: string[] = [];
    const { fs } = fakeFs((file) => {
      readCalls.push(file);
      return pdfOrText(file);
    });
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    const { artifacts, meta } = await runner({
      options: TEXT_ONLY,
      inputs: [scan],
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.filename).toBe("Client Scan.txt");
    // The PDF output is never read in text-only mode.
    expect(readCalls.every((f) => f.endsWith(".txt"))).toBe(true);
    // No PDF ⇒ null page count; the sidecar's characters ARE counted.
    expect(meta.producedSearchablePdf).toBe(false);
    expect(meta.pageCount).toBeNull();
    expect(meta.textCharacters).toBe(TEXT_OUT.byteLength);
  });

  it("uses tesseract for a raster input, and names it in the meta", async () => {
    // Tesseract is the engine that reads an image; OCRmyPDF is PDF-in/PDF-out and
    // cannot. Dispatch follows the input kind, so a PNG lands here even when
    // OCRmyPDF is installed and would otherwise be preferred.
    const execCalls: string[][] = [];
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async (_command, args) => {
        execCalls.push([...args]);
      },
      fs,
      resolveOnPath: () => true, // BOTH engines present
      countPages: async () => 1,
    });
    const png: ProcessorInputFile = {
      ...scan,
      filename: "Client Scan.png",
      contentType: "image/png",
    };
    const { artifacts, meta } = await runner({
      options: PDF_ONLY,
      inputs: [png],
    });
    expect(artifacts).toHaveLength(1);
    // tesseract argv shape: input, base, -l, lang, pdf
    expect(execCalls[0]?.[2]).toBe("-l");
    expect(execCalls[0]).toContain("pdf");
    expect(meta.engine).toBe("tesseract");
  });

  it("refuses a PDF when only tesseract is installed, instead of feeding it one", async () => {
    // The previous behaviour dispatched a PDF to whichever engine was present, so
    // this combination reached tesseract — which cannot read a PDF and failed inside
    // the engine, surfacing as "could not process this file". Refusing names the
    // real cause: this worker has no engine for that input kind.
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {
        throw new Error("the engine must not be invoked");
      },
      fs,
      resolveOnPath: onlyEngine("tesseract"),
      countPages: async () => 1,
    });
    await expect(runner({ options: PDF_ONLY, inputs: [scan] })).rejects.toThrow(
      /no ocr engine .* can read a pdf/i,
    );
  });

  it("refuses a raster when only OCRmyPDF is installed", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {
        throw new Error("the engine must not be invoked");
      },
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      countPages: async () => 1,
    });
    const png: ProcessorInputFile = {
      ...scan,
      filename: "scan.png",
      contentType: "image/png",
    };
    await expect(runner({ options: PDF_ONLY, inputs: [png] })).rejects.toThrow(
      /no ocr engine .* can read an image/i,
    );
  });

  it("falls back to a null page count when the produced PDF cannot be parsed (never fabricated)", async () => {
    // The default page-counter (real pdf-lib) can't parse the minimal fake PDF, so the
    // page count is honestly null rather than a made-up number.
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    const { meta } = await runner({ options: PDF_ONLY, inputs: [scan] });
    expect(meta.pageCount).toBeNull();
  });
});

describe("createNativeOcrRunner — failure paths always clean up and never leak", () => {
  it("propagates a subprocess/timeout error and still removes the temp dir", async () => {
    const exec: NativeOcrExec = async () => {
      throw new Error("Command failed: ETIMEDOUT /tmp/pdfxyz-ocr-xy/input.pdf");
    };
    const { fs, calls } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec,
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(runner({ options: BOTH, inputs: [scan] })).rejects.toThrow();
    expect(calls.rm).toHaveLength(1); // cleanup on failure is load-bearing
  });

  it("throws when the engine produces non-PDF output, and cleans up", async () => {
    const { fs, calls } = fakeFs((file) =>
      file.endsWith(".txt") ? TEXT_OUT : NOT_PDF,
    );
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(runner({ options: PDF_ONLY, inputs: [scan] })).rejects.toThrow(
      /usable PDF/i,
    );
    expect(calls.rm).toHaveLength(1);
  });

  it("throws when the text output is empty", async () => {
    const { fs } = fakeFs((file) =>
      file.endsWith(".txt") ? new Uint8Array(0) : VALID_PDF,
    );
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(
      runner({ options: TEXT_ONLY, inputs: [scan] }),
    ).rejects.toThrow(/text output/i);
  });

  it("throws when the PDF output exceeds the configured max output bytes", async () => {
    const big = new TextEncoder().encode(
      `%PDF-1.7\n${"x".repeat(4096)}\n%%EOF\n`,
    );
    const { fs } = fakeFs(() => big);
    const runner = createNativeOcrRunner(cfg({ maxOutputBytes: 1024 }), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(
      runner({ options: PDF_ONLY, inputs: [scan] }),
    ).rejects.toThrow();
  });

  it("rejects an oversized input before spawning or touching the filesystem", async () => {
    let spawned = false;
    const { fs, calls } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg({ maxInputBytes: 2 }), {
      exec: async () => {
        spawned = true;
      },
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(
      runner({
        options: PDF_ONLY,
        inputs: [{ ...scan, bytes: new Uint8Array([1, 2, 3, 4]) }],
      }),
    ).rejects.toThrow(/maximum size/i);
    expect(spawned).toBe(false);
    expect(calls.mkdtemp).toHaveLength(0);
  });

  it("rejects a multi-file request (OCR runs over exactly one document)", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(
      runner({ options: PDF_ONLY, inputs: [scan, scan] }),
    ).rejects.toThrow(/one input/i);
  });

  it("throws content-free when no engine is available (defensive backstop)", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: () => false, // nothing installed
    });
    await expect(runner({ options: PDF_ONLY, inputs: [scan] })).rejects.toThrow(
      /no ocr engine/i,
    );
  });
});

/** A rejection shaped like `promisify(execFile)`'s on a non-zero exit. */
function exitError(code: number, stderr = "") {
  return Object.assign(new Error("Command failed"), {
    code,
    killed: false,
    signal: null,
    stderr,
  });
}

describe("createNativeOcrRunner — document refusals are typed, the run stays retryable", () => {
  it("turns OCRmyPDF's encrypted-input exit (8) into an OcrEngineRefusal, and still cleans up", async () => {
    const { fs, calls } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {
        throw exitError(8, "EncryptedPdfError: Input PDF is encrypted.");
      },
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    const failure = await runner({ options: BOTH, inputs: [scan] }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(OcrEngineRefusal);
    expect((failure as OcrEngineRefusal).kind).toBe("encrypted");
    // The engine's stderr classified the failure; it never rides along.
    expect((failure as Error).message).not.toContain("EncryptedPdfError");
    expect(calls.rm).toHaveLength(1);
  });

  it("leaves a timeout as a plain error, so the processor keeps it retryable", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {
        throw Object.assign(new Error("Command failed"), {
          code: null,
          killed: true,
          signal: "SIGTERM",
        });
      },
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    const failure = await runner({ options: BOTH, inputs: [scan] }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(OcrEngineRefusal);
  });

  it("reads OCRmyPDF's exit codes only for OCRmyPDF, never for Tesseract", async () => {
    // Exit statuses are per-program: Tesseract's 8 is not "encrypted".
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {
        throw exitError(8);
      },
      fs,
      resolveOnPath: onlyEngine("tesseract"),
    });
    const png: ProcessorInputFile = {
      ...scan,
      filename: "scan.png",
      contentType: "image/png",
    };
    const failure = await runner({ options: PDF_ONLY, inputs: [png] }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(OcrEngineRefusal);
  });

  it("refuses more inputs than OCR_MAX_INPUT_FILES — the number the panel shows", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    const inputs = Array.from({ length: OCR_MAX_INPUT_FILES + 1 }, () => scan);
    await expect(runner({ options: PDF_ONLY, inputs })).rejects.toThrow();
    // Positive control: exactly the limit runs.
    await expect(
      runner({
        options: PDF_ONLY,
        inputs: inputs.slice(0, OCR_MAX_INPUT_FILES),
      }),
    ).resolves.toBeTruthy();
  });
});

/** A merged OCRmyPDF sidecar where page 1 was skipped because it had text. */
const SKIPPED_SIDECAR = new TextEncoder().encode(
  "[OCR skipped on page 1]\fScanned words from page two\n",
);
const skippedSidecarFs = () =>
  fakeFs((file) => (file.endsWith(".txt") ? SKIPPED_SIDECAR : VALID_PDF));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("createNativeOcrRunner — a skipped page's text reaches the .txt", () => {
  it("fills a skipped page from the existing text layer instead of shipping the placeholder", async () => {
    const seen: Uint8Array[] = [];
    const { fs } = skippedSidecarFs();
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      readExistingText: async (pdf) => {
        seen.push(pdf);
        return { pages: [{ text: "Typed cover page\n" }, { text: "" }] };
      },
    });
    const { artifacts, meta } = await runner({
      options: TEXT_ONLY,
      inputs: [scan],
    });
    const txt = decode(artifacts[0]!.bytes);
    expect(skippedSidecarPages(txt)).toEqual([]);
    expect(txt).toContain("Typed cover page");
    expect(txt).toContain("Scanned words from page two");
    // Read from the user's own input, and the count covers what they receive.
    expect(seen[0]).toBe(scan.bytes);
    expect(meta.textCharacters).toBe(txt.length);
  });

  it("leaves OCRmyPDF's placeholder when no text reader is wired, and the job still succeeds", async () => {
    const { fs } = skippedSidecarFs();
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    const { artifacts } = await runner({ options: TEXT_ONLY, inputs: [scan] });
    expect(skippedSidecarPages(decode(artifacts[0]!.bytes))).toEqual([1]);
  });

  it("never fails a good job because the existing text could not be read", async () => {
    const { fs } = skippedSidecarFs();
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      readExistingText: async () => {
        throw new Error("pdftotext failed.");
      },
    });
    const { artifacts } = await runner({ options: TEXT_ONLY, inputs: [scan] });
    expect(skippedSidecarPages(decode(artifacts[0]!.bytes))).toEqual([1]);
  });

  it("does not read the text layer when no page was skipped", async () => {
    let reads = 0;
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      readExistingText: async () => {
        reads += 1;
        return { pages: [] };
      },
    });
    await runner({ options: TEXT_ONLY, inputs: [scan] });
    expect(reads).toBe(0);
  });
});

/**
 * The composed chain, through the PRODUCTION deps builder and a real poppler:
 * `nativeOcrDeps` must wire the text reader, the reader must return the page's
 * words, and the runner must put them in the artifact. Each unit above can pass
 * while this path drops everything. The worker runs a different poppler and a
 * real OCRmyPDF; `pnpm worker:prove-tools ocr-pdf` proves that one.
 */
const POPPLER = findPopplerPdfToText();
describe.skipIf(!POPPLER)(
  POPPLER
    ? "nativeOcrDeps → real poppler → the .txt a user downloads"
    : "nativeOcrDeps → real poppler (SKIPPED: no poppler pdftotext found on PATH)",
  () => {
    it("fills the typed page of the proof's mixed document with its own words", async () => {
      // The deployment proof's own fixture and verdict (`worker:prove-tools`,
      // "ocr-pdf (text + scan)"), so the verdict is known to pass on a correct
      // chain here and not only on the day it meets a deployment.
      const bytes = await mixedScanPdf();
      const { fs } = skippedSidecarFs();
      const deps = nativeOcrDeps(
        { PDFXYZ_OCR: "1", PDFXYZ_PDF_TEXT_BIN: POPPLER! },
        {
          exec: async () => {},
          fs,
          resolveOnPath: onlyEngine("ocrmypdf"),
          pdfText: { resolveOnPath: () => true, fileExists: () => true },
        },
      );
      const run = await deps.runner!({
        options: TEXT_ONLY,
        inputs: [{ ...scan, bytes }],
      });
      const txt = decode(run.artifacts[0]!.bytes);
      expect(txt).toContain(MIXED_TYPED_LINE);
      expect(txt).toContain("Scanned words from page two");
      expect(skippedSidecarPages(txt)).toEqual([]);
      expect(await mixedSidecarVerdict(run.artifacts[0]!.bytes)).toMatchObject({
        ok: true,
      });
    });
  },
);

describe("probeNativeOcrEnginesFromConfig / firstUsableOcrEngine — config-aware detection", () => {
  const seams = (
    onPath: (b: string) => boolean,
    fileExists?: (p: string) => boolean,
  ): NativeOcrSeams => ({
    resolveOnPath: onPath,
    ...(fileExists ? { fileExists } : {}),
  });

  it("reports nothing when OCR is disabled, even if binaries are on PATH", () => {
    const engines = probeNativeOcrEnginesFromConfig(
      cfg({ enabled: false }),
      seams(() => true),
    );
    expect(engines).toEqual({ ocrmypdf: false, tesseract: false });
    expect(
      firstUsableOcrEngine(
        cfg({ enabled: false }),
        seams(() => true),
      ),
    ).toBeNull();
  });

  it("auto-detects by PATH for non-overridden engines", () => {
    const engines = probeNativeOcrEnginesFromConfig(
      cfg(),
      seams((bin) => bin === "tesseract"),
    );
    expect(engines).toEqual({ ocrmypdf: false, tesseract: true });
  });

  it("prefers ocrmypdf over tesseract when both are present", () => {
    expect(
      firstUsableOcrEngine(
        cfg(),
        seams(() => true),
      ),
    ).toBe("ocrmypdf");
  });

  it("considers only the pinned engine", () => {
    const engines = probeNativeOcrEnginesFromConfig(
      cfg({ engine: "tesseract" }),
      seams(() => true),
    );
    expect(engines).toEqual({ ocrmypdf: false, tesseract: true });
  });

  it("probes an overridden engine by absolute-path existence, not PATH", () => {
    const config = cfg({
      binaries: { ocrmypdf: "/opt/ocrmypdf", tesseract: "tesseract" },
      overridden: { ocrmypdf: true, tesseract: false },
    });
    const engines = probeNativeOcrEnginesFromConfig(
      config,
      seams(
        () => false, // nothing on PATH
        (p) => p === "/opt/ocrmypdf", // the override exists
      ),
    );
    expect(engines).toEqual({ ocrmypdf: true, tesseract: false });
  });
});

describe("nativeOcrDeps / probeNativeOcrEngines — from the environment", () => {
  it("returns EMPTY deps when OCR is not opted into (the honest default)", () => {
    const deps = nativeOcrDeps({}, { resolveOnPath: () => true });
    expect(deps.runner).toBeUndefined();
    expect(deps.engines).toBeUndefined();
  });

  it("wires a runner + probed engines when OCR is enabled", () => {
    const deps = nativeOcrDeps(
      { PDFXYZ_OCR: "on" },
      { resolveOnPath: (bin) => bin === "ocrmypdf" },
    );
    expect(typeof deps.runner).toBe("function");
    expect(deps.engines).toEqual({ ocrmypdf: true, tesseract: false });
  });

  it("reports no engines from the env when OCR is disabled", () => {
    const engines = probeNativeOcrEngines(
      { PDFXYZ_OCR: "off" },
      { resolveOnPath: () => true },
    );
    expect(engines).toEqual({ ocrmypdf: false, tesseract: false });
  });
});

describe("countPdfPages — bounded, best-effort, never throws", () => {
  it("counts the pages of a real PDF", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage([200, 200]);
    const bytes = await doc.save();
    expect(await countPdfPages(bytes)).toBe(3);
  });

  it("returns null for empty or non-PDF bytes rather than throwing", async () => {
    expect(await countPdfPages(new Uint8Array(0))).toBeNull();
    expect(
      await countPdfPages(new TextEncoder().encode("not a pdf")),
    ).toBeNull();
    // A minimal %PDF header with no object structure is not parseable → null, not a guess.
    expect(
      await countPdfPages(new TextEncoder().encode("%PDF-1.7\n%%EOF\n")),
    ).toBeNull();
  });
});

describe("countTextCharacters — a count only, never the text", () => {
  it("counts characters in a decoded sidecar", () => {
    expect(countTextCharacters(new TextEncoder().encode("hello"))).toBe(5);
    expect(countTextCharacters(new Uint8Array(0))).toBe(0);
  });

  it("returns null (not a partial count) for a sidecar above the measure ceiling", () => {
    // A 33 MiB buffer exceeds the 32 MiB measure ceiling: honestly "not measured".
    const huge = new Uint8Array(33 * 1024 * 1024);
    expect(countTextCharacters(huge)).toBeNull();
  });
});

describe("OCRmyPDF searchable-PDF metadata fidelity (Phase 27)", () => {
  it("searchable-pdf mode: engine ocrmypdf, PDF-only artifact kind, page count from the produced PDF", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      countPages: async () => 7,
    });
    const { artifacts, meta } = await runner({
      options: PDF_ONLY,
      inputs: [scan],
    });
    // The only artifact kind is a searchable PDF, and the meta reflects exactly that.
    expect(artifacts.map((a) => a.contentType)).toEqual(["application/pdf"]);
    expect(meta.engine).toBe("ocrmypdf");
    expect(meta.outputMode).toBe("searchable-pdf");
    expect(meta.producedSearchablePdf).toBe(true);
    expect(meta.producedTextSidecar).toBe(false);
    expect(meta.pageCount).toBe(7);
    // No sidecar ⇒ honestly null, never 0; the native backend exposes no confidence.
    expect(meta.textCharacters).toBeNull();
    expect(meta.meanConfidence).toBeNull();
  });

  it("measures the page count from the PRODUCED searchable PDF, never the input scan", async () => {
    // The produced output PDF (VALID_PDF) and the input scan carry DIFFERENT bytes;
    // capture what the page counter is handed and assert it is the produced output.
    const seen: Uint8Array[] = [];
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      countPages: async (bytes) => {
        seen.push(bytes);
        return 3;
      },
    });
    const { meta } = await runner({ options: PDF_ONLY, inputs: [scan] });
    expect(meta.pageCount).toBe(3);
    expect(seen).toHaveLength(1);
    // The counted bytes ARE the produced searchable PDF — not the 3-byte input scan.
    expect(seen[0]).toEqual(VALID_PDF);
    expect(seen[0]).not.toEqual(scan.bytes);
  });

  it("both mode: bounded sidecar character count with NO recognized text leaking into meta", async () => {
    const recognized =
      "TOPSECRET recognized words that must never ride in metadata";
    const sidecarBytes = new TextEncoder().encode(recognized);
    const { fs } = fakeFs((file) =>
      file.endsWith(".txt") ? sidecarBytes : VALID_PDF,
    );
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      countPages: async () => 4,
    });
    const { meta } = await runner({ options: BOTH, inputs: [scan] });
    expect(meta.producedSearchablePdf).toBe(true);
    expect(meta.producedTextSidecar).toBe(true);
    expect(meta.pageCount).toBe(4);
    // A COUNT ONLY — the sidecar's length, never its contents.
    expect(meta.textCharacters).toBe(recognized.length);
    expect(JSON.stringify(meta)).not.toContain("TOPSECRET");
    expect(JSON.stringify(meta)).not.toContain("recognized words");
  });

  it("does not fabricate metadata when OCRmyPDF yields no usable searchable PDF (throws, no meta)", async () => {
    // A missing/invalid searchable-PDF output is a failure: the runner throws and returns
    // NO artifacts and NO metadata, so nothing downstream can imply a searchable PDF that
    // was never produced — even though the page counter would gladly return a number.
    const { fs, calls } = fakeFs((file) =>
      file.endsWith(".txt") ? TEXT_OUT : NOT_PDF,
    );
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
      countPages: async () => 9,
    });
    await expect(runner({ options: PDF_ONLY, inputs: [scan] })).rejects.toThrow(
      /usable PDF/i,
    );
    expect(calls.rm).toHaveLength(1); // cleanup still runs; no fabricated success
  });
});
