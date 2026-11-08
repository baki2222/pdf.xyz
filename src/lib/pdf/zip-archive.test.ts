import { describe, expect, it } from "vitest";
import { buildZip, uniqueEntryNames } from "./zip-archive";

describe("uniqueEntryNames", () => {
  it("leaves names that are already distinct untouched", () => {
    const names = ["page-1.png", "page-2.png", "report.pdf"];
    expect(uniqueEntryNames(names)).toEqual(names);
  });

  it("numbers later copies before the extension, in input order", () => {
    expect(uniqueEntryNames(["a.pdf", "a.pdf", "a.pdf"])).toEqual([
      "a.pdf",
      "a (2).pdf",
      "a (3).pdf",
    ]);
  });

  it("treats a differently-cased name as taken", () => {
    expect(uniqueEntryNames(["Scan.PDF", "scan.pdf"])).toEqual([
      "Scan.PDF",
      "scan (2).pdf",
    ]);
  });

  it("never reuses a name an input already holds", () => {
    // "a (2).pdf" is a real input here, so the second "a.pdf" must skip it.
    const out = uniqueEntryNames(["a (2).pdf", "a.pdf", "a.pdf"]);
    expect(out).toEqual(["a (2).pdf", "a.pdf", "a (3).pdf"]);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(out.length);
  });

  it("finds the extension in the last path segment only", () => {
    expect(uniqueEntryNames(["v1.2/notes", "v1.2/notes"])).toEqual([
      "v1.2/notes",
      "v1.2/notes (2)",
    ]);
    expect(uniqueEntryNames(["pages/a.b.png", "pages/a.b.png"])).toEqual([
      "pages/a.b.png",
      "pages/a.b (2).png",
    ]);
  });

  it("does not read a leading dot as an extension", () => {
    expect(uniqueEntryNames([".hidden", ".hidden"])).toEqual([
      ".hidden",
      ".hidden (2)",
    ]);
  });

  it("gives every input its own name, whatever the mix", () => {
    const names = ["x.pdf", "X.pdf", "x (2).pdf", "x.pdf", "x", "x", "x (2)"];
    const out = uniqueEntryNames(names);
    expect(out).toHaveLength(names.length);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(names.length);
  });
});

/**
 * When a Blob entry's bytes are read: ALL of them, as `buildZip` is called,
 * before the first entry is written (review of batch plan P0b). The module's
 * comment once said "no copy is made before the archive is built", and
 * nothing checked it; it was false. So the memory profile the comment now
 * states is pinned here. JSZip keeps every entry's content for as long as the
 * archive is being built, so a lazier read alone would not lower the peak:
 * the fix that would is a writer that hands the archive the Blobs themselves.
 * When one lands, this test is INVERTED (reads start one entry at a time),
 * not deleted.
 */
describe("buildZip — Blob entries", () => {
  it("starts reading every Blob before it returns: the copies coexist", async () => {
    let reads = 0;
    const entry = (name: string) => {
      const blob = new Blob([name]);
      const read = blob.arrayBuffer.bind(blob);
      Object.defineProperty(blob, "arrayBuffer", {
        value: () => {
          reads += 1;
          return read();
        },
      });
      return { name, blob };
    };
    const archive = buildZip(
      [entry("a.pdf"), entry("b.pdf"), entry("c.pdf")],
      "STORE",
    );
    // Synchronously, before JSZip has written a byte.
    expect(reads).toBe(3);
    expect((await archive).size).toBeGreaterThan(0);
  });
});
