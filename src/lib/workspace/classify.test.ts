import { describe, expect, it } from "vitest";
import {
  createWorkspaceFile,
  extensionOf,
  fileFamily,
  fileKind,
} from "./classify";

describe("extensionOf", () => {
  it("returns the lower-cased extension", () => {
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });

  it("returns '' when there is no usable extension", () => {
    expect(extensionOf("noextension")).toBe("");
    expect(extensionOf("trailingdot.")).toBe("");
    expect(extensionOf(".gitignore")).toBe(""); // dotfile, not an extension
  });
});

describe("fileFamily", () => {
  it("classifies by extension across families", () => {
    expect(fileFamily("a.pdf")).toBe("pdf");
    expect(fileFamily("a.PNG")).toBe("image");
    expect(fileFamily("a.jpeg")).toBe("image");
    expect(fileFamily("a.docx")).toBe("word");
    expect(fileFamily("a.xlsx")).toBe("excel");
    expect(fileFamily("a.csv")).toBe("excel");
    expect(fileFamily("a.pptx")).toBe("powerpoint");
    expect(fileFamily("a.txt")).toBe("text");
    expect(fileFamily("a.md")).toBe("text");
  });

  it("falls back to MIME type when the extension is unknown", () => {
    expect(fileFamily("scan", "application/pdf")).toBe("pdf");
    expect(fileFamily("photo", "image/heif")).toBe("image");
    expect(fileFamily("notes", "text/plain")).toBe("text");
    expect(
      fileFamily(
        "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("word");
    expect(fileFamily("sheet", "application/vnd.ms-excel")).toBe("excel");
  });

  it("returns 'other' for anything unrecognized", () => {
    expect(fileFamily("mystery.bin")).toBe("other");
    expect(fileFamily("mystery", "application/octet-stream")).toBe("other");
  });
});

describe("fileKind", () => {
  it("prefers the extension as an uppercase label", () => {
    expect(fileKind("report.pdf")).toBe("PDF");
    expect(fileKind("photo.jpeg")).toBe("JPEG");
  });

  it("falls back to the MIME subtype, then FILE", () => {
    expect(fileKind("noext", "image/png")).toBe("PNG");
    expect(fileKind("noext")).toBe("FILE");
    // An absurdly long "extension" is ignored in favor of the MIME subtype.
    expect(fileKind("weird.superlongext", "application/pdf")).toBe("PDF");
  });
});

describe("createWorkspaceFile", () => {
  it("composes a WorkspaceFile from plain metadata and the passed id/time", () => {
    const file = createWorkspaceFile(
      { name: "invoice.pdf", size: 2048, type: "application/pdf" },
      "id-1",
      1000,
    );
    expect(file).toEqual({
      id: "id-1",
      name: "invoice.pdf",
      size: 2048,
      mime: "application/pdf",
      kind: "PDF",
      family: "pdf",
      addedAt: 1000,
    });
  });

  it("clamps invalid sizes to 0 and tolerates a missing MIME type", () => {
    const file = createWorkspaceFile({ name: "a.png", size: -5 }, "id-2", 5);
    expect(file.size).toBe(0);
    expect(file.mime).toBe("");
    expect(file.family).toBe("image");
    expect(file.kind).toBe("PNG");
  });
});
