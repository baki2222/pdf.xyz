import { describe, expect, it, vi } from "vitest";
import {
  createOfficeConversionProcessor,
  officePdfOutputName,
} from "./office-conversion";
import { createNativeLibreOfficePdfRunner } from "../office-conversion/native";
import type { NativeOfficeConversionConfig } from "../office-conversion/native-config";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const DOCX = new TextEncoder().encode("docx");

describe("office-conversion processor", () => {
  it("owns Word/Excel/PowerPoint to PDF and reports readiness", () => {
    const processor = createOfficeConversionProcessor({
      libreoffice: { convertToPdf: vi.fn(async () => PDF) },
    });
    expect(processor.tools).toEqual([
      "word-to-pdf",
      "excel-to-pdf",
      "powerpoint-to-pdf",
    ]);
    expect(processor.supports("word-to-pdf")).toBe(true);
    expect(processor.supports("excel-to-pdf")).toBe(true);
    expect(processor.supports("powerpoint-to-pdf")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "office-conversion",
      ready: true,
    });
  });

  it("fails honestly without LibreOffice", async () => {
    const result = await createOfficeConversionProcessor({}).process({
      tool: "word-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.docx",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: DOCX,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("converts one Office input into a PDF artifact", async () => {
    const convertToPdf = vi.fn(async () => PDF);
    const result = await createOfficeConversionProcessor({
      libreoffice: { convertToPdf },
    }).process({
      tool: "word-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "quarterly.report.docx",
          contentType: "application/octet-stream",
          bytes: DOCX,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(convertToPdf).toHaveBeenCalledWith(
      DOCX,
      "quarterly.report.docx",
      {},
    );
    if (result.ok) {
      expect(result.artifacts[0]).toMatchObject({
        filename: "quarterly.report.pdf",
        contentType: "application/pdf",
      });
      expect(result.meta).toMatchObject({
        engine: "libreoffice",
        tool: "word-to-pdf",
      });
    }
  });

  it("rejects multiple files and wrong extensions", async () => {
    const processor = createOfficeConversionProcessor({
      libreoffice: { convertToPdf: vi.fn(async () => PDF) },
    });
    const none = await processor.process({
      tool: "word-to-pdf",
      options: {},
      inputs: [],
    });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe("unprocessable_entity");
    const wrong = await processor.process({
      tool: "excel-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.docx",
          contentType: "application/octet-stream",
          bytes: DOCX,
        },
      ],
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(officePdfOutputName("report.final.docx")).toBe("report.final.pdf");
  });
});

/**
 * The composed chain the executor sees: the REAL native runner (its exec and
 * fs seams stubbed the way `execFile` and `fs/promises` answer), the engine,
 * then this processor's retry decision.
 *
 * Every LibreOffice failure used to leave the runner as one untyped `Error`,
 * the engine collapsed it to `failed`, and this processor marked `failed`
 * retryable. So a password-protected or corrupt deck — the same bytes, the
 * same answer, every time — was converted three times with backoff, and a
 * deck that hit the 120 s timeout was retried into ~370 s of worker time, three
 * times the browser's wait. The user waited through all of it and read "could
 * not convert", with no word about the password.
 */
describe("office-conversion processor — failures that repeat are final", () => {
  const CONFIG: NativeOfficeConversionConfig = {
    enabled: true,
    candidates: ["soffice"],
    overridden: false,
    timeoutMs: 120_000,
    maxInputBytes: 10_000,
    maxOutputBytes: 1_000,
    tmpDir: "/tmp",
  };
  const PPTX_TYPE =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  function fs(
    readFile: () => Promise<Uint8Array> = async () => PDF,
    mkdtemp: () => Promise<string> = async () => "/tmp/pdfxyz-office-1",
  ) {
    return {
      mkdtemp: vi.fn(mkdtemp),
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(readFile),
      rm: vi.fn(async () => {}),
    };
  }

  async function convert(
    seams: {
      exec?: () => Promise<{ code: number; timedOut: boolean }>;
      fs?: ReturnType<typeof fs>;
    },
    filename = "deck.pptx",
    bytes: Uint8Array = DOCX,
  ) {
    const exec = vi.fn(
      seams.exec ?? (async () => ({ code: 0, timedOut: false })),
    );
    const libreoffice = createNativeLibreOfficePdfRunner(CONFIG, {
      exec,
      fs: seams.fs ?? fs(),
      resolveOnPath: () => true,
    });
    const result = await createOfficeConversionProcessor({
      libreoffice,
      limits: { maxInputBytes: CONFIG.maxInputBytes },
    }).process({
      tool: "powerpoint-to-pdf",
      options: {},
      inputs: [{ fileId: "f", filename, contentType: PPTX_TYPE, bytes }],
    });
    return { result, exec };
  }

  function errorOf(result: Awaited<ReturnType<typeof convert>>["result"]) {
    if (result.ok) throw new Error("expected a failure");
    return result.error;
  }

  const enoent = () =>
    Promise.reject(
      Object.assign(new Error("no such file"), { code: "ENOENT" }),
    );

  it("a non-zero exit is final, and says what to try", async () => {
    const error = errorOf(
      (await convert({ exec: async () => ({ code: 1, timedOut: false }) }))
        .result,
    );
    expect(error).toMatchObject({
      code: "unprocessable_entity",
      retryable: false,
    });
    expect(error.message).toMatch(/password/i);
    expect(error.message).toMatch(/\.pptx/);
  });

  it("exit 0 with no output file (LibreOffice's answer to an unloadable file) is final", async () => {
    expect(errorOf((await convert({ fs: fs(enoent) })).result)).toMatchObject({
      code: "unprocessable_entity",
      retryable: false,
    });
  });

  it("output that is not a PDF is final", async () => {
    expect(
      errorOf(
        (
          await convert({
            fs: fs(async () => new TextEncoder().encode("nope")),
          })
        ).result,
      ),
    ).toMatchObject({ code: "unprocessable_entity", retryable: false });
  });

  it("a timeout is final — the same deck times out again on the same worker", async () => {
    const error = errorOf(
      (await convert({ exec: async () => ({ code: -1, timedOut: true }) }))
        .result,
    );
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/too long/i);
  });

  it("output over the worker's ceiling is final: payload_too_large", async () => {
    expect(
      errorOf(
        (
          await convert({
            fs: fs(async () => {
              const big = new Uint8Array(CONFIG.maxOutputBytes + 1);
              big.set(PDF);
              return big;
            }),
          })
        ).result,
      ),
    ).toMatchObject({ code: "payload_too_large", retryable: false });
  });

  it("POSITIVE CONTROL: an IO failure and a signal kill stay retryable", async () => {
    const io = errorOf(
      (
        await convert({
          fs: fs(undefined, () =>
            Promise.reject(Object.assign(new Error("io"), { code: "EIO" })),
          ),
        })
      ).result,
    );
    expect(io).toMatchObject({ code: "internal_error", retryable: true });
    const killed = errorOf(
      (await convert({ exec: async () => ({ code: -1, timedOut: false }) }))
        .result,
    );
    expect(killed).toMatchObject({ code: "internal_error", retryable: true });
  });

  it("an encrypted .pptx is named password-protected before LibreOffice runs", async () => {
    const { result, exec } = await convert({}, "deck.pptx", encryptedOoxml());
    const error = errorOf(result);
    expect(error).toMatchObject({ retryable: false });
    expect(error.message).toMatch(/password-protected/);
    expect(error.message).toMatch(/PowerPoint/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: a legacy .ppt is a compound file too, and still converts", async () => {
    const { result, exec } = await convert(
      {},
      "deck.ppt",
      compoundFile("PowerPoint Document"),
    );
    expect(result.ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("never hands a user a repository path", async () => {
    const result = await createOfficeConversionProcessor({}).process({
      tool: "powerpoint-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "deck.pptx",
          contentType: PPTX_TYPE,
          bytes: DOCX,
        },
      ],
    });
    expect(errorOf(result).message).not.toMatch(/docs\/|\.md\b/);
  });
});

/**
 * A password-locked OpenDocument file, as LibreOffice locked it
 * (`src/tests/odf-locked-fixtures/`), through the whole processor with the
 * real runner and only its process and filesystem stubbed. Until 2026-11-04
 * soffice ran, exited 0 with no PDF, and the user read "could not be
 * converted … save it again as .docx".
 */
describe("office-conversion processor — a locked OpenDocument file", () => {
  const CONFIG: NativeOfficeConversionConfig = {
    enabled: true,
    candidates: ["soffice"],
    overridden: false,
    timeoutMs: 120_000,
    maxInputBytes: 100_000,
    maxOutputBytes: 100_000,
    tmpDir: "/tmp",
  };
  const fixture = (name: string) =>
    new Uint8Array(readFileSync(`src/tests/odf-locked-fixtures/${name}`));

  async function run(tool: string, filename: string, bytes: Uint8Array) {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const libreoffice = createNativeLibreOfficePdfRunner(CONFIG, {
      exec,
      fs: {
        mkdtemp: vi.fn(async () => "/tmp/pdfxyz-office-1"),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => PDF),
        rm: vi.fn(async () => {}),
      },
      resolveOnPath: () => true,
    });
    const result = await createOfficeConversionProcessor({
      libreoffice,
      limits: { maxInputBytes: CONFIG.maxInputBytes },
    }).process({
      tool,
      options: {},
      inputs: [{ fileId: "f", filename, contentType: "", bytes }],
    });
    return { result, exec };
  }

  for (const [tool, name, noun] of [
    ["word-to-pdf", "locked.odt", "document"],
    ["excel-to-pdf", "locked.ods", "workbook"],
    ["powerpoint-to-pdf", "locked.odp", "presentation"],
  ] as const)
    it(`${tool}: ${name} is named password-protected, with LibreOffice's way out, and soffice never runs`, async () => {
      const { result, exec } = await run(tool, name, fixture(name));
      if (result.ok) throw new Error("expected a failure");
      expect(result.error).toMatchObject({
        code: "unprocessable_entity",
        retryable: false,
      });
      expect(result.error.message).toBe(
        `This ${noun} is password-protected. Open it in LibreOffice (or the app that saved it), choose File > Save As, saving a copy without its password, and convert the copy.`,
      );
      expect(exec).not.toHaveBeenCalled();
    });

  it("POSITIVE CONTROL: its unlocked twin reaches soffice and converts", async () => {
    const { result, exec } = await run(
      "word-to-pdf",
      "open.odt",
      fixture("open.odt"),
    );
    expect(result.ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

/** The OLE compound-file signature, then a directory entry name in UTF-16LE. */
function compoundFile(streamName: string): Uint8Array {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const name = [...streamName].flatMap((c) => [c.charCodeAt(0), 0]);
  const bytes = new Uint8Array(1024);
  bytes.set(magic, 0);
  bytes.set(name, 512);
  return bytes;
}

/** What Office writes for a password-protected .docx/.xlsx/.pptx. */
function encryptedOoxml(): Uint8Array {
  const info = compoundFile("EncryptionInfo");
  const pkg = compoundFile("EncryptedPackage");
  const out = new Uint8Array(1024);
  out.set(info.subarray(0, 600));
  out.set(pkg.subarray(512, 600), 640);
  return out;
}

/**
 * Excel to PDF's "Put each sheet on one page" (audit excel-to-pdf#1,
 * 2026-11-08), through the composed chain: the job's option bag, the
 * processor, the engine, the native runner, and the argv soffice is given.
 * A unit test of the target string alone would pass while the processor
 * dropped the option on the way, which is the seam this pins.
 */
describe("excel-to-pdf one page per sheet reaches soffice's argv", () => {
  const CSV = new TextEncoder().encode("Town,Visitors\nBern,980\n");
  const SINGLE_PAGE_TARGET =
    'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}';

  async function argvFor(tool: string, options: Record<string, unknown>) {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const config: NativeOfficeConversionConfig = {
      enabled: true,
      candidates: ["soffice"],
      overridden: false,
      timeoutMs: 120_000,
      maxInputBytes: 10_000,
      maxOutputBytes: 10_000,
      tmpDir: "/tmp",
    };
    const libreoffice = createNativeLibreOfficePdfRunner(config, {
      exec,
      resolveOnPath: (bin) => bin === "soffice",
      fs: {
        mkdtemp: async () => "/tmp/pdfxyz-office-1",
        writeFile: async () => {},
        readFile: async () => PDF,
        rm: async () => {},
      },
    });
    const result = await createOfficeConversionProcessor({
      libreoffice,
    }).process({
      tool,
      options,
      inputs: [
        {
          fileId: "f",
          filename: tool === "excel-to-pdf" ? "towns.csv" : "notes.docx",
          contentType: "text/csv",
          bytes: CSV,
        },
      ],
    });
    const argv = exec.mock.calls[0]
      ? (exec.mock.calls[0] as unknown as [string, string[]])[1]
      : null;
    return { result, argv };
  }

  it("asks LibreOffice's Calc PDF filter for SinglePageSheets", async () => {
    const { result, argv } = await argvFor("excel-to-pdf", {
      onePagePerSheet: true,
    });
    expect(result.ok).toBe(true);
    expect(argv).not.toBeNull();
    const at = argv!.indexOf("--convert-to");
    expect(argv![at + 1]).toBe(SINGLE_PAGE_TARGET);
    // The target is valid JSON after the filter name, as LibreOffice parses it.
    expect(
      JSON.parse(argv![at + 1]!.slice("pdf:calc_pdf_Export:".length)),
    ).toEqual({ SinglePageSheets: { type: "boolean", value: "true" } });
  });

  it("CONTROL: without the option the argv is exactly as before", async () => {
    for (const options of [{}, { onePagePerSheet: false }]) {
      const { argv } = await argvFor("excel-to-pdf", options);
      expect(argv![argv!.indexOf("--convert-to") + 1]).toBe("pdf");
    }
  });

  it("is Excel's alone: Word to PDF never sends a Calc filter", async () => {
    const { argv } = await argvFor("word-to-pdf", { onePagePerSheet: true });
    expect(argv![argv!.indexOf("--convert-to") + 1]).toBe("pdf");
  });

  it("a value that is not a boolean is refused before soffice runs", async () => {
    const { result, argv } = await argvFor("excel-to-pdf", {
      onePagePerSheet: "yes",
    });
    expect(argv).toBeNull();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "unprocessable_entity",
        retryable: false,
      });
  });
});

/*
 * Review 2026-11-08 (audit excel-to-pdf#1): orientation and fit-to-width are
 * written into the workbook's own page setup before soffice runs. This runs
 * the composed chain - option bag, processor, engine, the lazily loaded
 * rewrite, the native runner with only exec and fs stubbed - and unzips the
 * bytes soffice is actually handed.
 */
describe("excel-to-pdf orientation and fit-to-width reach the workbook soffice opens", () => {
  const SHEET =
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';

  async function workbook(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    );
    zip.file("_rels/.rels", "<Relationships/>");
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/worksheets/sheet1.xml", SHEET);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  async function run(
    tool: string,
    filename: string,
    options: Record<string, unknown>,
  ) {
    const written: Uint8Array[] = [];
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const libreoffice = createNativeLibreOfficePdfRunner(
      {
        enabled: true,
        candidates: ["soffice"],
        overridden: false,
        timeoutMs: 120_000,
        maxInputBytes: 1_000_000,
        maxOutputBytes: 10_000,
        tmpDir: "/tmp",
      },
      {
        exec,
        resolveOnPath: (bin) => bin === "soffice",
        fs: {
          mkdtemp: async () => "/tmp/pdfxyz-office-1",
          writeFile: async (_file, data) => {
            written.push(data);
          },
          readFile: async () => PDF,
          rm: async () => {},
        },
      },
    );
    const bytes = await workbook();
    const result = await createOfficeConversionProcessor({
      libreoffice,
    }).process({
      tool,
      options,
      inputs: [{ fileId: "f", filename, contentType: "x", bytes }],
    });
    const argv = exec.mock.calls[0]
      ? (exec.mock.calls[0] as unknown as [string, string[]])[1]
      : null;
    const sheet = written[0]
      ? await (
          await JSZip.loadAsync(written[0])
        )
          .file("xl/worksheets/sheet1.xml")
          ?.async("string")
      : undefined;
    return { result, argv, sheet };
  }

  it("landscape + fit columns: soffice opens a workbook that says so", async () => {
    const { result, argv, sheet } = await run("excel-to-pdf", "wide.xlsx", {
      orientation: "landscape",
      fitColumnsToWidth: true,
    });
    expect(result.ok).toBe(true);
    expect(sheet).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(sheet).toContain(
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
    );
    // Page setup is read from the file, so the export is the plain one.
    expect(argv![argv!.indexOf("--convert-to") + 1]).toBe("pdf");
  });

  it("portrait alone sets the orientation and does not switch scaling on", async () => {
    const { sheet } = await run("excel-to-pdf", "wide.xlsx", {
      orientation: "portrait",
    });
    expect(sheet).toContain(
      '<pageSetup paperSize="9" orientation="portrait"/>',
    );
    expect(sheet).not.toContain("fitTo");
  });

  it("CONTROL: with no layout the bytes soffice gets are the upload's", async () => {
    const { sheet } = await run("excel-to-pdf", "wide.xlsx", {});
    expect(sheet).toBe(SHEET);
  });

  it("refused before soffice on a file its rewrite cannot reach", async () => {
    const { result, argv } = await run("excel-to-pdf", "towns.csv", {
      fitColumnsToWidth: true,
    });
    expect(argv).toBeNull();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "unprocessable_entity",
        retryable: false,
        message: expect.stringContaining("work on .xlsx files only"),
      });
  });

  it("refuses one page per sheet combined with page setup", async () => {
    const { result, argv } = await run("excel-to-pdf", "wide.xlsx", {
      onePagePerSheet: true,
      orientation: "landscape",
    });
    expect(argv).toBeNull();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toContain("cannot be combined");
  });
});
