// @vitest-environment node
/**
 * The in-image PDF to Word pictures proof runs, from the workflow to the
 * call — walked through the chain it actually runs on, not searched for by
 * words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:docx-pictures-proof` → `package.json` maps that script to a file
 *   → that file calls `runDocxPicturesProof` with the worker's OWN deps
 *   (`pdfOfficeExportDeps`) and the LibreOffice runner Word to PDF uses
 *   (`nativeOfficeConversionDeps(…).libreoffice`), over every committed
 *   fixture, with both controls and the damaged fixture.
 *
 * Why it matters: the unit suites stand poppler in, and no vitest suite runs
 * in the image. This step is the ONE place in CI where PDF to Word's text
 * (poppler) and pictures (pdf.js) meet, and where a word processor lays the
 * .docx out; a proof that silently stopped running would leave that seam
 * untested everywhere, behind a green suite.
 *
 * And the production proof asks the deployed worker the same question:
 * its pdf-to-word spec sends the Word proof PDF and judges the picture, and
 * the round trip through Word to PDF is judged by the round-trip verdict.
 *
 * An AST and not `toContain`, as in `worker-pptx-fidelity-proof.test.ts`:
 * a guard that matches prose stays green while the step runs something
 * else. Comments are not nodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { REDO_OCR_LAYER_OUTCOMES } from "@/lib/jobs/ocr";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:docx-pictures-proof";

function walk(node: TS.Node, visit: (n: TS.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** Named value imports of a file: local name → module specifier. */
function importsOf(file: TS.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || stmt.importClause?.isTypeOnly)
      continue;
    const from = (stmt.moduleSpecifier as TS.StringLiteral).text;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const el of bindings.elements)
        if (!el.isTypeOnly) out.set(el.name.text, from);
  }
  return out;
}

function initializerOf(
  file: TS.SourceFile,
  name: string,
): TS.Expression | undefined {
  let found: TS.Expression | undefined;
  walk(file, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer
    )
      found = n.initializer;
  });
  return found;
}

const calleeName = (e: TS.Expression | undefined): string | undefined =>
  e && ts.isCallExpression(e) && ts.isIdentifier(e.expression)
    ? e.expression.text
    : undefined;

/** Executable `run:` lines of the container workflow (comments dropped). */
const runLines = read(".github/workflows/container.yml")
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n")
  .split(/\n(?=\s*- name:)/)
  .flatMap((step) => {
    const m = /\brun:\s*([^\n]+)/.exec(step);
    return m ? [m[1]!.trim()] : [];
  });

