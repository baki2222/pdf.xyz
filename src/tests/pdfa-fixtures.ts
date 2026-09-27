/**
 * Synthetic PDFs that do, or do not, DECLARE PDF/A-2b — the controls for
 * `inspectPdfAMarkers` and for every test that needs an engine output the
 * PDF/A gate will accept.
 *
 * PROVENANCE, stated because it bounds what these can prove: every file here is
 * built with pdf-lib, not produced by Ghostscript. No Ghostscript exists on the
 * machine these tests run on, and no stored production output of the pre-fix
 * argv exists in the repository. So `withoutOutputIntent()` is the shape the
 * 2026-09 audit DESCRIBES for the pre-fix argv (an XMP that claims part 2,
 * no OutputIntent) — it is a faithful model of the missing piece, not a capture
 * of the real file. The real file is proven only by `pnpm worker:prove-tools`
 * against a rebuilt worker, which runs this same predicate on the downloaded
 * artifact.
 *
 * The XMP spelling defaults to what Ghostscript's `gdevpdfe.c` writes —
 * attributes with single quotes, `pdfaid` prefix — so the positive control is
 * the spelling the gate will actually meet first.
 */
import { PDFDocument, PDFName, PDFString, rgb } from "pdf-lib";
import { PDFA_ID_NAMESPACE } from "@/lib/workers/pdf-archive/pdfa-markers";

export interface PdfAFixtureOptions {
  /** Which output intent the catalog carries. */
  intent?: "pdfa" | "none" | "wrong-subtype" | "no-profile";
  /** The XMP identification, or `null` for no /Metadata at all. */
  xmp?: {
    part?: string;
    conformance?: string;
    form?: "attribute" | "element";
    quote?: "'" | '"';
    prefix?: string;
  } | null;
  /** Flate-compress the XMP stream. */
  compressMetadata?: boolean;
  /** Write every non-stream object — the catalog included — into object streams. */
  objectStreams?: boolean;
  /** Plant the marker tokens as plain text in the Info dictionary. */
  strayMarkerText?: boolean;
}

function xmpPacket(opts: NonNullable<PdfAFixtureOptions["xmp"]>): string {
  const part = opts.part ?? "2";
  const conformance = opts.conformance ?? "B";
  const q = opts.quote ?? "'";
  const p = opts.prefix ?? "pdfaid";
  const description =
    opts.form === "element"
      ? `<rdf:Description rdf:about=${q}${q} xmlns:${p}=${q}${PDFA_ID_NAMESPACE}${q}>` +
        `<${p}:part>${part}</${p}:part><${p}:conformance>${conformance}</${p}:conformance>` +
        `</rdf:Description>`
      : `<rdf:Description rdf:about=${q}${q} xmlns:${p}=${q}${PDFA_ID_NAMESPACE}${q}` +
        ` ${p}:part=${q}${part}${q} ${p}:conformance=${q}${conformance}${q}/>`;
  return (
    `<?xpacket begin='﻿' id='W5M0MpCehiHzreSzNTczkc9d'?>\n` +
    `<x:xmpmeta xmlns:x='adobe:ns:meta/'>` +
    `<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>` +
    description +
    `</rdf:RDF></x:xmpmeta>\n<?xpacket end='w'?>`
  );
}

/** Build a one-page PDF with the requested PDF/A declarations. */
export async function buildPdfAFixture(
  opts: PdfAFixtureOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  // A filled shape, not text: the fixtures are about the catalog, and text
  // would have to come through the font chooser (text-drawing-call-sites).
  doc.addPage([200, 200]).drawRectangle({
    x: 20,
    y: 20,
    width: 160,
    height: 40,
    color: rgb(0.2, 0.4, 0.8),
  });
  const { context, catalog } = doc;

  const intent = opts.intent ?? "pdfa";
  if (intent !== "none") {
    const profile = context.register(
      context.stream(new Uint8Array(128).fill(7), { N: 3 }),
    );
    const intentDict = context.obj({
      Type: "OutputIntent",
      S: intent === "wrong-subtype" ? "GTS_PDFX" : "GTS_PDFA1",
      OutputConditionIdentifier: PDFString.of("sRGB"),
      ...(intent === "no-profile" ? {} : { DestOutputProfile: profile }),
    });
    catalog.set(
      PDFName.of("OutputIntents"),
      context.obj([context.register(intentDict)]),
    );
  }

  const xmp = opts.xmp === undefined ? {} : opts.xmp;
  if (xmp !== null) {
    const bytes = new TextEncoder().encode(xmpPacket(xmp));
    const dict = { Type: "Metadata", Subtype: "XML" };
    const stream = opts.compressMetadata
      ? context.flateStream(bytes, dict)
      : context.stream(bytes, dict);
    catalog.set(PDFName.of("Metadata"), context.register(stream));
  }

  if (opts.strayMarkerText) {
    // A literal string on the page dictionary: raw bytes in the file, so a byte
    // search sees every token, while the catalog declares nothing.
    doc
      .getPage(0)
      .node.set(
        PDFName.of("PieceInfo"),
        PDFString.of(
          "/OutputIntents [ /S /GTS_PDFA1 /DestOutputProfile ] " +
            `xmlns:pdfaid='${PDFA_ID_NAMESPACE}' pdfaid:part='2' pdfaid:conformance='B'`,
        ),
      );
  }

  return doc.save({ useObjectStreams: opts.objectStreams ?? false });
}

/** A file that declares PDF/A-2b the way Ghostscript's recipe produces it. */
export const declaredPdfA = (): Promise<Uint8Array> => buildPdfAFixture();

/** The audit's description of the pre-fix output: part 2 claimed, no OutputIntent. */
export const withoutOutputIntent = (): Promise<Uint8Array> =>
  buildPdfAFixture({ intent: "none" });
