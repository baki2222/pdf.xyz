import { MUST_ALLOW, MUST_BLOCK } from "@/lib/net/public-address.corpus";
import { describe, expect, it } from "vitest";
import {
  isSafePublicHttpUrl,
  parseCreateJobRequest,
  parseCreateUploadSessionRequest,
} from "./validation";

const pdfFile = {
  filename: "scan.pdf",
  contentType: "application/pdf",
  bytes: 1024,
};

describe("worker job validation", () => {
  it("accepts a valid upload session for a secure-worker PDF tool", () => {
    const result = parseCreateUploadSessionRequest({
      tool: "ocr-pdf",
      files: [pdfFile],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tool).toBe("ocr-pdf");
      expect(result.value.files[0]?.filename).toBe("scan.pdf");
      expect(result.value.files[0]?.contentType).toBe("application/pdf");
    }
  });

  it("rejects in-browser tools because they should not create server jobs", () => {
    const result = parseCreateUploadSessionRequest({
      tool: "merge-pdf",
      files: [pdfFile],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body.error.code).toBe("unprocessable_entity");
      expect(result.error.body.error.message).toContain("runs in your browser");
    }
  });

  it("rejects path traversal and wrong MIME types before upload", () => {
    const badName = parseCreateUploadSessionRequest({
      tool: "ocr-pdf",
      files: [{ ...pdfFile, filename: "../secret.pdf" }],
    });
    expect(badName.ok).toBe(false);

    const badMime = parseCreateUploadSessionRequest({
      tool: "ocr-pdf",
      files: [{ ...pdfFile, contentType: "text/html" }],
    });
    expect(badMime.ok).toBe(false);
    if (!badMime.ok)
      expect(badMime.error.body.error.code).toBe("unprocessable_entity");
  });

  it("accepts a worker job with opaque file ids", () => {
    const result = parseCreateJobRequest({
      tool: "ocr-pdf",
      inputs: ["f_1234567890"],
      options: { language: "eng" },
      idempotencyKey: "ocr:scan:1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inputs).toEqual(["f_1234567890"]);
      expect(result.value.idempotencyKey).toBe("ocr:scan:1");
      // Backward-compatible: a request without inputNames omits the field.
      expect(result.value.inputNames).toBeUndefined();
    }
  });

  it("accepts and sanitizes optional display inputNames", () => {
    const result = parseCreateJobRequest({
      tool: "ocr-pdf",
      inputs: ["f_1234567890"],
      inputNames: ["../../secret/Q3 Report.PDF"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Path stripped, extension normalized — a safe display name.
      expect(result.value.inputNames).toEqual(["Q3 Report.pdf"]);
    }
  });

  it("keeps inputNames positionally aligned and ignores extras", () => {
    const result = parseCreateJobRequest({
      tool: "ocr-pdf",
      inputs: ["f_1234567890"],
      inputNames: ["a.pdf", "b.pdf", "c.pdf"], // more names than inputs
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.inputNames).toEqual(["a.pdf"]);
  });

  it("rejects a malformed inputNames shape (not an array of strings)", () => {
    const notArray = parseCreateJobRequest({
      tool: "ocr-pdf",
      inputs: ["f_1234567890"],
      inputNames: "report.pdf",
    });
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) {
      expect(notArray.error.body.error.code).toBe("invalid_request");
    }

    const nonString = parseCreateJobRequest({
      tool: "ocr-pdf",
      inputs: ["f_1234567890"],
      inputNames: [42],
    });
    expect(nonString.ok).toBe(false);
  });

  it("rejects too many inputNames", () => {
    const result = parseCreateJobRequest({
      tool: "ocr-pdf",
      inputs: ["f_1234567890"],
      inputNames: Array.from({ length: 21 }, (_, i) => `f${i}.pdf`),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body.error.code).toBe("unprocessable_entity");
    }
  });

  it("requires URL tools to use a public URL instead of file ids", () => {
    const privateUrl = parseCreateJobRequest({
      tool: "webpage-to-pdf",
      inputs: [],
      options: { url: "http://127.0.0.1/admin" },
    });
    expect(privateUrl.ok).toBe(false);

    const publicUrl = parseCreateJobRequest({
      tool: "webpage-to-pdf",
      options: { url: "https://example.com/report" },
    });
    expect(publicUrl.ok).toBe(true);
    if (publicUrl.ok) {
      expect(publicUrl.value.inputs).toEqual([]);
      expect(publicUrl.value.options?.url).toBe("https://example.com/report");
    }
  });
});

describe("public URL SSRF guard", () => {
  it.each([
    "file:///etc/passwd",
    "http://localhost:3000",
    "http://10.0.0.5",
    "http://172.16.0.1",
    "http://192.168.1.10",
    "http://169.254.169.254/latest/meta-data",
    "https://user:pass@example.com",
  ])("blocks unsafe URL %s", (url) => {
    expect(isSafePublicHttpUrl(url)).toBe(false);
  });

  it("allows normal public http(s) URLs", () => {
    expect(isSafePublicHttpUrl("https://example.com/invoice.html")).toBe(true);
    expect(isSafePublicHttpUrl("http://example.org/path?q=1")).toBe(true);
  });

  /*
   * History: until 2026-09 this guard matched host STRINGS (`/^127\./`,
   * `host === "[::1]"`) and every URL in the audit list below walked past it.
   * The corpus is the classifier's own, spelled as URLs the way a user would
   * type them, so the edge and the worker can never disagree about an address.
   */
  const asUrl = (addr: string) =>
    addr.includes(":") ? `http://[${addr}]/` : `http://${addr}/`;

  it.each([
    "http://localhost./",
    "http://LOCALHOST../admin",
    "http://[::ffff:127.0.0.1]/",
    "http://[::]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://100.100.100.200/",
    "http://100.64.0.1/",
    "http://0.0.0.1/",
    "http://[::ffff:169.254.169.254]/",
    "http://0x7f000001/", // WHATWG canonicalises to 127.0.0.1
    "http://2130706433/",
    "http://127.1/",
    "http://metadata/computeMetadata/v1/",
    "http://metadata.google.internal/",
    "http://printer.local./",
    "http://x.invalid/",
    ...MUST_BLOCK.map(asUrl),
  ])("blocks bypass %s", (url) => {
    expect(isSafePublicHttpUrl(url)).toBe(false);
  });

  it.each(MUST_ALLOW.map(asUrl))(
    "still allows public literal %s (positive control)",
    (url) => {
      expect(isSafePublicHttpUrl(url)).toBe(true);
    },
  );
});
