/**
 * SIB-05 adversarial verification probe. Run as
 *   node --import tsx src/tests/hostile/sib05-probe.ts <fixture> <entry>
 * one cell per process, so RSS growth is the cell's own. Prints one JSON line.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import {
  ONE_PAGE,
  ownerOnlyEncrypted,
  zeroBomb,
} from "./security-in-browser.fixtures";

const reflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));

const fixtures: Record<string, () => Uint8Array> = {
  control: () => ownerOnlyEncrypted(ONE_PAGE, { layout: "stream" }),
  bomb: () =>
    ownerOnlyEncrypted(ONE_PAGE, {
      xrefBody: zeroBomb(1024),
      xrefDict: "/Filter /FlateDecode",
    }),
  chained: () =>
    ownerOnlyEncrypted(ONE_PAGE, {
      xrefBody: reflate(zeroBomb(1024)),
      xrefDict: "/Filter [/FlateDecode /FlateDecode]",
    }),
};

const requireHere = createRequire(`${process.cwd()}/package.json`);

let peak = 0;
const timer = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage.rss());
}, 10);

async function main() {
  const [, , fx, entry] = process.argv;
  const bytes = fixtures[fx!]!();
  const pdfjs = await import(
    pathToFileURL(requireHere.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
  );
  const { loadPdfLib } = await import("@/lib/pdf/pdf-lib");
  await loadPdfLib();
  const start = process.memoryUsage.rss();
  peak = start;
  const t0 = performance.now();
  let value: unknown;
  try {
    switch (entry) {
      case "classify": {
        const { classifyPdfAccess } = await import("@/lib/pdf/encryption");
        value = await classifyPdfAccess(bytes, pdfjs);
        break;
      }
      case "readXref": {
        const { readXref } = await import("@/lib/pdf/security/document");
        const x = await readXref(await loadPdfLib(), bytes);
        value = { entries: x.entries.size };
        break;
      }
      case "openProtected": {
        const { openProtectedPdf } =
          await import("@/lib/pdf/security/protected-pdf");
        const r = await openProtectedPdf(bytes);
        value = r.kind === "opened" ? { kind: r.kind } : r;
        break;
      }
      case "openWrongPassword": {
        const { openWithPassword } =
          await import("@/lib/pdf/security/open-with-password");
        const r = await openWithPassword(bytes, "definitely-not-it");
        value = r.kind === "opened" ? { kind: r.kind } : r;
        break;
      }
      case "openProtectedCopy": {
        const { openProtectedCopy } =
          await import("@/components/tools/runner/open-protected");
        const file = new File([bytes.slice()], "x.pdf", {
          type: "application/pdf",
        });
        const r = await openProtectedCopy(file, bytes, "pdf-lib");
        value = r ? { pageCount: r.pageCount } : null;
        break;
      }
    }
  } catch (e) {
    value = { threw: String((e as Error)?.message ?? e).slice(0, 200) };
  }
  peak = Math.max(peak, process.memoryUsage.rss());
  clearInterval(timer);
  console.log(
    JSON.stringify({
      fx,
      entry,
      size: bytes.length,
      ms: Math.round(performance.now() - t0),
      growthMb: Math.round((peak - start) / 1048576),
      value,
    }),
  );
  process.exit(0);
}
void main();
