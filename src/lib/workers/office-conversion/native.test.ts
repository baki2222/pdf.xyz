import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  CSV_UTF8_INFILTER,
  csvImportFilter,
  libreOfficeConvertArgs,
  createNativeLibreOfficePdfRunner,
  nativeOfficeConversionDeps,
  probeLibreOfficeFromConfig,
} from "./native";
import {
  resolveNativeOfficeConversionConfig,
  type NativeOfficeConversionConfig,
} from "./native-config";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const DOCX = new TextEncoder().encode("docx");
const config: NativeOfficeConversionConfig = {
  enabled: true,
  candidates: ["soffice", "libreoffice"],
  overridden: false,
  timeoutMs: 120_000,
  maxInputBytes: 1000,
  maxOutputBytes: 1000,
  tmpDir: "/tmp",
};

function fsStub(output = PDF) {
  return {
    mkdtemp: vi.fn(async () => "/tmp/pdfxyz-office-1"),
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => output),
    rm: vi.fn(async () => {}),
  };
}

describe("native LibreOffice Office converter", () => {
  it("resolves config defaults and overrides", () => {
    expect(resolveNativeOfficeConversionConfig({})).toMatchObject({
      enabled: true,
      candidates: ["soffice", "libreoffice"],
      timeoutMs: 120_000,
    });
    expect(
      resolveNativeOfficeConversionConfig({
        PDFXYZ_OFFICE_CONVERSION: "off",
        PDFXYZ_LIBREOFFICE_BIN: "/usr/bin/soffice",
        PDFXYZ_OFFICE_CONVERSION_TIMEOUT_MS: "45000",
      }),
    ).toMatchObject({
      enabled: false,
      candidates: ["/usr/bin/soffice"],
      overridden: true,
      timeoutMs: 45_000,
    });
  });

  it("builds fixed no-shell conversion argv", () => {
    expect(libreOfficeConvertArgs("/tmp/in.docx", "/tmp/out")).toEqual([
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      "--nodefault",
      "--nolockcheck",
      "--convert-to",
      "pdf",
      "--outdir",
      "/tmp/out",
      "/tmp/in.docx",
    ]);
  });

  describe("a CSV's character set (measured in the worker image, 2026-11-07)", () => {
    // LibreOffice handed a CSV with no import options reads it in its
    // Western default: UTF-8 "Zürich" printed as "ZÃ¼rich", which is how
    // production's "excel-to-pdf (csv)" proof failed. Forcing UTF-8 on every
    // CSV is no fix either: a Windows-1252 "Zürich" then printed "Z�rich".
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const UTF8_CSV = new TextEncoder().encode("Town,Visitors\nZürich,980\n");
    const BOM_CSV = new Uint8Array([0xef, 0xbb, 0xbf, ...UTF8_CSV]);
    const CP1252_CSV = new Uint8Array([
      ...ascii("Town,Visitors\nZ"),
      0xfc,
      ...ascii("rich,980\n"),
    ]);
    const ASCII_CSV = new TextEncoder().encode("Town,Visitors\nBern,980\n");

    async function argsFor(bytes: Uint8Array, name: string) {
      const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
      const runner = createNativeLibreOfficePdfRunner(config, {
        exec,
        fs: fsStub(),
        resolveOnPath: (bin) => bin === "soffice",
      });
      await runner.convertToPdf(bytes, name);
      return (exec.mock.calls[0] as unknown as [string, string[]])[1];
    }
    const FILTER = `--infilter=${CSV_UTF8_INFILTER}`;

    it("CONTROL: the filter is LibreOffice's CSV import with character set 76 (UTF-8)", () => {
      expect(CSV_UTF8_INFILTER).toBe("Text - txt - csv (StarCalc):44,34,76,1");
    });

    it("a UTF-8 CSV with non-ASCII text is imported as UTF-8, the file still last", async () => {
      const args = await argsFor(UTF8_CSV, "towns.csv");
      expect(args).toContain(FILTER);
      expect(args.indexOf(FILTER)).toBeLessThan(args.indexOf("--convert-to"));
      expect(args.at(-1)).toBe(join("/tmp/pdfxyz-office-1", "input.csv"));
    });

    it("so is one that starts with a byte-order mark", async () => {
      expect(await argsFor(BOM_CSV, "towns.csv")).toContain(FILTER);
    });

    it("a Windows-1252 CSV keeps the default that reads it correctly", async () => {
      expect(await argsFor(CP1252_CSV, "towns.csv")).not.toContain(FILTER);
    });

    it("an ASCII-only CSV is handed over exactly as before", async () => {
      expect(await argsFor(ASCII_CSV, "towns.csv")).not.toContain(FILTER);
    });

    it("a file that is not a CSV never gets the CSV filter, even as UTF-8 text", async () => {
      expect(await argsFor(UTF8_CSV, "notes.docx")).not.toContain(FILTER);
      expect(csvImportFilter(UTF8_CSV, "input.CSV")).toBe(CSV_UTF8_INFILTER);
    });
  });

  it("converts through temp input/output and cleans up", async () => {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const fs = fsStub();
    const runner = createNativeLibreOfficePdfRunner(config, {
      exec,
      fs,
      resolveOnPath: (bin) => bin === "soffice",
    });
    const output = await runner.convertToPdf(DOCX, "report.docx");
    expect([...output]).toEqual([...PDF]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-office-1", "input.docx"),
      DOCX,
    );
    expect(exec).toHaveBeenCalledWith(
      "soffice",
      expect.arrayContaining([
        "--outdir",
        "/tmp/pdfxyz-office-1",
        join("/tmp/pdfxyz-office-1", "input.docx"),
      ]),
      expect.objectContaining({ timeout: 120_000 }),
    );
    expect(fs.readFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-office-1", "input.pdf"),
    );
    expect(fs.rm).toHaveBeenCalledWith("/tmp/pdfxyz-office-1", {
      recursive: true,
      force: true,
    });
  });

  it("fails on conversion error or non-PDF output, saying which", async () => {
    // These asserted only a message pattern. Every failure was the same
    // untyped Error, so nothing downstream could tell a corrupt document
    // (final) from a run that did not finish (retryable). The reason is the
    // contract now; see `./errors`.
    await expect(
      createNativeLibreOfficePdfRunner(config, {
        exec: vi.fn(async () => ({ code: 1, timedOut: false })),
        fs: fsStub(),
        resolveOnPath: () => true,
      }).convertToPdf(DOCX, "x.docx"),
    ).rejects.toMatchObject({ name: "LibreOfficeRunError", reason: "exit" });
    await expect(
      createNativeLibreOfficePdfRunner(config, {
        exec: vi.fn(async () => ({ code: 0, timedOut: false })),
        fs: fsStub(new TextEncoder().encode("bad")),
        resolveOnPath: () => true,
      }).convertToPdf(DOCX, "x.docx"),
    ).rejects.toMatchObject({
      name: "LibreOfficeRunError",
      reason: "bad_output",
    });
  });

  it("probes and wires deps only when LibreOffice is available", () => {
    expect(
      probeLibreOfficeFromConfig(config, {
        resolveOnPath: (bin) => bin === "soffice",
      }),
    ).toBe("soffice");
    expect(
      nativeOfficeConversionDeps({}, { resolveOnPath: () => false })
        .libreoffice,
    ).toBeUndefined();
    expect(
      nativeOfficeConversionDeps({}, { resolveOnPath: () => true }).libreoffice,
    ).toBeDefined();
  });
});
