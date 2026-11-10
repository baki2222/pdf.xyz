import { describe, expect, it } from "vitest";
import * as PdfLib from "pdf-lib";
import {
  PDFArray,
  PDFBool,
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
  groupOfSubtype,
  type AnnotationGroupId,
} from "./annotation-groups";
import {
  inventoryAnnotations,
  inventoryDoc,
  MAX_REPLY_HOPS,
  removeAnnotations,
  removedOutputName,
  RemoveAnnotationsRefusal,
} from "./remove-annotations";
import {
  ALL_REMOVABLE_MARKERS,
  FULL_FIXTURE_GROUPS,
  MARK,
  MARKERS_BY_GROUP,
  addToPage,
  annot,
  apStream,
  fullFixture,
} from "@/tests/annotation-fixtures";
import { decodedScan, markersFound } from "@/tests/pdf-decoded-scan";

/**
 * Remove Annotations, proved on the SAVED bytes.
 *
 * The removal claim is "the chosen annotations are gone from the file, not
 * hidden". Two readers check it: pdf-lib re-opening the output (structure:
 * which annotations each page lists, what the form holds), and
 * `decodedScan`, which parses objects and DECODES every stream, object
 * streams included, and so sees an annotation's text, its appearance
 * stream and an attached file's payload wherever they were left. Every
 * absence is paired with a presence: the same markers are found in the
 * input, and a KEPT group's markers are found in the output.
 */

const all = new Set(ANNOTATION_GROUPS.map((g) => g.id));
const only = (...ids: AnnotationGroupId[]) => new Set(ids);

async function reopen(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

describe("the inventory", () => {
  it("counts every group of the full fixture, and the table sums to the fixture (health check)", async () => {
    const bytes = await fullFixture();
    const inv = await inventoryAnnotations(bytes);
    for (const group of ANNOTATION_GROUPS) {
      expect(inv.groups[group.id], group.id).toBe(
        FULL_FIXTURE_GROUPS[group.id],
      );
    }
    const tableSum = Object.values(FULL_FIXTURE_GROUPS).reduce(
      (a, b) => a + b,
      0,
    );
    expect(inv.total).toBe(tableSum);
    expect(tableSum).toBeGreaterThanOrEqual(ANNOTATION_GROUPS.length);
    expect(inv.signatureFields).toBe(1);
    expect(inv.signed).toBe(false);
    // Page 1: note, FreeText, highlight, ink, stamp, attachment (the pop-up
    // is not counted); page 2 holds the rest.
    expect(inv.pages.map((p) => p.page)).toEqual([1, 2]);
    const perPage = inv.pages.reduce(
      (sum, p) =>
        sum + Object.values(p.groups).reduce((a, b) => a + (b ?? 0), 0),
      0,
    );
    expect(perPage + inv.unplaced).toBe(inv.total);
  });

  it("every annotation subtype the table names sorts into its own row, and a Popup into none", () => {
    for (const group of ANNOTATION_GROUPS) {
      for (const subtype of group.subtypes) {
        expect(groupOfSubtype(subtype)).toBe(group.id);
      }
    }
    expect(groupOfSubtype("Popup")).toBeNull();
    expect(groupOfSubtype("SomethingNew")).toBe("other");
    expect(groupOfSubtype(undefined)).toBe("other");
  });

  it("counts a form field that no page lists", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const ctx = doc.context;
    const orphan = ctx.register(
      ctx.obj({ FT: "Tx", T: PDFString.of("ghost"), V: PDFString.of("x") }),
    );
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: ctx.obj([orphan]) }),
    );
    const inv = await inventoryAnnotations(await doc.save());
    expect(inv.groups["form-fields"]).toBe(1);
    expect(inv.unplaced).toBe(1);
    expect(inv.total).toBe(1);
  });

  it("counts hidden annotations", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    addToPage(doc, 0, annot(ctx, page.ref, "Square", { F: 2 }));
    addToPage(doc, 0, annot(ctx, page.ref, "Circle", { F: 32 }));
    addToPage(doc, 0, annot(ctx, page.ref, "Ink", { F: 4 }));
    const inv = await inventoryAnnotations(await doc.save());
    expect(inv.groups.drawings).toBe(3);
    expect(inv.hidden).toBe(2);
  });
});

