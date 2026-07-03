import { describe, expect, it } from "vitest";
import { MIME_BY_FORMAT } from "@/lib/jobs";
import {
  UPLOAD_FAMILIES,
  classifyDeclaredType,
  extensionOf,
  familyForExtension,
  familyForMime,
  normalizeContentType,
} from "./families";

describe("normalizeContentType", () => {
  it("lower-cases and strips parameters", () => {
    expect(normalizeContentType("Application/PDF; charset=utf-8")).toBe(
      "application/pdf",
    );
    expect(normalizeContentType("text/plain")).toBe("text/plain");
  });

  it("returns null for non-strings, blanks, and non-MIME shapes", () => {
    expect(normalizeContentType(undefined)).toBeNull();
    expect(normalizeContentType(123)).toBeNull();
    expect(normalizeContentType("")).toBeNull();
    expect(normalizeContentType("not-a-mime")).toBeNull();
    expect(normalizeContentType("/etc/passwd")).toBeNull();
    expect(normalizeContentType("https://evil.example/x")).toBeNull();
  });

  it("rejects an absurdly long value", () => {
    expect(normalizeContentType(`application/${"x".repeat(300)}`)).toBeNull();
  });
});

describe("extensionOf", () => {
  it("returns the lower-cased final extension", () => {
    expect(extensionOf("report.PDF")).toBe("pdf");
    expect(extensionOf("a.b.tar.gz")).toBe("gz");
  });

  it("returns null when there is no usable extension", () => {
    expect(extensionOf("README")).toBeNull();
    expect(extensionOf(".env")).toBeNull(); // leading dot is not an extension
    expect(extensionOf("trailing.")).toBeNull();
    expect(extensionOf(42)).toBeNull();
  });

  it("ignores directory components", () => {
    expect(extensionOf("some/dir/file.png")).toBe("png");
  });
});

describe("familyForMime / familyForExtension", () => {
  it("maps recognized MIME types to families", () => {
    expect(familyForMime("application/pdf")).toBe("pdf");
    expect(familyForMime("image/png")).toBe("image");
    expect(familyForMime("text/csv")).toBe("spreadsheet");
    expect(familyForMime(null)).toBeNull();
    expect(familyForMime("application/x-msdownload")).toBeNull();
  });

  it("maps recognized extensions to families", () => {
    expect(familyForExtension("a.pdf")).toBe("pdf");
    expect(familyForExtension("a.jpeg")).toBe("image");
    expect(familyForExtension("a.exe")).toBeNull();
  });
});

describe("classifyDeclaredType", () => {
  it("accepts a coherent (filename, MIME) pair", () => {
    expect(classifyDeclaredType("scan.pdf", "application/pdf")).toEqual({
      ok: true,
      family: "pdf",
    });
  });

  it("accepts a recognized MIME even when the extension is unknown or absent", () => {
    expect(classifyDeclaredType("noext", "application/pdf")).toEqual({
      ok: true,
      family: "pdf",
    });
    expect(classifyDeclaredType("data.bin", "image/png")).toEqual({
      ok: true,
      family: "image",
    });
  });

  it("rejects an unrecognized MIME type", () => {
    expect(classifyDeclaredType("x.exe", "application/x-msdownload")).toEqual({
      ok: false,
      reason: "unrecognized",
    });
  });

  it("rejects a MIME/extension family mismatch (two recognized families)", () => {
    expect(classifyDeclaredType("invoice.pdf", "image/png")).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(classifyDeclaredType("photo.png", "application/pdf")).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("accepts a recognized MIME whose extension is simply unknown (not a mismatch)", () => {
    // `.exe` is in no family, so it is not evidence against the recognized MIME.
    expect(classifyDeclaredType("payload.exe", "application/pdf")).toEqual({
      ok: true,
      family: "pdf",
    });
  });
});

describe("drift guard: intake recognizes every MIME the validator accepts", () => {
  const acceptedMimes = Object.values(MIME_BY_FORMAT).flat();

  it.each([...new Set(acceptedMimes)])(
    "the coarse intake allowlist recognizes %s",
    (mime) => {
      expect(familyForMime(mime)).not.toBeNull();
    },
  );

  it("every family's declared MIMEs and extensions are lower-case", () => {
    for (const spec of Object.values(UPLOAD_FAMILIES)) {
      for (const mime of spec.mimes) expect(mime).toBe(mime.toLowerCase());
      for (const ext of spec.extensions) expect(ext).toBe(ext.toLowerCase());
    }
  });
});
