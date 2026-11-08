// @vitest-environment node
/**
 * Every Office-to-PDF production proof can fail on a blank PDF.
 *
 * Audit #50 (excel-to-pdf#3, 2026-11-06): the harness's excel-to-pdf (xlsx)
 * and (csv) specs asserted only `isPdf` — five bytes of `%PDF-` — with no
 * `verify` reading the text, so a worker returning an empty page (a
 * LibreOffice regression, a missing font, a mis-decoded CSV) PASSED. ODS,
 * ODT, RTF and DOCX had verdicts; the spreadsheet formats did not. The same
 * walk found powerpoint-to-pdf (pptx) blind too.
 *
 * The harness is found the way a run finds it — package.json's
 * `worker:prove-tools` script → the file — and its specs are read from the
 * AST of the `SPECS` array, not searched for by words. Which specs are Office
 * proofs is derived from OFFICE_TO_PDF_TOOLS, not typed.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { OFFICE_TO_PDF_TOOLS } from "@/lib/workers/office-conversion/tools";
import {
  SHEET_PROOF_CELLS,
  sheetProofVerdict,
} from "@/tests/office-sheet-proof-fixtures";
import { PPTX_PROOF_TITLE, pptxTitleProofVerdict } from "@/tests/pptx-fixture";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};
const harness = /^tsx (\S+\.ts)$/.exec(
  pkg.scripts["worker:prove-tools"] ?? "",
)?.[1];

function specsOf(file: TS.SourceFile): TS.ObjectLiteralExpression[] {
  let found: TS.ArrayLiteralExpression | undefined;
  const visit = (n: TS.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === "SPECS" &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    )
      found = n.initializer;
    n.forEachChild(visit);
  };
  visit(file);
  if (!found) throw new Error("no `SPECS` array literal in the harness");
  return found.elements.filter(ts.isObjectLiteralExpression);
}

function propNames(spec: TS.ObjectLiteralExpression, file: TS.SourceFile) {
  return new Map(
    spec.properties.map((p) => [p.name?.getText(file) ?? "", p] as const),
  );
}

function stringProp(
  props: Map<string, TS.ObjectLiteralElementLike>,
  key: string,
): string | undefined {
  const p = props.get(key);
  return p && ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)
    ? p.initializer.text
    : undefined;
}

describe("every Office-to-PDF production proof reads what came back", () => {
  expect(harness, "worker:prove-tools must run a .ts file with tsx").toBe(
    "scripts/worker-prove-tools.ts",
  );
  const file = ts.createSourceFile(
    harness!,
    read(harness!),
    ts.ScriptTarget.Latest,
    true,
  );
  const specs = specsOf(file);
  const office = specs
    .map((s) => propNames(s, file))
    .filter((p) =>
      (OFFICE_TO_PDF_TOOLS as readonly string[]).includes(
        stringProp(p, "tool") ?? "",
      ),
    );

  it("health check: the AST walk found the harness's specs, and the Office ones", () => {
    expect(specs.length).toBeGreaterThan(40);
    // docx ×2, xlsx, csv, pptx, odt, rtf, ods, odp, and the refusals.
    expect(office.length).toBeGreaterThanOrEqual(9);
    for (const tool of OFFICE_TO_PDF_TOOLS)
      expect(office.some((p) => stringProp(p, "tool") === tool)).toBe(true);
  });

  it("each one either verifies the PDF's content or proves a refusal", () => {
    const blind = office
      .filter(
        // `refusedAtCreate` (2026-11-08): the web tier must refuse the
        // request, so no PDF exists to read; its `expect` is `() => false`.
        (p) =>
          !p.has("verify") &&
          !p.has("expectFailure") &&
          !p.has("refuses") &&
          !p.has("refusedAtCreate"),
      )
      .map(
        (p) =>
          `${stringProp(p, "label") ?? stringProp(p, "tool")} (${stringProp(p, "name")})`,
      );
    expect(blind).toEqual([]);
  });
});

describe("the spreadsheet verdict", () => {
  it("fails a blank PDF's text", () => {
    expect(sheetProofVerdict("", 1).ok).toBe(false);
    expect(sheetProofVerdict(" ", 1).ok).toBe(false);
  });

  it("fails text missing any one cell, and names it", () => {
    for (const cell of SHEET_PROOF_CELLS) {
      const text = SHEET_PROOF_CELLS.filter((c) => c !== cell).join(" ");
      const verdict = sheetProofVerdict(text, 1);
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toContain(cell);
    }
  });

  it("control: passes text holding every cell, including the non-ASCII one", () => {
    expect(SHEET_PROOF_CELLS.some((c) => /[^\x20-\x7e]/.test(c))).toBe(true);
    expect(sheetProofVerdict(SHEET_PROOF_CELLS.join(" "), 1).ok).toBe(true);
    expect(sheetProofVerdict(SHEET_PROOF_CELLS.join(" "), 0).ok).toBe(false);
  });
});

/**
 * The PowerPoint proof's verdict, held like the spreadsheet's: the AST guard
 * above sees only that a `verify` exists, so a verdict that always says ok
 * would satisfy it. These are the bounds on what the verdict itself accepts.
 */
describe("the slide-title verdict", () => {
  const words = PPTX_PROOF_TITLE.split(" ").filter((w) => /\w/.test(w));

  it("fails a blank PDF's text", () => {
    expect(pptxTitleProofVerdict("", 1).ok).toBe(false);
    expect(pptxTitleProofVerdict(" ", 1).ok).toBe(false);
  });

  it("fails text missing any one title word, and names it", () => {
    // Health check: the title has words to drop.
    expect(words.length).toBeGreaterThanOrEqual(3);
    for (const word of words) {
      const text = words.filter((w) => w !== word).join(" ");
      const verdict = pptxTitleProofVerdict(text, 1);
      expect(verdict.ok, word).toBe(false);
      expect(verdict.detail).toContain(word);
    }
  });

  it("control: passes text holding the title, and fails it with no page", () => {
    expect(pptxTitleProofVerdict(PPTX_PROOF_TITLE, 1).ok).toBe(true);
    expect(pptxTitleProofVerdict(words.join("\n"), 2).ok).toBe(true);
    expect(pptxTitleProofVerdict(PPTX_PROOF_TITLE, 0).ok).toBe(false);
  });
});
