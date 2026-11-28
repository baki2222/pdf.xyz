/**
 * `pnpm worker:office-input-proof` — OpenDocument and RTF input, inside the
 * built worker image: an .odt and an .rtf through Word to PDF, an .ods
 * through Excel to PDF and an .odp through PowerPoint to PDF, each through
 * the real engine (`runOfficeToPdf`, its content check included) and the real
 * LibreOffice runner, and each PDF read by the image's own pdftotext for its
 * pages and its distinctive word. An OpenDocument spreadsheet named .odt, and
 * random bytes named .rtf, must be refused before LibreOffice runs. And the
 * files this image's LibreOffice locked with a password
 * (`src/tests/odf-locked-fixtures/`) must be named password-protected before
 * it runs, while LibreOffice handed them directly makes no PDF. And a CSV
 * per Delimiter and Character set choice (competitor audit #18), each read
 * right with its choice and wrong with the choice a reader would otherwise
 * get. And value-rich CSVs, converted with Auto and with no import options,
 * must print the same values. And CSVs named with a Cyrillic, a Bengali and
 * a CJK stem must print that stem in the page header and never "input",
 * beside a control named input.csv that must print "input". See
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
import {
  OFFICE_INPUT_FIXTURES,
  odsWith,
  wideSheetCsv,
  wideSheetOds,
} from "@/tests/office-input-fixtures";
import {
  EXCEL_TO_PDF_TOOL,
  runOfficeToPdf,
} from "@/lib/workers/office-conversion/engine";
import { sheetLayoutProofVerdict } from "@/lib/workers/office-conversion/sheet-layout-proof";
import { lockedOdfFixtures } from "@/tests/locked-odf";
import {
  CSV_CHARSET_CASES,
  CSV_CHOICE_CASES,
  CSV_DEFAULT_CASES,
  CSV_FILE_NAME_CASES,
} from "@/tests/csv-charset-fixtures";

async function main(): Promise<number> {
  const libreoffice = nativeOfficeConversionDeps(process.env).libreoffice;
  // The same runner, importing every file with NO options: the baseline the
  // CSV default-import check compares Auto's output against.
  const libreofficeNoOptions = nativeOfficeConversionDeps(process.env, {
    importFilter: () => null,
  }).libreoffice;
  const extract = pdfOfficeExportDeps(process.env).extract;
  if (!libreoffice || !libreofficeNoOptions || !extract) {
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
    ...lockedOdfFixtures(),
    csv: CSV_CHARSET_CASES,
    csvChoices: CSV_CHOICE_CASES,
    libreofficeNoOptions,
    csvDefaults: CSV_DEFAULT_CASES,
    csvFileNames: CSV_FILE_NAME_CASES,
  });
  for (const line of result.lines) console.log(line);
  // Audit wave 2 excel-to-pdf#1: Landscape and fit on a .csv and an .ods,
  // each saved as .xlsx by this image's LibreOffice first, judged on the
  // PDF by the same verdict the production .xlsx proof uses.
  let layoutOk = true;
  for (const [name, bytes] of [
    ["wide.csv", wideSheetCsv()],
    ["wide.ods", await wideSheetOds()],
  ] as const) {
    const run = await runOfficeToPdf(
      EXCEL_TO_PDF_TOOL,
      bytes,
      name,
      { libreoffice },
      undefined,
      {
        onePagePerSheet: false,
        orientation: "landscape",
        fitColumnsToWidth: true,
      },
    );
    if (!run.ok) {
      console.log(`page setup (${name}): FAIL — ${run.kind}: ${run.message}`);
      layoutOk = false;
      continue;
    }
    const text = await extract(run.output);
    const verdict = await sheetLayoutProofVerdict(
      run.output,
      text.pages.map((p) => p.text),
    );
    console.log(
      `page setup (${name}): ${verdict.ok ? "ok" : "FAIL"} — ${verdict.detail}`,
    );
    layoutOk &&= verdict.ok;
  }
  const ok = result.ok && layoutOk;
  console.log(ok ? "PROVEN" : "FAIL");
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`FAIL — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
