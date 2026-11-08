// SIB-02 verify child: run ONE entry point on the H18 xref /W [0 0 0] fixture
// and print the outcome. The parent bounds heap and wall time.
import { loadPdfLib } from "../../lib/pdf/pdf-lib";
import { readXref } from "../../lib/pdf/security/document";
import { openProtectedPdf } from "../../lib/pdf/security/protected-pdf";
import { ONE_PAGE, xrefStreamPdf } from "./security-in-browser.fixtures";

const [, , entry = "readXref", ...rest] = process.argv;
const index = rest.length > 0 ? rest.join(" ") : "[0 2147483647]";
const bytes = xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 0]", index });
const t0 = Date.now();
const tick = setInterval(() => {
  const m = process.memoryUsage();
  console.log(
    `t=${Date.now() - t0}ms rss=${(m.rss / 1e6) | 0}MB heap=${(m.heapUsed / 1e6) | 0}MB`,
  );
}, 1000);
(async () => {
  console.log(`bytes=${bytes.length} entry=${entry} index=${index}`);
  try {
    if (entry === "readXref") {
      const lib = await loadPdfLib();
      const x = await readXref(lib, bytes);
      console.log(`RESULT settled entries=${x.entries.size}`);
    } else {
      const r = await openProtectedPdf(bytes);
      console.log(`RESULT settled ${JSON.stringify(r).slice(0, 200)}`);
    }
  } catch (e) {
    console.log(
      `RESULT threw ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`,
    );
  }
  clearInterval(tick);
  console.log(
    `elapsed=${Date.now() - t0}ms maxRSS=${(process.resourceUsage().maxRSS / 1024) | 0}MB`,
  );
})();
