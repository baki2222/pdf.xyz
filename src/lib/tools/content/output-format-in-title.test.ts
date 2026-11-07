// @vitest-environment node
/**
 * A "convert from PDF" page names the file type it makes in its search title.
 *
 * Audit search-demand#3 (2026-11-06): "pdf to ppt" and "pdf to pptx" are
 * searched ahead of "pdf to powerpoint", yet PDF to PowerPoint's title was
 * "PDF to PowerPoint: Slides with Pictures and Text" — neither PPT nor PPTX
 * — while its reverse page names PPTX and PPT and every other convert-from
 * page names its output (DOCX, XLSX, JPG, MD, TXT…).
 *
 * The set is DISCOVERED from the catalogue (every convert-from tool), and the
 * format each must name is its first `outputs` entry, so a new converter, or
 * a changed output, is held here without editing this file.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools/catalog";
import { getToolContent } from "./index";

/** True when `title` names `format` as a word ("PDF/A" included). */
function namesFormat(title: string, format: string): boolean {
  const escaped = format.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, "i").test(title);
}

describe("convert-from pages name their output in the title", () => {
  const converters = tools.filter((t) => t.category === "convert-from");

  it("finds the converters (health check: an empty set passes vacuously)", () => {
    expect(converters.length).toBeGreaterThanOrEqual(8);
  });

  it("the predicate reads a format as a word (controls)", () => {
    expect(
      namesFormat("PDF to PowerPoint: Slides with Pictures and Text", "PPTX"),
    ).toBe(false);
    expect(
      namesFormat("PDF to Word: Editable DOCX With Its Pictures", "DOCX"),
    ).toBe(true);
    // "PPT" must not be found inside "PPTX".
    expect(namesFormat("PDF to PPTX", "PPT")).toBe(false);
  });

  it.each(converters.map((t) => [t.slug, t.outputs[0]!]))(
    "%s names %s",
    (slug, format) => {
      const title = getToolContent(slug)?.seoTitle ?? "";
      expect(namesFormat(title, format), title).toBe(true);
    },
  );

  it("PDF to PowerPoint also answers 'pdf to ppt', the name people search", () => {
    expect(
      namesFormat(getToolContent("pdf-to-powerpoint")!.seoTitle, "PPT"),
    ).toBe(true);
  });
});
