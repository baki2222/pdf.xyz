// @vitest-environment node
/**
 * The Word to PDF deployment proof must be able to FAIL on the defect it
 * exists for, and must be wired where it runs.
 *
 * The defect: the worker image shipped no fonts (Debian lists them only as
 * Recommends of `libreoffice`; the Dockerfile installs with
 * `--no-install-recommends`), so Calibri and Cambria came out in a fallback
 * face with other metrics and CJK, Bengali, Hindi and Thai had no glyphs —
 * while the proof sent one unstyled English line and accepted any `%PDF-`.
 *
 * Three things are pinned here:
 *
 *   1. the proof DOCX, read back the way Word reads it, carries a run in every
 *      Office font and every script `office-conversion/fonts.ts` names;
 *   2. the verdict passes a PDF that embeds what the fixed image embeds, fails
 *      the PDF the shipped image wrote, and needs EVERY one of its
 *      requirements (a requirement nothing can fail is decoration);
 *   3. `scripts/worker-prove-tools.ts` builds its word-to-pdf input with that
 *      DOCX and judges the result with that verdict — read through the
 *      TypeScript parser, because the script runs on import and a verdict
 *      named in a comment is not a call.
 *
 * WHAT IT CANNOT SEE: what LibreOffice on the live worker embeds. Only
 * `pnpm worker:prove-tools word-to-pdf` against a rebuilt worker reads that.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from "pdf-lib";
import type * as TS from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDocxParagraphs } from "@/lib/workers/pdf-office-export/docx-text";
import {
  OFFICE_METRIC_CLONES,
  SCRIPT_FONTS,
} from "@/lib/workers/office-conversion/fonts";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import {
  OFFICE_FONT_PROOF_TITLE,
  officeFontProofDocx,
  officeFontProofVerdict,
  officeFontRequirements,
  pdfFontFaces,
} from "./office-font-fixtures";
import { useNodeFontSource } from "./unicode-fonts";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

/**
 * The PostScript names the fixed image's faces carry, as LibreOffice writes
 * them into /BaseFont (six-letter subset tag, then the name). The clones are
 * derived from the one list; the script faces are the names in Debian
 * bookworm's fonts-noto-core and fonts-noto-cjk, typed because a name is what
 * the proof reads and nothing else in the repository states it.
 */
const FIXED_IMAGE_FACES = [
  ...OFFICE_METRIC_CLONES.map((c) => c.clone.replace(/\s+/g, "")),
  "NotoSansCJKsc-Regular",
  "NotoSansCJKjp-Regular",
  "NotoSansCJKkr-Regular",
  "NotoSansDevanagari-Regular",
  "NotoSansThai-Regular",
];

/** What LibreOffice fell back to on the image with no font packages. */
const SHIPPED_IMAGE_FACES = ["DejaVuSans", "DejaVuSerif", "DejaVuSansMono"];

/** A six-letter subset tag, as LibreOffice writes one: BAAAAA+, CAAAAA+ ... */
const tag = (i: number) => `${String.fromCharCode(66 + (i % 25))}AAAAA+`;

/**
 * A PDF whose fonts carry `names`, each as its own TrueType font dictionary —
 * the first one written INLINE in the page's /Resources, the rest as indirect
 * objects, so both places a writer may put a font are read. With
 * `realBengali`, a Bengali line is drawn through the product's own embedder,
 * so one font in the file is a genuine Type0 + CIDFontType2 embedding rather
 * than a dictionary this test wrote.
 */
async function pdfWithFaces(
  names: readonly string[],
  realBengali: boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("proof", { x: 40, y: 800, size: 12, font: helvetica });
  if (realBengali) {
    const sample = SCRIPT_FONTS.Bengali.sample;
    const font = await embedDrawingFont(doc, [sample]);
    page.drawText(sample, { x: 40, y: 760, size: 14, font });
  }
  const fontDict = (name: string, i: number) =>
    doc.context.obj({
      Type: "Font",
      Subtype: "TrueType",
      BaseFont: `${tag(i)}${name}`,
    });
  names.forEach((name, i) => {
    const dict = fontDict(name, i);
    if (i === 0) {
      const resources = page.node.normalizedEntries().Resources;
      const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
      fonts.set(PDFName.of(`FInline${i}`), dict);
    } else {
      const ref: PDFRef = doc.context.register(dict);
      page.node.setFontDictionary(PDFName.of(`FLo${i}`), ref);
    }
  });
  return doc.save({ useObjectStreams: false });
}

let restoreFontSource: () => void;
beforeAll(() => {
  restoreFontSource = useNodeFontSource();
});
afterAll(() => restoreFontSource());

