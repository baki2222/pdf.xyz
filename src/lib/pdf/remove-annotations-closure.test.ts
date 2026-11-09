import { describe, expect, it } from "vitest";
import * as PdfLib from "pdf-lib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "pdf-lib";
import {
  ANNOTATION_GROUPS,
  DEFAULT_GROUPS,
  type AnnotationGroupId,
} from "./annotation-groups";
import {
  inventoryAnnotations,
  inventoryDoc,
  planRemoval,
  removeAnnotations,
} from "./remove-annotations";
import { addToPage, annot, fullFixture } from "@/tests/annotation-fixtures";
import { markersFound } from "@/tests/pdf-decoded-scan";

/**
 * Remove Annotations' closure — what else goes with what the reader ticked —
 * and the numbers reported about it, proved on the SAVED bytes.
 *
 * Review round 1 (2026-11-10). Each case below was a probe that showed the
 * branch taking an annotation off its page while its bytes, or a count, said
 * otherwise: a pop-up found only from its /Parent side, a reply on no page,
 * an annotation a kept object still used, an attached file judged by its
 * filespec object instead of its bytes, a structure element's /Alt, a
 * signature widget with no /Subtype, and a panel whose plan left out the
 * replies the run removes. Every case was red before the fix.
 */

const all = new Set(ANNOTATION_GROUPS.map((g) => g.id));
const only = (...ids: AnnotationGroupId[]) => new Set(ids);
const reopen = (bytes: Uint8Array) =>
  PDFDocument.load(bytes, { updateMetadata: false });

async function twoPageDoc() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  return doc;
}

describe("the plan the panel shows is the run's closure", () => {
  const selections: [string, ReadonlySet<AnnotationGroupId>][] = [
    ...ANNOTATION_GROUPS.map(
      (g) => [g.id, only(g.id)] as [string, ReadonlySet<AnnotationGroupId>],
    ),
    ["defaults", DEFAULT_GROUPS],
    ["all", all],
  ];
  for (const [label, chosen] of selections) {
    it(`${label}: the planned total and per-page counts equal what the saved copy lost`, async () => {
      const bytes = await fullFixture();
      const inventory = await inventoryAnnotations(bytes);
      const plan = planRemoval(inventory, chosen);
      const result = await removeAnnotations(bytes, chosen);
      expect(plan.total).toBe(result.removedTotal);
      expect(plan.groups).toEqual(result.removed);
      const after = inventoryDoc(PdfLib, await reopen(result.bytes));
      const sum = (g: Partial<Record<AnnotationGroupId, number>>) =>
        Object.values(g).reduce((a, b) => a + b, 0);
      const lost = inventory.pages
        .map((p) => {
          const left = after.pages.find((q) => q.page === p.page);
          return {
            page: p.page,
            n: sum(p.groups) - (left ? sum(left.groups) : 0),
          };
        })
        .filter((p) => p.n > 0);
      expect(plan.pages.map((p) => ({ page: p.page, n: p.total }))).toEqual(
        lost,
      );
    });
  }

  it("ticking only markup plans the reply to the highlight too (the case that was wrong)", async () => {
    const inventory = await inventoryAnnotations(await fullFixture());
    const plan = planRemoval(inventory, only("text-markup"));
    expect(plan.groups["text-markup"]).toBe(1);
    expect(plan.groups.comments).toBe(1);
    expect(plan.total).toBe(2);
    expect(plan.pages.map((p) => p.page)).toEqual([1, 2]);
  });
});

describe("pop-ups found from either side", () => {
  it("a page-listed pop-up with no /Parent goes with the markup that opens it, comments unticked", async () => {
    const doc = await twoPageDoc();
    const ctx = doc.context;
    const p = doc.getPage(0).ref;
    const popup = annot(ctx, p, "Popup", { Contents: "SECRETPOPUPa1" });
    const hl = annot(ctx, p, "Highlight", {
      Contents: "SECRETHLa2",
      QuadPoints: [40, 60, 100, 60, 40, 40, 100, 40],
      Popup: popup,
    });
    addToPage(doc, 0, hl);
    addToPage(doc, 0, popup);
    const bytes = await doc.save();
    expect(markersFound(bytes, ["SECRETPOPUPa1", "SECRETHLa2"])).toHaveLength(
      2,
    );
    const result = await removeAnnotations(bytes, only("text-markup"));
    expect(markersFound(result.bytes, ["SECRETPOPUPa1", "SECRETHLa2"])).toEqual(
      [],
    );
    const out = await reopen(result.bytes);
    expect(out.getPage(0).node.lookup(PDFName.of("Annots"))).toBeUndefined();
  });

  it("a pop-up a kept highlight opens stays, and its /Parent does not keep the removed note", async () => {
    const doc = await twoPageDoc();
    const ctx = doc.context;
    const p = doc.getPage(0).ref;
    const popupRef = ctx.nextRef();
    const note = annot(ctx, p, "Text", {
      Contents: "SECRETNOTEg1",
      Popup: popupRef,
    });
    ctx.assign(
      popupRef,
      ctx.obj({
        Type: "Annot",
        Subtype: "Popup",
        Rect: [0, 0, 1, 1],
        Parent: note,
        Contents: PDFString.of("KEPTPOPUPg2"),
      }),
    );
    const hl = annot(ctx, p, "Highlight", {
      Popup: popupRef,
      QuadPoints: [0, 0, 1, 0, 0, 1, 1, 1],
    });
    addToPage(doc, 0, note);
    addToPage(doc, 0, hl);
    const result = await removeAnnotations(await doc.save(), only("comments"));
    expect(markersFound(result.bytes, ["SECRETNOTEg1", "KEPTPOPUPg2"])).toEqual(
      ["KEPTPOPUPg2"],
    );
    expect(result.removed.comments).toBe(1);
    expect(result.stillInFile).toBe(0);
  });
});

