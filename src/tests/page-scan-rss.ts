/**
 * Run the PowerPoint page reader over one PDF in a FRESH process and report
 * its peak memory: `tsx src/tests/page-scan-rss.ts <file.pdf>`.
 *
 * A process's peak resident set (`resourceUsage().maxRSS`) only rises, so it
 * cannot be read inside a test runner that has already decoded other
 * fixtures. This script warms pdf.js up on a one-page PDF first (loading the
 * library and its fonts is not the page's cost), reads the peak, scans the
 * file, and reads it again. Prints one line of JSON: numbers only.
 */
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { scanPdfPages } from "@/lib/workers/pdf-office-export/page-scan";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("usage: page-scan-rss.ts <file.pdf>");
  const warm = await PDFDocument.create();
  const font = await embedDrawingFont(warm, ["warm"]);
  warm.addPage([200, 200]).drawText("warm", { x: 20, y: 100, size: 12, font });
  await scanPdfPages(await warm.save());
  const bytes = new Uint8Array(readFileSync(file));
  const before = process.resourceUsage().maxRSS;
  const t0 = Date.now();
  const scan = await scanPdfPages(bytes);
  const ms = Date.now() - t0;
  const after = process.resourceUsage().maxRSS;
  console.log(
    JSON.stringify({
      warmMb: Math.round(before / 1024),
      peakMb: Math.round(after / 1024),
      ms,
      tooLarge: scan.tooLargeImages,
      pictures: scan.pages.reduce(
        (n, p) =>
          n +
          p.items.filter((i) => i.kind === "picture" && i.role === "image")
            .length,
        0,
      ),
    }),
  );
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