describe("removal, read back from the saved file", () => {
  it("the positive control: every marker is in the INPUT, through object streams", async () => {
    const bytes = await fullFixture();
    const scan = decodedScan(bytes);
    expect(scan.stats.objectStreams).toBeGreaterThan(0);
    expect(scan.stats.decoded).toBeGreaterThan(scan.stats.objectStreams);
    expect(scan.stats.overBudget).toBe(0);
    expect(markersFound(bytes, ALL_REMOVABLE_MARKERS)).toEqual(
      ALL_REMOVABLE_MARKERS,
    );
    expect(markersFound(bytes, [MARK.reply, MARK.signature])).toHaveLength(2);
    // And the reader is not reading raw bytes: no marker is in them as such.
    const raw = Buffer.from(bytes).toString("latin1");
    expect(ALL_REMOVABLE_MARKERS.filter((m) => raw.includes(m))).toEqual([]);
  });

  for (const group of ANNOTATION_GROUPS) {
    it(`removing only ${group.id} takes its annotations and their bytes out, and keeps every other group`, async () => {
      const bytes = await fullFixture();
      const result = await removeAnnotations(bytes, only(group.id));
      const out = inventoryDoc(PdfLib, await reopen(result.bytes));
      expect(out.groups[group.id]).toBe(0);
      expect(result.removed[group.id]).toBe(FULL_FIXTURE_GROUPS[group.id]);
      for (const other of ANNOTATION_GROUPS) {
        if (other.id === group.id) continue;
        // The reply answers the highlight, so it goes with text markup.
        const expected =
          group.id === "text-markup" && other.id === "comments"
            ? FULL_FIXTURE_GROUPS.comments - 1
            : FULL_FIXTURE_GROUPS[other.id];
        expect(out.groups[other.id], other.id).toBe(expected);
      }
      expect(markersFound(result.bytes, MARKERS_BY_GROUP[group.id])).toEqual(
        [],
      );
      const keptMarkers = ANNOTATION_GROUPS.filter(
        (g) => g.id !== group.id,
      ).flatMap((g) => MARKERS_BY_GROUP[g.id]);
      expect(markersFound(result.bytes, keptMarkers)).toEqual(keptMarkers);
      expect(markersFound(result.bytes, [MARK.signature])).toEqual([
        MARK.signature,
      ]);
      expect(out.signatureFields).toBe(1);
    });
  }

  it("the defaults take comments, markup, drawings, stamps and attachments — text, appearance streams, rich text and the attached payload — and keep the rest", async () => {
    const bytes = await fullFixture();
    const result = await removeAnnotations(bytes, DEFAULT_GROUPS);
    const scan = decodedScan(result.bytes);
    expect(scan.stats.objectStreams).toBeGreaterThan(0);
    expect(scan.stats.overBudget).toBe(0);
    const gone = [
      MARK.noteAuthor,
      MARK.noteText,
      MARK.popupText,
      MARK.freeTextAp,
      MARK.richText,
      MARK.payload,
      MARK.attachName,
      MARK.highlight,
      MARK.reply,
      MARK.ink,
      MARK.square,
      MARK.stamp,
    ];
    expect(gone.filter((m) => scan.corpus.includes(m))).toEqual([]);
    const kept = [
      MARK.link,
      MARK.field,
      MARK.signature,
      MARK.redact,
      MARK.screen,
    ];
    expect(kept.filter((m) => scan.corpus.includes(m))).toEqual(kept);
    expect(result.removedTotal).toBe(8);
    expect(result.keptTotal).toBe(4);
    expect(result.attachmentsStillEmbedded).toBe(0);
  });

  it("the defaults never remove redaction marks or the 'other' group", () => {
    expect(DEFAULT_GROUPS.has("redaction-marks")).toBe(false);
    expect(DEFAULT_GROUPS.has("other")).toBe(false);
    expect(DEFAULT_GROUPS.has("links")).toBe(false);
    expect(DEFAULT_GROUPS.has("form-fields")).toBe(false);
    for (const subtype of ["Redact", "PrinterMark", "3D", "RichMedia"]) {
      expect(DEFAULT_GROUPS.has(groupOfSubtype(subtype)!)).toBe(false);
    }
  });

  it("result counts are the output's inventory against the input's", async () => {
    const bytes = await fullFixture();
    for (const chosen of [DEFAULT_GROUPS, all, only("links", "stamps")]) {
      const before = await inventoryAnnotations(bytes);
      const result = await removeAnnotations(bytes, chosen);
      const after = await inventoryAnnotations(result.bytes);
      for (const g of ANNOTATION_GROUPS) {
        expect(result.removed[g.id]).toBe(
          before.groups[g.id] - after.groups[g.id],
        );
        expect(result.kept[g.id]).toBe(after.groups[g.id]);
      }
      expect(result.removedTotal).toBe(before.total - after.total);
      expect(result.keptTotal).toBe(after.total);
    }
  });

  it("names the download -annotations-removed", () => {
    expect(removedOutputName("report.pdf")).toBe(
      "report-annotations-removed.pdf",
    );
  });
});

