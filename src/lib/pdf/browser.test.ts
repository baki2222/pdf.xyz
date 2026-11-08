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

  // THE DEFECT (found 2026-11-08 by the batch design review): JSZip's
  // `zip.file(name, …)` REPLACES an entry of the same name. Batch Compress
  // names each output after its input, so two different files both called
  // scan.pdf (picked from two folders) came back as ONE entry in the ZIP. The
  // second file's result silently replaced the first, and the page still said
  // "2 files done".
  it("keeps every file when two outputs share a name", async () => {
    const blob = await zipFiles([
      { name: "scan-compressed.pdf", bytes: new Uint8Array([1]) },
      { name: "scan-compressed.pdf", bytes: new Uint8Array([2]) },
      { name: "Scan-Compressed.pdf", bytes: new Uint8Array([3]) },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    // Health check: one entry per input, whatever the names.
    expect(entries).toHaveLength(3);
    const byName: Record<string, number[]> = {};
    for (const entry of entries) {
      byName[entry.name] = Array.from(await entry.async("uint8array"));
    }
    // The first keeps its name; later ones gain " (2)", " (3)" before the
    // extension, in input order. A differently-cased name counts as taken,
    // since Windows and macOS extract case-insensitively.
    expect(byName).toEqual({
      "scan-compressed.pdf": [1],
      "scan-compressed (2).pdf": [2],
      "Scan-Compressed (3).pdf": [3],
    });
  });

  // Batch plan P0b: a batch keeps each finished file as a Blob, so the ZIP
  // takes Blob entries as they are, beside bytes, with the same naming rule.
  it("takes Blob entries beside bytes, and names them by the same rule", async () => {
    const blob = await zipFiles([
      { name: "a.pdf", blob: new Blob([new Uint8Array([7, 7, 7])]) },
      { name: "a.pdf", bytes: new Uint8Array([4]) },
      { name: "b.pdf", blob: new Blob([new Uint8Array([5, 6])]) },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const byName: Record<string, number[]> = {};
    for (const entry of Object.values(zip.files).filter((e) => !e.dir)) {
      byName[entry.name] = Array.from(await entry.async("uint8array"));
    }
    expect(byName).toEqual({
      "a.pdf": [7, 7, 7],
      "a (2).pdf": [4],
      "b.pdf": [5, 6],
    });
  });

  it("STORE writes each entry as it is: the archive holds the bytes uncompressed", async () => {
    // Highly compressible content, so DEFLATE would shrink it to almost
    // nothing; STORE must carry every byte (the batch's PDFs are already
    // compressed, and DEFLATE would only burn a phone's CPU on them).
    const content = new Uint8Array(64 * 1024).fill(65);
    const stored = await zipFiles(
      [{ name: "x.pdf", blob: new Blob([content]) }],
      {
        compression: "STORE",
      },
    );
    const deflated = await zipFiles([{ name: "x.pdf", bytes: content }]);
    expect(stored.size).toBeGreaterThan(content.byteLength);
    // Control: the default really compresses, so the size above is STORE's.
    expect(deflated.size).toBeLessThan(content.byteLength / 10);
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
