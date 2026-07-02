// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { OcrOptions } from "@/lib/jobs/ocr";
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

const BOTH: OcrOptions = { languages: ["eng", "spa"], outputMode: "both", skipTextPages: false };
const PDF_ONLY: OcrOptions = { languages: ["eng"], outputMode: "searchable-pdf", skipTextPages: false };
const TEXT_ONLY: OcrOptions = { languages: ["eng"], outputMode: "text", skipTextPages: false };

const scan: ProcessorInputFile = {
  fileId: "f_1234567890",
  filename: "Client Scan.pdf",
  contentType: "application/pdf",
  bytes: new Uint8Array([1, 2, 3]),
};

/** Minimal bytes that satisfy the structural PDF check (header + trailer). */
const VALID_PDF = new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(64)}\n%%EOF\n`);
const NOT_PDF = new TextEncoder().encode("this is plainly not a pdf document");
const TEXT_OUT = new TextEncoder().encode("Recognized text from the scan.");

interface FsCalls {
  mkdtemp: string[];
  writeFile: { file: string; len: number }[];
  readFile: string[];
  rm: string[];
}

/** A recording fake fs whose readFile returns bytes chosen per path (pdf vs txt). */
function fakeFs(read: (file: string) => Uint8Array): { fs: NativeOcrFs; calls: FsCalls } {
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
const onlyEngine = (present: string): NativeOcrSeams["resolveOnPath"] => (bin) => bin === present;

describe("nativeOcrArgs — fixed argv, no shell interpolation", () => {
  it("builds OCRmyPDF args: joined languages, sidecar, and separate input/output paths", () => {
    const inv = nativeOcrArgs("ocrmypdf", "ocrmypdf", {
      inputPath: "/tmp/j/input.pdf",
      workDir: "/tmp/j",
      languages: ["eng", "spa"],
      skipTextPages: false,
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
    expect(inv.pdfOut).toBe("/tmp/j/output.pdf");
  });

  it("adds --skip-text only when requested, and omits the sidecar for pdf-only", () => {
    const inv = nativeOcrArgs("ocrmypdf", "ocrmypdf", {
      inputPath: "/t/in.pdf",
      workDir: "/t",
      languages: ["eng"],
      skipTextPages: true,
      wantPdf: true,
      wantText: false,
    });
    expect(inv.args).toContain("--skip-text");
    expect(inv.args).not.toContain("--sidecar");
  });

  it("builds Tesseract args with an output base and pdf/txt config tokens", () => {
    const inv = nativeOcrArgs("tesseract", "tesseract", {
      inputPath: "/t/in.png",
      workDir: "/t",
      languages: ["eng", "deu"],
      skipTextPages: true, // ignored for tesseract
      wantPdf: true,
      wantText: true,
    });
    expect(inv.command).toBe("tesseract");
    expect(inv.args.slice(0, 4)).toEqual(["/t/in.png", "/t/output", "-l", "eng+deu"]);
    expect(inv.args).toContain("pdf");
    expect(inv.args).toContain("txt");
    // tesseract has no page-level skip-text notion.
    expect(inv.args).not.toContain("--skip-text");
    expect(inv.pdfOut).toBe("/t/output.pdf");
    expect(inv.txtOut).toBe("/t/output.txt");
  });

  it("passes an override command path through verbatim", () => {
    const inv = nativeOcrArgs("ocrmypdf", "/opt/ocr/bin/ocrmypdf", {
      inputPath: "/t/in.pdf",
      workDir: "/t",
      languages: ["eng"],
      skipTextPages: false,
      wantPdf: true,
      wantText: false,
    });
    expect(inv.command).toBe("/opt/ocr/bin/ocrmypdf");
  });
});

describe("inputExtension — safe, fixed temp extension by content type", () => {
  it("maps common types and defaults unknown to pdf", () => {
    expect(inputExtension({ ...scan, contentType: "application/pdf" })).toBe("pdf");
    expect(inputExtension({ ...scan, contentType: "image/png" })).toBe("png");
    expect(inputExtension({ ...scan, contentType: "image/jpeg" })).toBe("jpg");
    expect(inputExtension({ ...scan, contentType: "application/octet-stream" })).toBe("pdf");
  });
});

describe("createNativeOcrRunner — success paths", () => {
  it("writes input, runs OCRmyPDF by argv, returns validated PDF + text artifacts, cleans up", async () => {
    const execCalls: { command: string; args: string[]; options: unknown }[] = [];
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

    expect(artifacts.map((a) => a.filename)).toEqual(["Client Scan-ocr.pdf", "Client Scan.txt"]);
    expect(artifacts[0]?.contentType).toBe("application/pdf");
    expect(artifacts[0]?.bytes).toEqual(VALID_PDF);
    expect(artifacts[1]?.contentType).toContain("text/plain");
    expect(artifacts[1]?.bytes).toEqual(TEXT_OUT);
    // The whole temp lifecycle happened and the dir was removed.
    expect(calls.mkdtemp[0]).toContain("/base");
    expect(calls.writeFile).toHaveLength(1);
    expect(calls.rm).toHaveLength(1);
    // The subprocess was invoked by argv with the configured timeout.
    expect(execCalls[0]!.command).toBe("ocrmypdf");
    expect(execCalls[0]!.options).toMatchObject({ timeout: 300_000, windowsHide: true });

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
      meanConfidence: null, // the native backend exposes none — never fabricated
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
    const { artifacts, meta } = await runner({ options: PDF_ONLY, inputs: [scan] });
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
    const { artifacts, meta } = await runner({ options: TEXT_ONLY, inputs: [scan] });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.filename).toBe("Client Scan.txt");
    // The PDF output is never read in text-only mode.
    expect(readCalls.every((f) => f.endsWith(".txt"))).toBe(true);
    // No PDF ⇒ null page count; the sidecar's characters ARE counted.
    expect(meta.producedSearchablePdf).toBe(false);
    expect(meta.pageCount).toBeNull();
    expect(meta.textCharacters).toBe(TEXT_OUT.byteLength);
  });

  it("uses tesseract when it is the only engine present, and names it in the meta", async () => {
    const execCalls: string[][] = [];
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async (_command, args) => {
        execCalls.push([...args]);
      },
      fs,
      resolveOnPath: onlyEngine("tesseract"),
      countPages: async () => 1,
    });
    const { artifacts, meta } = await runner({ options: PDF_ONLY, inputs: [scan] });
    expect(artifacts).toHaveLength(1);
    // tesseract argv shape: input, base, -l, lang, pdf
    expect(execCalls[0]?.[2]).toBe("-l");
    expect(execCalls[0]).toContain("pdf");
    expect(meta.engine).toBe("tesseract");
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
    const runner = createNativeOcrRunner(cfg(), { exec, fs, resolveOnPath: onlyEngine("ocrmypdf") });
    await expect(runner({ options: BOTH, inputs: [scan] })).rejects.toThrow();
    expect(calls.rm).toHaveLength(1); // cleanup on failure is load-bearing
  });

  it("throws when the engine produces non-PDF output, and cleans up", async () => {
    const { fs, calls } = fakeFs((file) => (file.endsWith(".txt") ? TEXT_OUT : NOT_PDF));
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(runner({ options: PDF_ONLY, inputs: [scan] })).rejects.toThrow(/usable PDF/i);
    expect(calls.rm).toHaveLength(1);
  });

  it("throws when the text output is empty", async () => {
    const { fs } = fakeFs((file) => (file.endsWith(".txt") ? new Uint8Array(0) : VALID_PDF));
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(runner({ options: TEXT_ONLY, inputs: [scan] })).rejects.toThrow(/text output/i);
  });

  it("throws when the PDF output exceeds the configured max output bytes", async () => {
    const big = new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(4096)}\n%%EOF\n`);
    const { fs } = fakeFs(() => big);
    const runner = createNativeOcrRunner(cfg({ maxOutputBytes: 1024 }), {
      exec: async () => {},
      fs,
      resolveOnPath: onlyEngine("ocrmypdf"),
    });
    await expect(runner({ options: PDF_ONLY, inputs: [scan] })).rejects.toThrow();
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
      runner({ options: PDF_ONLY, inputs: [{ ...scan, bytes: new Uint8Array([1, 2, 3, 4]) }] }),
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
    await expect(runner({ options: PDF_ONLY, inputs: [scan, scan] })).rejects.toThrow(/one input/i);
  });

  it("throws content-free when no engine is available (defensive backstop)", async () => {
    const { fs } = fakeFs(pdfOrText);
    const runner = createNativeOcrRunner(cfg(), {
      exec: async () => {},
      fs,
      resolveOnPath: () => false, // nothing installed
    });
    await expect(runner({ options: PDF_ONLY, inputs: [scan] })).rejects.toThrow(/no ocr engine/i);
  });
});

