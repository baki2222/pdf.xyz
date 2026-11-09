import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import type { AnnotationGroupId } from "@/lib/pdf/annotation-groups";

/**
 * PDFs carrying real annotations of every group Remove Annotations offers,
 * built object by object (pdf-lib has no API for most annotation kinds), and
 * each carrying a UNIQUE marker where a careless removal would leave text
 * behind: the note's author (/T) and text (/Contents), a FreeText's
 * appearance stream (/AP /N, Flate-compressed), a stream-form rich-text
 * body (/RC), an attached file's payload (/EmbeddedFile, compressed), a
 * stamp's appearance, a link's URI, a form field's value. Saved with object
 * streams, so the markers sit inside compressed object streams in the INPUT
 * as well — a reader that does not decode them finds nothing either side.
 */

export const MARK = {
  noteAuthor: "MARKNOTEAUTHORq1",
  noteText: "MARKNOTETEXTq2",
  popupText: "MARKPOPUPq3",
  freeTextAp: "MARKFREETEXTAPq4",
  richText: "MARKRICHTEXTq5",
  payload: "MARKATTACHPAYLOADq6",
  attachName: "MARKATTACHNAMEq7",
  highlight: "MARKHIGHLIGHTq8",
  reply: "MARKREPLYq9",
  ink: "MARKINKq10",
  square: "MARKSQUAREq11",
  stamp: "MARKSTAMPAPq12",
  link: "MARKLINKURIq13",
  field: "MARKFIELDVALUEq14",
  signature: "MARKSIGFIELDq15",
  redact: "MARKREDACTq16",
  screen: "MARKSCREENq17",
} as const;

/** What the full fixture holds, by group — the inventory must equal it. */
export const FULL_FIXTURE_GROUPS: Record<AnnotationGroupId, number> = {
  comments: 3, // the note, the FreeText, the reply
  "text-markup": 1,
  drawings: 2, // ink, square
  stamps: 1,
  attachments: 1,
  links: 1,
  "form-fields": 1,
  "redaction-marks": 1,
  other: 1,
};

/** Which markers live in which group's objects. */
export const MARKERS_BY_GROUP: Record<AnnotationGroupId, readonly string[]> = {
  comments: [
    MARK.noteAuthor,
    MARK.noteText,
    MARK.popupText,
    MARK.freeTextAp,
    MARK.richText,
  ],
  "text-markup": [MARK.highlight],
  drawings: [MARK.ink, MARK.square],
  stamps: [MARK.stamp],
  attachments: [MARK.payload, MARK.attachName],
  links: [MARK.link],
  "form-fields": [MARK.field],
  "redaction-marks": [MARK.redact],
  other: [MARK.screen],
};

export const register = (ctx: PDFContext, value: PDFObject): PDFRef =>
  ctx.register(value);

const rect = (ctx: PDFContext, x: number, y: number, w = 60, h = 20) =>
  ctx.obj([x, y, x + w, y + h]);

/** A Flate-compressed form XObject drawing `text`. */
export function apStream(ctx: PDFContext, text: string): PDFRef {
  const stream = ctx.flateStream(`BT /Helv 10 Tf 2 6 Td (${text}) Tj ET`, {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 120, 20],
  });
  return ctx.register(stream);
}

export function annot(
  ctx: PDFContext,
  page: PDFRef,
  subtype: string,
  extra: Record<string, PDFObject | string | number | number[]> = {},
  at: [number, number] = [40, 40],
): PDFRef {
  const dict = ctx.obj({
    Type: "Annot",
    Subtype: subtype,
    Rect: rect(ctx, at[0], at[1]),
    P: page,
  }) as PDFDict;
  for (const [k, v] of Object.entries(extra)) {
    dict.set(
      PDFName.of(k),
      typeof v === "string" && !v.startsWith("/")
        ? PDFString.of(v)
        : typeof v === "string"
          ? PDFName.of(v.slice(1))
          : typeof v === "number"
            ? PDFNumber.of(v)
            : Array.isArray(v)
              ? ctx.obj(v)
              : v,
    );
  }
  return ctx.register(dict);
}

export function addToPage(doc: PDFDocument, index: number, ref: PDFObject) {
  const node = doc.getPage(index).node;
  const existing = node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) existing.push(ref);
  else node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

export interface FullFixture {
  bytes: Uint8Array;
}

export interface FullFixtureOptions {
  /** Sign the signature field (a /V dict), so the input reads as signed. */
  signed?: boolean;
  /** List the attached file in /Names /EmbeddedFiles too. */
  alsoEmbedded?: boolean;
  /** Write object streams (default true). */
  objectStreams?: boolean;
}

/**
 * Two pages, every group present (see {@link FULL_FIXTURE_GROUPS}), plus a
 * signature field that no group removes and visible page text that stays.
 */
