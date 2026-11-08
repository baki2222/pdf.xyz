// @vitest-environment node
/**
 * The deployment proof for Extract Tables must read the CELLS it gets back.
 *
 * Until 2026-09-27 `scripts/worker-prove-tools.ts` proved extract-tables with
 * `expect: isZipContainer` alone — a `PK` at byte 0 — while the engine
 * returned the proof fixture's title as a data row and an empty column in
 * every row; the ledger recorded the tool as proven. The verdict that reads
 * the cells (`tablesProofVerdict`) is tested beside the engine, and on real
 * poppler; this pins that the proof CALLS it, on the fixture whose answer it
 * holds. The script runs on import, so it is read as source, through the
 * TypeScript parser — the spec object itself, not a string that could sit in
 * a comment.
 *
 * Since 2026-11-08 the rule binds the UNLABELLED extract-tables spec (the
 * report proof) only: the wave-3 cases (`./options-proof`) each send their
 * own fixture, and the second describe holds every one of them to its
 * fixture and its verdict the same way.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/worker-prove-tools.ts", import.meta.url),
);
const FIXTURES = "@/tests/table-extract-fixtures";

/** Identifiers a node calls, anywhere inside it. */
function calls(node: TS.Node): Set<string> {
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
 * What is wrong with the extract-tables proof spec in `source`: every spec
 * object literal whose `tool` is "extract-tables" must build its input with
 * `reportTablesPdf` and judge its output with `tablesProofVerdict`, both
 * imported from the fixtures module that holds the report's answer.
 */
function proofSpecProblems(source: string): string[] {
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
          p.initializer.text === "extract-tables",
      ) &&
      // The labelled wave-3 cases send their own fixtures and are held by
      // the test below; this guard is about the report proof, which has none.
      !n.properties.some((p) => p.name?.getText(file) === "label")
    )
      specs.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);

  if (specs.length === 0) return ["no extract-tables spec"];
  const problems: string[] = [];
  const property = (spec: TS.ObjectLiteralExpression, name: string) =>
    spec.properties.find((p) => p.name?.getText(file) === name);
  specs.forEach((spec, i) => {
    for (const [name, fn] of [
      ["make", "reportTablesPdf"],
      ["verify", "tablesProofVerdict"],
    ] as const) {
      const prop = property(spec, name);
      if (!prop) problems.push(`spec ${i + 1}: no \`${name}\``);
      else if (!calls(prop).has(fn))
        problems.push(`spec ${i + 1}: \`${name}\` does not call ${fn}`);
      if (!imported.has(fn))
        problems.push(`${fn} not imported from ${FIXTURES}`);
    }
  });
  return [...new Set(problems)];
}

describe("worker-prove-tools: the extract-tables proof reads the cells", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("builds the report fixture and judges the ZIP with its answer", () => {
    expect(proofSpecProblems(source)).toEqual([]);
  });

  it("POSITIVE CONTROL: the spec as it shipped — a PK check on tablePdf — fails", () => {
    const shipped = `
      import JSZip from "jszip";
      const SPECS = [
        {
          tool: "extract-tables",
          make: tablePdf,
          name: "table.pdf",
          type: PDF_MIME,
          expect: isZipContainer,
          want: "ZIP of CSV+XLSX",
        },
      ];`;
    expect(proofSpecProblems(shipped)).toEqual([
      "spec 1: `make` does not call reportTablesPdf",
      `reportTablesPdf not imported from ${FIXTURES}`,
      "spec 1: no `verify`",
      `tablesProofVerdict not imported from ${FIXTURES}`,
    ]);
    // A verdict named only in a comment is not a call.
    const commented = source.replace(
      /verify: \(bytes\) => tablesProofVerdict\(bytes\),/,
      "// verify: (bytes) => tablesProofVerdict(bytes),",
    );
    expect(commented).not.toBe(source);
    expect(proofSpecProblems(commented)).toEqual(["spec 1: no `verify`"]);
    expect(proofSpecProblems("const SPECS = [];")).toEqual([
      "no extract-tables spec",
    ]);
  });
});

/**
 * Every labelled Extract Tables and PDF to Excel spec (the wave-3 cases),
 * found by walking the script — not by name — and held, both ways, to the
 * table below: the fixture its `make` calls, and the verdict its `verify`
 * calls or the refusal its `expectFailure` names. A labelled spec missing
 * from the table is a case nothing here checks; a row with no spec is a case
 * the deployment proof lost.
 */