describe("attachments", () => {
  it("a file the PDF also lists as its own attachment stays, and is reported from the output", async () => {
    const bytes = await fullFixture({ alsoEmbedded: true });
    const result = await removeAnnotations(bytes, only("attachments"));
    expect(result.attachmentsStillEmbedded).toBe(1);
    expect(markersFound(result.bytes, [MARK.payload])).toEqual([MARK.payload]);
    const out = inventoryDoc(PdfLib, await reopen(result.bytes));
    expect(out.groups.attachments).toBe(0);
  });

  it("a file attached only through the removed pin is deleted with it", async () => {
    const bytes = await fullFixture();
    const result = await removeAnnotations(bytes, only("attachments"));
    expect(result.attachmentsStillEmbedded).toBe(0);
    expect(markersFound(result.bytes, [MARK.payload, MARK.attachName])).toEqual(
      [],
    );
  });
});

describe("refusals, before anything changes", () => {
  it("no annotations", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();
    const copy = bytes.slice();
    const err = await removeAnnotations(bytes, all).catch((e) => e);
    expect(err).toBeInstanceOf(RemoveAnnotationsRefusal);
    expect(err.reason).toBe("no-annotations");
    expect(Buffer.from(bytes).equals(Buffer.from(copy))).toBe(true);
  });

  it("nothing selected, and only absent kinds selected", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    addToPage(doc, 0, annot(doc.context, page.ref, "Ink"));
    const bytes = await doc.save();
    const copy = bytes.slice();
    for (const chosen of [new Set<AnnotationGroupId>(), only("links")]) {
      const err = await removeAnnotations(bytes, chosen).catch((e) => e);
      expect(err).toBeInstanceOf(RemoveAnnotationsRefusal);
      expect(err.reason).toBe("nothing-selected");
    }
    expect(Buffer.from(bytes).equals(Buffer.from(copy))).toBe(true);
  });

  it("a dynamic XFA form with Form fields chosen; without them, the rest is removed", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const field = annot(ctx, page.ref, "Widget", { FT: "/Tx", T: "a" });
    addToPage(doc, 0, field);
    addToPage(doc, 0, annot(ctx, page.ref, "Ink", { Contents: MARK.ink }));
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: ctx.obj([field]), XFA: PDFString.of("<xdp/>") }),
    );
    doc.catalog.set(PDFName.of("NeedsRendering"), PDFBool.True);
    const bytes = await doc.save();
    const copy = bytes.slice();
    const inv = await inventoryAnnotations(bytes);
    expect(inv.dynamicXfa).toBe(true);
    const err = await removeAnnotations(bytes, all).catch((e) => e);
    expect(err).toBeInstanceOf(RemoveAnnotationsRefusal);
    expect(err.reason).toBe("dynamic-xfa");
    expect(Buffer.from(bytes).equals(Buffer.from(copy))).toBe(true);
    const ok = await removeAnnotations(bytes, only("drawings"));
    expect(ok.removed.drawings).toBe(1);
    expect(ok.kept["form-fields"]).toBe(1);
  });
});