describe("probeNativeOcrEnginesFromConfig / firstUsableOcrEngine — config-aware detection", () => {
  const seams = (onPath: (b: string) => boolean, fileExists?: (p: string) => boolean): NativeOcrSeams => ({
    resolveOnPath: onPath,
    ...(fileExists ? { fileExists } : {}),
  });

  it("reports nothing when OCR is disabled, even if binaries are on PATH", () => {
    const engines = probeNativeOcrEnginesFromConfig(cfg({ enabled: false }), seams(() => true));
    expect(engines).toEqual({ ocrmypdf: false, tesseract: false });
    expect(firstUsableOcrEngine(cfg({ enabled: false }), seams(() => true))).toBeNull();
  });

  it("auto-detects by PATH for non-overridden engines", () => {
    const engines = probeNativeOcrEnginesFromConfig(cfg(), seams((bin) => bin === "tesseract"));
    expect(engines).toEqual({ ocrmypdf: false, tesseract: true });
  });

  it("prefers ocrmypdf over tesseract when both are present", () => {
    expect(firstUsableOcrEngine(cfg(), seams(() => true))).toBe("ocrmypdf");
  });

  it("considers only the pinned engine", () => {
    const engines = probeNativeOcrEnginesFromConfig(cfg({ engine: "tesseract" }), seams(() => true));
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
    const engines = probeNativeOcrEngines({ PDFXYZ_OCR: "off" }, { resolveOnPath: () => true });
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
    expect(await countPdfPages(new TextEncoder().encode("not a pdf"))).toBeNull();
    // A minimal %PDF header with no object structure is not parseable → null, not a guess.
    expect(await countPdfPages(new TextEncoder().encode("%PDF-1.7\n%%EOF\n"))).toBeNull();
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
