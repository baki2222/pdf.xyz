import { describe, expect, it, vi } from "vitest";
import {
  OFFICE_TO_PDF_TOOLS,
  runOfficeToPdf,
  type LibreOfficePdfRunner,
} from "./engine";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const DOCX = new TextEncoder().encode("docx bytes");

function runner(output = PDF): LibreOfficePdfRunner {
  return { convertToPdf: vi.fn(async () => output) };
}

describe("office-conversion engine", () => {
  it("declares the owned tools", () => {
    expect(OFFICE_TO_PDF_TOOLS).toEqual([
      "word-to-pdf",
      "excel-to-pdf",
      "powerpoint-to-pdf",
    ]);
  });

  it("fails honestly when LibreOffice is unavailable", async () => {
    await expect(
      runOfficeToPdf("word-to-pdf", DOCX, "report.docx", {}),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("converts supported Office files to validated PDF bytes", async () => {
    const libreoffice = runner();
    const result = await runOfficeToPdf("word-to-pdf", DOCX, "report.docx", {
      libreoffice,
    });
    expect(result).toMatchObject({
      ok: true,
      meta: {
        engine: "libreoffice",
        tool: "word-to-pdf",
        inputBytes: DOCX.byteLength,
        outputBytes: PDF.byteLength,
      },
    });
    // The third argument is the run control: no attempt signal here.
    expect(libreoffice.convertToPdf).toHaveBeenCalledWith(
      DOCX,
      "report.docx",
      {},
    );
  });

  it("rejects wrong tool/input pair and oversized input", async () => {
    await expect(
      runOfficeToPdf("excel-to-pdf", DOCX, "report.docx", {
        libreoffice: runner(),
      }),
    ).resolves.toMatchObject({ ok: false, kind: "invalid_input" });
    await expect(
      runOfficeToPdf("word-to-pdf", DOCX, "report.docx", {
        libreoffice: runner(),
        limits: { maxInputBytes: 4 },
      }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
  });

  it("rejects non-PDF output as unreadable — final, not a retryable `failed`", async () => {
    // INVERTED 2026-09-27. This asserted `kind: "failed"`, which the processor
    // maps to a RETRYABLE internal_error: the same file was converted again,
    // twice, to the same non-PDF. The document is the problem, so the answer
    // is final and says what to try.
    await expect(
      runOfficeToPdf("word-to-pdf", DOCX, "report.docx", {
        libreoffice: runner(new TextEncoder().encode("no pdf")),
      }),
    ).resolves.toMatchObject({ ok: false, kind: "unreadable" });
  });
});

describe("a CSV's delimiter and character set (competitor audit #18)", () => {
  const CSV = new TextEncoder().encode("a;b\n1;2\n");
  const CHOSEN = { delimiter: "semicolon", charset: "windows-1251" } as const;

  it("a choice reaches LibreOffice with the .csv, as the fifth argument", async () => {
    const libreoffice = runner();
    const result = await runOfficeToPdf(
      "excel-to-pdf",
      CSV,
      "rows.csv",
      { libreoffice },
      undefined,
      undefined,
      CHOSEN,
    );
    expect(result.ok).toBe(true);
    expect(libreoffice.convertToPdf).toHaveBeenCalledWith(
      CSV,
      "rows.csv",
      {},
      undefined,
      CHOSEN,
    );
  });

  it("so does one beside one page per sheet, with the layout", async () => {
    const libreoffice = runner();
    const layout = {
      onePagePerSheet: true,
      orientation: null,
      fitColumnsToWidth: false,
    };
    await runOfficeToPdf(
      "excel-to-pdf",
      CSV,
      "rows.csv",
      { libreoffice },
      undefined,
      layout,
      CHOSEN,
    );
    expect(libreoffice.convertToPdf).toHaveBeenCalledWith(
      CSV,
      "rows.csv",
      {},
      layout,
      CHOSEN,
    );
  });

  it("CONTROL: Auto on both is called exactly as before", async () => {
    const libreoffice = runner();
    await runOfficeToPdf(
      "excel-to-pdf",
      CSV,
      "rows.csv",
      { libreoffice },
      undefined,
      undefined,
      { delimiter: null, charset: null },
    );
    expect(libreoffice.convertToPdf).toHaveBeenCalledWith(CSV, "rows.csv", {});
  });

  it("a choice on a file that is not a .csv is refused before LibreOffice runs", async () => {
    const libreoffice = runner();
    const result = await runOfficeToPdf(
      "excel-to-pdf",
      new TextEncoder().encode("xls bytes"),
      "book.xls",
      { libreoffice },
      undefined,
      undefined,
      { delimiter: "tab", charset: null },
    );
    expect(result).toMatchObject({ ok: false, kind: "invalid_input" });
    if (!result.ok) expect(result.message).toMatch(/\.csv files only/);
    expect(libreoffice.convertToPdf).not.toHaveBeenCalled();
  });
});