const WAVE3_CASES: Record<string, { make: string; judge: string }> = {
  "extract-tables (ocr, combined)": {
    make: "scannedTablePdf",
    judge: "ocrCombinedVerdict",
  },
  "extract-tables (ocr, page without a table)": {
    make: "scannedTablePdf",
    judge: "ocrPerTableVerdict",
  },
  "extract-tables (ocr off control)": {
    make: "scannedTablePdf",
    judge: "SCAN_WITHOUT_OCR_FAILURE",
  },
  "extract-tables (combine, repeated header)": {
    make: "repeatedHeaderPdf",
    judge: "combinedHeaderVerdict",
  },
  "extract-tables (no tables)": {
    make: "letterPdf",
    judge: "NO_TABLES_FAILURE",
  },
  "extract-tables (defaults, number cells)": {
    make: "numberCellsPdf",
    judge: "defaultsVerdict",
  },
  "pdf-to-excel (ocr, sheet per page)": {
    make: "scannedTablePdf",
    judge: "ocrSheetPerPageVerdict",
  },
  "pdf-to-excel (sheet per page, blank page, number cells)": {
    make: "numberCellsPdf",
    judge: "sheetPerPageVerdict",
  },
  "pdf-to-excel (malformed options refused before ocr)": {
    make: "unsupportedEncryptionPdf",
    judge: "MALFORMED_BAG_FAILURE",
  },
};

/** Identifiers referenced anywhere inside a node (calls and plain names). */
function names(node: TS.Node): Set<string> {
  const out = new Set<string>();
  const walk = (n: TS.Node) => {
    if (ts.isIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

function wave3Problems(source: string): string[] {
  const file = ts.createSourceFile(
    "w.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const found = new Map<string, TS.ObjectLiteralExpression>();
  const problems: string[] = [];
  const str = (spec: TS.ObjectLiteralExpression, key: string) => {
    const p = spec.properties.find(
      (q): q is TS.PropertyAssignment =>
        ts.isPropertyAssignment(q) && q.name.getText(file) === key,
    );
    return p && ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
  };
  const walk = (n: TS.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const tool = str(n, "tool");
      const label = str(n, "label");
      if ((tool === "extract-tables" || tool === "pdf-to-excel") && label) {
        if (found.has(label)) problems.push(`"${label}" appears twice`);
        found.set(label, n);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(file);
  for (const label of found.keys())
    if (!WAVE3_CASES[label]) problems.push(`"${label}" is in no row here`);
  for (const [label, want] of Object.entries(WAVE3_CASES)) {
    const spec = found.get(label);
    if (!spec) {
      problems.push(`"${label}" has no spec`);
      continue;
    }
    const prop = (key: string) =>
      spec.properties.find((p) => p.name?.getText(file) === key);
    const make = prop("make");
    if (!make || !names(make).has(want.make))
      problems.push(`"${label}": \`make\` does not use ${want.make}`);
    const judge = prop("verify") ?? prop("expectFailure");
    if (!judge || !names(judge).has(want.judge))
      problems.push(`"${label}": judged without ${want.judge}`);
  }
  return problems;
}

describe("worker-prove-tools: the wave-3 tables and Excel cases", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("each builds its fixture and is judged by its verdict", () => {
    expect(wave3Problems(source)).toEqual([]);
  });

  it("POSITIVE CONTROL: a verdict swapped, a spec dropped, a stray label — each caught", () => {
    const swapped = source.replace(
      "verify: (bytes, job) => ocrCombinedVerdict(bytes, job.results),",
      "verify: (bytes, job) => ocrPerTableVerdict(bytes, job.results),",
    );
    expect(swapped).not.toBe(source);
    expect(wave3Problems(swapped)).toEqual([
      '"extract-tables (ocr, combined)": judged without ocrCombinedVerdict',
    ]);
    const renamed = source.replace(
      'label: "extract-tables (no tables)"',
      'label: "extract-tables (prose)"',
    );
    expect(renamed).not.toBe(source);
    expect(wave3Problems(renamed)).toEqual([
      '"extract-tables (prose)" is in no row here',
      '"extract-tables (no tables)" has no spec',
    ]);
    expect(wave3Problems("const SPECS = [];")).toHaveLength(
      Object.keys(WAVE3_CASES).length,
    );
  });
});
