import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { attachConsoleGuard, uploadFiles, writeTempPdf } from "./helpers";
import { zipEntries } from "./client-proof/artifacts";

/**
 * Two different PDFs that share a name must come back as two files in the
 * batch ZIP. Until 2026-11-08 they did not: JSZip's `zip.file(name, …)`
 * replaces an entry of the same name, so batch Compress returned ONE file for
 * two scans called scan.pdf (picked from two folders), and the row list still
 * said both were done. The unit tests hold `uniqueEntryNames` and `zipFiles`;
 * this proves the composed path a reader uses: the lazily loaded archive
 * module, the batch view's "Download all" and the bytes that land on disk.
 */
test("batch Compress keeps both files when two share a name", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  // Two folders, one name, different content (3 and 5 pages).
  const first = await writeTempPdf("scan.pdf", 3);
  const second = await writeTempPdf("scan.pdf", 5);
  expect(first).not.toBe(second);

  await page.goto("/tools/compress-pdf");
  await uploadFiles(page, [first, second]);

  await page.getByRole("button", { name: "Compress 2 PDFs" }).click();
  const download = page.getByRole("button", { name: "Download all (2)" });
  await expect(download).toBeVisible({ timeout: 60_000 });

  const [file] = await Promise.all([
    page.waitForEvent("download"),
    download.click(),
  ]);
  expect(file.suggestedFilename()).toBe("pdfxyz-compressed.zip");
  const entries = await zipEntries(readFileSync((await file.path())!));

  // Health check: the archive decoded and holds something.
  expect(entries.size).toBeGreaterThan(0);
  const names = [...entries.keys()].sort();
  expect(names, `entries: ${names.join(", ")}`).toHaveLength(2);
  // The second copy is numbered before its extension; which base name both
  // carry depends on whether the repack made them smaller.
  const [plain, numbered] = names[0]!.includes(" (2)")
    ? [names[1]!, names[0]!]
    : [names[0]!, names[1]!];
  expect(numbered).toBe(plain.replace(/\.pdf$/, " (2).pdf"));
  // Two different documents, not one written twice.
  expect(entries.get(plain)!.equals(entries.get(numbered)!)).toBe(false);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});
