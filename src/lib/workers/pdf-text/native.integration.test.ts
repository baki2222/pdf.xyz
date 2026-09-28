// @vitest-environment node
//
// The pdftotext runner against the ACTUAL poppler binary, with the production
// argv (including `-q`) and the production exec. It proves the two facts the
// open-failure classification rests on, which a mocked exec can only assume:
//
//  - poppler exits 1 on a PDF that needs a password, and on a file that is not
//    a PDF, and prints nothing either way under `-q`;
//  - a PDF with only an OWNER password (it opens in every viewer) still
//    extracts. That is why the classification runs only after a failure: an
//    `/Encrypt` preflight would refuse this file, which works today.
//
// It needs POPPLER's pdftotext, which the worker image installs. xpdf ships a
// binary with the same name (Git for Windows puts one first on PATH) that has
// no `-bbox-layout` and exits 99 on it, so the suite looks for the binary
// whose banner names Poppler rather than trusting the first `pdftotext`.
// When there is none (CI's unit job has no poppler), the suite SKIPS rather
// than claim a proof it did not run.
// `open-failure.chain.test.ts` covers the path from the exit code onwards on
// every machine.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PDF_NEEDS_PASSWORD_MESSAGE } from "@/lib/pdf/encryption";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";
import { runPdfOfficeExport } from "../pdf-office-export/engine";
import { PdfTextOpenError } from "./errors";
import {
  createNativePdfLayoutExtractor,
  createNativePdfTextExtractor,
} from "./native";
import { resolveNativePdfTextConfig } from "./native-config";

/** The first `pdftotext` on PATH whose version banner says it is Poppler's. */
function popplerPdfToText(): string | null {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE").split(";")
      : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = dir && path.join(dir, `pdftotext${ext}`);
      if (!candidate || !existsSync(candidate)) continue;
      // The banner goes to stderr, and `-v` exits non-zero on some builds.
      const run = spawnSync(candidate, ["-v"], { encoding: "utf8" });
      if (/poppler/i.test(`${run.stdout ?? ""}${run.stderr ?? ""}`))
        return candidate;
    }
  }
  return null;
}

const POPPLER = popplerPdfToText();
const suite = POPPLER ? describe : describe.skip;

async function textPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 200]).drawText(text, { x: 40, y: 120, size: 14, font });
  return doc.save();
}

suite("pdftotext runner (real binary)", () => {
  const config = resolveNativePdfTextConfig({});
  const extract = createNativePdfTextExtractor(POPPLER!, config, "keep");
  const layout = createNativePdfLayoutExtractor(POPPLER!, config);

  it("positive control: a real text PDF extracts its words", async () => {
    const result = await extract(await textPdf("Quarterly totals 2026"));
    expect(result.text).toContain("Quarterly totals 2026");
  });

  it("a user-password PDF is refused as needing a password", async () => {
    const err = await extract(userPasswordEncryptedPdf()).catch((e) => e);
    expect(err).toBeInstanceOf(PdfTextOpenError);
    expect((err as PdfTextOpenError).reason).toBe("needs-password");
    expect((err as Error).message).toBe(PDF_NEEDS_PASSWORD_MESSAGE);
    // The bbox mode (Extract tables) fails the same way.
    const viaLayout = await layout(userPasswordEncryptedPdf()).catch((e) => e);
    expect((viaLayout as PdfTextOpenError).reason).toBe("needs-password");
  });

  it("an owner-only PDF still opens: no password is asked for", async () => {
    const result = await extract(ownerOnlyEncryptedPdf());
    // The fixture has no content stream, so no text, but it OPENED.
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    const run = await runPdfOfficeExport(
      "pdf-to-word",
      ownerOnlyEncryptedPdf(),
      { extract },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("no_text");
  });

  it("a file that is not a PDF is refused as unreadable, not as locked", async () => {
    const err = await extract(new TextEncoder().encode("garbage")).catch(
      (e) => e,
    );
    expect((err as PdfTextOpenError).reason).toBe("unreadable");
    expect((err as Error).message).toBe(UNREADABLE_PDF_MESSAGE);
  });
});
