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
    expect(libreoffice.convertToPdf).toHaveBeenCalledWith(DOCX, "report.docx");
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

  it("rejects non-PDF output", async () => {
    await expect(
      runOfficeToPdf("word-to-pdf", DOCX, "report.docx", {
        libreoffice: runner(new TextEncoder().encode("no pdf")),
      }),
    ).resolves.toMatchObject({ ok: false, kind: "failed" });
  });
});
