// @vitest-environment node
/**
 * No style one surface offers and another cannot draw (audit sign-pdf#1).
 *
 * The typed signature's styles live in `SIGNATURE_STYLES`. Two things could
 * leave a style offered and undrawable:
 *
 *  1. Another engine draws typed signatures from the same list and was not
 *     taught the handwriting faces. `signature.ts`' `signPdf` — the Sign PDF
 *     form's engine until 2026-10-24, still exported and tested — is the one
 *     that does; it is RUN below with every style, and the face it embeds is
 *     read out of the file.
 *  2. The worker (Request Signatures, `native.ts`) offers typed styles. It
 *     does not: it places AcroForm text fields that a signer fills in their
 *     own viewer, in that viewer's font. That is pinned as a property of the
 *     worker's REAL code — the value-import closure of the container's entry
 *     points (`Dockerfile` CMD → `package.json` script → file), not a list
 *     of files — so a worker module that starts drawing a typed style fails
 *     here and has to be given the faces (and a worker image release) first.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  REPO_ROOT,
  rel,
  valueImportGraph,
  workerEntryPoints,
} from "@/tests/spawn-sites";
import { SIGNATURE_STYLES, type SignatureStyle } from "./offered-kinds";
import { isHandwritingStyle } from "./signature-style";
import { HANDWRITING_FACES } from "./handwriting";
import { signPdf } from "./signature";

/** Code that reads the typed-signature style list or draws a typed signature. */
const OFFERS_TYPED_STYLES =
  /\b(?:SIGNATURE_STYLES|SignatureStyle|HANDWRITING_STYLES|typedSignatureObject|HANDWRITING_FACES)\b/;

/** The modules among `files` that use the style list — the definition aside. */
function styleUsers(files: readonly string[]): string[] {
  return files
    .filter((f) => !/offered-kinds\.ts$/.test(f))
    .filter((f) => OFFERS_TYPED_STYLES.test(readFileSync(f, "utf8")))
    .map((f) => rel(f));
}

describe("the worker offers no typed signature style", () => {
  it("no module the worker runs reads the style list (with a graph-size bound and a positive control)", () => {
    const entries = workerEntryPoints();
    expect(entries.length).toBeGreaterThan(0);
    const graph = valueImportGraph(entries);
    // A collapsed walk would make the absence below vacuous.
    expect(
      graph.length,
      "the worker graph is implausibly small",
    ).toBeGreaterThan(100);
    expect(
      graph.some((f) => /request-signatures[\\/]native\.ts$/.test(f)),
    ).toBe(true);
    expect(styleUsers(graph)).toEqual([]);

    // Positive control: the same detector over the signature panel's own
    // closure finds the panel — so an empty answer above is a real absence.
    const panel = valueImportGraph([
      `${REPO_ROOT}/src/components/tools/runner/editor/signature-panel.tsx`,
    ]);
    expect(styleUsers(panel)).toContain(
      "src/components/tools/runner/editor/signature-panel.tsx",
    );
  });
});

async function signPdfFace(style: SignatureStyle, text: string) {
  const blank = await PDFDocument.create();
  blank.addPage([400, 300]);
  const out = await signPdf(
    await blank.save(),
    { kind: "typed", text, style },
    { pageIndex: 0, position: "bottom-right", width: 200 },
  );
  const doc = await PDFDocument.load(out);
  const fonts = doc
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("Font"), PDFDict);
  return fonts
    .entries()
    .map(([, ref]) =>
      String((doc.context.lookup(ref) as PDFDict).get(PDFName.of("BaseFont"))),
    );
}

describe("signPdf draws every offered style", () => {
  it("each handwriting style embeds its face; Script and Print their standard faces", async () => {
    expect(SIGNATURE_STYLES.length).toBeGreaterThanOrEqual(5);
    for (const style of SIGNATURE_STYLES) {
      const faces = await signPdfFace(style, "Ada Lovelace");
      expect(faces, style).toHaveLength(1);
      if (isHandwritingStyle(style))
        expect(faces[0], style).toContain(
          HANDWRITING_FACES[style].postscriptName,
        );
      else
        expect(faces[0], style).toBe(
          style === "print" ? "/Helvetica" : "/Times-Italic",
        );
    }
  }, 120_000);

  it("a name a face cannot draw: Script's face, not a blank", async () => {
    for (const style of SIGNATURE_STYLES.filter(isHandwritingStyle)) {
      const faces = await signPdfFace(style, "আডা লভলেস");
      expect(faces[0], style).toMatch(/Noto/);
    }
  }, 120_000);
});