describe("form fields", () => {
  it("are removed with their values; the signature field and /SigFlags stay, and /CO is pruned", async () => {
    const bytes = await fullFixture();
    const doc = await PDFDocument.load(bytes);
    const form = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    const fields = form.lookup(PDFName.of("Fields"), PDFArray);
    form.set(PDFName.of("CO"), doc.context.obj([fields.get(0)]));
    const result = await removeAnnotations(
      await doc.save(),
      only("form-fields"),
    );
    const out = await reopen(result.bytes);
    const outForm = out.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    expect(outForm.lookup(PDFName.of("Fields"), PDFArray).size()).toBe(1);
    expect(outForm.get(PDFName.of("SigFlags"))).toEqual(PDFNumber.of(3));
    expect(outForm.lookup(PDFName.of("CO"), PDFArray).size()).toBe(0);
    expect(markersFound(result.bytes, [MARK.field])).toEqual([]);
    expect(result.signatureFieldsKept).toBe(1);
  });

  it("with no signature field, /AcroForm goes; a hybrid XFA form loses /XFA and /NeedsRendering", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const parent = ctx.register(
      ctx.obj({ T: PDFString.of("group"), FT: "Tx" }),
    );
    const kid = annot(ctx, page.ref, "Widget", {
      Parent: parent,
      V: MARK.field,
    });
    (ctx.lookup(parent) as PDFDict).set(PDFName.of("Kids"), ctx.obj([kid]));
    addToPage(doc, 0, kid);
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: ctx.obj([parent]), XFA: PDFString.of("<xdp/>") }),
    );
    doc.catalog.set(PDFName.of("NeedsRendering"), PDFBool.False);
    const result = await removeAnnotations(
      await doc.save(),
      only("form-fields"),
    );
    expect(result.droppedXfa).toBe(true);
    const out = await reopen(result.bytes);
    expect(out.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    expect(out.catalog.has(PDFName.of("NeedsRendering"))).toBe(false);
    expect(markersFound(result.bytes, [MARK.field, "xdp"])).toEqual([]);
  });

  it("signature widgets survive every subset of groups, signed or not", async () => {
    const bytes = await fullFixture({ signed: true });
    expect((await inventoryAnnotations(bytes)).signed).toBe(true);
    const subsets: ReadonlySet<AnnotationGroupId>[] = [
      all,
      only("form-fields"),
      DEFAULT_GROUPS,
      only("form-fields", "links"),
    ];
    for (const chosen of subsets) {
      const result = await removeAnnotations(bytes, chosen);
      expect(result.signatureFieldsKept).toBe(1);
      expect(result.signed).toBe(true);
      expect(markersFound(result.bytes, [MARK.signature])).toEqual([
        MARK.signature,
      ]);
      // Still a FIELD and still ON ITS PAGE — surviving in the file
      // detached from either would pass the two checks above.
      const out = await reopen(result.bytes);
      const isSig = (o: unknown) =>
        o instanceof PDFDict &&
        o.get(PDFName.of("FT")) === PDFName.of("Sig") &&
        o.lookup(PDFName.of("T"), PDFString).decodeText() === MARK.signature;
      const fields = out.catalog
        .lookup(PDFName.of("AcroForm"), PDFDict)
        .lookup(PDFName.of("Fields"), PDFArray);
      expect(
        fields.asArray().some((f) => isSig(out.context.lookup(f))),
        "the signature is in /AcroForm /Fields",
      ).toBe(true);
      const listed = out
        .getPage(1)
        .node.lookup(PDFName.of("Annots"), PDFArray)
        .asArray();
      expect(
        listed.some((a) => isSig(out.context.lookup(a))),
        "the signature widget is on page 2's /Annots",
      ).toBe(true);
    }
  });
});