describe("officeFontProofDocx — a run in every Office font and every script", () => {
  it("reads back, as Word would, every font's line and every script's sample", async () => {
    const docx = await officeFontProofDocx();
    const paragraphs = await readDocxParagraphs(docx);
    // HEALTH: one paragraph per clone, per script, plus the title.
    expect(paragraphs).toHaveLength(
      1 + OFFICE_METRIC_CLONES.length + Object.keys(SCRIPT_FONTS).length,
    );
    expect(paragraphs[0]).toBe(OFFICE_FONT_PROOF_TITLE);
    for (const c of OFFICE_METRIC_CLONES)
      expect(paragraphs.some((p) => p.startsWith(`${c.office}:`))).toBe(true);
    for (const font of Object.values(SCRIPT_FONTS))
      expect(paragraphs).toContain(font.sample);
  });

  it("asks for each Office font by name, in the slots Word writes", async () => {
    const zip = await JSZip.loadAsync(await officeFontProofDocx());
    const xml = await zip.file("word/document.xml")!.async("string");
    const asked = new Set(
      [...xml.matchAll(/<w:rFonts w:ascii="([^"]+)"/g)].map((m) => m[1]),
    );
    expect(asked.size).toBeGreaterThan(0);
    for (const c of OFFICE_METRIC_CLONES) expect(asked).toContain(c.office);
    // Every script sample carries the language tag Word writes on it.
    for (const font of Object.values(SCRIPT_FONTS))
      expect(xml).toContain(`="${font.lang}"/>`);
  });
});

describe("pdfFontFaces — reads every font a PDF embeds", () => {
  it("finds inline, indirect and Type0-descendant fonts, subset tags removed", async () => {
    const faces = await pdfFontFaces(
      await pdfWithFaces(["Carlito", "Caladea"], true),
    );
    expect(faces).toContain("Carlito"); // inline in /Resources
    expect(faces).toContain("Caladea"); // indirect
    expect(faces).toContain("Helvetica");
    // The real Type0 embedding: the parent and its CIDFontType2 descendant.
    expect(faces.some((f) => /^NotoSansBengali/.test(f))).toBe(true);
    expect(faces.every((f) => !/^[A-Z]{6}\+/.test(f))).toBe(true);
  });
});

describe("officeFontProofVerdict — fails on the shipped image, passes on the fix", () => {
  it("passes a PDF that embeds every clone and a face for every script", async () => {
    const verdict = await officeFontProofVerdict(
      await pdfWithFaces(FIXED_IMAGE_FACES, true),
    );
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.detail).toMatch(/Carlito/);
  });

  it("POSITIVE CONTROL: the PDF the shipped image wrote — DejaVu everywhere — fails, naming every requirement", async () => {
    const verdict = await officeFontProofVerdict(
      await pdfWithFaces(SHIPPED_IMAGE_FACES, false),
    );
    expect(verdict.ok).toBe(false);
    for (const r of officeFontRequirements())
      expect(verdict.detail).toContain(r.label);
    expect(verdict.detail).toMatch(/embedded: .*DejaVuSans/);
  });

  it("every requirement is NECESSARY: removing the one face that meets it fails exactly it", async () => {
    const requirements = officeFontRequirements();
    // HEALTH: derived from the one list — a clone per Office font, and one
    // requirement per distinct script token.
    const tokens = new Set(
      Object.values(SCRIPT_FONTS)
        .map((s) => s.faceToken)
        .filter((t) => t !== null),
    );
    expect(requirements).toHaveLength(
      OFFICE_METRIC_CLONES.length + tokens.size,
    );
    expect(tokens.size).toBeGreaterThanOrEqual(3);

    // The real Bengali embedding stands in for the Bengali face.
    for (const requirement of requirements) {
      const meeting = FIXED_IMAGE_FACES.filter((f) => requirement.matches(f));
      const withoutIt = FIXED_IMAGE_FACES.filter(
        (f) => !requirement.matches(f),
      );
      const bengali = requirement.label.includes("Bengali");
      if (!bengali) expect(meeting.length).toBeGreaterThan(0);
      const verdict = await officeFontProofVerdict(
        await pdfWithFaces(withoutIt, !bengali),
      );
      expect(verdict.ok, requirement.label).toBe(false);
      // Exactly this one is named: two missing would read "no A; no B — ".
      expect(
        verdict.detail.startsWith(
          `no ${requirement.label} [${requirement.debianPackage}] — `,
        ),
        verdict.detail,
      ).toBe(true);
    }
  });

  it("matches a clone by its exact family, not a prefix or a substring", async () => {
    const lookalikes = FIXED_IMAGE_FACES.map((f) =>
      f === "LiberationSans" ? "LiberationSansNarrow-Regular" : f,
    );
    expect(lookalikes).not.toEqual(FIXED_IMAGE_FACES);
    const verdict = await officeFontProofVerdict(
      await pdfWithFaces(lookalikes, true),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/^no Liberation Sans \(for Arial\)/);
    // A bold face of the clone is the clone's family.
    const bold = await officeFontProofVerdict(
      await pdfWithFaces(
        FIXED_IMAGE_FACES.map((f) => (f === "Carlito" ? "Carlito-Bold" : f)),
        true,
      ),
    );
    expect(bold.ok).toBe(true);
  });

  it("a file that is not a PDF is a FAIL with the reason, not a throw", async () => {
    const verdict = await officeFontProofVerdict(
      new TextEncoder().encode("not a pdf"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/could not be read for its fonts/);
  });
});