describe("replies no page lists", () => {
  it("a reply on no page, reached only from the structure tree, goes with the note it answers", async () => {
    const doc = await twoPageDoc();
    const ctx = doc.context;
    const p = doc.getPage(0).ref;
    const note = annot(ctx, p, "Text", { Contents: "SECRETNOTEh1" });
    addToPage(doc, 0, note);
    const reply = annot(ctx, p, "Text", {
      Contents: "SECRETREPLYh2",
      IRT: note,
      StructParent: 0,
    });
    const root = ctx.nextRef();
    const elem = ctx.register(
      ctx.obj({
        Type: "StructElem",
        S: "Annot",
        P: root,
        K: ctx.obj({ Type: "OBJR", Obj: reply }),
      }),
    );
    ctx.assign(
      root,
      ctx.obj({
        Type: "StructTreeRoot",
        K: [elem],
        ParentTree: ctx.obj({ Nums: [0, elem] }),
      }),
    );
    doc.catalog.set(PDFName.of("StructTreeRoot"), root);
    const bytes = await doc.save();
    expect(markersFound(bytes, ["SECRETREPLYh2"])).toHaveLength(1);
    const result = await removeAnnotations(bytes, only("comments"));
    expect(
      markersFound(result.bytes, ["SECRETNOTEh1", "SECRETREPLYh2"]),
    ).toEqual([]);
    expect(result.repliesKept).toBe(0);
  });
});

describe("an annotation a kept object still uses is reported, not counted removed", () => {
  it("a note a kept square points at stays in the file and is counted as still there", async () => {
    const doc = await twoPageDoc();
    const ctx = doc.context;
    const p = doc.getPage(0).ref;
    const note = annot(ctx, p, "Text", { Contents: "SPAREDNOTEs1" });
    const gone = annot(ctx, p, "Text", { Contents: "GONENOTEs2" });
    const square = annot(ctx, p, "Square", { Contents: "x", ExData: note });
    for (const r of [note, gone, square]) addToPage(doc, 0, r);
    const result = await removeAnnotations(await doc.save(), only("comments"));
    expect(markersFound(result.bytes, ["SPAREDNOTEs1", "GONENOTEs2"])).toEqual([
      "SPAREDNOTEs1",
    ]);
    expect(result.removed.comments).toBe(1);
    expect(result.removedTotal).toBe(1);
    expect(result.stillInFile).toBe(1);
    expect(result.kept.comments).toBe(0);
  });
});

describe("attached files, judged by their bytes", () => {
  async function pinned(
    wire: (doc: PDFDocument, payload: PDFRef) => PDFRef | PDFDict,
  ) {
    const doc = await twoPageDoc();
    const ctx = doc.context;
    const payload = ctx.register(
      ctx.flateStream("SECRETPAYLOADc1", { Type: "EmbeddedFile" }),
    );
    const fs = wire(doc, payload);
    addToPage(
      doc,
      0,
      annot(ctx, doc.getPage(0).ref, "FileAttachment", { FS: fs }),
    );
    const bytes = await doc.save();
    expect(markersFound(bytes, ["SECRETPAYLOADc1"])).toHaveLength(1);
    return removeAnnotations(bytes, only("attachments"));
  }
  const filespec = (doc: PDFDocument, payload: PDFRef) =>
    doc.context.obj({
      Type: "Filespec",
      F: PDFString.of("c.txt"),
      EF: doc.context.obj({ F: payload }),
    });
  const nameIt = (doc: PDFDocument, fs: PDFRef) =>
    doc.catalog.set(
      PDFName.of("Names"),
      doc.context.obj({
        EmbeddedFiles: doc.context.obj({
          Names: [PDFString.of("c.txt"), fs],
        }),
      }),
    );

  it("a filespec a page also lists as an associated file (/AF): reported", async () => {
    const result = await pinned((doc, payload) => {
      const fs = doc.context.register(filespec(doc, payload));
      doc.getPage(0).node.set(PDFName.of("AF"), doc.context.obj([fs]));
      return fs;
    });
    expect(markersFound(result.bytes, ["SECRETPAYLOADc1"])).toHaveLength(1);
    expect(result.removed.attachments).toBe(1);
    expect(result.attachmentsStillEmbedded).toBe(1);
  });

  it("a direct filespec whose payload a named filespec shares: reported", async () => {
    const result = await pinned((doc, payload) => {
      nameIt(doc, doc.context.register(filespec(doc, payload)));
      return filespec(doc, payload);
    });
    expect(markersFound(result.bytes, ["SECRETPAYLOADc1"])).toHaveLength(1);
    expect(result.attachmentsStillEmbedded).toBe(1);
  });

  it("a separate indirect filespec sharing the named one's payload: reported", async () => {
    const result = await pinned((doc, payload) => {
      nameIt(doc, doc.context.register(filespec(doc, payload)));
      return doc.context.register(filespec(doc, payload));
    });
    expect(markersFound(result.bytes, ["SECRETPAYLOADc1"])).toHaveLength(1);
    expect(result.attachmentsStillEmbedded).toBe(1);
  });

  it("a payload only the pin held is gone and reported as 0 (the control)", async () => {
    const result = await pinned((doc, payload) =>
      doc.context.register(filespec(doc, payload)),
    );
    expect(markersFound(result.bytes, ["SECRETPAYLOADc1"])).toEqual([]);
    expect(result.attachmentsStillEmbedded).toBe(0);
  });
});

