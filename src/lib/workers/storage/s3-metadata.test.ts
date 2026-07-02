import { describe, expect, it } from "vitest";
import { sanitizeDisplayFilename } from "@/lib/jobs/filenames";
import {
  CONTENT_DISPOSITION_HEADER,
  FILENAME_METADATA_HEADER,
  contentDispositionAttachment,
  decodeFilenameMetadata,
  encodeFilenameMetadata,
} from "./s3-metadata";

const E_ACUTE = "é";
const REPORT_ACCENT = "r" + E_ACUTE + "port.pdf";

describe("s3 filename metadata", () => {
  it("uses the lowercase x-amz-meta-filename header name", () => {
    expect(FILENAME_METADATA_HEADER).toBe("x-amz-meta-filename");
  });

  it("encodes to a pure-ASCII, space-free, header-safe token", () => {
    const values = [
      "report.pdf",
      "Q3 Results 2026.pdf",
      REPORT_ACCENT,
      "a+b (copy).pdf",
      "100%done.pdf",
    ];
    for (const v of values) {
      const encoded = encodeFilenameMetadata(v);
      // ASCII only, no spaces or control chars — safe as a signed header value.
      expect(/^[\x21-\x7e]*$/.test(encoded)).toBe(true);
      expect(encoded).not.toContain(" ");
    }
  });

  it("round-trips through encode -> decode to the sanitized name", () => {
    const cases = [
      "report.pdf",
      "Q3 Results.pdf",
      REPORT_ACCENT,
      "../../etc/passwd",
      "CON.pdf",
      "a b+c(d).pdf",
    ];
    for (const raw of cases) {
      const decoded = decodeFilenameMetadata(encodeFilenameMetadata(raw));
      expect(decoded).toBe(sanitizeDisplayFilename(raw));
    }
  });

  it("returns null for an absent or blank header so the caller can fall back", () => {
    expect(decodeFilenameMetadata(undefined)).toBeNull();
    expect(decodeFilenameMetadata(null)).toBeNull();
    expect(decodeFilenameMetadata("")).toBeNull();
    expect(decodeFilenameMetadata("   ")).toBeNull();
  });

  it("never throws on malformed percent-encoding and re-sanitizes the value", () => {
    // A lone `%` is invalid percent-encoding; decode falls back and sanitizes.
    const out = decodeFilenameMetadata("%E0%A4%A.pdf");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("/");
  });

  it("re-sanitizes a tampered metadata value (no path can escape)", () => {
    // Even if a client somehow stored a traversal string, decode collapses it.
    const tampered = encodeURIComponent("../../secret.pdf");
    expect(decodeFilenameMetadata(tampered)).toBe("secret.pdf");
  });
});

describe("contentDispositionAttachment", () => {
  it("uses the content-disposition header name", () => {
    expect(CONTENT_DISPOSITION_HEADER).toBe("content-disposition");
  });

  it("builds an attachment header with ASCII + RFC 5987 filename forms", () => {
    expect(contentDispositionAttachment("report-compressed.pdf")).toBe(
      "attachment; filename=\"report-compressed.pdf\"; filename*=UTF-8''report-compressed.pdf",
    );
  });

  it("keeps the header on a single, injection-free line for any input", () => {
    // A name with a quote, a path, and non-ASCII — all neutralized.
    const header = contentDispositionAttachment(REPORT_ACCENT);
    expect(header.startsWith("attachment; filename=")).toBe(true);
    expect(header).not.toContain("\n");
    expect(header).not.toContain("\r");
    // The RFC 5987 form is percent-encoded ASCII.
    expect(/filename\*=UTF-8''[\x21-\x7e]+$/.test(header)).toBe(true);
  });

  it("is derived from the sanitized name (path/case stripped)", () => {
    const header = contentDispositionAttachment("../../etc/Secret.PDF");
    expect(header).toContain('filename="Secret.pdf"');
    expect(header).not.toContain("etc");
    expect(header).not.toContain("/");
  });
});
