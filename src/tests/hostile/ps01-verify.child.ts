// PS-01 verify child: run ONE entry point on an xref-stream fixture whose /W
// is given on argv, and print the outcome. The parent (a shell `timeout`)
// bounds wall time; a hang shows as no RESULT line.
import { loadPdf } from "../../lib/pdf/engine";
import { countPdfPagesDetailed } from "../../lib/pdf/page-count";
import { probePdf } from "../../lib/pdf/probe";
import { ONE_PAGE, xrefStreamPdf } from "./page-structure.raw";

const [, , entry = "loadPdf", w = "[1 99999999999999999999 2]"] = process.argv;
const bytes = xrefStreamPdf({ objects: ONE_PAGE, w });
const t0 = Date.now();
(async () => {
  console.log(`bytes=${bytes.length} entry=${entry} w=${w}`);
  try {
    let r: unknown;
    if (entry === "loadPdf") r = (await loadPdf(bytes)).getPageCount();
    else if (entry === "count") r = await countPdfPagesDetailed(bytes);
    else if (entry === "probe")
      r = await probePdf(bytes, { maxBytes: 50 * 1024 * 1024 });
    else if (entry === "pdfjs") {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      r = doc.numPages;
    }
    console.log(`RESULT settled ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    console.log(
      `RESULT threw ${(e as Error)?.constructor?.name}: ${(e as Error)?.message?.slice(0, 200)}`,
    );
  }
  console.log(`elapsed=${Date.now() - t0}ms`);
  process.exit(0);
})();
