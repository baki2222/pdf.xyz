// @vitest-environment node
/**
 * Extract Tables through a REAL poppler `pdftotext`, with the production deps
 * builder, read back from the ZIP a user downloads.
 *
 * The unit tests beside this one run the detector over captured poppler
 * output. A capture is a point in time; this runs the generated fixtures
 * through whatever poppler is installed, then through `runTableExtract`, the
 * ZIP writer and an RFC-4180 reader that shares no code with that writer. The
 * production worker runs a different poppler from a dev laptop; run
 * `pnpm worker:prove-tools extract-tables` against a deployment for that one.
 *
 * Skips VISIBLY when no poppler is installed (the suite name says so): Git for
 * Windows puts Xpdf's `pdftotext` first on PATH, and a run against that would
 * fail, or pass, for reasons that say nothing about the worker.
 */
import { describe, expect, it } from "vitest";
import * as officeFixtures from "@/tests/pdf-office-fixtures";
import { findPopplerPdfToText } from "@/tests/pdf-office-fixtures";
import {
  OFFICE_FIXTURE_TABLES,
  reportTablesPdf,
  TABLE_EXTRACT_FIXTURES,
  tablesProofVerdict,
  tablesZipMismatches,
} from "@/tests/table-extract-fixtures";
import { nativeTableExtractDeps } from "../pdf-text/native";
import { runTableExtract, type TableExtractDeps } from "./engine";
import { createTableExtractProcessor } from "../processor/table-extract";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";

const POPPLER = findPopplerPdfToText();
const suite = describe.skipIf(!POPPLER);
const label = POPPLER
  ? "Extract Tables on real poppler"
  : "Extract Tables on real poppler (SKIPPED: no poppler pdftotext found on PATH)";

/** The production deps builder, pointed at the poppler we found. */
function deps(): TableExtractDeps {
  return nativeTableExtractDeps(
    { PDFXYZ_PDF_TEXT_BIN: POPPLER! },
    { resolveOnPath: () => true },
  );
}

suite(label, () => {
  it("every fixture PDF comes back as exactly its tables, or as no_tables", async () => {
    // Discovered, not named: every table fixture with its answer, and every
    // zero-argument `*Pdf` builder of the PDF to Office fixtures — prose,
    // justified prose, lists side by side, two columns, a single row — whose
    // answer is its tables where it draws any, and no_tables everywhere else.
    const office = Object.entries(officeFixtures as Record<string, unknown>)
      .filter(
        (entry): entry is [string, () => Promise<Uint8Array>] =>
          entry[0].endsWith("Pdf") &&
          typeof entry[1] === "function" &&
          entry[1].length === 0,
      )
      .map(([name, build]) => ({
        name,
        build,
        tables: OFFICE_FIXTURE_TABLES[name] ?? [],
      }));
    const cases = [
      ...Object.entries(TABLE_EXTRACT_FIXTURES).map(([name, f]) => ({
        name,
        ...f,
      })),
      ...office,
    ];
    expect(cases.length).toBeGreaterThanOrEqual(18);
    expect(cases.filter((c) => c.tables.length === 0).length).toBeGreaterThan(
      6,
    );

    for (const { name, build, tables } of cases) {
      const run = await runTableExtract(await build(), deps());
      if (tables.length === 0) {
        expect(run.ok ? "a ZIP" : run.kind, name).toBe("no_tables");
        continue;
      }
      if (!run.ok) throw new Error(`${name}: extract-tables ${run.kind}`);
      expect(run.meta.tableCount, name).toBe(tables.length);
      expect(await tablesZipMismatches(run.output, tables), name).toEqual([]);
    }
  });

  it("the deployment proof's own verdict passes the proof fixture here", async () => {
    // The exact function `scripts/worker-prove-tools.ts` calls on the ZIP a
    // deployment returns, on the ZIP this poppler produces for the same PDF.
    const run = await runTableExtract(await reportTablesPdf(), deps());
    if (!run.ok) throw new Error(`extract-tables ${run.kind}`);
    expect(await tablesProofVerdict(run.output)).toEqual({
      ok: true,
      detail: "2 table(s), 4x4 + 4x3, every cell matches",
    });
  });
  it("names a user-password PDF as password-protected through the processor: final, and linked to Unlock", async () => {
    // The composed chain the executor sees: real poppler refuses the file,
    // the engine asks the bytes why, the processor decides whether to retry.
    const locked = officeFixtures.rc4EncryptedPdf({
      userPassword: "s3cret",
      ownerPassword: "owner",
    });
    const result = await createTableExtractProcessor(deps()).process({
      tool: "extract-tables",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "statement.pdf",
          contentType: "application/pdf",
          bytes: locked,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
        retryable: false,
      });
  });

  it("POSITIVE CONTROL: an owner-password-only PDF is encrypted AND still reads — never called locked", async () => {
    const ownerOnly = officeFixtures.rc4EncryptedPdf({
      userPassword: "",
      ownerPassword: "owner",
      text: "Owner locked but readable",
    });
    const run = await runTableExtract(ownerOnly, deps());
    // One line of prose: no table, but it OPENED.
    expect(run.ok ? "a ZIP" : run.kind).toBe("no_tables");
  });
});
