// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString, rgb } from "pdf-lib";
import { PDFA_ID_NAMESPACE } from "./pdfa-markers";
import { PDFA_LEVELS } from "./levels";
import { readCarriedDocInfo } from "./docinfo";
import {
  PDFA_PROOF_DOCINFO,
  pdfHeaderVersion,
  pdfaLevelProofPdf,
  pdfaLevelProofVerdict,
} from "./level-proof";

const { title: TITLE, author: AUTHOR } = PDFA_PROOF_DOCINFO;

/**
 * A pdf-lib model of Ghostscript's PDF/A output: a GTS_PDFA1 output intent,
 * an XMP packet in the spelling gdevpdfe.c writes (single-quoted pdfaid
 * attributes, dc:title in an rdf:Alt, dc:creator in an rdf:Seq), and the Info
 * dictionary. Not a Ghostscript capture: the real file is judged by the same
 * function in `pnpm worker:prove-tools`.
 */
async function ghostscriptShaped(opts: {
  part: string;
  header?: string;
  infoTitle?: string | null;
  infoAuthor?: string | null;
  dc?: boolean;
  intent?: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]).drawRectangle({
    x: 10,
    y: 10,
    width: 100,
    height: 50,
    color: rgb(0.5, 0.2, 0.2),
  });
  const { context, catalog } = doc;
  const profile = context.register(
    context.stream(new Uint8Array(128).fill(7), { N: 3 }),
  );
  if (opts.intent !== false)
    catalog.set(
      PDFName.of("OutputIntents"),
      context.obj([
        context.register(
          context.obj({
            Type: "OutputIntent",
            S: "GTS_PDFA1",
            OutputConditionIdentifier: PDFString.of("sRGB"),
            DestOutputProfile: profile,
          }),
        ),
      ]),
    );
  const dc =
    opts.dc === false
      ? ""
      : `<rdf:Description rdf:about='' xmlns:dc='http://purl.org/dc/elements/1.1/' dc:format='application/pdf'>` +
        `<dc:title><rdf:Alt><rdf:li xml:lang='x-default'>${TITLE}</rdf:li></rdf:Alt></dc:title>` +
        `<dc:creator><rdf:Seq><rdf:li>${AUTHOR}</rdf:li></rdf:Seq></dc:creator></rdf:Description>`;
  const xmp =
    `<?xpacket begin='﻿' id='W5M0MpCehiHzreSzNTczkc9d'?>\n` +
    `<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>` +
    `<rdf:Description rdf:about='' xmlns:pdfaid='${PDFA_ID_NAMESPACE}' pdfaid:part='${opts.part}' pdfaid:conformance='B'/>` +
    dc +
    `</rdf:RDF></x:xmpmeta>\n<?xpacket end='w'?>`;
  catalog.set(
    PDFName.of("Metadata"),
    context.register(
      context.flateStream(new TextEncoder().encode(xmp), {
        Type: "Metadata",
        Subtype: "XML",
      }),
    ),
  );
  if (opts.infoTitle !== null) doc.setTitle(opts.infoTitle ?? TITLE);
  if (opts.infoAuthor !== null) doc.setAuthor(opts.infoAuthor ?? AUTHOR);
  const bytes = await doc.save({ useObjectStreams: false });
  // pdf-lib writes %PDF-1.7; the header Ghostscript writes is set here, same length.
  const header = new TextEncoder().encode(`%PDF-${opts.header ?? "1.7"}`);
  bytes.set(header, 0);
  return bytes;
}