describe("the in-image PDF to Word pictures proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(
      runLines.some((l) => /pnpm worker:pptx-fidelity-proof$/.test(l)),
    ).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step, `no container.yml step runs ${SCRIPT}`).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
    expect(read(".github/workflows/container.yml")).toMatch(
      /target:\s*worker\s*\n\s*tags:\s*pdfxyz-worker:ci/,
    );
  });

  it("package.json points it at a file that calls the proof on the worker's own deps and LibreOffice", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const target = /^tsx (\S+\.ts)$/.exec(pkg.scripts[SCRIPT] ?? "")?.[1];
    expect(target, `${SCRIPT} must run a .ts file with tsx`).toBeDefined();
    expect(existsSync(path.join(ROOT, target!))).toBe(true);
    const file = ts.createSourceFile(
      target!,
      read(target!),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = importsOf(file);
    expect(imports.get("runDocxPicturesProof")).toBe(
      "@/lib/workers/pdf-office-export/docx-pictures-proof",
    );
    expect(imports.get("pdfOfficeExportDeps")).toBe(
      "@/lib/workers/pdf-office-export/native",
    );
    expect(imports.get("nativeOfficeConversionDeps")).toBe(
      "@/lib/workers/office-conversion/native",
    );
    expect(imports.get("DOCX_PICTURE_FIXTURES")).toBe(
      "@/tests/docx-picture-fixtures",
    );
    expect(imports.get("docxTextOnly20261017")).toBe(
      "@/tests/docx-text-only-2026-10-17",
    );
    expect(imports.get("junkAfterEofPdf")).toBe(
      "@/tests/pptx-fidelity-fixtures",
    );

    const calls: TS.CallExpression[] = [];
    walk(file, (n) => {
      if (ts.isCallExpression(n) && calleeName(n) === "runDocxPicturesProof")
        calls.push(n);
    });
    expect(calls).toHaveLength(1);
    const arg = calls[0]!.arguments[0];
    expect(arg && ts.isObjectLiteralExpression(arg)).toBe(true);
    const props = new Map(
      (arg as TS.ObjectLiteralExpression).properties.map((p) => [
        p.name?.getText(file) ?? "",
        p,
      ]),
    );
    for (const key of [
      "exportDeps",
      "toPdf",
      "fixtures",
      "damaged",
      "textOnlyDocx",
      "dropOnePicture",
    ])
      expect(props.has(key), `runDocxPicturesProof is not given ${key}`).toBe(
        true,
      );
    // The worker's own deps, from the image's environment.
    expect(calleeName(initializerOf(file, "exportDeps"))).toBe(
      "pdfOfficeExportDeps",
    );
    const lo = initializerOf(file, "libreoffice");
    expect(
      lo &&
        ts.isPropertyAccessExpression(lo) &&
        lo.name.text === "libreoffice" &&
        calleeName(lo.expression),
    ).toBe("nativeOfficeConversionDeps");
    expect(props.get("toPdf")!.getText(file)).toMatch(
      /libreoffice\.convertToPdf\(/,
    );
    // Every fixture, derived from the list; the damaged one a committed
    // fixture, damaged; and no poppler, page reader or qpdf, no conclusion.
    expect(file.getFullText()).toMatch(/DOCX_PICTURE_FIXTURES\.map\(/);
    expect(props.get("damaged")!.getText(file)).toMatch(/junkAfterEofPdf\(/);
    for (const needed of [
      /!exportDeps\.extractFlow/,
      /!exportDeps\.scanPages/,
      /!exportDeps\.repairPdf/,
      /!libreoffice/,
    ])
      expect(file.getFullText()).toMatch(needed);
  });
});

describe("the production proof asks PDF to Word about its picture, and LibreOffice lays it out", () => {
  const FILE = "scripts/worker-prove-tools.ts";
  const file = ts.createSourceFile(
    FILE,
    read(FILE),
    ts.ScriptTarget.Latest,
    true,
  );
  const specs: TS.ObjectLiteralExpression[] = [];
  walk(file, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === "SPECS" &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    )
      for (const el of n.initializer.elements)
        if (ts.isObjectLiteralExpression(el)) specs.push(el);
  });
  const prop = (node: TS.ObjectLiteralExpression, name: string) =>
    node.properties.find(
      (p): p is TS.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(file) === name,
    );
  const str = (node: TS.ObjectLiteralExpression, name: string) => {
    const p = prop(node, name);
    return p && ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
  };

  it("health check: SPECS was found and is the size it plausibly is", () => {
    expect(specs.length).toBeGreaterThan(15);
    expect(specs.length).toBeLessThan(200);
  });

  // The unlabelled pdf-to-word spec is the pictures proof; since 2026-10-24
  // a second, labelled one proves the OCR option (asserted below), so "the
  // pdf-to-word spec" is the one with no label.
  const picturesSpecs = () =>
    specs.filter(
      (s) => str(s, "tool") === "pdf-to-word" && prop(s, "label") === undefined,
    );

  it("the OCR spec sends a real scan with OCR on and reads the scan's words back as text", () => {
    const ocr = specs.filter((s) => str(s, "label") === "pdf-to-word (ocr)");
    expect(ocr).toHaveLength(1);
    const spec = ocr[0]!;
    expect(str(spec, "tool")).toBe("pdf-to-word");
    expect(prop(spec, "make")?.initializer.getText(file)).toMatch(
      /^scannedTextPdf$/,
    );
    expect(prop(spec, "options")?.initializer.getText(file)).toMatch(
      /\bocr:\s*true\b/,
    );
    expect(prop(spec, "verify")?.initializer.getText(file)).toMatch(
      /\bscannedDocxVerdict\(/,
    );
    for (const name of ["scannedDocxVerdict", "scannedTextPdf"])
      expect(importsOf(file).get(name)).toBe("@/tests/word-ocr-proof-fixtures");
    // Control: every pdf-to-word spec is the pictures one, this, or one of
    // the OCR page-choice proofs (asserted below). Until 2026-11-08 it was
    // "the pictures one or this"; wave 3 added Turn pages upright,
    // Straighten and Redo existing OCR, each an ON/OFF pair.
    expect(specs.filter((s) => str(s, "tool") === "pdf-to-word").length).toBe(
      picturesSpecs().length +
        ocr.length +
        pageChoiceSpecs().length +
        redoLayerSpecs().length,
    );
  });

  // Wave 3 (audit pdf-to-word#3): each OCR page choice is proven by an ON
  // spec and its OFF control, judged by `ocr-first-proof.ts` on the DOCX.
  const pageChoiceSpecs = () =>
    specs.filter(
      (s) =>
        str(s, "tool") === "pdf-to-word" &&
        /^pdf-to-word \(ocr, (upright|deskew|redo)( off control)?\)$/.test(
          str(s, "label") ?? "",
        ),
    );

  // 2026-11-08 (#290): Redo against OCRmyPDF's OWN layer, which OCRmyPDF 14
  // keeps on its own; then (the worker's pre-pass, same day) also against
  // the mode-before-text shape. Each want is read from
  // REDO_OCR_LAYER_OUTCOMES (asserted below). Found by label PREFIX, so a
  // new shape's case is counted without being named here.
  const REDO_LAYER_PREFIX = "pdf-to-word (ocr, redo, ";
  const redoLayerSpecs = () =>
    specs.filter((s) => str(s, "label")?.startsWith(REDO_LAYER_PREFIX));

  it("each OCR page choice has an ON spec and an OFF control, judged on the DOCX by the shared verdict", () => {
    // [tag, option, verdict, ON want, OFF want, the fixture both send].
    // The fixture is pinned as a RELATIONSHIP where one exists: the OCR PDF
    // proof of the same flag sends it, and that proof is what showed the
    // fixture exercises the flag. Redo has no OCR PDF twin, so its fixture
    // is pinned by text: without the stale layer, 'replaced' passes on any
    // worker that runs OCR at all.
    const choices = [
      [
        "upright",
        "rotatePages",
        "uprightDocxVerdict",
        "read",
        "unread",
        "ocr-pdf (upright)",
      ],
      [
        "deskew",
        "deskew",
        "deskewDocxVerdict",
        "straight",
        "crooked",
        "ocr-pdf (deskew)",
      ],
      ["redo", "redoOcr", "redoDocxVerdict", "replaced", "kept", null],
    ] as const;
    const makeOf = (s: TS.ObjectLiteralExpression) =>
      prop(s, "make")?.initializer.getText(file).replace(/\s+/g, " ");
    // The string literals a verify passes, in order: exactly [want].
    const literalsOf = (s: TS.ObjectLiteralExpression) => {
      const out: string[] = [];
      const walk = (n: TS.Node) => {
        if (ts.isStringLiteral(n)) out.push(n.text);
        ts.forEachChild(n, walk);
      };
      const init = prop(s, "verify")?.initializer;
      if (init) walk(init);
      return out;
    };
    // Health: the set is the six it claims, so "each" below is not vacuous.
    expect(pageChoiceSpecs()).toHaveLength(choices.length * 2);
    for (const [tag, option, verdict, onWant, offWant, twin] of choices) {
      const fixture =
        twin === null
          ? // CHANGED 2026-11-08 (#290): the first fixture set `3 Tr` before
            // its BT, a layer OCRmyPDF 14 does not strip, so the ON case
            // failed on a correct product. Now the shape Tesseract writes.
            'async () => withStaleOcrLayer(await scannedTextPdf(), "tesseract")'
          : makeOf(specs.find((s) => str(s, "label") === twin)!);
      // Positive control for the twin lookup: it names a real fixture.
      expect(fixture, tag).toMatch(/^(upsideDownScan|crookedScan|async )/);
      for (const [suffix, value, want] of [
        ["", "true", onWant],
        [" off control", "false", offWant],
      ] as const) {
        const label = `pdf-to-word (ocr, ${tag}${suffix})`;
        const found = specs.filter((s) => str(s, "label") === label);
        expect(found, label).toHaveLength(1);
        const options = prop(found[0]!, "options")?.initializer.getText(file);
        expect(options, label).toMatch(/\bocr:\s*true\b/);
        expect(options, label).toMatch(
          new RegExp(`\\b${option}:\\s*${value}\\b`),
        );
        expect(
          prop(found[0]!, "verify")?.initializer.getText(file),
          label,
        ).toMatch(new RegExp(`\\b${verdict}\\(`));
        // Redo's ON want is read from the outcome table, not typed: the
        // verify passes redoWant(REDO_OCR_LAYER_OUTCOMES.tesseract), and the
        // table's row is what makes that "replaced" today.
        if (tag === "redo" && suffix === "") {
          expect(
            prop(found[0]!, "verify")?.initializer.getText(file),
            label,
          ).toMatch(/\bredoWant\(REDO_OCR_LAYER_OUTCOMES\.tesseract\)/);
          expect(REDO_OCR_LAYER_OUTCOMES.tesseract).toBe(want);
        } else {
          expect(literalsOf(found[0]!), label).toEqual([want]);
        }
        expect(makeOf(found[0]!), label).toBe(fixture);
      }
      expect(importsOf(file).get(verdict)).toBe(
        "@/lib/workers/pdf-office-export/ocr-first-proof",
      );
    }
    expect(importsOf(file).get("withStaleOcrLayer")).toBe(
      "@/lib/workers/ocr-redo-proof",
    );
  });

  it("Redo is proven against every other layer shape, each with the want its own table row gives", () => {
    const found = redoLayerSpecs();
    // Every shape of the table but `tesseract` (the ON/OFF pair above), once.
    const others = Object.keys(REDO_OCR_LAYER_OUTCOMES).filter(
      (s) => s !== "tesseract",
    );
    expect(found).toHaveLength(others.length);
    const shapes = found.map((spec) => {
      const make = prop(spec, "make")?.initializer.getText(file) ?? "";
      const shape =
        /withStaleOcrLayer\(\s*await scannedTextPdf\(\),\s*"([^"]+)",?\s*\)/.exec(
          make,
        )?.[1];
      expect(shape, make).toBeDefined();
      const options = prop(spec, "options")?.initializer.getText(file);
      expect(options).toMatch(/\bocr:\s*true\b/);
      expect(options).toMatch(/\bredoOcr:\s*true\b/);
      // The verdict and the want line read the SAME row as the fixture's shape.
      const row = shape === "ocrmypdf" ? "\\.ocrmypdf" : `\\["${shape}"\\]`;
      expect(prop(spec, "verify")?.initializer.getText(file)).toMatch(
        new RegExp(
          `\\bredoDocxVerdict\\([\\s\\S]*redoWant\\(REDO_OCR_LAYER_OUTCOMES${row}\\)`,
        ),
      );
      expect(prop(spec, "want")?.initializer.getText(file)).toMatch(
        new RegExp(`^redoWantText\\(REDO_OCR_LAYER_OUTCOMES${row}\\)$`),
      );
      return shape;
    });
    expect(shapes.sort()).toEqual([...others].sort());
    // INVERTED 2026-11-08: this asserted `ocrmypdf` was "kept", so the DOCX
    // had to hold the new words BESIDE the old. The worker's pre-pass
    // removes every shape, so every case now wants "replaced".
    for (const shape of others)
      expect(
        REDO_OCR_LAYER_OUTCOMES[shape as keyof typeof REDO_OCR_LAYER_OUTCOMES],
        shape,
      ).toBe("replaced");
  });

  // Review 2026-11-08: every Redo case went through pdf-to-word; none
  // through OCR PDF, though redoing an OCR PDF output in OCR PDF is the
  // most direct path the copy describes.
  it("OCR PDF proves Redo on OCRmyPDF's own layer, judged on the PDF's text by the same table row", () => {
    const found = specs.filter((s) =>
      str(s, "label")?.startsWith("ocr-pdf (redo"),
    );
    expect(found).toHaveLength(1);
    const spec = found[0]!;
    expect(str(spec, "tool")).toBe("ocr-pdf");
    expect(prop(spec, "make")?.initializer.getText(file)).toMatch(
      /^async \(\) => withStaleOcrLayer\(await scannedTextPdf\(\), "ocrmypdf"\)$/,
    );
    const options = prop(spec, "options")?.initializer.getText(file);
    expect(options).toMatch(/\bredoOcr:\s*true\b/);
    expect(options).toMatch(/\boutputMode:\s*"searchable-pdf"/);
    // The PDF's own text (every layer a reader gets), not a sidecar.
    expect(
      prop(spec, "verify")?.initializer.getText(file).replace(/\s+/g, " "),
    ).toMatch(
      /\bredoTextVerdict\( await pdfPlainText\(bytes\), SCANNED_LINE, redoTextWant\(REDO_OCR_LAYER_OUTCOMES\.ocrmypdf\),? \)/,
    );
    expect(prop(spec, "artifact")).toBeUndefined();
    expect(prop(spec, "want")?.initializer.getText(file)).toBe(
      "redoPdfWantText(REDO_OCR_LAYER_OUTCOMES.ocrmypdf)",
    );
    expect(importsOf(file).get("redoTextVerdict")).toBe(
      "@/lib/workers/ocr-redo-proof",
    );
    expect(REDO_OCR_LAYER_OUTCOMES.ocrmypdf).toBe("replaced");
  });

  it("the pdf-to-word spec sends the Word proof PDF and verifies the picture", () => {
    const mine = picturesSpecs();
    expect(mine).toHaveLength(1);
    const spec = mine[0]!;
    expect(prop(spec, "make")?.initializer.getText(file)).toMatch(
      /\bdocxProofPdf\(\)/,
    );
    expect(prop(spec, "verify")?.initializer.getText(file)).toMatch(
      /\bdocxDeploymentVerdict\(/,
    );
    for (const name of ["docxDeploymentVerdict", "docxProofPdf"])
      expect(importsOf(file).get(name)).toBe(
        "@/lib/workers/pdf-office-export/deployment-proof",
      );
  });

  it("the .docx it returns is laid out by Word to PDF, and judged by the round-trip verdict", () => {
    const keptAs = picturesSpecs().map((s) => str(s, "keepArtifactAs"));
    expect(keptAs).toHaveLength(1);
    expect(keptAs[0]).toBeTruthy();
    const trips = specs.filter((s) => str(s, "from") === keptAs[0]);
    expect(trips).toHaveLength(1);
    expect(str(trips[0]!, "tool")).toBe("word-to-pdf");
    expect(prop(trips[0]!, "verify")?.initializer.getText(file)).toMatch(
      /\bdocxRoundTripVerdict\(/,
    );
    expect(importsOf(file).get("docxRoundTripVerdict")).toBe(
      "@/lib/workers/pdf-office-export/deployment-proof",
    );
  });
});
