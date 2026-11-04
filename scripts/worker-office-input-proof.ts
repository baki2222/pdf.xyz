/**
 * `pnpm worker:office-input-proof` — OpenDocument and RTF input, inside the
 * built worker image: an .odt and an .rtf through Word to PDF, an .ods
 * through Excel to PDF and an .odp through PowerPoint to PDF, each through
 * the real engine (`runOfficeToPdf`, its content check included) and the real
 * LibreOffice runner, and each PDF read by the image's own pdftotext for its
 * pages and its distinctive word. An OpenDocument spreadsheet named .odt, and
 * random bytes named .rtf, must be refused before LibreOffice runs. See
 * `src/lib/workers/office-conversion/input-proof.ts`.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched, and nothing it prints is document text
 * beyond the fixtures' own proof words.
 */
import { runOfficeInputProof } from "@/lib/workers/office-conversion/input-proof";
import { nativeOfficeConversionDeps } from "@/lib/workers/office-conversion/native";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { OFFICE_INPUT_FIXTURES, odsWith } from "@/tests/office-input-fixtures";

async function main(): Promise<number> {
  const libreoffice = nativeOfficeConversionDeps(process.env).libreoffice;
  const extract = pdfOfficeExportDeps(process.env).extract;
  if (!libreoffice || !extract) {
    console.log(
      `CANNOT CONCLUDE — ${!libreoffice ? "LibreOffice" : "pdftotext"} is not available in this image.`,
    );
    return 2;
  }
  const result = await runOfficeInputProof({
    libreoffice,
    extract: (pdf) => extract(pdf),
    fixtures: OFFICE_INPUT_FIXTURES,
    spreadsheetBytes: await odsWith("Renamed"),
  });
  for (const line of result.lines) console.log(line);
  console.log(result.ok ? "PROVEN" : "FAIL");
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`FAIL — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
