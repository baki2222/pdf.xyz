// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  baseName,
  downloadBytes,
  readFileBytes,
  totalBytes,
  zipFiles,
} from "./browser";

describe("baseName", () => {
  it("strips a single extension", () => {
    expect(baseName("report.pdf")).toBe("report");
  });

  it("keeps earlier dots in the name", () => {
    expect(baseName("my.report.final.pdf")).toBe("my.report.final");
  });

  it("returns the name unchanged when there is no extension", () => {
    expect(baseName("report")).toBe("report");
  });
});

describe("totalBytes", () => {
  it("sums the byte length across files", () => {
    expect(
      totalBytes([
        { name: "a", bytes: new Uint8Array(3) },
        { name: "b", bytes: new Uint8Array(5) },
      ]),
    ).toBe(8);
  });
});

describe("readFileBytes", () => {
  it("reads a File into a Uint8Array", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "x.bin");
    const bytes = await readFileBytes(file);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});

describe("zipFiles", () => {
  it("bundles named files into a readable ZIP", async () => {
    const blob = await zipFiles([
      { name: "one.pdf", bytes: new Uint8Array([1, 2, 3]) },
      { name: "two.pdf", bytes: new Uint8Array([9, 8]) },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["one.pdf", "two.pdf"]);
    const one = await zip.file("one.pdf")!.async("uint8array");
    expect(Array.from(one)).toEqual([1, 2, 3]);
  });
});

describe("downloadBytes", () => {
  beforeEach(() => {
    // jsdom doesn't implement object URLs; stub them for the download path.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and clicks an anchor with the given filename", () => {
    const downloads: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });

    downloadBytes(new Uint8Array([1, 2, 3]), "out.pdf");

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual(["out.pdf"]);
    clickSpy.mockRestore();
  });
});
