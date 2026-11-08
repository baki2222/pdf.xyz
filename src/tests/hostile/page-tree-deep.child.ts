// PS-05 child: a /Pages chain `depth` nodes deep (argv[3], one page at the
// bottom) through ONE entry point (argv[2]), reported as a plain object. Run
// through runBounded: pdf-lib parses and walks synchronously, so a regressed
// recursion would block vitest itself.
import { PdfEngineError } from "../../lib/pdf/engine-errors";
import { getPageCount, getPageRotations } from "../../lib/pdf/engine";
import { countPdfPagesDetailed } from "../../lib/pdf/page-count";
import { probePdf } from "../../lib/pdf/probe";
import { reportResult } from "./report";
import { deepPageTreeObjects, rawPdf } from "./page-structure.raw";

const [, , entry = "getPageCount", depthArg = "50000"] = process.argv;
const bytes = rawPdf({ objects: deepPageTreeObjects(Number(depthArg)) });

(async () => {
  try {
    let value: unknown;
    if (entry === "getPageCount") value = await getPageCount(bytes);
    else if (entry === "getPageRotations")
      value = await getPageRotations(bytes);
    else if (entry === "count")
      value = await countPdfPagesDetailed(bytes, Number.POSITIVE_INFINITY);
    else if (entry === "probe")
      value = (await probePdf(bytes, { maxBytes: Number.POSITIVE_INFINITY }))
        .pages;
    else throw new Error(`unknown entry ${entry}`);
    reportResult({ settled: value });
  } catch (err) {
    reportResult({
      threw: (err as Error)?.name,
      typed: err instanceof PdfEngineError,
      message: (err as Error)?.message,
    });
  }
})();