describe("pop-ups and replies", () => {
  it("a pop-up goes with its parent; an orphan pop-up goes with comments; a pop-up a kept annotation opens stays", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const ctx = doc.context;
    const note = annot(ctx, page.ref, "Text", { Contents: "n" });
    const popup = annot(ctx, page.ref, "Popup", {
      Parent: note,
      Contents: MARK.popupText,
    });
    (ctx.lookup(note) as PDFDict).set(PDFName.of("Popup"), popup);
    const orphan = annot(ctx, page.ref, "Popup", { Contents: "ORPHANPOPUPq" });
    const square = annot(ctx, page.ref, "Square", { Contents: MARK.square });
    const keptPopup = annot(ctx, page.ref, "Popup", {
      Parent: square,
      Contents: "KEPTPOPUPq",
    });
    (ctx.lookup(square) as PDFDict).set(PDFName.of("Popup"), keptPopup);
    for (const r of [note, popup, orphan, square, keptPopup])
      addToPage(doc, 0, r);
    const result = await removeAnnotations(await doc.save(), only("comments"));
    expect(
      markersFound(result.bytes, [MARK.popupText, "ORPHANPOPUPq"]),
    ).toEqual([]);
    expect(markersFound(result.bytes, ["KEPTPOPUPq", MARK.square])).toEqual([
      "KEPTPOPUPq",
      MARK.square,
    ]);
    const out = await reopen(result.bytes);
    expect(
      out.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(2);
  });

  // INVERTED 2026-11-10 (review round 1). This was "an /IRT cycle, and a
  // chain longer than the hop limit, are kept and counted", expecting
  // repliesKept 4 with the cycle's two notes among them — and the panel then
  // said they "could not be traced". A cycle IS traced completely: every
  // member has been checked against what goes, none does, so it stays
  // whatever is ticked. Only the chain past the hop limit is untraced.
  it("an /IRT cycle is traced and kept uncounted; only a chain longer than the hop limit is counted", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const ctx = doc.context;
    const highlight = annot(ctx, page.ref, "Highlight", {
      Contents: MARK.highlight,
    });
    addToPage(doc, 0, highlight);
    // A two-note cycle that never reaches the highlight.
    const a = annot(ctx, page.ref, "Text", { Contents: "CYCLEAq" });
    const b = annot(ctx, page.ref, "Text", { Contents: "CYCLEBq", IRT: a });
    (ctx.lookup(a) as PDFDict).set(PDFName.of("IRT"), b);
    addToPage(doc, 0, a);
    addToPage(doc, 0, b);
    // A chain of MAX_REPLY_HOPS + 2 notes ending at the highlight.
    let prev: PDFRef = highlight;
    const chain: PDFRef[] = [];
    for (let i = 0; i < MAX_REPLY_HOPS + 2; i += 1) {
      prev = annot(ctx, page.ref, "Text", { IRT: prev });
      chain.push(prev);
      addToPage(doc, 0, prev);
    }
    // A short reply that does reach it.
    const direct = annot(ctx, page.ref, "Text", {
      Contents: MARK.reply,
      IRT: highlight,
    });
    addToPage(doc, 0, direct);
    const result = await removeAnnotations(
      await doc.save(),
      only("text-markup"),
    );
    expect(markersFound(result.bytes, [MARK.highlight, MARK.reply])).toEqual(
      [],
    );
    expect(markersFound(result.bytes, ["CYCLEAq", "CYCLEBq"])).toHaveLength(2);
    // Only the two chain notes beyond the hop limit (was 4, with the cycle).
    expect(result.repliesKept).toBe(2);
    expect(result.kept.comments).toBe(4);
    expect(result.removed.comments).toBe(1 + MAX_REPLY_HOPS);
  });
});

