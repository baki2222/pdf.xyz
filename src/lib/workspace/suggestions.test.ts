import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { createWorkspaceFile } from "./classify";
import { eligibleFilesFor } from "@/lib/handoff";
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
    // A mixed image set routes to JPG→PDF. (This comment used to say "which
    // handles both" while JPG→PDF dropped every PNG; the promise is now
    // checked against the hand-off below instead of asserted here.)
    const mixed = slugs([file("a.png"), file("b.jpg")]);
    expect(mixed).toContain("jpg-to-pdf");
    expect(mixed).not.toContain("png-to-pdf");
  });

  /**
   * The composed chain: the NUMBER the suggestion promises must equal the files
   * the suggested tool's hand-off keeps. Before, 3 PNGs + 2 JPGs were promised
   * as "your 5 images" and JPG to PDF received 2.
   */
  it("promises exactly the images the suggested tool will receive", () => {
    const mixes: WorkspaceFile[][] = [
      [
        file("a.png"),
        file("b.png"),
        file("c.png"),
        file("d.jpg"),
        file("e.jpeg"),
      ],
      [file("a.png"), file("b.jpg")],
      [file("a.png"), file("b.png")],
      [file("a.jpg"), file("b.webp"), file("c.png"), file("d.heic")],
    ];
    for (const files of mixes) {
      const suggestion = suggestTools(files).find(
        (s) => /-to-pdf$/.test(s.slug) && /image/.test(s.reason),
      );
      expect(suggestion, files.map((f) => f.name).join(",")).toBeDefined();
      const promised = Number(suggestion!.reason.match(/(\d+)/)![1]);
      const handed = eligibleFilesFor(
        suggestion!.slug,
        files.map((f) => ({ name: f.name, type: f.mime })),
      ).length;
      expect(promised, suggestion!.reason).toBe(handed);
    }
  });

  it("does not promise a conversion for images no tool can take", () => {
    expect(slugs([file("a.webp"), file("b.heic")])).not.toContain("jpg-to-pdf");
    expect(slugs([file("a.webp"), file("b.heic")])).not.toContain("png-to-pdf");
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
