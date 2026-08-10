import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { createWorkspaceFile } from "./classify";
import { suggestTools } from "./suggestions";
import type { WorkspaceFile } from "./types";

let seq = 0;
function file(name: string, type = ""): WorkspaceFile {
  seq += 1;
  return createWorkspaceFile({ name, size: 1000, type }, `id-${seq}`, seq);
}

const slugs = (files: WorkspaceFile[]) =>
  suggestTools(files).map((s) => s.slug);

describe("suggestTools", () => {
  it("returns nothing when no files are staged", () => {
    expect(suggestTools([])).toEqual([]);
  });

  it("puts Merge PDF first for multiple PDFs", () => {
    const result = suggestTools([file("a.pdf"), file("b.pdf"), file("c.pdf")]);
    expect(result[0]!.slug).toBe("merge-pdf");
    expect(result[0]!.reason).toContain("3 PDFs");
    expect(result.map((s) => s.slug)).toContain("compress-pdf");
  });

  it("suggests single-PDF tools but not merge for one PDF", () => {
    const result = slugs([file("only.pdf")]);
    expect(result).not.toContain("merge-pdf");
    expect(result).toContain("organize-pages");
    expect(result).toContain("compress-pdf");
    expect(result).toContain("split-pdf");
  });

  it("suggests PNG→PDF only when every image is a PNG", () => {
    expect(slugs([file("a.png"), file("b.png")])).toContain("png-to-pdf");
    // A mixed image set routes to JPG→PDF, which handles both.
    const mixed = slugs([file("a.png"), file("b.jpg")]);
    expect(mixed).toContain("jpg-to-pdf");
    expect(mixed).not.toContain("png-to-pdf");
  });

  it("suggests the matching converter for office + text files", () => {
    expect(slugs([file("a.docx")])).toContain("word-to-pdf");
    expect(slugs([file("a.xlsx")])).toContain("excel-to-pdf");
    expect(slugs([file("a.pptx")])).toContain("powerpoint-to-pdf");
    expect(slugs([file("a.txt")])).toContain("text-to-pdf");
  });

  it("is deterministic, bounded, and only ever suggests real catalog tools", () => {
    const mix = [
      file("a.pdf"),
      file("b.pdf"),
      file("c.png"),
      file("d.docx"),
      file("e.txt"),
    ];
    const a = suggestTools(mix, 4);
    const b = suggestTools(mix, 4);
    expect(a).toEqual(b); // stable ordering
    expect(a.length).toBeLessThanOrEqual(4);
    for (const s of a) expect(getToolBySlug(s.slug)).toBeDefined();
  });
});
