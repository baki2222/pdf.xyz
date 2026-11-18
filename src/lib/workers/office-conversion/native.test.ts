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
import { csvInfilter } from "./csv-filter";
import type { CsvImportChoice } from "./csv-import";
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

    async function argsFor(
      bytes: Uint8Array,
      name: string,
      csv?: CsvImportChoice,
    ) {
      const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
      const runner = createNativeLibreOfficePdfRunner(config, {
        exec,
        fs: fsStub(),
        resolveOnPath: (bin) => bin === "soffice",
      });
      await runner.convertToPdf(bytes, name, {}, undefined, csv);
      return (exec.mock.calls[0] as unknown as [string, string[]])[1];
    }
    const FILTER = `--infilter=${CSV_UTF8_INFILTER}`;

    // CHANGED 2026-11-17 (review): this pinned "44,34,76,1", the 2026-11-07
    // spelling, which stops after token 4 and so leaves "detect special
    // numbers" on: in the image a UTF-8 file's "1/2" printed as a date.
    it("CONTROL: the filter is LibreOffice's CSV import with character set 76 (UTF-8), tokens 5-8 as no options sets them", () => {
      expect(CSV_UTF8_INFILTER).toBe(
        "Text - txt - csv (StarCalc):44,34,76,1,,0,false,false",
      );
    });

    it("a UTF-8 CSV with non-ASCII text is imported as UTF-8, the file still last", async () => {
      const args = await argsFor(UTF8_CSV, "towns.csv");
      expect(args).toContain(FILTER);
      expect(args.indexOf(FILTER)).toBeLessThan(args.indexOf("--convert-to"));
      // WAS "input.csv" until 2026-11-17: every upload's name, which a CSV's
      // printed header showed. Now the job's own stem (`./input-name`).
      expect(args.at(-1)).toBe(join("/tmp/pdfxyz-office-1", "towns.csv"));
    });

    it("so is one that starts with a byte-order mark", async () => {
      expect(await argsFor(BOM_CSV, "towns.csv")).toContain(FILTER);
    });

    // INVERTED 2026-11-17 (competitor audit #18), not deleted. These two
    // read, from 2026-11-07: "a Windows-1252 CSV keeps the default that
    // reads it correctly" and "an ASCII-only CSV is handed over exactly as
    // before", each asserting only that the UTF-8 filter was ABSENT — so
    // they pinned "no filter at all", and every CSV that was not UTF-8 was
    // read as comma separated. Every .csv now gets a filter; for these two
    // it is the import LibreOffice made with NO options (docsh.cxx: MS_1252,
    // comma, double quote), spelled out.
    // CORRECTED 2026-11-17 (review): "spelled out" was "44,34,1,1", and that
    // string is NOT the no-options import: with token 8 missing LibreOffice
    // detects special numbers, so "1/2" printed as 01/02/26 and "1e5" as
    // 1.00E+05 in the live image. The string below now carries tokens 5-8;
    // that it prints what no options printed is proved by OUTPUT in the
    // image (input-proof.ts, "csv default import"), never by this string.
    const DEFAULT_IMPORT = `--infilter=${csvInfilter("comma", "windows-1252")}`;

    it("a Windows-1252 CSV gets LibreOffice's no-options import, spelled out", async () => {
      const args = await argsFor(CP1252_CSV, "towns.csv");
      expect(args).not.toContain(FILTER);
      expect(args).toContain(DEFAULT_IMPORT);
      expect(DEFAULT_IMPORT).toBe(
        "--infilter=Text - txt - csv (StarCalc):44,34,1,1,,0,false,false",
      );
    });

    it("so does an ASCII-only CSV", async () => {
      const args = await argsFor(ASCII_CSV, "towns.csv");
      expect(args).toContain(DEFAULT_IMPORT);
      expect(args.filter((a) => a.startsWith("--infilter="))).toHaveLength(1);
    });

    it("a chosen delimiter and character set are what LibreOffice is handed, before --convert-to", async () => {
      const args = await argsFor(ASCII_CSV, "towns.csv", {
        delimiter: "semicolon",
        charset: "windows-1251",
      });
      const chosen =
        "--infilter=Text - txt - csv (StarCalc):59,34,34,1,,0,false,false";
      expect(args).toContain(chosen);
      expect(args.indexOf(chosen)).toBeLessThan(args.indexOf("--convert-to"));
      // WAS "input.csv" until 2026-11-17: every upload's name, which a CSV's
      // printed header showed. Now the job's own stem (`./input-name`).
      expect(args.at(-1)).toBe(join("/tmp/pdfxyz-office-1", "towns.csv"));
    });

    it("Auto-detect finds a semicolon file's separator on its own", async () => {
      const semi = new TextEncoder().encode("Town;Visitors\nBern;980\n");
      expect(await argsFor(semi, "towns.csv")).toContain(
        "--infilter=Text - txt - csv (StarCalc):59,34,1,1,,0,false,false",
      );
    });

    it("an Excel sep= first line names the separator and is skipped (line 2)", async () => {
      const hinted = new TextEncoder().encode(
        "sep=;\nTown;Visitors\nBern;980\n",
      );
      expect(await argsFor(hinted, "towns.csv")).toContain(
        "--infilter=Text - txt - csv (StarCalc):59,34,1,2,,0,false,false",
      );
    });

    it("the importFilter seam replaces the filter, and only the seam", async () => {
      const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
      const runner = createNativeLibreOfficePdfRunner(config, {
        exec,
        fs: fsStub(),
        resolveOnPath: (bin) => bin === "soffice",
        importFilter: () => null,
      });
      await runner.convertToPdf(UTF8_CSV, "towns.csv", {});
      const args = (exec.mock.calls[0] as unknown as [string, string[]])[1];
      expect(args.filter((a) => a.startsWith("--infilter="))).toEqual([]);
      // CONTROL: the same file through the default seam gets the filter.
      expect(await argsFor(UTF8_CSV, "towns.csv")).toContain(FILTER);
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
    // INVERTED 2026-11-17, not deleted: these three read input.docx and
    // input.pdf, so they pinned the name a CSV's header printed in
    // production. The upload is now written under the user's own stem.
    expect(fs.writeFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-office-1", "report.docx"),
      DOCX,
    );
    expect(exec).toHaveBeenCalledWith(
      "soffice",
      expect.arrayContaining([
        "--outdir",
        "/tmp/pdfxyz-office-1",
        join("/tmp/pdfxyz-office-1", "report.docx"),
      ]),
      expect.objectContaining({ timeout: 120_000 }),
    );
    expect(fs.readFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-office-1", "report.pdf"),
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