describe("tagged PDFs", () => {
  async function tagged(extraKid: boolean) {
    const doc = await twoPageDoc();
    const ctx = doc.context;
    const p = doc.getPage(0).ref;
    const note = annot(ctx, p, "Text", {
      Contents: "SECRETNOTEb1",
      StructParent: 0,
    });
    addToPage(doc, 0, note);
    const objr = ctx.obj({ Type: "OBJR", Obj: note, Pg: p });
    const root = ctx.nextRef();
    const elem = ctx.register(
      ctx.obj({
        Type: "StructElem",
        S: extraKid ? "Link" : "Annot",
        P: root,
        Alt: PDFString.of("SECRETALTb2"),
        ActualText: PDFString.of("SECRETACTUALb3"),
        K: extraKid ? ctx.obj([0, objr]) : objr,
      }),
    );
    ctx.assign(
      root,
      ctx.obj({
        Type: "StructTreeRoot",
        K: [elem],
        ParentTree: ctx.obj({ Nums: [0, elem] }),
        ParentTreeNextKey: 1,
      }),
    );
    doc.catalog.set(PDFName.of("StructTreeRoot"), root);
    doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
    const bytes = await doc.save();
    expect(
      markersFound(bytes, ["SECRETNOTEb1", "SECRETALTb2", "SECRETACTUALb3"]),
    ).toHaveLength(3);
    return removeAnnotations(bytes, only("comments"));
  }

  it("the structure element of a removed annotation loses its /Alt and /ActualText when nothing else is left in it", async () => {
    const result = await tagged(false);
    expect(
      markersFound(result.bytes, [
        "SECRETNOTEb1",
        "SECRETALTb2",
        "SECRETACTUALb3",
      ]),
    ).toEqual([]);
  });

  it("an element that still holds page content keeps its text, and loses only the pointer", async () => {
    const result = await tagged(true);
    expect(markersFound(result.bytes, ["SECRETNOTEb1"])).toEqual([]);
    expect(
      markersFound(result.bytes, ["SECRETALTb2", "SECRETACTUALb3"]),
    ).toHaveLength(2);
    const out = await reopen(result.bytes);
    const root = out.catalog.lookup(PDFName.of("StructTreeRoot"), PDFDict);
    const elem = out.context.lookup(
      root.lookup(PDFName.of("K"), PDFArray).get(0),
    ) as PDFDict;
    expect(elem.lookup(PDFName.of("K"), PDFArray).asArray()).toEqual([
      PDFNumber.of(0),
    ]);
  });
});

describe("a signature widget with no /Subtype", () => {
  it("is a signature field, never removed, whatever is ticked", async () => {
    const doc = await twoPageDoc();
    const ctx = doc.context;
    const p = doc.getPage(0).ref;
    const sig = annot(ctx, p, "Widget", { FT: "/Sig", T: "Signature1" });
    (ctx.lookup(sig) as PDFDict).delete(PDFName.of("Subtype"));
    const screen = annot(ctx, p, "Screen", { Contents: "x" });
    addToPage(doc, 0, sig);
    addToPage(doc, 0, screen);
    doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [sig] }));
    const bytes = await doc.save();
    const inv = await inventoryAnnotations(bytes);
    expect(inv.signatureFields).toBe(1);
    expect(inv.groups.other).toBe(1);
    const result = await removeAnnotations(bytes, all);
    expect(result.removed.other).toBe(1);
    expect(result.removedTotal).toBe(1);
    expect(result.signatureFieldsKept).toBe(1);
    const out = await reopen(result.bytes);
    expect(
      out.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(1);
  });
});
