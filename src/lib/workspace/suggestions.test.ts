/**
 * The workspace's suggestions are the ranking's (`rankForFiles`), read
 * through the files the workspace stages — measured facts when it has them,
 * the name's facts until then.
 *
 * HISTORY. Until 2026-10-09 `suggestTools` was its own model: a hand-written
 * score per family and a reason string per tool ("Combine your 3 PDFs into a
 * single document."), with no fact behind it beyond the extension. Its tests
 * pinned the reason's NUMBER to the hand-off ("promises exactly the images
 * the suggested tool will receive" — it once promised "your 5 images" and
 * delivered 2). That property is kept, stated on the new shape: what a
 * suggestion says it carries is what the gate carries. The cases below are
 * the old file's, re-asked of the ranking.
 */
import { describe, expect, it } from "vitest";
import { eligibleFilesFor } from "@/lib/handoff";
import { renderEvidence } from "@/lib/intent/evidence";
import { buildToolIndex } from "@/lib/intent/tool-index";
import type { PdfProbe } from "@/lib/pdf/probe-result";
import { getToolBySlug } from "@/lib/tools";
import { createWorkspaceFile } from "./classify";
import { factsOf, suggestTools } from "./suggestions";
import type { WorkspaceFile } from "./types";

const index = buildToolIndex();
let seq = 0;
function file(name: string, type = ""): WorkspaceFile {
  seq += 1;
  return createWorkspaceFile({ name, size: 1000, type }, `id-${seq}`, seq);
}

const top = (files: WorkspaceFile[]) =>
  suggestTools(files, index).top.map((s) => s.slug);
const all = (files: WorkspaceFile[]) => {
  const r = suggestTools(files, index);
  return [...r.top, ...r.more];
};

describe("suggestTools (the adapter over rankForFiles)", () => {
  it("returns nothing when no files are staged", () => {
    expect(suggestTools([], index)).toEqual({ top: [], more: [], notes: [] });
  });

  it("puts Merge PDF first for several PDFs, and says how many it combines", () => {
    const r = suggestTools(
      [file("a.pdf"), file("b.pdf"), file("c.pdf")],
      index,
    );
    expect(r.top[0]!.slug).toBe("merge-pdf");
    expect(r.top[0]!.evidence.map(renderEvidence)).toContain("3 PDFs");
    expect(r.top.map((s) => s.slug)).toContain("compress-pdf");
  });

  it("leads with single-PDF tools, not Merge, for one PDF", () => {
    const result = top([file("only.pdf")]);
    expect(result).not.toContain("merge-pdf");
    expect(result).toEqual(["compress-pdf", "sign-pdf", "edit-pdf"]);
    const everything = all([file("only.pdf")]).map((s) => s.slug);
    for (const slug of ["organize-pages", "split-pdf"])
      expect(everything).toContain(slug);
  });

  it("suggests PNG→PDF first only when every image is a PNG", () => {
    expect(top([file("a.png"), file("b.png")])[0]).toBe("png-to-pdf");
    expect(top([file("a.png"), file("b.jpg")])[0]).toBe("jpg-to-pdf");
  });

  /**
   * The composed chain, kept from the old model: the number a suggestion
   * promises must equal the files the suggested tool's hand-off keeps.
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
      const suggestion = suggestTools(files, index).top.find((s) =>
        /-to-pdf$/.test(s.slug),
      );
      expect(suggestion, files.map((f) => f.name).join(",")).toBeDefined();
      const handed = eligibleFilesFor(
        suggestion!.slug,
        files.map((f) => ({ name: f.name, type: f.mime })),
      ).length;
      expect(suggestion!.carry.eligible).toBe(handed);
      expect(suggestion!.evidence.map(renderEvidence)).toContain(
        `${handed} image${handed === 1 ? "" : "s"}`,
      );
    }
  });

  it("does not promise a conversion for images no tool can take", () => {
    const slugs = all([file("a.webp"), file("b.heic")]).map((s) => s.slug);
    expect(slugs).not.toContain("jpg-to-pdf");
    expect(slugs).not.toContain("png-to-pdf");
    expect(
      suggestTools([file("a.webp"), file("b.heic")], index).notes.map(
        (n) => n.kind,
      ),
    ).toEqual(["unsupported", "unsupported"]);
  });

  it("suggests the matching converter for office and text files", () => {
    expect(top([file("a.docx")])).toEqual(["word-to-pdf"]);
    expect(top([file("a.xlsx")])).toEqual(["excel-to-pdf"]);
    expect(top([file("a.pptx")])).toEqual(["powerpoint-to-pdf"]);
    expect(top([file("a.txt")])).toEqual(["text-to-pdf"]);
  });

  it("is deterministic and only ever suggests real catalogue tools", () => {
    const mix = [
      file("a.pdf"),
      file("b.pdf"),
      file("c.png"),
      file("d.docx"),
      file("e.txt"),
    ];
    expect(suggestTools(mix, index)).toEqual(suggestTools(mix, index));
    for (const s of all(mix)) expect(getToolBySlug(s.slug)).toBeDefined();
  });

  it("reads a staged file's measured facts once the workspace has them", () => {
    const scan = file("scan.pdf");
    const probe: PdfProbe = {
      read: "ok",
      lock: "none",
      pages: 1,
      formFields: 0,
      sample: ["image-only"],
    };
    const measured: WorkspaceFile = {
      ...scan,
      facts: {
        ...factsOf(scan),
        bytes: "PDF",
        pdf: { state: "checked", probe },
      },
    };
    expect(top([scan])[0]).toBe("compress-pdf");
    expect(top([measured])[0]).toBe("ocr-pdf");
  });
});
