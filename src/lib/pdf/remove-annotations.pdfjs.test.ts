// @native-canvas
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { ANNOTATION_GROUPS, DEFAULT_GROUPS } from "./annotation-groups";
import { removeAnnotations } from "./remove-annotations";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { addToPage, annot, fullFixture } from "@/tests/annotation-fixtures";

/**
 * Remove Annotations read back the way a READER receives it: pdf.js's
 * `getAnnotations()` — what a viewer's comment panel lists and draws — on
 * the saved bytes, and its operator list for a kept page whose resources a
 * removed annotation shared. Nothing here goes through the engine's own
 * inventory, so the inventory cannot certify itself.
 */

async function subtypesPerPage(bytes: Uint8Array): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl: `${pathToFileURL(join(dir, "standard_fonts")).href}/`,
  });
  const doc = await task.promise;
  try {
    const out: string[][] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const annots = (await page.getAnnotations()) as {
        subtype: string;
      }[];
      out.push(annots.map((a) => a.subtype).sort());
    }
    return out;
  } finally {
    await task.destroy();
  }
}

async function operatorCount(bytes: Uint8Array, pageNo: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNo);
    const ops = await page.getOperatorList();
    return {
      xobjects: ops.fnArray.filter(
        (fn: number) => fn === pdfjs.OPS.paintFormXObjectBegin,
      ).length,
      // The graphics state's line width, as pdf.js applied it.
      lineWidths: ops.fnArray.flatMap((fn: number, i: number) =>
        fn === pdfjs.OPS.setGState
          ? (ops.argsArray[i][0] as [string, unknown][])
              .filter(([key]) => key === "LW")
              .map(([, v]) => v as number)
          : [],
      ),
    };
  } finally {
    await task.destroy();
  }
}

describe("Remove Annotations, as pdf.js reads the saved copy", () => {
  it("the input lists every kind (positive control)", async () => {
    const pages = await subtypesPerPage(await fullFixture());
    const flat = pages.flat();
    for (const subtype of [
      "Text",
      "FreeText",
      "Highlight",
      "Ink",
      "Square",
      "Stamp",
      "FileAttachment",
      "Link",
      "Widget",
    ]) {
      expect(flat, subtype).toContain(subtype);
    }
  });

  it("the defaults leave only links, form fields and the kinds that default off", async () => {
    const result = await removeAnnotations(await fullFixture(), DEFAULT_GROUPS);
    const flat = (await subtypesPerPage(result.bytes)).flat();
    const removed = ANNOTATION_GROUPS.filter((g) =>
      DEFAULT_GROUPS.has(g.id),
    ).flatMap((g) => g.subtypes);
    expect(flat.filter((s) => removed.includes(s))).toEqual([]);
    expect(flat).toContain("Link");
    expect(flat.filter((s) => s === "Widget")).toHaveLength(2);
    expect(flat).not.toContain("Popup");
  });

  it("removing links alone leaves every other kind listed", async () => {
    const before = (await subtypesPerPage(await fullFixture())).flat();
    const result = await removeAnnotations(
      await fullFixture(),
      new Set(["links"] as const),
    );
    const after = (await subtypesPerPage(result.bytes)).flat();
    expect(after).not.toContain("Link");
    expect(after.length).toBe(before.length - 1);
  });

  it("a kept page still draws what a removed annotation shared with it", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const shared = ctx.register(
      ctx.flateStream("0 0 m 10 10 l S", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 10, 10],
      }),
    );
    // A stamp whose appearance is the page's XObject, and (hostile) whose
    // own dictionary is the page's graphics state, line width 7.
    const stampRef = annot(ctx, page.ref, "Stamp", {
      AP: ctx.obj({ N: shared }),
      LW: 7,
    });
    page.node.set(
      PDFName.of("Resources"),
      ctx.obj({
        XObject: ctx.obj({ X1: shared }),
        ExtGState: ctx.obj({ GS1: stampRef }),
      }),
    );
    page.node.set(
      PDFName.of("Contents"),
      ctx.register(ctx.flateStream("q /GS1 gs /X1 Do Q")),
    );
    addToPage(doc, 0, stampRef);
    const bytes = await doc.save();
    expect(await operatorCount(bytes, 1)).toEqual({
      xobjects: 1,
      lineWidths: [7],
    });
    const result = await removeAnnotations(bytes, new Set(["stamps"] as const));
    expect((await subtypesPerPage(result.bytes))[0]).toEqual([]);
    expect(await operatorCount(result.bytes, 1)).toEqual({
      xobjects: 1,
      lineWidths: [7],
    });
    const out = await PDFDocument.load(result.bytes);
    const res = out.getPage(0).node.Resources()!;
    expect(res.lookup(PDFName.of("XObject"))).toBeInstanceOf(PDFDict);
  });
});
