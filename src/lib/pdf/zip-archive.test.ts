import { describe, expect, it } from "vitest";
import { uniqueEntryNames } from "./zip-archive";

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
