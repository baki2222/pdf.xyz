import { describe, expect, it } from "vitest";
import {
  MAX_PDF_BYTES,
  baseName,
  isLikelyPdf,
  mergedOutputName,
  outputName,
  partitionPdfFiles,
  sanitizeSegment,
  validatePdfFile,
} from "./files";

const pdf = (name: string, size = 1000, type = "application/pdf") => ({
  name,
  type,
  size,
});

describe("baseName", () => {
  it("strips one extension and keeps earlier dots", () => {
    expect(baseName("report.pdf")).toBe("report");
    expect(baseName("my.report.final.pdf")).toBe("my.report.final");
    expect(baseName("noext")).toBe("noext");
  });
});

describe("isLikelyPdf", () => {
  it("accepts by MIME type or extension, case-insensitively", () => {
    expect(isLikelyPdf({ name: "a.pdf", type: "" })).toBe(true);
    expect(isLikelyPdf({ name: "A.PDF", type: "" })).toBe(true);
    expect(isLikelyPdf({ name: "a", type: "application/pdf" })).toBe(true);
  });

  it("rejects non-PDFs", () => {
    expect(isLikelyPdf({ name: "a.png", type: "image/png" })).toBe(false);
    expect(isLikelyPdf({ name: "a.pdfx", type: "" })).toBe(false);
  });
});

describe("validatePdfFile", () => {
  it("accepts a normal PDF", () => {
    expect(validatePdfFile(pdf("a.pdf")).ok).toBe(true);
  });

  it("rejects a non-PDF with a reason", () => {
    const result = validatePdfFile(pdf("a.txt", 10, "text/plain"));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/isn't a PDF/i);
  });

  it("rejects an empty file", () => {
    expect(validatePdfFile(pdf("a.pdf", 0)).ok).toBe(false);
  });

  it("rejects an oversized file", () => {
    const result = validatePdfFile(pdf("a.pdf", MAX_PDF_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/too large/i);
  });

  it("respects a custom byte budget", () => {
    expect(validatePdfFile(pdf("a.pdf", 100), 50).ok).toBe(false);
    expect(validatePdfFile(pdf("a.pdf", 40), 50).ok).toBe(true);
  });
});

describe("partitionPdfFiles", () => {
  it("splits accepted from rejected, keeping reasons", () => {
    const { accepted, rejected } = partitionPdfFiles([
      pdf("ok.pdf"),
      pdf("bad.txt", 10, "text/plain"),
      pdf("empty.pdf", 0),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["ok.pdf"]);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.file.name).toBe("bad.txt");
    expect(rejected.every((r) => r.reason.length > 0)).toBe(true);
  });
});

describe("sanitizeSegment", () => {
  it("removes filesystem-illegal characters", () => {
    expect(sanitizeSegment('a/b:c*d?"e<f>g|h')).toBe("abcdefgh");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeSegment("  my   file  ")).toBe("my file");
  });

  it("falls back to 'document' when nothing usable remains", () => {
    expect(sanitizeSegment("")).toBe("document");
    expect(sanitizeSegment("///")).toBe("document");
  });
});

describe("outputName", () => {
  it("appends a suffix and extension to the sanitized base", () => {
    expect(outputName("report.pdf", "rotated")).toBe("report-rotated.pdf");
    expect(outputName("a/b.pdf", "split", "zip")).toBe("ab-split.zip");
  });
});

describe("mergedOutputName", () => {
  it("derives from the first usable name", () => {
    expect(mergedOutputName(["first.pdf", "second.pdf"])).toBe(
      "first-merged.pdf",
    );
    expect(mergedOutputName(["   ", "real.pdf"])).toBe("real-merged.pdf");
  });

  it("falls back to merged.pdf when there are no names", () => {
    expect(mergedOutputName([])).toBe("merged.pdf");
  });
});