describe("pdfaLevelProofVerdict", () => {
  it.each(PDFA_LEVELS.map((l) => [l.id, l.part] as const))(
    "POSITIVE CONTROL: %s declared as part %s, title and author in Info and XMP",
    async (id, part) => {
      const bytes = await ghostscriptShaped({
        part,
        header: part === "1" ? "1.4" : "1.7",
      });
      const v = await pdfaLevelProofVerdict(bytes, id);
      expect(v.detail).toMatch(/title and author in Info and XMP/);
      expect(v.ok).toBe(true);
    },
  );

  it("NEGATIVE CONTROL (the defect): 1b asked, an older worker writes part 2 on PDF 1.7 and drops the DOCINFO", async () => {
    const old = await ghostscriptShaped({
      part: "2",
      infoTitle: null,
      infoAuthor: null,
      dc: false,
    });
    const v = await pdfaLevelProofVerdict(old, "1b");
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/declares PDF\/A part 2, not 1/);
    expect(v.detail).toMatch(/is built on PDF 1\.4/);
    expect(v.detail).toMatch(/Info dictionary lost the title/);
    expect(v.detail).toMatch(/no dc:title/);
  });

  it("NEGATIVE CONTROL (the defect, 2b): the right part, but the title and author discarded", async () => {
    // A 2b request on an older worker: the default level, so the XMP part
    // matches, and only the carried fields can tell the images apart.
    const old = await ghostscriptShaped({
      part: "2",
      infoTitle: null,
      infoAuthor: null,
      dc: false,
    });
    const v = await pdfaLevelProofVerdict(old, "2b");
    expect(v.ok).toBe(false);
    expect(v.detail).not.toMatch(/part 2, not/);
    expect(v.detail).toMatch(/lost the author/);
  });

  it("NEGATIVE: a 1b file on PDF 1.7, and 3b asked but 2 declared", async () => {
    expect(
      (
        await pdfaLevelProofVerdict(
          await ghostscriptShaped({ part: "1", header: "1.7" }),
          "1b",
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await pdfaLevelProofVerdict(
          await ghostscriptShaped({ part: "2" }),
          "3b",
        )
      ).ok,
    ).toBe(false);
  });

  it("NEGATIVE: the title in Info but not in the XMP", async () => {
    const v = await pdfaLevelProofVerdict(
      await ghostscriptShaped({ part: "2", dc: false }),
      "2b",
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/no dc:creator/);
  });

  it("HEALTH: not a PDF, the proof input itself (no XMP), and a value the worker does not carry all fail", async () => {
    expect(
      (await pdfaLevelProofVerdict(new TextEncoder().encode("junk"), "2b")).ok,
    ).toBe(false);
    const input = await pdfaLevelProofVerdict(await pdfaLevelProofPdf(), "2b");
    expect(input.ok).toBe(false);
    expect(input.detail).toMatch(/no readable XMP/);
    const bracket = await pdfaLevelProofVerdict(
      await ghostscriptShaped({ part: "2" }),
      "2b",
      { title: "Report (2025)", author: AUTHOR },
    );
    expect(bracket.ok).toBe(false);
    expect(bracket.detail).toMatch(/does not carry/);
  });
});

describe("it asks the engine's own question (inspectPdfAMarkers) for the level", () => {
  // Held here rather than in worker-pdfa-proof.test.ts, which lets a spec
  // verify with this function on the strength of it.
  it("a file with everything else right but no PDF/A output intent fails, in the engine's words", async () => {
    const v = await pdfaLevelProofVerdict(
      await ghostscriptShaped({ part: "2", intent: false }),
      "2b",
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("the catalog has no /OutputIntents");
  });

  it("a part the level did not ask for fails, in the engine's words", async () => {
    const v = await pdfaLevelProofVerdict(
      await ghostscriptShaped({ part: "2" }),
      "3b",
    );
    expect(v.detail).toContain("the XMP declares PDF/A part 2, not 3");
  });
});

describe("the proof input", () => {
  it("carries what the worker reads and carries, and a writer's Producer like a real file", async () => {
    const bytes = await pdfaLevelProofPdf();
    expect(await readCarriedDocInfo(bytes)).toEqual({
      Title: TITLE,
      Author: AUTHOR,
    });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getProducer()).toMatch(/pdf-lib/);
  });

  it("is deterministic", async () => {
    const a = Buffer.from(await pdfaLevelProofPdf());
    const b = Buffer.from(await pdfaLevelProofPdf());
    expect(a.equals(b)).toBe(true);
    expect(pdfHeaderVersion(a)).toBe("1.7");
  });
});