describe("shared objects", () => {
  it("an annotation two pages list is removed once, from both, and a shared /Annots array is not corrupted", async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([200, 200]);
    const p2 = doc.addPage([200, 200]);
    const p3 = doc.addPage([200, 200]);
    const ctx = doc.context;
    const stampRef = annot(ctx, p1.ref, "Stamp", {
      AP: ctx.obj({ N: apStream(ctx, MARK.stamp) }),
    });
    const link = annot(ctx, p1.ref, "Link", { Contents: MARK.link });
    const shared = ctx.register(ctx.obj([stampRef, link]));
    p1.node.set(PDFName.of("Annots"), shared);
    p2.node.set(PDFName.of("Annots"), shared);
    p3.node.set(PDFName.of("Annots"), ctx.obj([stampRef]));
    const bytes = await doc.save();
    const inv = await inventoryAnnotations(bytes);
    expect(inv.groups.stamps).toBe(1);
    expect(inv.groups.links).toBe(1);
    const result = await removeAnnotations(bytes, only("stamps"));
    expect(result.removed.stamps).toBe(1);
    const out = await reopen(result.bytes);
    const lists = out
      .getPages()
      .map((p) => p.node.lookup(PDFName.of("Annots")));
    expect(lists[0]).toBeInstanceOf(PDFArray);
    expect((lists[0] as PDFArray).size()).toBe(1);
    expect((lists[1] as PDFArray).size()).toBe(1);
    expect(lists[2]).toBeUndefined();
    expect(markersFound(result.bytes, [MARK.stamp])).toEqual([]);
    expect(markersFound(result.bytes, [MARK.link])).toEqual([MARK.link]);
  });

  it("an object a removed annotation shares with a kept page, a kept annotation or a kept field survives", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const ctx = doc.context;
    // A removed stamp's appearance is also a kept link's appearance.
    const sharedAp = apStream(ctx, "SHAREDAPq");
    const removedStamp = annot(ctx, page.ref, "Stamp", {
      AP: ctx.obj({ N: sharedAp }),
    });
    const keptLink = annot(ctx, page.ref, "Link", {
      AP: ctx.obj({ N: sharedAp }),
    });
    // (hostile) A removed square whose dictionary is ALSO the kept page's
    // graphics state (/ExtGState /GS1), which the page's content uses.
    const squareAsGState = annot(ctx, page.ref, "Square", {
      Contents: "SQUAREGSq",
      CA: 1,
    });
    page.node.set(
      PDFName.of("Resources"),
      ctx.obj({ ExtGState: ctx.obj({ GS1: squareAsGState }) }),
    );
    page.node.set(
      PDFName.of("Contents"),
      ctx.register(ctx.flateStream("q /GS1 gs 0 0 m 5 5 l S Q")),
    );
    // A removed note that a kept highlight opens as its /Popup.
    const sharedPopupNote = annot(ctx, page.ref, "Text", {
      Contents: "POPUPNOTEq",
    });
    const keptHighlight = annot(ctx, page.ref, "Highlight", {
      Popup: sharedPopupNote,
    });
    // A removed ink that is a kept field's /Parent.
    const inkParent = annot(ctx, page.ref, "Ink", { Contents: "INKPARENTq" });
    const field = annot(ctx, page.ref, "Widget", {
      FT: "/Tx",
      T: "f",
      Parent: inkParent,
    });
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: ctx.obj([field]) }),
    );
    for (const r of [
      removedStamp,
      keptLink,
      squareAsGState,
      sharedPopupNote,
      keptHighlight,
      inkParent,
      field,
    ]) {
      addToPage(doc, 0, r);
    }
    const bytes = await doc.save();
    const shared = ["SHAREDAPq", "SQUAREGSq", "POPUPNOTEq", "INKPARENTq"];
    expect(markersFound(bytes, shared)).toEqual(shared);
    const result = await removeAnnotations(
      bytes,
      only("stamps", "comments", "drawings"),
    );
    // Unlisted from the page, every one of them …
    const out = await reopen(result.bytes);
    const listed = out
      .getPage(0)
      .node.lookup(PDFName.of("Annots"), PDFArray)
      .asArray()
      .map((a) => out.context.lookup(a) as PDFDict)
      .map((d) => d.get(PDFName.of("Subtype"))?.toString());
    expect(listed.sort()).toEqual(["/Highlight", "/Link", "/Widget"]);
    // … but not cut: something kept still uses each.
    expect(markersFound(result.bytes, shared)).toEqual(shared);
    const res = out.getPage(0).node.Resources()!;
    expect(
      res.lookup(PDFName.of("ExtGState"), PDFDict).lookup(PDFName.of("GS1")),
    ).toBeDefined();
  });
});