export async function fullFixture(
  options: FullFixtureOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([400, 500]);
  const p2 = doc.addPage([400, 500]);
  p1.drawText("PAGETEXTONE", { x: 40, y: 450, size: 12, font });
  p2.drawText("PAGETEXTTWO", { x: 40, y: 450, size: 12, font });
  const ctx = doc.context;
  const r1 = p1.ref;
  const r2 = p2.ref;

  // Comments: a sticky note with its pop-up, a FreeText with an appearance
  // and a stream-form rich-text body.
  const note = annot(ctx, r1, "Text", {
    T: MARK.noteAuthor,
    Contents: MARK.noteText,
    Name: "/Comment",
  });
  const popup = annot(
    ctx,
    r1,
    "Popup",
    { Parent: note, Contents: MARK.popupText },
    [120, 40],
  );
  (ctx.lookup(note) as PDFDict).set(PDFName.of("Popup"), popup);
  const rc = ctx.register(
    ctx.flateStream(`<body><p>${MARK.richText}</p></body>`),
  );
  const freeText = annot(
    ctx,
    r1,
    "FreeText",
    {
      DA: "/Helv 10 Tf 0 g",
      RC: rc,
      AP: ctx.obj({ N: apStream(ctx, MARK.freeTextAp) }),
    },
    [40, 80],
  );

  // Markup: a highlight with a reply (a Text annotation) on page 2.
  const highlight = annot(
    ctx,
    r1,
    "Highlight",
    {
      Contents: MARK.highlight,
      QuadPoints: [40, 140, 100, 140, 40, 120, 100, 120],
      C: [1, 1, 0],
    },
    [40, 120],
  );
  const reply = annot(
    ctx,
    r2,
    "Text",
    {
      Contents: MARK.reply,
      IRT: highlight,
    },
    [40, 40],
  );

  // Drawings.
  const ink = annot(
    ctx,
    r1,
    "Ink",
    {
      Contents: MARK.ink,
      InkList: ctx.obj([ctx.obj([40, 200, 60, 220, 80, 200])]),
    },
    [40, 200],
  );
  const square = annot(ctx, r2, "Square", { Contents: MARK.square }, [40, 100]);

  // A stamp with an appearance.
  const stampRef = annot(
    ctx,
    r1,
    "Stamp",
    {
      Name: "/Approved",
      AP: ctx.obj({ N: apStream(ctx, MARK.stamp) }),
    },
    [200, 200],
  );

  // A file attachment: filespec → embedded file stream (compressed).
  const payload = ctx.register(
    ctx.flateStream(`attached bytes ${MARK.payload} end`, {
      Type: "EmbeddedFile",
    }),
  );
  const filespec = ctx.register(
    ctx.obj({
      Type: "Filespec",
      F: PDFString.of(`${MARK.attachName}.txt`),
      UF: PDFHexString.fromText(`${MARK.attachName}.txt`),
      EF: ctx.obj({ F: payload }),
    }),
  );
  const attachment = annot(
    ctx,
    r1,
    "FileAttachment",
    {
      FS: filespec,
      Name: "/PushPin",
    },
    [200, 260],
  );
  if (options.alsoEmbedded) {
    doc.catalog.set(
      PDFName.of("Names"),
      ctx.obj({
        EmbeddedFiles: ctx.obj({
          Names: ctx.obj([PDFHexString.fromText("kept.txt"), filespec]),
        }),
      }),
    );
  }

  // A link.
  const link = annot(
    ctx,
    r2,
    "Link",
    {
      A: ctx.obj({
        S: "URI",
        URI: PDFString.of(`https://example.com/${MARK.link}`),
      }),
      Border: [0, 0, 0],
    },
    [40, 300],
  );

  // A text field (merged field + widget) and a signature field.
  const field = annot(
    ctx,
    r2,
    "Widget",
    {
      FT: "/Tx",
      T: "name",
      V: MARK.field,
    },
    [40, 200],
  );
  const sigExtra: Record<string, PDFObject | string | number> = {
    FT: "/Sig",
    T: MARK.signature,
  };
  if (options.signed) {
    sigExtra.V = ctx.register(
      ctx.obj({
        Type: "Sig",
        Filter: "Adobe.PPKLite",
        SubFilter: "adbe.pkcs7.detached",
        ByteRange: [0, 0, 0, 0],
        Contents: PDFHexString.of("00"),
      }),
    );
  }
  const signature = annot(ctx, r2, "Widget", sigExtra, [200, 200]);
  doc.catalog.set(
    PDFName.of("AcroForm"),
    ctx.obj({
      Fields: ctx.obj([field, signature]),
      SigFlags: 3,
      DA: PDFString.of("/Helv 0 Tf 0 g"),
    }),
  );

  // A pending redaction mark and a Screen annotation.
  const redact = annot(
    ctx,
    r2,
    "Redact",
    {
      Contents: MARK.redact,
      OverlayText: PDFString.of("REDACTED"),
    },
    [200, 300],
  );
  const screen = annot(
    ctx,
    r2,
    "Screen",
    { Contents: MARK.screen },
    [200, 400],
  );

  for (const ref of [
    note,
    popup,
    freeText,
    highlight,
    ink,
    stampRef,
    attachment,
  ]) {
    addToPage(doc, 0, ref);
  }
  for (const ref of [reply, square, link, field, signature, redact, screen]) {
    addToPage(doc, 1, ref);
  }
  return doc.save({
    useObjectStreams: options.objectStreams ?? true,
    updateFieldAppearances: false,
  });
}

/** Every marker the full fixture holds, except the signature field's. */
export const ALL_REMOVABLE_MARKERS: readonly string[] =
  Object.values(MARKERS_BY_GROUP).flat();