// ─────────────────────── the proof harness calls it ───────────────────────

const SCRIPT = fileURLToPath(
  new URL("../../scripts/worker-prove-tools.ts", import.meta.url),
);
const FIXTURES = "@/tests/office-font-fixtures";

function callsIn(node: TS.Node): Set<string> {
  const out = new Set<string>();
  const walk = (n: TS.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression))
      out.add(n.expression.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

/**
 * Every spec whose `tool` is "word-to-pdf" must build its input with
 * `officeFontProofDocx` and judge the PDF with `officeFontProofVerdict`, both
 * imported from the fixtures module. `make: fn` (a reference, not a call) is
 * accepted for `make`, since the harness calls it.
 */
function wordProofProblems(source: string): string[] {
  const file = ts.createSourceFile(
    "worker-prove-tools.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imported = new Set<string>();
  const specs: TS.ObjectLiteralExpression[] = [];
  const walk = (n: TS.Node) => {
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text === FIXTURES
    ) {
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const el of bindings.elements) imported.add(el.name.text);
    }
    if (
      ts.isObjectLiteralExpression(n) &&
      n.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          p.name.getText(file) === "tool" &&
          ts.isStringLiteral(p.initializer) &&
          p.initializer.text === "word-to-pdf",
      )
    )
      specs.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);
  // A spec that takes its input `from` another spec's artifact is a ROUND
  // TRIP of that artifact through Word to PDF (since 2026-10-17, PDF to
  // Word's .docx), not the font proof: it is held to a `verify` of its own,
  // never to "any %PDF-". The font proof itself must still be there.
  const hasFrom = (spec: TS.ObjectLiteralExpression) =>
    spec.properties.some((p) => p.name?.getText(file) === "from");
  const trips = specs.filter(hasFrom);
  const proofs = specs.filter((s) => !hasFrom(s));
  if (proofs.length === 0) return ["no word-to-pdf spec"];
  const problems: string[] = [];
  for (const spec of trips)
    if (!spec.properties.some((p) => p.name?.getText(file) === "verify"))
      problems.push(
        `spec ${specs.indexOf(spec) + 1}: a round trip with no \`verify\``,
      );
  proofs.forEach((spec) => {
    const i = specs.indexOf(spec);
    for (const [name, fn] of [
      ["make", "officeFontProofDocx"],
      ["verify", "officeFontProofVerdict"],
    ] as const) {
      const prop = spec.properties.find((p) => p.name?.getText(file) === name);
      const uses =
        prop &&
        ts.isPropertyAssignment(prop) &&
        ((ts.isIdentifier(prop.initializer) && prop.initializer.text === fn) ||
          callsIn(prop).has(fn));
      if (!prop) problems.push(`spec ${i + 1}: no \`${name}\``);
      else if (!uses)
        problems.push(`spec ${i + 1}: \`${name}\` does not use ${fn}`);
      if (!imported.has(fn))
        problems.push(`${fn} not imported from ${FIXTURES}`);
    }
  });
  return [...new Set(problems)];
}

describe("worker-prove-tools: the word-to-pdf proof reads the fonts", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("sends the font proof DOCX and judges the PDF by its embedded faces", () => {
    expect(wordProofProblems(source)).toEqual([]);
  });

  it("POSITIVE CONTROL: the spec as it shipped — one unstyled line, any %PDF- — fails", () => {
    const shipped = `
      const SPECS = [
        {
          tool: "word-to-pdf",
          make: docxFile,
          name: "letter.docx",
          type: DOCX_MIME,
          expect: isPdf,
          want: "PDF",
        },
      ];`;
    expect(wordProofProblems(shipped)).toEqual([
      "spec 1: `make` does not use officeFontProofDocx",
      `officeFontProofDocx not imported from ${FIXTURES}`,
      "spec 1: no `verify`",
      `officeFontProofVerdict not imported from ${FIXTURES}`,
    ]);
    // A verdict named only in a comment is not a call.
    const commented = source.replace(
      /verify: \(bytes\) => officeFontProofVerdict\(bytes\),/,
      "// verify: (bytes) => officeFontProofVerdict(bytes),",
    );
    expect(commented).not.toBe(source);
    expect(wordProofProblems(commented)).toEqual(["spec 1: no `verify`"]);
    expect(wordProofProblems("const SPECS = [];")).toEqual([
      "no word-to-pdf spec",
    ]);
    // A round trip (`from` another artifact) is not taken for the font
    // proof, and must judge what comes back; alone it is no font proof.
    const trip = `{ tool: "word-to-pdf", from: "docx-from-pdf", expect: isPdf }`;
    expect(wordProofProblems(`const SPECS = [${trip}];`)).toEqual([
      "no word-to-pdf spec",
    ]);
    const tripped = source.replace(
      /verify: \(bytes\) => docxRoundTripVerdict\(bytes\),/,
      "",
    );
    expect(tripped).not.toBe(source);
    expect(wordProofProblems(tripped)).toEqual([
      "spec 2: a round trip with no `verify`",
    ]);
  });
});