describe("hostile inputs, bounded", () => {
  it("pop-up, /IRT and /Kids cycles, non-array /Annots, null and number entries", async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([200, 200]);
    const p2 = doc.addPage([200, 200]);
    const ctx = doc.context;
    const a = annot(ctx, p1.ref, "Text", { Contents: "A" });
    const pop = annot(ctx, p1.ref, "Popup", { Parent: a });
    (ctx.lookup(a) as PDFDict).set(PDFName.of("Popup"), pop);
    (ctx.lookup(pop) as PDFDict).set(PDFName.of("Popup"), pop);
    (ctx.lookup(a) as PDFDict).set(PDFName.of("IRT"), a);
    p1.node.set(
      PDFName.of("Annots"),
      ctx.obj([a, pop, PdfLib.PDFNull, PDFNumber.of(7), ctx.obj("Bogus")]),
    );
    p2.node.set(PDFName.of("Annots"), ctx.obj({ Not: "an array" }));
    const kidsA = ctx.register(ctx.obj({ T: PDFString.of("ka"), FT: "Tx" }));
    const kidsB = ctx.register(
      ctx.obj({ T: PDFString.of("kb"), Kids: ctx.obj([kidsA]) }),
    );
    (ctx.lookup(kidsA) as PDFDict).set(PDFName.of("Kids"), ctx.obj([kidsB]));
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: ctx.obj([kidsA]) }),
    );
    const bytes = await doc.save();
    const inv = await inventoryAnnotations(bytes);
    expect(inv.groups.comments).toBe(1);
    const result = await removeAnnotations(bytes, all);
    expect(result.removed.comments).toBe(1);
  });

  it("10,000 references to one annotation are one annotation, removed in bounded time", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const ink = annot(ctx, page.ref, "Ink", { Contents: MARK.ink });
    page.node.set(
      PDFName.of("Annots"),
      ctx.obj(Array.from({ length: 10_000 }, () => ink)),
    );
    const bytes = await doc.save();
    const started = Date.now();
    const inv = await inventoryAnnotations(bytes);
    expect(inv.groups.drawings).toBe(1);
    const result = await removeAnnotations(bytes, all);
    expect(result.removed.drawings).toBe(1);
    expect(markersFound(result.bytes, [MARK.ink])).toEqual([]);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("a field tree deeper than the walk is refused for Form fields, and other kinds still go", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    let node = annot(ctx, page.ref, "Widget", { FT: "/Tx", T: "leaf" });
    addToPage(doc, 0, node);
    for (let i = 0; i < 100; i += 1) {
      const parent = ctx.register(
        ctx.obj({ T: PDFString.of(`l${i}`), Kids: ctx.obj([node]) }),
      );
      (ctx.lookup(node) as PDFDict).set(PDFName.of("Parent"), parent);
      node = parent;
    }
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: ctx.obj([node]) }),
    );
    addToPage(doc, 0, annot(ctx, page.ref, "Square"));
    const bytes = await doc.save();
    const inv = await inventoryAnnotations(bytes);
    expect(inv.fieldTreeTooDeep).toBe(true);
    const err = await removeAnnotations(bytes, all).catch((e) => e);
    expect(err).toBeInstanceOf(RemoveAnnotationsRefusal);
    expect(err.reason).toBe("field-tree");
    const ok = await removeAnnotations(bytes, only("drawings"));
    expect(ok.removed.drawings).toBe(1);
  });

  it("an annotation stored in an object stream is found and removed", async () => {
    const bytes = await fullFixture({ objectStreams: true });
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("/ObjStm");
    const result = await removeAnnotations(bytes, only("comments"));
    expect(result.removed.comments).toBe(3);
  });
});

describe("the counts are the copy's, not the plan's", () => {
  it("a note the form tree also lists stays in the file, and is reported kept, not removed", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const note = annot(ctx, page.ref, "Text", { Contents: "FORMLISTEDNOTEq" });
    addToPage(doc, 0, note);
    addToPage(
      doc,
      0,
      annot(ctx, page.ref, "Text", { Contents: MARK.noteText }),
    );
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: ctx.obj([note]) }),
    );
    const result = await removeAnnotations(await doc.save(), only("comments"));
    // The plan removed two; the copy still holds the one the form lists.
    expect(result.removed.comments).toBe(1);
    expect(result.kept.comments).toBe(1);
    expect(markersFound(result.bytes, ["FORMLISTEDNOTEq"])).toEqual([
      "FORMLISTEDNOTEq",
    ]);
    expect(markersFound(result.bytes, [MARK.noteText])).toEqual([]);
  });
});
